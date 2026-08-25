#!/usr/bin/env node
// Follow-up sequence (phase 2). Finds leads whose first outreach was SENT and
// went unanswered past the wait window, drafts ONE gentle follow-up per lead,
// and posts it approval-gated in the #outreach-followups thread. Nothing sends
// without an explicit approval click; on approval the follow-up goes out as a
// reply in the SAME Gmail thread.
//
// GATED on reply detection: if the Gmail read scope isn't authorized, this
// exits without drafting anything — following up blind (unable to see who
// replied) is exactly the outcome to avoid.
//
// Usage:
//   node scripts/run-follow-ups.mjs                 (default wait, from env or 4 days)
//   node scripts/run-follow-ups.mjs --wait-minutes 5   (short window for testing)
//   node scripts/run-follow-ups.mjs --dry-run          (find + draft, no draft/discord/db writes)

import { createHash, randomBytes } from 'node:crypto';
import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { fetchLeads, updateLead } from './lib/leadgen-supabase.mjs';
import { draftFollowUp } from '../services/leadgen-qualifier/src/follow-up-drafter.mjs';
import { getGmailThread, gmailReadScopeAvailable } from '../services/gmail/src/read.mjs';
import { resolveGmailConfig } from '../services/gmail/src/config.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import { upsertPersistedPendingTask } from '../services/discord-bot/src/pending-task-store.mjs';
import { buildOutboundEventDiscordPayload, upgradeLegacyDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';
import { buildApprovalButtons } from '../services/discord-bot/src/approval-buttons.mjs';

const DISCORD_API = 'https://discord.com/api/v10';
const DEFAULT_WAIT_MINUTES = 4 * 24 * 60; // 4 days
const MAX_FOLLOW_UPS = 1;

function getArg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}
function hasFlag(flag) { return process.argv.includes(flag); }

function buildTaskId(text) {
  const ts = new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fp = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  return `TASK-${ts}-${fp}${randomBytes(2).toString('hex').toUpperCase()}`;
}

function headerValue(message, name) {
  const h = message?.payload?.headers;
  if (!Array.isArray(h)) return '';
  const m = h.find((x) => String(x?.name || '').toLowerCase() === name.toLowerCase());
  return String(m?.value || '');
}

