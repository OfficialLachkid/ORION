#!/usr/bin/env node
// Night shift — durable overnight maintenance. Runs the day's lead
// qualification in the operator's preferred pre-token-reset window (01:30),
// then posts a digest so they wake to reviewed results. Designed to survive
// what session-scoped CronCreate could not: it's a real launchd job.
//
// Rate-limit safety: the SAME script runs at 01:30 (primary) and 07:00
// (fallback, with --fallback). On a successful run it writes a per-day
// marker; the --fallback invocation exits immediately if today's marker
// already exists (so 07:00 is a no-op when the night shift succeeded), and
// runs the qualification itself when the marker is missing (so a rate-limited
// or failed 01:30 run is recovered at 07:00, never lost).
//
// v1 scope: qualification + digest + marker + fallback. Future layers
// (autonomous junk-lead cleanup, vault freshness, test health) are tracked
// in the vault's Night_Shift_Autonomous_Maintenance note and deliberately
// left out of v1 — those either need the operator's sign-off (autonomous
// deletes) or aren't schedulable headless (mining the interactive chat).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { fetchLeads } from './lib/leadgen-supabase.mjs';
import { reconcileDrafts } from './lib/draft-reconciler.mjs';
import { detectReplies } from './lib/reply-detector.mjs';
import { buildNoticeDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function todayStamp() {
  // LOCAL date, NOT UTC. The primary run (01:30) and the fallback (07:00) are
  // on the same LOCAL day but can straddle a UTC day boundary (01:30 CEST =
  // 23:30 UTC the previous day). Using UTC here meant the 01:30 run wrote
  // yesterday's UTC-dated marker and the 07:00 fallback looked for today's,
  // never matched, and re-ran qualification every day. Local date keeps both
  // on the same stamp.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function markerPath() {
  return resolve(projectRoot, 'data', 'night-shift', `${todayStamp()}.done`);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
}

async function postDiscord(config, channelId, payload) {
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return;
  }
  try {
    await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    process.stderr.write(`Night-shift digest post failed (non-fatal): ${error.message}\n`);
  }
}

// Runs the existing qualification script and returns its parsed outcomes.
// Systemic failure (every lead errored with the same startup-shaped error,
// e.g. a rate limit or ENOENT) is reported distinctly so the caller knows
// NOT to write the success marker — that's what lets the 07:00 fallback
// recover it.
function runQualification(limit) {
  return runQualificationScript([resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'), '--limit', String(limit)]);
}

// Re-drafts leads the operator rejected with feedback (status=draft_rejected):
// same qualification script, --redraft-rejected mode, which feeds each lead's
// saved rejection_feedback back into the qualifier so the new draft addresses
// it. Returns the parsed outcomes (empty if there were none to redraft).
function runRedraftRejected(limit) {
  return runQualificationScript([resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'), '--redraft-rejected', '--limit', String(limit)]);
}

// Drafts follow-ups for sent leads that passed the wait window without a reply
// (default 4 days; run-follow-ups reads FOLLOW_UP_WAIT_MINUTES if set). Itself
// gated on the Gmail read scope, so it no-ops until reply detection is live.
// Returns the count drafted (each approval-gated in #outreach-followups).
function runFollowUps(limit) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, 'scripts', 'run-follow-ups.mjs'), '--limit', String(limit)], {
    cwd: projectRoot, encoding: 'utf8', timeout: 30 * 60 * 1000,
  });
  const stdout = String(result.stdout || '');
  try {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return Number(JSON.parse(stdout.slice(start, end + 1)).drafted || 0);
    }
  } catch { /* fall through */ }
  return 0;
}

function runQualificationScript(args) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 60 * 60 * 1000, // 1h hard ceiling for the whole batch
  });

  const stdout = String(result.stdout || '');
  let outcomes = [];
  try {
    const start = stdout.indexOf('[');
    const end = stdout.lastIndexOf(']');
    if (start !== -1 && end > start) {
      outcomes = JSON.parse(stdout.slice(start, end + 1));
    }
  } catch {
    outcomes = [];
  }

  const ran = outcomes.length > 0;
  const allErrored = ran && outcomes.every((o) => o.error);
  const systemicFailure = (!ran && result.status !== 0) || allErrored;

  return { outcomes, systemicFailure, exitCode: result.status ?? -1, stderr: String(result.stderr || '') };
}

