#!/usr/bin/env node
// Night shift: durable overnight maintenance. Runs the day's lead
// qualification in the operator's preferred pre-token-reset window (01:30),
// then posts a digest so they wake to reviewed results. Designed to survive
// what session-scoped CronCreate could not: it's a real launchd job.
//
// Rate-limit safety: the same script runs at 01:30 (primary) and 07:00
// (fallback, with --fallback). On a successful run it writes a per-day
// marker; the --fallback invocation exits immediately if today's marker
// already exists (so 07:00 is a no-op when the night shift succeeded), and
// runs the qualification itself when the marker is missing (so a rate-limited
// or failed 01:30 run is recovered at 07:00, never lost).
//
// v1 scope started as qualification + digest + marker + fallback. It now also
// performs low-risk Poke Quizz queue maintenance:
//   - re-run schedule reconciliation for active video lanes
//   - move fallback preview MP4s from Desktop back to the SSD when it returns

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { buildNoticeDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../services/product-video-agent/src/publication-channels.mjs';
import { reconcilePokeQuizzPreviewFallbackStorage } from '../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
  syncPokeQuizzQueueStatusMessage,
} from '../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../services/product-video-agent/src/publication-store.mjs';
import { fetchLeads } from './lib/leadgen-supabase.mjs';
import { reconcileDrafts } from './lib/draft-reconciler.mjs';
import { detectReplies } from './lib/reply-detector.mjs';
import { getQualificationBatchTimeoutMs } from './lib/night-shift-runtime.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

function todayStamp() {
  // LOCAL date, not UTC. The primary run (01:30) and the fallback (07:00) are
  // on the same local day but can straddle a UTC day boundary. Using UTC here
  // caused the primary and fallback to write/check different markers.
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

function parseTrailingJsonArray(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return [];
  }

  for (let index = text.lastIndexOf('['); index >= 0; index = text.lastIndexOf('[', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep scanning backward until the trailing JSON array is found.
    }
  }

  return [];
}

function parseLastJsonObject(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    const candidate = text.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning backward until the trailing JSON object is found.
    }
  }

  return null;
}

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

function runQualification(limit) {
  return runQualificationScript(
    [resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'), '--limit', String(limit)],
    getQualificationBatchTimeoutMs(limit),
  );
}

function runRedraftRejected(limit) {
  return runQualificationScript(
    [resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs'), '--redraft-rejected', '--limit', String(limit)],
    getQualificationBatchTimeoutMs(limit),
  );
}

function runFollowUps(limit) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, 'scripts', 'run-follow-ups.mjs'), '--limit', String(limit)], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30 * 60 * 1000,
  });
  const stdout = String(result.stdout || '');
  try {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return Number(JSON.parse(stdout.slice(start, end + 1)).drafted || 0);
    }
  } catch {
    // Fall through to zero.
  }
  return 0;
}

function runQualificationScript(args, timeoutMs) {
  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
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
  const allErrored = ran && outcomes.every((outcome) => outcome.error);
  const systemicFailure = (!ran && result.status !== 0) || allErrored;
  const childStderr = String(result.stderr || '').trim();
  const outcomeErrors = [...new Set(outcomes.map((outcome) => outcome.error).filter(Boolean))];
  const processError = result.error?.message
    || (result.signal ? `Qualification process ended with signal ${result.signal}.` : '');
  const diagnostic = childStderr || outcomeErrors.slice(0, 3).join(' | ') || processError;

  return { outcomes, systemicFailure, exitCode: result.status ?? -1, stderr: diagnostic };
}

