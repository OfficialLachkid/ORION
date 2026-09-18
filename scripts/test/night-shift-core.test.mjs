import test from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  markerPath,
  NIGHT_SHIFT_STEP_MARKERS,
  runNightShift,
  stepMarkerPath,
} from '../lib/night-shift/core.mjs';

const FIXED_NOW = new Date('2026-09-09T01:30:00.000Z');

function makeTempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'orion-night-shift-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

function makeDeps(root, overrides = {}) {
  const calls = [];
  const exitCodes = [];
  const stdout = [];
  const stderr = [];
  const config = {
    channelIds: {},
    env: {},
    runtimePaths: {
      logDir: join(root, 'logs'),
    },
  };

  const deps = {
    projectRoot: root,
    existsSync,
    mkdirSync,
    writeFileSync,
    now: () => new Date(FIXED_NOW),
    stdout: { write: (message) => stdout.push(String(message)) },
    stderr: { write: (message) => stderr.push(String(message)) },
    setExitCode: (code) => exitCodes.push(code),
    loadRuntimeConfig: () => config,
    recordOpsMetric: () => calls.push('recordOpsMetric'),
    runQualification: () => {
      calls.push('runQualification');
      return {
        outcomes: [{ approvalTaskId: 'draft-1' }],
        systemicFailure: false,
        rateLimited: false,
        exitCode: 0,
        stderr: '',
      };
    },
    detectReplies: async () => {
      calls.push('detectReplies');
      return { available: true, replies: 0, bounces: 0, autoReplies: 0, checked: 0 };
    },
    runRedraftRejected: () => {
      calls.push('runRedraftRejected');
      return { outcomes: [] };
    },
    runFollowUps: () => {
      calls.push('runFollowUps');
      return 0;
    },
    reconcileDrafts: async () => {
      calls.push('reconcileDrafts');
      return { sent: 0, edited: 0, repointed: 0 };
    },
    reconcilePreviewFallbackStorage: async () => {
      calls.push('reconcilePreviewFallbackStorage');
      return { preferredAvailable: true, strandedCount: 0, moved: [], deduped: [], skipped: [] };
    },
    runVideoQueueMaintenance: async () => {
      calls.push('runVideoQueueMaintenance');
      return { processedChannels: 0, scheduled: 0, published: 0, withdrawn: 0 };
    },
    replenishPokeQuizzReviewBacklog: async () => {
      calls.push('replenishPokeQuizzReviewBacklog');
      return {
        status: 'completed',
        generated: 0,
        initialReviewReadyCount: 10,
        finalReviewReadyCount: 10,
        targetReviewReadyCount: 10,
        errors: [],
      };
    },
    refreshPokeQuizzReviewMessages: async () => {
      calls.push('refreshPokeQuizzReviewMessages');
      return { refreshed: 0, failed: 0, retried: 0 };
    },
    fetchLeads: async () => {
      calls.push('fetchLeads');
      return [];
    },
    countOpenDrafts: async () => {
      calls.push('countOpenDrafts');
      return 0;
    },
    postNightShiftFailure: async () => calls.push('postNightShiftFailure'),
    postLeadNightShiftDigest: async () => calls.push('postLeadNightShiftDigest'),
    postPokemonNightShiftDigest: async () => calls.push('postPokemonNightShiftDigest'),
    kickOffScheduledLeadgen: () => {
      calls.push('kickOffScheduledLeadgen');
      return 4242;
    },
    ...overrides,
  };

  return { calls, config, deps, exitCodes, stderr, stdout };
}

function pokemonMaintenanceMarker(root) {
  return stepMarkerPath(NIGHT_SHIFT_STEP_MARKERS.pokemonMaintenance, FIXED_NOW, root);
}

function leadgenMarker(root) {
  return stepMarkerPath(NIGHT_SHIFT_STEP_MARKERS.leadgen, FIXED_NOW, root);
}

