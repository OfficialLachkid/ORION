// Morning-shift drain for fresh outreach drafts
// (`source_type: lead_qualification`). Mirrors send-approved-followups
// but with two added safety rails:
//
//   1. Daily send cap — only up to DEFAULT_OUTREACH_DAILY_SEND_CAP
//      drafts auto-send per morning run. The rest stay in the
//      pending-approval store and keep their Discord cards so the
//      operator can still click-approve them manually. Start small,
//      scale up as confidence grows.
//
//   2. Pre-send checks — each candidate runs through
//      outreach-presend-checks.mjs (suppression, body shape,
//      drafter-leakage patterns, per-domain daily cap). Rejected
//      drafts stay in the store with their cards; a stdout log line
//      documents the reason so the operator can see it in the
//      LaunchAgent log.
//
// Follow-ups continue to run through send-approved-followups.mjs
// unchanged — the follow-up SLA is tight and we don't want to add
// latency or new failure modes to that path.

import { buildDiscordApi, deleteApprovalCard } from './send-approved-followups.mjs';
import { runPresendChecks } from './outreach-presend-checks.mjs';

// ─── Daily send cap ─────────────────────────────────────────────────
// Edit this value to change how many outreach drafts auto-send per
// morning run. Start at 5 and scale up as confidence grows. Set to
// Infinity to send every approved draft without a daily cap.
export const DEFAULT_OUTREACH_DAILY_SEND_CAP = 5;

const DEFAULT_SLEEP_MS = 800;

export function pickApprovedOutreachSends(tasks, { cap = DEFAULT_OUTREACH_DAILY_SEND_CAP } = {}) {
  const sorted = (Array.isArray(tasks) ? tasks : [])
    .filter((t) => t?.source_type === 'lead_qualification' && t?.runtime_action === 'gmail_send_draft')
    .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
  if (!Number.isFinite(cap)) return sorted;
  if (cap <= 0) return [];
  return sorted.slice(0, cap);
}

export async function sendOneOutreachDraft(task, deps) {
  const presend = await runPresendChecks(task, {
    supabaseFetch: deps.supabaseFetch,
    leadsTable: deps.leadsTable,
    cap: deps.perDomainDailyCap,
    nowIso: deps.nowIso,
  });
  if (!presend.ok) {
    return { ok: false, skipped: true, taskId: task.task_id, to: task.email_request?.to, reason: presend.reason };
  }
  const result = await deps.executeTask(task, deps.config);
  if (result?.outcome !== 'completed') {
    const message = result?.error?.message || 'executeTask did not complete';
    return { ok: false, skipped: false, taskId: task.task_id, to: task.email_request?.to, error: message };
  }
  deps.removePersistedPendingTask(deps.config, task.task_id);
  const cardResult = await deps.deleteApprovalCard({
    config: deps.config,
    taskId: task.task_id,
    discordApi: deps.discordApi,
    searchApprovalMessageInThreads: deps.searchApprovalMessageInThreads,
  }).catch((error) => ({ deleted: false, reason: 'delete_failed', error: error.message || String(error) }));
  return {
    ok: true,
    skipped: false,
    taskId: task.task_id,
    to: task.email_request?.to,
    cardDeleted: Boolean(cardResult?.deleted),
    cardReason: cardResult?.deleted ? null : (cardResult?.reason || null),
  };
}