function buildDigest(outcomes, backlogCount, openDraftCount, extras = {}) {
  const n = outcomes.length;
  const drafted = outcomes.filter((o) => o.approvalTaskId).length;
  const noEmail = outcomes.filter((o) => o.status === 'qualified_no_email').length;
  const rejected = outcomes.filter((o) => o.status === 'rejected_fit').length;
  const unreachable = outcomes.filter((o) => o.status === 'site_unreachable').length;
  const extractionError = outcomes.filter((o) => o.status === 'extraction_error').length;
  const failed = outcomes.filter((o) => o.error).length;
  const { redrafted = 0, reconciled = 0, editedInGmail = 0, repointedInGmail = 0, followedUp = 0, replyResult = null } = extras;

  const parts = [
    drafted > 0 ? `**${drafted}** new draft(s) awaiting approval in #outreach-agent` : '',
    noEmail > 0 ? `**${noEmail}** qualified, no email` : '',
    rejected > 0 ? `**${rejected}** rejected (weak fit)` : '',
    unreachable > 0 ? `**${unreachable}** site unreachable` : '',
    extractionError > 0 ? `**${extractionError}** extraction error` : '',
    failed > 0 ? `**${failed}** call failed (retried next run)` : '',
  ].filter(Boolean);

  const replyLine = replyResult && replyResult.available === false
    ? `Reply detection is **paused** — Gmail needs re-authorizing with the read scope (follow-ups stay off until then).`
    : (replyResult && (replyResult.replies || replyResult.bounces || replyResult.autoReplies)
      ? `Replies checked: **${replyResult.replies}** reply, **${replyResult.bounces}** undeliverable, **${replyResult.autoReplies}** auto-reply (of ${replyResult.checked} sent thread(s)).`
      : '');

  const maintenance = [
    replyLine,
    followedUp > 0 ? `Drafted **${followedUp}** follow-up(s) for unanswered leads (approval-gated in #outreach-followups).` : '',
    redrafted > 0 ? `Re-drafted **${redrafted}** previously-rejected lead(s) using your feedback.` : '',
    reconciled > 0 ? `Reconciled **${reconciled}** draft(s) you sent manually in Gmail (marked sent, closed the approval).` : '',
    editedInGmail > 0 ? `Mirrored **${editedInGmail}** draft edit(s) you made in Gmail back into the Discord approval card.` : '',
    repointedInGmail > 0 ? `Repointed **${repointedInGmail}** draft(s) after mobile Gmail created a new draft on edit — the approval card now reflects your latest version.` : '',
  ].filter(Boolean);

  return [
    `Night shift processed **${n}** lead(s)${parts.length ? ' — ' + parts.join(', ') : ''}.`,
    ...(maintenance.length ? ['', ...maintenance] : []),
    ``,
    `Backlog: **${backlogCount}** leads still \`new\`. Open drafts awaiting your approval: **${openDraftCount}**.`,
  ].join('\n');
}

async function countOpenDrafts(config) {
  const channelId = config.channelIds.outreachAgent;
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return 0;
  }
  try {
    const res = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages?limit=50`, {
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}` },
    });
    const msgs = await res.json();
    return Array.isArray(msgs) ? msgs.filter((m) => m.embeds?.[0]?.title?.includes('Approval Needed')).length : 0;
  } catch {
    return 0;
  }
}