// Posts the follow-up approval into the #outreach-followups thread.
async function postApproval(config, outboundEvents) {
  const channelId = config.channelIds.outreachFollowups || config.channelIds.outreachAgent;
  for (const ev of outboundEvents) {
    if (ev.type !== 'approval_request') continue;
    ev.metadata = {
      ...ev.metadata,
      approverMentions: [
        ...(config.operatorRoleId ? [`<@&${config.operatorRoleId}>`] : []),
        ...((config.operatorUserIds || []).map((u) => `<@${u}>`)),
      ].join(' '),
      approverUserIds: config.operatorUserIds || [],
      approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
    };
    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(ev));
    if (ev.metadata?.taskId) body.components = buildApprovalButtons(ev.metadata.taskId, { isEmailAction: Boolean(ev.metadata?.emailTo) });
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Discord post failed (${res.status}): ${await res.text()}`);
  }
}

async function main() {
  const waitMinutes = Number(getArg('--wait-minutes', process.env.FOLLOW_UP_WAIT_MINUTES || DEFAULT_WAIT_MINUTES));
  const limit = Number(getArg('--limit', '10'));
  const dryRun = hasFlag('--dry-run');
  const config = loadRuntimeConfig();
  const gmailConfig = resolveGmailConfig(config);

  // Fail-safe: never follow up when we can't see replies.
  if (!(await gmailReadScopeAvailable(gmailConfig))) {
    process.stdout.write('Follow-ups skipped: Gmail read scope not authorized (reply detection unavailable).\n');
    return { skipped: 'no_read_scope', drafted: 0 };
  }

  const cutoff = Date.now() - waitMinutes * 60 * 1000;
  const sent = await fetchLeads({ status: 'sent', limit: 500 });
  const eligible = sent.filter((l) => {
    if (l.responded_at) return false; // replied — stop
    if (!l.contact_email || !l.qualification?.gmail_thread_id) return false;
    const followUps = Number(l.qualification?.follow_up_count || 0);
    if (followUps >= MAX_FOLLOW_UPS) return false;
    const lastAt = l.qualification?.last_follow_up_at || l.sent_at;
    return lastAt && new Date(lastAt).getTime() <= cutoff;
  }).slice(0, Math.max(1, limit));

  if (eligible.length === 0) {
    process.stdout.write('No leads due for a follow-up.\n');
    return { drafted: 0 };
  }

  let drafted = 0;
  const outcomes = [];
  for (const lead of eligible) {
    let followUp;
    try {
      followUp = await draftFollowUp(lead, config);
    } catch (error) {
      outcomes.push({ lead: lead.business_name, error: error.message });
      continue;
    }

    // Original Message-Id for proper In-Reply-To threading (best-effort).
    let inReplyTo = '';
    try {
      const thread = await getGmailThread(gmailConfig, lead.qualification.gmail_thread_id);
      const ours = (gmailConfig.senderEmail || '').toLowerCase();
      const ourMsg = (thread.messages || []).find((m) => headerValue(m, 'From').toLowerCase().includes(ours));
      inReplyTo = headerValue(ourMsg || thread.messages?.[0], 'Message-Id');
    } catch { /* threading header is a nicety */ }

    if (dryRun) {
      outcomes.push({ lead: lead.business_name, subject: followUp.draft_subject, body: followUp.draft_body });
      continue;
    }

    const subject = String(followUp.draft_subject || '').trim();
    const bodyText = String(followUp.draft_body || '').trim();
    const task = {
      task_id: buildTaskId(`${lead.id}:followup`),
      source_type: 'lead_follow_up',
      source_channel: 'outreachFollowups',
      submitted_by: 'follow-up-agent',
      submitted_at: new Date().toISOString(),
      summary: lead.source_url ? `Follow-up to [${lead.business_name}](${lead.source_url})` : `Follow-up to ${lead.business_name}`,
      full_text: `follow-up email to ${lead.contact_email} subject: ${subject} body: ${bodyText}`,
      target_agent: 'outreach-agent',
      domain: 'sales',
      priority: 'normal',
      approval_required: false,
      status: 'queued',
      runtime_action: 'gmail_create_draft',
      email_request: {
        to: lead.contact_email, subject, bodyText,
        threadId: lead.qualification.gmail_thread_id,
        inReplyTo, references: inReplyTo,
      },
      lead_id: lead.id,
      lead_domain: lead.domain,
      lead_business_name: lead.business_name,
      lead_source_url: lead.source_url || '',
    };

    const result = await executeTask(task, config);
    if (result.outcome !== 'completed') {
      outcomes.push({ lead: lead.business_name, error: result.error?.message || 'draft failed' });
      continue;
    }
    const pat = result.executionResult?.report?.pendingApprovalTask;
    if (pat) upsertPersistedPendingTask(config, pat);
    await postApproval(config, result.outboundEvents);

    await updateLead(lead.id, {
      qualification: {
        ...lead.qualification,
        follow_up_count: Number(lead.qualification?.follow_up_count || 0) + 1,
        last_follow_up_at: new Date().toISOString(),
        follow_up_task_id: task.task_id,
      },
    }).catch(() => {});

    recordOpsMetric(config, 'lead_follow_up', { leadId: lead.id, domain: lead.domain, taskId: task.task_id });
    drafted += 1;
    outcomes.push({ lead: lead.business_name, taskId: task.task_id, subject });
  }

  process.stdout.write(`${JSON.stringify({ drafted, outcomes }, null, 2)}\n`);
  return { drafted, outcomes };
}

main().catch((error) => {
  process.stderr.write(`Follow-up run failed: ${error.message}\n`);
  process.exitCode = 1;
});