async function runVideoQueueMaintenance(asOf = new Date().toISOString()) {
  const profiles = await loadPublicationChannelProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const scriptPath = resolve(projectRoot, 'services/product-video-agent/scripts/execute-youtube-publication.mjs');
  const results = [];

  for (const profile of activeProfiles) {
    const child = spawnSync(process.execPath, [
      scriptPath,
      '--channel',
      profile.account_key,
      '--channels',
      DEFAULT_PUBLICATION_CHANNELS_PATH,
      '--schedule-approved',
      '--as-of',
      asOf,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 20 * 60 * 1000,
    });

    const parsedResults = parseTrailingJsonArray(child.stdout);
    const error = child.error?.message
      || (child.status === 0 ? '' : String(child.stderr || '').trim());
    results.push({
      channelId: profile.id,
      accountKey: profile.account_key,
      channelName: profile.name,
      status: error ? 'failed' : 'completed',
      exitCode: child.status ?? 0,
      error,
      results: parsedResults,
    });
  }

  return summarizeVideoQueueMaintenance(activeProfiles, results);
}

async function replenishPokeQuizzReviewBacklog(config, asOf = new Date().toISOString()) {
  const reviewThreadId = String(config.channelIds.pokeQuizzReview || '').trim();
  if (!reviewThreadId) {
    return {
      status: 'skipped',
      generated: 0,
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
      errors: ['Missing pokeQuizzReview channel/thread id.'],
    };
  }

  const catalogJsonPath = await ensurePreferredPokeQuizzCatalogJsonPath();
  if (!catalogJsonPath) {
    return {
      status: 'failed',
      generated: 0,
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
      errors: ['No localized Poke Quizz catalog JSON could be found.'],
    };
  }

  const profiles = await loadPublicationChannelProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, 'poke-quizz-youtube');
  const store = createPublicationStore(config);
  const generationScriptPath = resolve(
    projectRoot,
    'services/product-video-agent/scripts/generate-poke-quizz-review.mjs',
  );

  const fetchQueueStatus = async () => {
    const publications = await store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    });
    return computePokeQuizzQueueStatus(publications, channelProfile, asOf);
  };

  const initialQueueStatus = await fetchQueueStatus();
  const generated = [];
  const errors = [];
  let reviewReadyCount = initialQueueStatus.reviewReadyCount;
  let consecutiveFailures = 0;

  while (reviewReadyCount < POKE_QUIZZ_REVIEW_TARGET_COUNT && consecutiveFailures < 3) {
    const child = spawnSync(process.execPath, [
      generationScriptPath,
      '--thread-id',
      reviewThreadId,
      '--catalog-json',
      catalogJsonPath,
      '--channel',
      'poke-quizz-youtube',
      '--as-of',
      new Date().toISOString(),
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 40 * 60 * 1000,
    });

    const payload = parseLastJsonObject(child.stdout);
    if (child.error || child.status !== 0 || !payload?.publication_id) {
      consecutiveFailures += 1;
      errors.push(
        child.error?.message
          || String(child.stderr || '').trim()
          || 'Poke Quizz review replenishment generation failed.',
      );
      continue;
    }

    consecutiveFailures = 0;
    generated.push({
      publicationId: payload.publication_id,
      previewUrl: payload.preview_url || '',
      messageId: payload.message_id || '',
    });

    reviewReadyCount = (await fetchQueueStatus()).reviewReadyCount;
  }

  const finalQueueStatus = await fetchQueueStatus();
  await syncPokeQuizzQueueStatusMessage({
    runtimeConfig: config,
    store,
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    asOf,
  });

  return {
    status: errors.length > 0 && generated.length === 0 ? 'failed' : generated.length > 0 ? 'completed' : 'skipped',
    generated: generated.length,
    generatedItems: generated,
    initialReviewReadyCount: initialQueueStatus.reviewReadyCount,
    finalReviewReadyCount: finalQueueStatus.reviewReadyCount,
    targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
    errors,
  };
}

async function refreshPokeQuizzReviewMessages() {
  const scriptPath = resolve(
    projectRoot,
    'services/product-video-agent/scripts/refresh-poke-quizz-review-messages.mjs',
  );
  const child = spawnSync(process.execPath, [
    scriptPath,
    '--channel',
    'poke-quizz-youtube',
    '--delay-ms',
    '1200',
    '--max-retries',
    '3',
  ], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 20 * 60 * 1000,
  });

  const summary = parseLastJsonObject(child.stdout) || {};
  const error = child.error?.message
    || (child.status === 0 ? '' : String(child.stderr || '').trim());
  return {
    status: error ? 'failed' : 'completed',
    exitCode: child.status ?? 0,
    error,
    ...summary,
  };
}

