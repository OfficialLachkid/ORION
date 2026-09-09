import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
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

export const NIGHT_SHIFT_STEP_MARKERS = Object.freeze({
  pokemonMaintenance: 'pokemon-maintenance',
  leadgen: 'leadgen',
});

export function markerPath(now = new Date(), root = projectRoot) {
  return resolve(root, 'data', 'night-shift', `${todayStamp(now)}.done`);
}

export function stepMarkerPath(step, now = new Date(), root = projectRoot) {
  return resolve(root, 'data', 'night-shift', `${todayStamp(now)}.${step}.done`);
}

function writeMarker(filePath, now, runtime) {
  runtime.mkdirSync(dirname(filePath), { recursive: true });
  runtime.writeFileSync(filePath, now.toISOString());
}

function hasFlag(argv, flag) {
  return argv.includes(flag);
}

function getArgValue(argv, flag, fallbackValue = '') {
  const index = argv.indexOf(flag);
  return index === -1 ? fallbackValue : (argv[index + 1] || fallbackValue);
}

function buildRuntime(deps) {
  return {
    projectRoot,
    existsSync,
    mkdirSync,
    writeFileSync,
    now: () => new Date(),
    stdout: process.stdout,
    stderr: process.stderr,
    setExitCode: (code) => {
      process.exitCode = code;
    },
    loadRuntimeConfig,
    recordOpsMetric,
    runQualification,
    detectReplies,
    runRedraftRejected,
    runFollowUps,
    reconcileDrafts,
    reconcilePreviewFallbackStorage,
    runVideoQueueMaintenance,
    replenishPokeQuizzReviewBacklog,
    refreshPokeQuizzReviewMessages,
    fetchLeads,
    countOpenDrafts,
    postNightShiftFailure,
    postLeadNightShiftDigest,
    postPokemonNightShiftDigest,
    kickOffScheduledLeadgen,
    ...deps,
  };
}

