// Morning-shift drain for fresh outreach drafts
// (`source_type: lead_qualification`). Mirrors send-approved-followups
// but with two added safety rails:
//
//   1. Daily send cap — only up to DEFAULT_OUTREACH_DAILY_SEND_CAP
//      drafts auto-send per morning run. The rest stay in the
//      pending-approval store and keep their Discord cards so the
//      operator can still click-approve them manually. Starts small,
//      scales up as the clean-run streak grows.
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

import {
  buildDiscordApi,
  deleteApprovalCard,
  isDatabaseReceiptPending,
  markApprovalCardReceiptPending,
} from './send-approved-followups.mjs';
import { runPresendChecks } from './outreach-presend-checks.mjs';
import { createSupabaseApiHeaders } from '../../../services/lib/supabase-api-headers.mjs';

// ─── Daily send cap ─────────────────────────────────────────────────
// Edit this value to change how many outreach drafts auto-send per
// morning run. Set to Infinity to send every approved draft without
// a daily cap.
//
// Cap history:
//   2026-10-22 → 5  initial ship; validate pre-send gates on live mail
//   2026-11-06 → 50 16-day clean streak (follow-ups 114/114 @ up to 28
//                   per morning; outreach 25/25 sent, 25 correctly
//                   skipped by suppression gate, 0 failures). Backlog
//                   of ~271 approved drafts needs throughput to drain.
export const DEFAULT_OUTREACH_DAILY_SEND_CAP = 50;

const DEFAULT_SLEEP_MS = 800;

// Resolve the domain for a pending outreach task. Prefers the explicit
// `lead_domain` field (set by the drafter), falls back to parsing the
// recipient address so legacy tasks without that field still work.
export function domainOfTask(task) {
  const explicit = String(task?.lead_domain || '').trim().toLowerCase();
  if (explicit) return explicit;
  const addr = String(task?.email_request?.to || '').trim();
  const at = addr.lastIndexOf('@');
  return at === -1 ? '' : addr.slice(at + 1).toLowerCase();
}

// Pick the next batch of approved outreach drafts to auto-send.
//
// 2026-11-13: added per-domain dedup at pick time. The pending-approval
// backlog is dominated by same-domain siblings (3-6 drafts at
// electricbrothers.nl, stukadoors-gulmercan.nl, etc.), and the send
// loop was already collapsing them to one send/morning via its in-batch
// `sentDomains` guard. That meant cap=50 was consistently sending only
// ~20 unique-domain emails. Deduping BEFORE the slice gives us up to
// `cap` real sends per morning instead. Tasks without a resolvable
// domain (legacy / malformed) are not deduped — they go through as-is
// and the send-loop guard is still there as defense in depth.
export function pickApprovedOutreachSends(tasks, { cap = DEFAULT_OUTREACH_DAILY_SEND_CAP } = {}) {
  const sorted = (Array.isArray(tasks) ? tasks : [])
    .filter((t) => (
      t?.source_type === 'lead_qualification'
      && t?.runtime_action === 'gmail_send_draft'
      && t?.database_receipt_pending !== true
    ))
    .sort((a, b) => String(a.task_id).localeCompare(String(b.task_id)));
  const seenDomains = new Set();
  const deduped = [];
  for (const task of sorted) {
    const domain = domainOfTask(task);
    if (!domain) {
      deduped.push(task);
      continue;
    }
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    deduped.push(task);
  }
  if (!Number.isFinite(cap)) return deduped;
  if (cap <= 0) return [];
  return deduped.slice(0, cap);
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
  if (isDatabaseReceiptPending(result)) {
    deps.upsertPersistedPendingTask(deps.config, {
      ...task,
      database_receipt_pending: true,
      delivery_state: 'sent_receipt_pending',
      receipt_pending_since: new Date().toISOString(),
    });
    const cardResult = await deps.markApprovalCardReceiptPending({
      config: deps.config,
      taskId: task.task_id,
      discordApi: deps.discordApi,
      searchApprovalMessageInThreads: deps.searchApprovalMessageInThreads,
    }).catch((error) => ({ updated: false, reason: 'update_failed', error: error.message || String(error) }));
    return {
      ok: true,
      skipped: false,
      receiptPending: true,
      taskId: task.task_id,
      to: task.email_request?.to,
      cardUpdated: Boolean(cardResult?.updated),
      cardReason: cardResult?.updated ? null : (cardResult?.reason || null),
    };
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
      headers: createSupabaseApiHeaders(apiKey, {
        'Content-Type': 'application/json',
      }),
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
    upsertPersistedPendingTask = () => {},
    searchApprovalMessageInThreads,
    fetchImpl = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    sleepMs = DEFAULT_SLEEP_MS,
    cap = DEFAULT_OUTREACH_DAILY_SEND_CAP,
    perDomainDailyCap,
    discordApi: discordApiOverride = null,
    deleteApprovalCard: deleteApprovalCardOverride = null,
    markApprovalCardReceiptPending: markApprovalCardReceiptPendingOverride = null,
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
  const doMarkReceiptPending = markApprovalCardReceiptPendingOverride || markApprovalCardReceiptPending;
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
  // In-batch domain dedup (added 2026-10-27, now defense in depth).
  // As of 2026-11-13 pickApprovedOutreachSends already dedupes by
  // domain, so this guard should rarely fire — it stays to catch
  // legacy tasks without a resolvable domain that reach the send
  // loop through the fallback path, and any domain collision that
  // slips in through a non-pick code path.
  const sentDomains = new Set();

  for (const [i, task] of picks.entries()) {
    const marker = `[${i + 1}/${picks.length}] ${task.task_id} → ${task.email_request?.to || '(no-to)'}`;
    const taskDomain = domainOfTask(task);
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
        upsertPersistedPendingTask,
        deleteApprovalCard: doDeleteCard,
        markApprovalCardReceiptPending: doMarkReceiptPending,
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