function summarizeVideoQueueMaintenance(profiles, runs) {
  const summary = {
    attemptedChannels: profiles.length,
    processedChannels: 0,
    failedChannels: 0,
    scheduled: 0,
    published: 0,
    returnedToApproval: 0,
    deleted: 0,
    changedSchedule: 0,
    statusLookupFailures: 0,
    errors: [],
    channels: runs,
  };

  for (const run of runs) {
    if (run.status === 'failed') {
      summary.failedChannels += 1;
      summary.errors.push(`${run.accountKey}: ${run.error || 'unknown queue maintenance error'}`);
      continue;
    }

    summary.processedChannels += 1;
    for (const result of run.results) {
      const action = String(result?.action || '');
      const workflowState = String(result?.workflow_state || '');
      const reason = String(result?.reason || '');
      if (action === 'schedule_update' || workflowState === 'scheduled') {
        summary.scheduled += 1;
      }
      if (workflowState === 'published') {
        summary.published += 1;
      }
      if (workflowState === 'deleted') {
        summary.deleted += 1;
      }
      if (workflowState === 'preview_approved') {
        summary.returnedToApproval += 1;
      }
      if (reason === 'youtube_publish_time_changed') {
        summary.changedSchedule += 1;
      }
      if (reason === 'status_lookup_failed') {
        summary.statusLookupFailures += 1;
      }
    }
  }

  return summary;
}

function buildDigest(outcomes, backlogCount, openDraftCount, extras = {}) {
  const processedCount = outcomes.length;
  const drafted = outcomes.filter((outcome) => outcome.approvalTaskId).length;
  const noEmail = outcomes.filter((outcome) => outcome.status === 'qualified_no_email').length;
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected_fit').length;
  const unreachable = outcomes.filter((outcome) => outcome.status === 'site_unreachable').length;
  const extractionError = outcomes.filter((outcome) => outcome.status === 'extraction_error').length;
  const failed = outcomes.filter((outcome) => outcome.error).length;
  const {
    redrafted = 0,
    reconciled = 0,
    editedInGmail = 0,
    repointedInGmail = 0,
    followedUp = 0,
    replyResult = null,
    outreachChannel = '#outreach-agent',
    qualifiedCallLeadsChannel = '',
  } = extras;

  const parts = [
    drafted > 0 ? `**${drafted}** new draft(s) awaiting approval in ${outreachChannel}` : '',
    noEmail > 0
      ? `**${noEmail}** qualified, no email${
        qualifiedCallLeadsChannel ? ` (phone outreach in ${qualifiedCallLeadsChannel})` : ''
      }`
      : '',
    rejected > 0 ? `**${rejected}** rejected (weak fit)` : '',
    unreachable > 0 ? `**${unreachable}** site unreachable` : '',
    extractionError > 0 ? `**${extractionError}** extraction error` : '',
    failed > 0 ? `**${failed}** call failed (retried next run)` : '',
  ].filter(Boolean);

  const replyLine = replyResult && replyResult.available === false
    ? 'Reply detection is **paused** - Gmail needs re-authorizing with the read scope (follow-ups stay off until then).'
    : (replyResult && (replyResult.replies || replyResult.bounces || replyResult.autoReplies)
      ? `Replies checked: **${replyResult.replies}** reply, **${replyResult.bounces}** undeliverable, **${replyResult.autoReplies}** auto-reply (of ${replyResult.checked} sent thread(s)).`
      : '');

  const maintenance = [
    replyLine,
    followedUp > 0 ? `Drafted **${followedUp}** follow-up(s) for unanswered leads (approval-gated in #outreach-followups).` : '',
    redrafted > 0 ? `Re-drafted **${redrafted}** previously-rejected lead(s) using your feedback.` : '',
    reconciled > 0 ? `Reconciled **${reconciled}** draft(s) you sent manually in Gmail (marked sent, closed the approval).` : '',
    editedInGmail > 0 ? `Mirrored **${editedInGmail}** draft edit(s) you made in Gmail back into the Discord approval card.` : '',
    repointedInGmail > 0 ? `Repointed **${repointedInGmail}** draft(s) after mobile Gmail created a new draft on edit - the approval card now reflects your latest version.` : '',
  ].filter(Boolean);

  return [
    `Night shift processed **${processedCount}** lead(s)${parts.length ? ' - ' + parts.join(', ') : ''}.`,
    ...(maintenance.length ? ['', ...maintenance] : []),
    '',
    `Backlog: **${backlogCount}** leads still \`new\`. Open drafts awaiting your approval: **${openDraftCount}**.`,
  ].join('\n');
}