export async function runNightShift(argv = process.argv, deps = {}) {
  const runtime = buildRuntime(deps);
  const isFallback = hasFlag(argv, '--fallback');
  const limit = Number(getArgValue(argv, '--limit', '30'));
  const startedAt = runtime.now();
  const runTimestamp = startedAt.toISOString();
  const config = runtime.loadRuntimeConfig();
  const marker = markerPath(startedAt, runtime.projectRoot);
  const pokemonMaintenanceMarker = stepMarkerPath(
    NIGHT_SHIFT_STEP_MARKERS.pokemonMaintenance,
    startedAt,
    runtime.projectRoot,
  );
  const leadgenMarker = stepMarkerPath(
    NIGHT_SHIFT_STEP_MARKERS.leadgen,
    startedAt,
    runtime.projectRoot,
  );

  if (isFallback && runtime.existsSync(marker)) {
    runtime.stdout.write(`Night shift already completed today (${marker}); fallback is a no-op.\n`);
    return;
  }

  const label = isFallback ? 'Night Shift (07:00 fallback)' : 'Night Shift';
  const { outcomes, systemicFailure, rateLimited, exitCode, stderr } = runtime.runQualification(limit);

  runtime.recordOpsMetric(config, 'night_shift_run', {
    fallback: isFallback,
    processed: outcomes.length,
    drafted: outcomes.filter((outcome) => outcome.approvalTaskId).length,
    systemicFailure,
    rateLimited,
    exitCode,
  });

  if (systemicFailure) {
    runtime.stderr.write(`Night shift qualification failed systemically (exit ${exitCode}). No full marker written; video maintenance and primary leadgen will still run.\nstderr: ${stderr.slice(0, 500)}\n`);
    try {
      await runtime.postNightShiftFailure(config, { label, isFallback });
    } catch (error) {
      runtime.stderr.write(`Night-shift failure notice failed (non-fatal): ${error.message}\n`);
    }
    runtime.setExitCode(1);
  }

  let replyResult = { available: false, replies: 0, bounces: 0, autoReplies: 0, checked: 0 };
  let redrafted = 0;
  let followedUp = 0;
  let reconciled = 0;
  let editedInGmail = 0;
  let repointedInGmail = 0;

  if (!systemicFailure) {
    try {
      replyResult = await runtime.detectReplies(config);
    } catch (error) {
      runtime.stderr.write(`Reply-detection step failed (non-fatal): ${error.message}\n`);
    }

    try {
      const redraft = runtime.runRedraftRejected(limit);
      redrafted = redraft.outcomes.filter((outcome) => outcome.approvalTaskId).length;
    } catch (error) {
      runtime.stderr.write(`Redraft-rejected step failed (non-fatal): ${error.message}\n`);
    }

    try {
      followedUp = runtime.runFollowUps(limit);
    } catch (error) {
      runtime.stderr.write(`Follow-up step failed (non-fatal): ${error.message}\n`);
    }

    try {
      const result = await runtime.reconcileDrafts(config);
      reconciled = result.sent;
      editedInGmail = result.edited;
      repointedInGmail = result.repointed;
    } catch (error) {
      runtime.stderr.write(`Draft reconcile step failed (non-fatal): ${error.message}\n`);
    }
  }

  let previewFallback = null;
  let previewFallbackError = '';
  let videoQueueMaintenance = null;
  let videoQueueMaintenanceError = '';
  let reviewBacklogReplenishment = null;
  let reviewMessageRefresh = null;
  let skippedPokemonMaintenance = false;

  if (isFallback && runtime.existsSync(pokemonMaintenanceMarker)) {
    skippedPokemonMaintenance = true;
    runtime.stdout.write(`Pokemon video maintenance already completed today (${pokemonMaintenanceMarker}); fallback skips duplicate video work.\n`);
  } else {
    try {
      previewFallback = await runtime.reconcilePreviewFallbackStorage();
    } catch (error) {
      previewFallbackError = error.message;
      runtime.stderr.write(`Preview fallback reconcile failed (non-fatal): ${error.message}\n`);
    }

    try {
      videoQueueMaintenance = await runtime.runVideoQueueMaintenance(runTimestamp);
    } catch (error) {
      videoQueueMaintenanceError = error.message;
      runtime.stderr.write(`Video queue maintenance failed (non-fatal): ${error.message}\n`);
    }

    try {
      reviewBacklogReplenishment = await runtime.replenishPokeQuizzReviewBacklog(config, runTimestamp);
    } catch (error) {
      reviewBacklogReplenishment = {
        status: 'failed',
        generated: 0,
        initialReviewReadyCount: 0,
        finalReviewReadyCount: 0,
        targetReviewReadyCount: REVIEW_READY_TARGET_COUNT,
        errors: [error.message],
      };
      runtime.stderr.write(`Review backlog replenish failed (non-fatal): ${error.message}\n`);
    }

    try {
      reviewMessageRefresh = await runtime.refreshPokeQuizzReviewMessages();
    } catch (error) {
      reviewMessageRefresh = {
        status: 'failed',
        error: error.message,
        refreshed: 0,
        failed: 0,
        retried: 0,
      };
      runtime.stderr.write(`Review card refresh failed (non-fatal): ${error.message}\n`);
    }

    writeMarker(pokemonMaintenanceMarker, runtime.now(), runtime);
  }

  // Skip the marker when the primary run partially completed but hit a
  // Claude usage-limit / rate-limit — that leaves the fallback slot (07:00,
  // after Claude's window resets) armed to pick up the leads still marked
  // `new` in Supabase. Without this, a partial-success primary silently
  // trapped rate-limited leads for a full day (operator flagged 2026-08-06).
  // Digest and downstream steps still run so the operator sees what did
  // complete on this pass.
  if (systemicFailure) {
    runtime.stderr.write('Night shift full marker skipped because qualification failed; fallback remains armed for qualification retry.\n');
  } else if (rateLimited) {
    runtime.stderr.write(`Night shift qualification hit Claude usage limits - ${outcomes.filter((o) => o.error).length}/${outcomes.length} lead(s) errored. Marker skipped so the fallback slot re-runs qualification after the usage window resets.\n`);
  } else {
    writeMarker(marker, runtime.now(), runtime);
  }

  const backlog = await runtime.fetchLeads({ status: 'new', limit: 2000 })
    .then((leads) => leads.length)
    .catch(() => 0);
  const openDrafts = await runtime.countOpenDrafts(config);

  if (!systemicFailure) {
    try {
      await runtime.postLeadNightShiftDigest(config, {
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
    } catch (error) {
      runtime.stderr.write(`Lead night-shift digest failed (non-fatal): ${error.message}\n`);
    }
  }

  try {
    await runtime.postPokemonNightShiftDigest(
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
  } catch (error) {
    runtime.stderr.write(`Pokemon night-shift digest failed (non-fatal): ${error.message}\n`);
  }

  // Kick off the daily leadgen sweep AFTER everything else — the video
  // pipeline is the machine's heaviest step, and leadgen is the only
  // background task the operator explicitly wants deferred until last
  // (2026-09-05 ask: "leadgen is absolute last work that needs to be
  // done"). Detached + unref so night-shift exits cleanly the moment
  // the leadgen child is spawned — the child inherits its own Discord
  // reporting and rotation-state persistence, so no supervisor is
  // needed here. Suppress in fallback mode: the fallback slot exists
  // to recover a partially-completed primary, not to double-fire
  // leadgen.
  let leadgenChildPid = null;
  if (!isFallback) {
    if (runtime.existsSync(leadgenMarker)) {
      runtime.stdout.write(`Scheduled leadgen already started today (${leadgenMarker}); skipping duplicate kick-off.\n`);
    } else {
      try {
        leadgenChildPid = runtime.kickOffScheduledLeadgen(config);
        writeMarker(leadgenMarker, runtime.now(), runtime);
      } catch (error) {
        runtime.stderr.write(`Failed to kick off scheduled leadgen (non-fatal): ${error.message}\n`);
      }
    }
  }

  runtime.stdout.write(`${JSON.stringify({
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
    leadgenChildPid,
    skippedPokemonMaintenance,
  }, null, 2)}\n`);
}

export function kickOffScheduledLeadgen(config) {
  const scriptPath = resolve(projectRoot, 'scripts', 'run-scheduled-leadgen.mjs');
  const logDir = config.runtimePaths.logDir;
  mkdirSync(logDir, { recursive: true });
  const stdout = openSync(resolve(logDir, 'leadgen-schedule.stdout.log'), 'a');
  const stderr = openSync(resolve(logDir, 'leadgen-schedule.stderr.log'), 'a');

  const child = spawn(process.execPath, [scriptPath], {
    detached: true,
    stdio: ['ignore', stdout, stderr],
    cwd: projectRoot,
  });
  child.unref();
  process.stdout.write(`Scheduled leadgen sweep started detached as PID ${child.pid}. Log: ${resolve(logDir, 'leadgen-schedule.stdout.log')}\n`);
  return child.pid ?? null;
}