async function main() {
  const isFallback = hasFlag('--fallback');
  const limit = Number(getArgValue('--limit', '10'));
  const config = loadRuntimeConfig();
  const marker = markerPath();

  // Fallback (07:00): if the night shift already succeeded today, do nothing.
  if (isFallback && existsSync(marker)) {
    process.stdout.write(`Night shift already completed today (${marker}); fallback is a no-op.\n`);
    return;
  }

  const label = isFallback ? 'Night Shift (07:00 fallback)' : 'Night Shift';
  const { outcomes, systemicFailure, exitCode, stderr } = runQualification(limit);

  recordOpsMetric(config, 'night_shift_run', {
    fallback: isFallback,
    processed: outcomes.length,
    drafted: outcomes.filter((o) => o.approvalTaskId).length,
    systemicFailure,
    exitCode,
  });

  if (systemicFailure) {
    // Do NOT write the marker — let the next scheduled slot (07:00 fallback,
    // or tomorrow's 01:30) recover. Surface it so it isn't silently lost.
    process.stderr.write(`Night shift qualification failed systemically (exit ${exitCode}). No marker written — will retry at the next slot.\nstderr: ${stderr.slice(0, 500)}\n`);
    await postDiscord(config, config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration, buildNoticeDiscordPayload({
      title: `${label} — Failed`,
      description: `Qualification failed systemically (likely a usage/rate limit or startup error). No leads were processed. This will retry automatically at the next scheduled slot${isFallback ? ' (tomorrow 01:30)' : ' (07:00 today)'} — nothing is lost.`,
      color: 0xED4245,
      footerText: 'Ruflo night shift',
    }));
    process.exitCode = 1;
    return;
  }

  // Reply detection — the prerequisite for follow-ups. Read-only; a no-op
  // until Gmail is re-authorized with the read scope (reports available:false
  // in that case so follow-ups stay off). Runs BEFORE any follow-up logic so
  // responded_at/bounced are fresh.
  let replyResult = { available: false, replies: 0, bounces: 0, autoReplies: 0, checked: 0 };
  try {
    replyResult = await detectReplies(config);
  } catch (error) {
    process.stderr.write(`Reply-detection step failed (non-fatal): ${error.message}\n`);
  }

  // Re-draft any leads the operator rejected with feedback — each one's saved
  // rejection_feedback is fed back into the qualifier so the new draft
  // addresses it. Best-effort; a failure here never blocks the digest/marker.
  let redrafted = 0;
  try {
    const redraft = runRedraftRejected(limit);
    redrafted = redraft.outcomes.filter((o) => o.approvalTaskId).length;
  } catch (error) {
    process.stderr.write(`Redraft-rejected step failed (non-fatal): ${error.message}\n`);
  }

  // Draft follow-ups for sent leads that went unanswered past the wait window
  // (gated on the Gmail read scope, so a no-op until reply detection is live).
  let followedUp = 0;
  try {
    followedUp = runFollowUps(limit);
  } catch (error) {
    process.stderr.write(`Follow-up step failed (non-fatal): ${error.message}\n`);
  }

  // Reconcile drafts the operator touched in Gmail:
  //   - Drafts sent/deleted by hand → flip Discord approval to "sent", mark
  //     the lead sent, drop the pending task.
  //   - Drafts still pending but with edited subject/body → mirror the current
  //     Gmail content back into the pending-task store and rewrite the
  //     approval card's Subject/Body fields so the preview matches reality.
  let reconciled = 0;
  let editedInGmail = 0;
  let repointedInGmail = 0;
  try {
    const result = await reconcileDrafts(config);
    reconciled = result.sent;
    editedInGmail = result.edited;
    repointedInGmail = result.repointed;
  } catch (error) {
    process.stderr.write(`Draft reconcile step failed (non-fatal): ${error.message}\n`);
  }

  // Success (even a partial batch with a couple of timeouts counts) — mark
  // the day done and post the digest.
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, new Date().toISOString());

  const backlog = await fetchLeads({ status: 'new', limit: 2000 }).then((l) => l.length).catch(() => 0);
  const openDrafts = await countOpenDrafts(config);

  await postDiscord(config, config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration, buildNoticeDiscordPayload({
    title: label,
    description: buildDigest(outcomes, backlog, openDrafts, { redrafted, reconciled, editedInGmail, repointedInGmail, followedUp, replyResult }),
    color: 0x5865F2,
    footerText: 'Ruflo night shift',
  }));

  process.stdout.write(`${JSON.stringify({ processed: outcomes.length, redrafted, reconciled, editedInGmail, repointedInGmail, followedUp, backlog, openDrafts }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Night shift failed: ${error.message}\n`);
  process.exitCode = 1;
});