function buildVideoQueueMaintenanceLine(summary) {
  if (!summary) {
    return '';
  }
  const parts = [];
  if (summary.scheduled > 0) parts.push(`**${summary.scheduled}** scheduled`);
  if (summary.published > 0) parts.push(`**${summary.published}** marked live`);
  if (summary.returnedToApproval > 0) parts.push(`**${summary.returnedToApproval}** returned to approval`);
  if (summary.deleted > 0) parts.push(`**${summary.deleted}** marked deleted`);
  if (summary.changedSchedule > 0) parts.push(`**${summary.changedSchedule}** schedule(s) corrected`);
  if (summary.statusLookupFailures > 0) parts.push(`**${summary.statusLookupFailures}** lookup failure(s)`);
  if (summary.failedChannels > 0) parts.push(`**${summary.failedChannels}** channel run(s) failed`);
  if (parts.length === 0) {
    return summary.processedChannels > 0
      ? 'Video queue maintenance found no schedule corrections to apply.'
      : '';
  }
  return `Video queue maintenance: ${parts.join(', ')}.`;
}

function buildPreviewFallbackLine(report) {
  if (!report) {
    return '';
  }
  if (report.preferredAvailable === false) {
    return report.strandedCount > 0
      ? `Preview fallback storage: SSD still unavailable, **${report.strandedCount}** preview(s) remain on Desktop fallback.`
      : 'Preview fallback storage: SSD still unavailable, but no stranded previews were found on Desktop fallback.';
  }
  if (report.moved.length > 0 || report.deduped.length > 0) {
    const parts = [];
    if (report.moved.length > 0) parts.push(`moved **${report.moved.length}** back to SSD`);
    if (report.deduped.length > 0) parts.push(`removed **${report.deduped.length}** duplicate fallback copy/copies`);
    if (report.skipped.length > 0) parts.push(`skipped **${report.skipped.length}** conflicted preview(s)`);
    return `Preview fallback storage: ${parts.join(', ')}.`;
  }
  return report.strandedCount > 0
    ? `Preview fallback storage: SSD reachable, but **${report.skipped.length}** preview(s) still need manual review.`
    : '';
}

function buildReviewBacklogReplenishmentLine(report) {
  if (!report) {
    return '';
  }
  if (report.errors?.length && report.generated === 0) {
    return `Review backlog replenish failed: ${report.errors[0]}`;
  }
  if (report.generated > 0) {
    return `Review backlog replenish: generated **${report.generated}** preview(s), review queue now holds **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready for approval.`;
  }
  return report.finalReviewReadyCount < report.targetReviewReadyCount
    ? `Review backlog replenish is still below target at **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready preview(s).`
    : `Review backlog replenish found **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready preview(s); no fill-up was needed.`;
}