test('primary night shift still runs Pokemon maintenance and leadgen after systemic qualification failure', async (t) => {
  const root = makeTempRoot(t);
  const { calls, deps, exitCodes } = makeDeps(root, {
    runQualification: () => {
      calls.push('runQualification');
      return {
        outcomes: [],
        systemicFailure: true,
        rateLimited: false,
        exitCode: 1,
        stderr: 'fetch failed',
      };
    },
  });

  await runNightShift(['node', 'scripts/run-night-shift.mjs', '--limit', '30'], deps);

  assert.deepEqual(exitCodes, [1]);
  assert.equal(existsSync(markerPath(FIXED_NOW, root)), false);
  assert.equal(existsSync(pokemonMaintenanceMarker(root)), true);
  assert.equal(existsSync(leadgenMarker(root)), true);
  assert.equal(calls.includes('postNightShiftFailure'), true);
  assert.equal(calls.includes('reconcilePreviewFallbackStorage'), true);
  assert.equal(calls.includes('runVideoQueueMaintenance'), true);
  assert.equal(calls.includes('replenishPokeQuizzReviewBacklog'), true);
  assert.equal(calls.includes('refreshPokeQuizzReviewMessages'), true);
  assert.equal(calls.includes('kickOffScheduledLeadgen'), true);
  assert.equal(calls.includes('postPokemonNightShiftDigest'), true);
  // Under the 2026-09-18 phase re-ordering, redraft-rejected, follow-ups
  // and reply detection now run BEFORE runQualification and are no longer
  // gated on its success — so a systemic qualification failure must not
  // skip those steps. Only postLeadNightShiftDigest remains gated on
  // systemicFailure (the digest reports qualification-specific numbers
  // that don't make sense when the qualifier itself blew up).
  assert.equal(calls.includes('detectReplies'), true);
  assert.equal(calls.includes('runRedraftRejected'), true);
  assert.equal(calls.includes('runFollowUps'), true);
  assert.equal(calls.includes('reconcileDrafts'), true);
  assert.equal(calls.includes('postLeadNightShiftDigest'), false);
});

test('night shift runs Claude-quota phases in priority order: redraft -> follow-ups -> qualification', async (t) => {
  const root = makeTempRoot(t);
  const { calls, deps } = makeDeps(root);

  await runNightShift(['node', 'scripts/run-night-shift.mjs', '--limit', '30'], deps);

  const detectRepliesIndex = calls.indexOf('detectReplies');
  const redraftIndex = calls.indexOf('runRedraftRejected');
  const followUpsIndex = calls.indexOf('runFollowUps');
  const qualificationIndex = calls.indexOf('runQualification');
  const reconcileIndex = calls.indexOf('reconcileDrafts');

  assert.ok(detectRepliesIndex >= 0, 'detectReplies must run');
  assert.ok(redraftIndex > detectRepliesIndex, 'runRedraftRejected must run after detectReplies');
  assert.ok(followUpsIndex > redraftIndex, 'runFollowUps must run after runRedraftRejected');
  assert.ok(qualificationIndex > followUpsIndex, 'runQualification must run LAST of the Claude-quota phases so quota drains hit new drafts, not operator-feedback rewrites or follow-ups');
  assert.ok(reconcileIndex > qualificationIndex, 'reconcileDrafts must run after all Claude-quota phases so it picks up freshly-produced drafts');
});

test('fallback retries qualification but skips duplicate Pokemon maintenance and full leadgen sweep', async (t) => {
  const root = makeTempRoot(t);
  mkdirSync(join(root, 'data', 'night-shift'), { recursive: true });
  writeFileSync(pokemonMaintenanceMarker(root), FIXED_NOW.toISOString());
  const { calls, deps } = makeDeps(root);

  await runNightShift(['node', 'scripts/run-night-shift.mjs', '--fallback', '--limit', '30'], deps);

  assert.equal(existsSync(markerPath(FIXED_NOW, root)), true);
  assert.equal(existsSync(leadgenMarker(root)), false);
  assert.equal(calls.includes('runQualification'), true);
  assert.equal(calls.includes('detectReplies'), true);
  assert.equal(calls.includes('postLeadNightShiftDigest'), true);
  assert.equal(calls.includes('postPokemonNightShiftDigest'), true);
  assert.equal(calls.includes('reconcilePreviewFallbackStorage'), false);
  assert.equal(calls.includes('runVideoQueueMaintenance'), false);
  assert.equal(calls.includes('replenishPokeQuizzReviewBacklog'), false);
  assert.equal(calls.includes('refreshPokeQuizzReviewMessages'), false);
  assert.equal(calls.includes('kickOffScheduledLeadgen'), false);
});

test('fallback runs Pokemon maintenance when the primary never reached that step', async (t) => {
  const root = makeTempRoot(t);
  const { calls, deps } = makeDeps(root);

  await runNightShift(['node', 'scripts/run-night-shift.mjs', '--fallback', '--limit', '30'], deps);

  assert.equal(existsSync(markerPath(FIXED_NOW, root)), true);
  assert.equal(existsSync(pokemonMaintenanceMarker(root)), true);
  assert.equal(existsSync(leadgenMarker(root)), false);
  assert.equal(calls.includes('reconcilePreviewFallbackStorage'), true);
  assert.equal(calls.includes('runVideoQueueMaintenance'), true);
  assert.equal(calls.includes('replenishPokeQuizzReviewBacklog'), true);
  assert.equal(calls.includes('refreshPokeQuizzReviewMessages'), true);
  assert.equal(calls.includes('kickOffScheduledLeadgen'), false);
});