// Loose builder: lets a caller inject a custom supabaseFetch for
// tests. In production (run-morning-shift.mjs) we build one from the
// runtime config's Supabase URL + API key.
export function buildSupabaseFetch(config) {
  const url = config?.env?.SUPABASE_URL || '';
  const apiKey = config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '';
  if (!url || !apiKey) return null;
  return async (path) => {
    const response = await globalThis.fetch(new URL(`/rest/v1/${path}`, url), {
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) throw new Error(`Supabase ${path} → ${response.status}`);
    return response.json();
  };
}

export async function sendApprovedOutreach(options) {
  const {
    config,
    executeTask,
    loadPersistedPendingTasks,
    removePersistedPendingTask,
    searchApprovalMessageInThreads,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    sleepMs = DEFAULT_SLEEP_MS,
    cap = DEFAULT_OUTREACH_DAILY_SEND_CAP,
    perDomainDailyCap,
    discordApi: discordApiOverride = null,
    deleteApprovalCard: deleteApprovalCardOverride = null,
    supabaseFetch: supabaseFetchOverride = null,
    leadsTable = 'leads',
    nowIso,
    stdout = process.stdout,
  } = options;

  if (typeof executeTask !== 'function') throw new Error('executeTask dependency is required');
  if (typeof loadPersistedPendingTasks !== 'function') throw new Error('loadPersistedPendingTasks dependency is required');
  if (typeof removePersistedPendingTask !== 'function') throw new Error('removePersistedPendingTask dependency is required');
  if (typeof searchApprovalMessageInThreads !== 'function') throw new Error('searchApprovalMessageInThreads dependency is required');

  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  const discordApi = discordApiOverride || buildDiscordApi(token, fetchImpl, sleep);
  const doDeleteCard = deleteApprovalCardOverride || deleteApprovalCard;
  const supabaseFetch = supabaseFetchOverride || buildSupabaseFetch(config);

  const pending = loadPersistedPendingTasks(config);
  const picks = pickApprovedOutreachSends(pending, { cap });
  const matched = (Array.isArray(pending) ? pending : []).filter((t) => t?.source_type === 'lead_qualification' && t?.runtime_action === 'gmail_send_draft').length;
  stdout.write(`[morning-shift:outreach] cap=${cap === Infinity ? 'none' : cap} matched=${matched} picked=${picks.length}\n`);
  if (picks.length === 0) {
    return { picked: 0, sent: 0, skipped: 0, failed: 0, cardsDeleted: 0, failures: [], outcomes: [], matched };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let cardsDeleted = 0;
  const failures = [];
  const outcomes = [];
  // In-batch domain dedup (added 2026-10-27 after the first live
  // morning run blasted 4 cold emails to the same recipient).
  // Supabase's per-domain cap check only looks at the leads table,
  // where fresh drafts have `last_contacted_at = null`, so a backlog
  // with multiple drafts to the same domain slipped past the gate.
  // We now also track every domain that already got a sent email in
  // THIS run and short-circuit the rest.
  const sentDomains = new Set();
  function domainOf(task) {
    const explicit = String(task?.lead_domain || '').trim().toLowerCase();
    if (explicit) return explicit;
    const addr = String(task?.email_request?.to || '').trim();
    const at = addr.lastIndexOf('@');
    return at === -1 ? '' : addr.slice(at + 1).toLowerCase();
  }

  for (const [i, task] of picks.entries()) {
    const marker = `[${i + 1}/${picks.length}] ${task.task_id} → ${task.email_request?.to || '(no-to)'}`;
    const taskDomain = domainOf(task);
    if (taskDomain && sentDomains.has(taskDomain)) {
      skipped += 1;
      const outcome = { ok: false, skipped: true, taskId: task.task_id, to: task.email_request?.to, reason: `in_batch_domain_duplicate:${taskDomain}` };
      outcomes.push(outcome);
      stdout.write(`[morning-shift:outreach] SKIPPED ${marker}: ${outcome.reason}\n`);
      if (i < picks.length - 1) await sleep(sleepMs);
      continue;
    }
    try {
      const outcome = await sendOneOutreachDraft(task, {
        config,
        executeTask,
        removePersistedPendingTask,
        deleteApprovalCard: doDeleteCard,
        discordApi,
        searchApprovalMessageInThreads,
        supabaseFetch,
        leadsTable,
        perDomainDailyCap,
        nowIso,
      });
      outcomes.push(outcome);
      if (outcome.ok) {
        sent += 1;
        if (outcome.cardDeleted) cardsDeleted += 1;
        if (taskDomain) sentDomains.add(taskDomain);
        stdout.write(`[morning-shift:outreach] sent ${marker}${outcome.cardDeleted ? ' (card deleted)' : ''}\n`);
      } else if (outcome.skipped) {
        skipped += 1;
        stdout.write(`[morning-shift:outreach] SKIPPED ${marker}: ${outcome.reason}\n`);
      } else {
        failed += 1;
        failures.push({ taskId: task.task_id, to: task.email_request?.to, error: outcome.error });
        stdout.write(`[morning-shift:outreach] FAILED ${marker}: ${outcome.error}\n`);
      }
    } catch (error) {
      failed += 1;
      failures.push({ taskId: task.task_id, to: task.email_request?.to, error: error.message || String(error) });
      outcomes.push({ ok: false, skipped: false, taskId: task.task_id, to: task.email_request?.to, error: error.message || String(error) });
      stdout.write(`[morning-shift:outreach] THREW ${marker}: ${error.message || error}\n`);
    }
    if (i < picks.length - 1) await sleep(sleepMs);
  }

  const summary = { picked: picks.length, sent, skipped, failed, cardsDeleted, matched, failures, outcomes };
  stdout.write(`[morning-shift:outreach] summary: ${JSON.stringify({ cap: cap === Infinity ? 'none' : cap, matched, picked: picks.length, sent, skipped, failed, cardsDeleted })}\n`);
  return summary;
}