function buildReviewMessageRefreshLine(report) {
  if (!report) {
    return '';
  }
  if (report.error) {
    return `Review card refresh failed: ${report.error}`;
  }
  if (report.failed > 0) {
    return `Review card refresh updated **${report.refreshed || 0}** card(s), but **${report.failed}** still need another pass.`;
  }
  if (report.refreshed > 0) {
    const retryNote = report.retried > 0
      ? ` after **${report.retried}** rate-limit retry/retries`
      : '';
    return `Review card refresh updated **${report.refreshed}** card(s)${retryNote}.`;
  }
  return '';
}

function buildPokemonNightShiftDigest({
  videoQueueMaintenance = null,
  previewFallback = null,
  reviewBacklogReplenishment = null,
  reviewMessageRefresh = null,
  videoQueueMaintenanceError = '',
  previewFallbackError = '',
} = {}) {
  const lines = [];
  if (videoQueueMaintenanceError) {
    lines.push(`Video queue maintenance failed: ${videoQueueMaintenanceError}`);
  } else {
    const queueLine = buildVideoQueueMaintenanceLine(videoQueueMaintenance);
    if (queueLine) {
      lines.push(queueLine);
    }
  }

  if (previewFallbackError) {
    lines.push(`Preview fallback reconcile failed: ${previewFallbackError}`);
  } else {
    const fallbackLine = buildPreviewFallbackLine(previewFallback);
    if (fallbackLine) {
      lines.push(fallbackLine);
    }
  }

  const reviewBacklogLine = buildReviewBacklogReplenishmentLine(reviewBacklogReplenishment);
  if (reviewBacklogLine) {
    lines.push(reviewBacklogLine);
  }

  const reviewMessageRefreshLine = buildReviewMessageRefreshLine(reviewMessageRefresh);
  if (reviewMessageRefreshLine) {
    lines.push(reviewMessageRefreshLine);
  }

  if (lines.length === 0) {
    return 'Poke Quizz night shift found no queue or SSD preview corrections to apply.';
  }

  return lines.join('\n');
}

async function postPokemonNightShiftDigest(config, title, options = {}) {
  const channelId = config.channelIds.pokemon || '';
  if (!channelId) {
    return;
  }

  const hasError = Boolean(options.videoQueueMaintenanceError || options.previewFallbackError);
  await postDiscord(config, channelId, buildNoticeDiscordPayload({
    title,
    description: buildPokemonNightShiftDigest(options),
    color: hasError ? 0xED4245 : 0x57F287,
    footerText: 'ORION video gen night shift',
  }));
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
    return Array.isArray(msgs) ? msgs.filter((message) => message.embeds?.[0]?.title?.includes('Approval Needed')).length : 0;
  } catch {
    return 0;
  }
}

