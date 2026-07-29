#!/usr/bin/env node
// Qualify-and-draft: reads status='new' leads, has Claude judge fit against
// VBJ's offers (fetching the lead's real site), and for qualified leads with
// a public email creates a Gmail draft routed through the same Discord
// approval flow as /email-draft — Approve/Reject buttons in #outreach-agent
// (draft + approval merged into one message), nothing sends without
// explicit approval.
//
// Usage:
//   node scripts/run-lead-qualification.mjs --limit 3
//   node scripts/run-lead-qualification.mjs --limit 5 --niche plumbing
//   node scripts/run-lead-qualification.mjs --dry-run   (qualify only, no draft/discord/db writes)
//   node scripts/run-lead-qualification.mjs --no-screenshot   (skip the playwright-cli visual step, text-only judgment)

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { fetchLeads, updateLead } from './lib/leadgen-supabase.mjs';
import { measurePageSpeed, qualifyLead } from '../services/leadgen-qualifier/src/qualifier.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import { upsertPersistedPendingTask } from '../services/discord-bot/src/pending-task-store.mjs';
import {
  buildNoticeDiscordPayload,
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from '../services/discord-bot/src/message-formatting.mjs';
import { buildApprovalButtons } from '../services/discord-bot/src/approval-buttons.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

// Headless-browser render for sites that 403 plain fetches — one page, one
// attempt, hard timeout, no crawling. Used only in --retry-unreachable mode.
function renderPageText(url) {
  const venvPython = resolve(projectRoot, '.venv-leadgen', 'bin', 'python3');
  const script = resolve(projectRoot, 'services', 'leadgen-scraper', 'render_page.py');
  const result = spawnSync(existsSync(venvPython) ? venvPython : 'python3', [script, url], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 90000,
  });

  const text = String(result.stdout || '').trim();
  return result.status === 0 && text ? text : null;
}

