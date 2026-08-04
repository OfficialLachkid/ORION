import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../../../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../../../services/lib/metrics-store.mjs';
import { fetchLeads } from '../leadgen-supabase.mjs';
import { reconcileDrafts } from '../draft-reconciler.mjs';
import { detectReplies } from '../reply-detector.mjs';
import {
  countOpenDrafts,
  postLeadNightShiftDigest,
  postNightShiftFailure,
  postPokemonNightShiftDigest,
} from './digest.mjs';
import {
  reconcilePreviewFallbackStorage,
  refreshPokeQuizzReviewMessages,
  replenishPokeQuizzReviewBacklog,
  REVIEW_READY_TARGET_COUNT,
  runVideoQueueMaintenance,
} from './pokemon-maintenance.mjs';
import {
  runFollowUps,
  runQualification,
  runRedraftRejected,
} from './qualification.mjs';

export function todayStamp(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function markerPath(now = new Date()) {
  return resolve(projectRoot, 'data', 'night-shift', `${todayStamp(now)}.done`);
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function getArgValue(argv, flag, fallbackValue = '') {
  const index = argv.indexOf(flag);
  return index === -1 ? fallbackValue : (argv[index + 1] || fallbackValue);
}

export async function runNightShift(argv = process.argv) {
  const isFallback = hasFlag(argv, '--fallback');
  const limit = Number(getArgValue(argv, '--limit', '30'));
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
    await postNightShiftFailure(config, { label, isFallback });
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
    previewFallback = await reconcilePreviewFallbackStorage();
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
      targetReviewReadyCount: REVIEW_READY_TARGET_COUNT,
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

  const backlog = await fetchLeads({ status: 'new', limit: 2000 })
    .then((leads) => leads.length)
    .catch(() => 0);
  const openDrafts = await countOpenDrafts(config);

  await postLeadNightShiftDigest(config, {
    label,
    outcomes,
    backlog,
    openDrafts,
    extras: {
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
    },
  });

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