async function main() {
  const isFallback = hasFlag('--fallback');
  const limit = Number(getArgValue('--limit', '10'));
  const config = loadRuntimeConfig();
  const marker = markerPath();

  if (isFallback && existsSync(marker)) {
    process.stdout.write(`Night shift already completed today (${marker}); fallback is a no-op.\n`);
    return;
  }

  const label = isFallback ? 'Night Shift (07:00 fallback)' : 'Night Shift';
  const { outcomes, systemicFailure, exitCode, stderr } = runQualification(limit);

  recordOpsMetric(config, 'night_shift_run', {
    fallback: isFallback,
    processed: outcomes.length,
    drafted: outcomes.filter((outcome) => outcome.approvalTaskId).length,
    systemicFailure,
    exitCode,
  });

  if (systemicFailure) {
    process.stderr.write(`Night shift qualification failed systemically (exit ${exitCode}). No marker written; will retry at the next slot.\nstderr: ${stderr.slice(0, 500)}\n`);
    await postDiscord(config, config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration, buildNoticeDiscordPayload({
      title: `${label} - Failed`,
      description: `Qualification failed systemically (likely a usage/rate limit or startup error). No leads were processed. This will retry automatically at the next scheduled slot${isFallback ? ' (tomorrow 01:30)' : ' (07:00 today)'} - nothing is lost.`,
      color: 0xED4245,
      footerText: 'ORION night shift',
    }));
    process.exitCode = 1;
    return;
  }

  let replyResult = { available: false, replies: 0, bounces: 0, autoReplies: 0, checked: 0 };
  try {
    replyResult = await detectReplies(config);
  } catch (error) {
    process.stderr.write(`Reply-detection step failed (non-fatal): ${error.message}\n`);
  }

  let redrafted = 0;
  try {
    const redraft = runRedraftRejected(limit);
    redrafted = redraft.outcomes.filter((outcome) => outcome.approvalTaskId).length;
  } catch (error) {
    process.stderr.write(`Redraft-rejected step failed (non-fatal): ${error.message}\n`);
  }

  let followedUp = 0;
  try {
    followedUp = runFollowUps(limit);
  } catch (error) {
    process.stderr.write(`Follow-up step failed (non-fatal): ${error.message}\n`);
  }

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

  let previewFallback = null;
  let previewFallbackError = '';
  try {
    previewFallback = await reconcilePokeQuizzPreviewFallbackStorage();
  } catch (error) {
    previewFallbackError = error.message;
    process.stderr.write(`Preview fallback reconcile failed (non-fatal): ${error.message}\n`);
  }

  let videoQueueMaintenance = null;
  let videoQueueMaintenanceError = '';
  try {
    videoQueueMaintenance = await runVideoQueueMaintenance(new Date().toISOString());
  } catch (error) {
    videoQueueMaintenanceError = error.message;
    process.stderr.write(`Video queue maintenance failed (non-fatal): ${error.message}\n`);
  }

  let reviewBacklogReplenishment = null;
  try {
    reviewBacklogReplenishment = await replenishPokeQuizzReviewBacklog(config, new Date().toISOString());
  } catch (error) {
    reviewBacklogReplenishment = {
      status: 'failed',
      generated: 0,
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
      errors: [error.message],
    };
    process.stderr.write(`Review backlog replenish failed (non-fatal): ${error.message}\n`);
  }

  let reviewMessageRefresh = null;
  try {
    reviewMessageRefresh = await refreshPokeQuizzReviewMessages();
  } catch (error) {
    reviewMessageRefresh = {
      status: 'failed',
      error: error.message,
      refreshed: 0,
      failed: 0,
      retried: 0,
    };
    process.stderr.write(`Review card refresh failed (non-fatal): ${error.message}\n`);
  }

  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, new Date().toISOString());

  const backlog = await fetchLeads({ status: 'new', limit: 2000 }).then((leads) => leads.length).catch(() => 0);
  const openDrafts = await countOpenDrafts(config);

  await postDiscord(config, config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration, buildNoticeDiscordPayload({
    title: label,
    description: buildDigest(outcomes, backlog, openDrafts, {
      redrafted,
      reconciled,
      editedInGmail,
      repointedInGmail,
      followedUp,
      replyResult,
      outreachChannel: config.channelIds.outreachAgent
        ? `<#${config.channelIds.outreachAgent}>`
        : '#outreach-agent',
      qualifiedCallLeadsChannel: config.channelIds.qualifiedCallLeads
        ? `<#${config.channelIds.qualifiedCallLeads}>`
        : '',
    }),
    color: 0x5865F2,
    footerText: 'ORION night shift',
  }));

  await postPokemonNightShiftDigest(
    config,
    isFallback ? 'Pokemon Night Shift (07:00 fallback)' : 'Pokemon Night Shift',
    {
      videoQueueMaintenance,
      previewFallback,
      reviewBacklogReplenishment,
      reviewMessageRefresh,
      videoQueueMaintenanceError,
      previewFallbackError,
    },
  );

  process.stdout.write(`${JSON.stringify({
    processed: outcomes.length,
    redrafted,
    reconciled,
    editedInGmail,
    repointedInGmail,
    followedUp,
    backlog,
    openDrafts,
    videoQueueMaintenance,
    reviewBacklogReplenishment,
    reviewMessageRefresh,
    previewFallback,
    videoQueueMaintenanceError,
    previewFallbackError,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Night shift failed: ${error.message}\n`);
  process.exitCode = 1;
});