function buildTaskId(text) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fingerprint = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  return `TASK-${timestamp}-${fingerprint}${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function postToChannel(config, channelId, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Discord post failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

// Mirrors the live bot's fanOutOutboundEvents closely enough for this
// standalone script: resolve channel by key, format the event, attach
// Approve/Reject buttons on approval requests.
async function dispatchOutboundEvents(config, outboundEvents = []) {
  for (const outboundEvent of outboundEvents) {
    const channelId = config.channelIds[outboundEvent.channelKey];
    if (!channelId) {
      continue;
    }

    if (outboundEvent.type === 'approval_request') {
      // approverMentions must be a joined string (it becomes the message's
      // `content` verbatim) — this previously stayed an array and only
      // "worked" by accident, since a single-element array stringifies to
      // its bare element; it also never included operatorUserIds at all, so
      // the individual operator (lachkid) was never actually pinged here,
      // only the operator role — unlike #approvals, which pings both.
      const roleMentions = config.operatorRoleId ? [`<@&${config.operatorRoleId}>`] : [];
      const userMentions = (config.operatorUserIds || []).map((userId) => `<@${userId}>`);
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: [...roleMentions, ...userMentions].join(' '),
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));
    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId, {
        isEmailAction: Boolean(outboundEvent.metadata?.emailTo),
      });
    }

    await postToChannel(config, channelId, body);
  }
}

// executeTask() for gmail_create_draft returns a redundant pair for lead
// outreach: an 'agentResults' notice ("Gmail draft created for X") and a
// separate 'approvals' request with Approve/Reject buttons — the approval
// embed already carries the full draft (To/Subject/Body), so the notice is
// dropped here and the approval alone is redirected into #outreach-agent.
// That gives one message with the draft AND the buttons instead of two
// messages split across two channels (operator request, 2026-07-20).
// Falls back to the original 'approvals' channel key if DISCORD_OUTREACH_
// AGENT_CHANNEL_ID isn't configured yet, so nothing silently stops posting.
async function dispatchLeadOutreachEvents(config, outboundEvents = []) {
  const hasOutreachChannel = Boolean(config.channelIds.outreachAgent);
  const merged = outboundEvents
    .filter((outboundEvent) => outboundEvent.channelKey !== 'agentResults')
    .map((outboundEvent) => (
      outboundEvent.type === 'approval_request' && hasOutreachChannel
        ? { ...outboundEvent, channelKey: 'outreachAgent' }
        : outboundEvent
    ));

  await dispatchOutboundEvents(config, merged);
}

async function createDraftWithApproval(config, lead, qualification) {
  const subject = String(qualification.draft_subject || '').trim();
  const bodyText = String(qualification.draft_body || '').trim();
  const task = {
    task_id: buildTaskId(`${lead.id}:${subject}`),
    source_type: 'lead_qualification',
    source_channel: 'leadGeneration',
    submitted_by: 'lead-qualifier',
    submitted_at: new Date().toISOString(),
    summary: lead.source_url
      ? `Draft outreach to [${lead.business_name}](${lead.source_url}) (${qualification.offer_angle})`
      : `Draft outreach to ${lead.business_name} (${qualification.offer_angle})`,
    full_text: `draft email to ${lead.contact_email} subject: ${subject} body: ${bodyText}`,
    target_agent: 'outreach-agent',
    domain: 'sales',
    priority: 'normal',
    approval_required: false,
    status: 'queued',
    runtime_action: 'gmail_create_draft',
    email_request: { to: lead.contact_email, subject, bodyText },
    lead_id: lead.id,
    lead_domain: lead.domain,
    lead_business_name: lead.business_name,
    lead_source_url: lead.source_url || '',
  };

  const result = await executeTask(task, config);
  if (result.outcome !== 'completed') {
    throw new Error(result.error?.message || 'Gmail draft creation failed.');
  }

  const pendingApprovalTask = result.executionResult?.report?.pendingApprovalTask;
  if (pendingApprovalTask) {
    upsertPersistedPendingTask(config, pendingApprovalTask);
  }

  await dispatchLeadOutreachEvents(config, result.outboundEvents);
  return task.task_id;
}

async function main() {
  const limit = Number(getArgValue('--limit', '3'));
  const niche = getArgValue('--niche', '');
  const dryRun = hasFlag('--dry-run');
  const retryUnreachable = hasFlag('--retry-unreachable');
  const redraftRejected = hasFlag('--redraft-rejected');
  // Re-check leads that were qualified but dropped for a missing email — the
  // qualifier now hunts for the address on the site itself, so many are
  // recoverable (see the email-recovery block below).
  const recoverEmails = hasFlag('--recover-emails');
  const noScreenshot = hasFlag('--no-screenshot');
  const config = loadRuntimeConfig();

  const status = redraftRejected ? 'draft_rejected'
    : recoverEmails ? 'qualified_no_email'
    : (retryUnreachable ? 'site_unreachable' : 'new');

  // Oldest first so the backlog drains in discovery order. (Server-side
  // ascending order — reversing a newest-N window silently skipped the
  // true oldest once the table outgrew the window.)
  const allNew = await fetchLeads({
    status,
    niche: niche || undefined,
    limit: 100,
    order: 'oldest',
  });
  // Cap at the fetch window, not a hard 10 — the old Math.min(limit, 10)
  // silently clamped every run to 10 regardless of --limit (so a --limit 20
  // night shift only ever did 10).
  const batch = allNew.slice(0, Math.max(1, Math.min(limit, 100)));

  if (batch.length === 0) {
    process.stdout.write(`No leads with status=${status} to process.\n`);
    return;
  }

  const outcomes = [];
  for (const lead of batch) {
    // Slow site = concrete website-builder signal; measured before the
    // judgment call so the real number can land in the draft.
    const pageSpeed = await measurePageSpeed(
      lead.source_url,
      config.env.PAGESPEED_API_KEY || process.env.PAGESPEED_API_KEY,
    );

    // In retry mode the site blocked plain fetches last time — render it
    // once with a real browser and hand the text to the qualifier.
    const renderedSiteText = retryUnreachable ? renderPageText(lead.source_url) : null;

    // In redraft mode, feed the operator's saved rejection feedback back into
    // the qualifier so the new draft addresses exactly what they flagged.
    const operatorFeedback = redraftRejected ? (lead.qualification?.rejection_feedback || null) : null;

    let qualification;
    try {
      qualification = await qualifyLead(lead, config, { pageSpeed, renderedSiteText, enableScreenshot: !noScreenshot, operatorFeedback });
    } catch (error) {
      // sourceUrl must be included here too — omitting it silently drops the
      // markdown link for every errored lead in the summary message (this is
      // exactly what happened during the ENOENT-broken run: every one of the
      // 10 leads hit this path, so the whole summary showed plain text names).
      outcomes.push({ lead: lead.business_name, sourceUrl: lead.source_url, error: error.message });
      continue;
    }
    qualification.page_speed = pageSpeed;

    // Email recovery: the local Ollama extractor misses emails that ARE on the
    // site (elbouw.com showed info@elbouw.com yet was stored with none) — and a
    // qualified lead without an email is dropped from outreach entirely. 23
    // leads had been lost this way. Claude is already reading the site here, so
    // trust a discovered address, but only if it's plausibly real and on-domain
    // or a common provider — never let a hallucinated address reach a draft.
    const discoveredEmail = String(qualification.contact_email || '').trim().toLowerCase();
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(discoveredEmail);
    if (!lead.contact_email && emailLooksValid) {
      lead.contact_email = discoveredEmail;
      qualification.contact_email_recovered = true;
      if (!dryRun) {
        await updateLead(lead.id, { contact_email: discoveredEmail }).catch(() => {});
      }
    }

    let status;
    let approvalTaskId = null;
    if (qualification.decision === 'qualified') {
      status = lead.contact_email ? 'qualified' : 'qualified_no_email';
    } else if (qualification.decision === 'extraction_error') {
      status = 'extraction_error';
    } else if (qualification.decision === 'unverifiable') {
      // Site blocked our fetch — parked for retry, not a verdict on the
      // business. Left as 'new' would retry immediately (and hammer a site
      // that's rate-limiting us); a distinct status lets a later pass
      // re-queue these deliberately.
      status = 'site_unreachable';
    } else {
      status = 'rejected_fit';
    }

    if (!dryRun && status === 'qualified') {
      try {
        approvalTaskId = await createDraftWithApproval(config, lead, qualification);
      } catch (error) {
        outcomes.push({ lead: lead.business_name, decision: qualification.decision, draftError: error.message });
        status = 'qualified_draft_failed';
      }
    }

    if (!dryRun) {
      await updateLead(lead.id, {
        status,
        // Re-qualifying REPLACES this jsonb, which silently wiped the operator's
        // rejection feedback (it had done its job feeding the redraft, but the
        // audit trail vanished — TFG lost its "te Engels / ziet er oud uit" note
        // this way). Carry the rejection history forward explicitly.
        qualification: {
          ...qualification,
          ...(lead.qualification?.rejection_feedback ? {
            rejection_feedback: lead.qualification.rejection_feedback,
            rejected_by: lead.qualification.rejected_by,
            rejected_at: lead.qualification.rejected_at,
            redrafted_after_feedback_at: new Date().toISOString(),
          } : {}),
          approval_task_id: approvalTaskId,
          qualified_by: 'claude',
        },
        qualified_at: new Date().toISOString(),
      });
    }

    recordOpsMetric(config, 'lead_qualification', {
      leadId: lead.id,
      domain: lead.domain,
      decision: qualification.decision,
      status,
      offerAngle: qualification.offer_angle || '',
      approvalTaskId: approvalTaskId || '',
      dryRun,
    });

    outcomes.push({
      lead: lead.business_name,
      domain: lead.domain,
      sourceUrl: lead.source_url,
      leadAgeDays: Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000),
      decision: qualification.decision,
      status,
      offer_angle: qualification.offer_angle,
      confidence: qualification.confidence,
      lcp_seconds: pageSpeed?.lcp_seconds ?? null,
      screenshot_reviewed: qualification.screenshot_reviewed ?? null,
      reasoning: qualification.reasoning || '',
      approvalTaskId,
    });
  }

  // Summary goes to #lead-qualification-agent (operator request — #lead-
  // generation is for discovery activity; qualification/outreach is the
  // sales side). Per-lead drafts + approvals go to #outreach-agent instead,
  // via dispatchLeadOutreachEvents above.
  const channelId = config.channelIds.leadQualificationAgent
    || config.channelIds.leadGeneration
    || config.channelIds.agentResults;
  if (!dryRun && channelId && config.env.DISCORD_BOT_TOKEN) {
    // A per-lead list alone forces the operator to read every line to find
    // out why "10 qualified" produced only 3 drafts — a rollup up front
    // answers that at a glance (operator feedback, 2026-07-21).
    const draftCount = outcomes.filter((o) => o.approvalTaskId).length;
    const noEmailCount = outcomes.filter((o) => o.status === 'qualified_no_email').length;
    const draftFailedCount = outcomes.filter((o) => o.status === 'qualified_draft_failed').length;
    const rejectedCount = outcomes.filter((o) => o.status === 'rejected_fit').length;
    const unreachableCount = outcomes.filter((o) => o.status === 'site_unreachable').length;
    const extractionErrorCount = outcomes.filter((o) => o.status === 'extraction_error').length;
    const failedCount = outcomes.filter((o) => o.error).length;

    const rollupParts = [
      draftCount > 0 ? `**${draftCount}** draft(s) awaiting approval in #outreach-agent` : '',
      noEmailCount > 0 ? `**${noEmailCount}** qualified but no email found (no draft possible)` : '',
      draftFailedCount > 0 ? `**${draftFailedCount}** qualified but draft creation failed` : '',
      rejectedCount > 0 ? `**${rejectedCount}** rejected — weak fit` : '',
      unreachableCount > 0 ? `**${unreachableCount}** site unreachable (parked for retry)` : '',
      extractionErrorCount > 0 ? `**${extractionErrorCount}** extraction error` : '',
      failedCount > 0 ? `**${failedCount}** qualification call failed (timeout/error — stays \`new\`, retried in a future run)` : '',
    ].filter(Boolean);

    // Each lead gets a "full" line (with reasoning) and a "short" fallback
    // (without it). When the qualification limit is bumped above 10, the full
    // detail can approach Discord's 4096-char embed cap — so the rollup header
    // is always kept, then lines are added within a budget: full detail while
    // it fits, dropping the reasoning suffix when it doesn't, and finally a
    // "…and N more" note rather than a hard mid-word truncation (operator
    // flagged this as a thing to watch when raising the limit, 2026-07-22).
    const DESCRIPTION_BUDGET = 3900; // headroom under the 4096 hard cap
    const header = `Processed ${outcomes.length} lead(s) — ${rollupParts.join(', ')}.`;

    const rendered = outcomes.map((o) => {
      const name = o.sourceUrl ? `[${o.lead}](${o.sourceUrl})` : o.lead;
      if (o.error) return { full: `- ${name}: qualification failed (${o.error.slice(0, 80)})`, short: `- ${name}: qualification failed` };
      if (o.draftError) return { full: `- ${name}: qualified but draft failed (${o.draftError.slice(0, 80)})`, short: `- ${name}: qualified but draft failed` };
      const angle = o.offer_angle ? ` — ${o.offer_angle}` : '';
      const lcp = Number.isFinite(o.lcp_seconds) ? `, LCP ${o.lcp_seconds}s` : '';
      const age = Number.isFinite(o.leadAgeDays) ? ` (found ${o.leadAgeDays}d ago${lcp})` : '';
      const approval = o.approvalTaskId ? ` (draft awaiting approval: ${o.approvalTaskId})` : '';
      const why = (o.status === 'rejected_fit' || o.status === 'extraction_error') && o.reasoning
        ? ` — ${o.reasoning.slice(0, 200)}`
        : '';
      const short = `- ${name}: **${o.status}**${angle}${age}${approval}`;
      return { full: `${short}${why}`, short };
    });

    const bodyLines = [];
    let used = header.length + 2; // + the "\n\n" separator
    for (let i = 0; i < rendered.length; i += 1) {
      const { full, short } = rendered[i];
      const pick = used + full.length + 1 <= DESCRIPTION_BUDGET
        ? full
        : (used + short.length + 1 <= DESCRIPTION_BUDGET ? short : null);
      if (pick === null) {
        bodyLines.push(`…and ${rendered.length - i} more (see the full log / leads table)`);
        break;
      }
      bodyLines.push(pick);
      used += pick.length + 1;
    }

    // Title reflects WHICH mode ran — a redraft/recovery run posting as plain
    // "Lead Qualification" was misleading (operator flagged this, 2026-07-27).
    const runTitle = redraftRejected ? 'Lead Qualification — Redraft (rejected drafts)'
      : recoverEmails ? 'Lead Qualification — Email recovery'
      : retryUnreachable ? 'Lead Qualification — Retry (unreachable sites)'
      : 'Lead Qualification';
    await postToChannel(config, channelId, buildNoticeDiscordPayload({
      title: runTitle,
      description: `${header}\n\n${bodyLines.join('\n')}`,
      color: 0x5865F2,
      footerText: 'Ruflo lead qualification',
    }));
  }

  process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Lead qualification failed: ${error.message}\n`);
  process.exitCode = 1;
});
