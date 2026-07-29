import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMacSyncDescription,
  classifyMacSyncState,
  classifyWorktreeStatus,
  isAllowedRuntimeDriftEntry,
  parseRevListCounts,
  summarizeHealthChecks,
} from '../lib/mac-sync-worker-utils.mjs';

test('parseRevListCounts parses ahead and behind counts', () => {
  assert.deepEqual(parseRevListCounts('2\t5'), {
    aheadCount: 2,
    behindCount: 5,
  });
});

test('classifyMacSyncState blocks dirty worktrees', () => {
  const result = classifyMacSyncState({
    currentBranch: 'main',
    upstreamRef: 'origin/main',
    isClean: false,
    aheadCount: 0,
    behindCount: 1,
  });

  assert.equal(result.status, 'blocked_dirty');
  assert.equal(result.canPull, false);
  assert.equal(result.blocked, true);
});

test('classifyWorktreeStatus recognizes allowed runtime drift', () => {
  const result = classifyWorktreeStatus([
    ' M agentdb.rvf.lock',
    '?? Jacobs-2',
  ].join('\n'));

  assert.equal(result.isClean, false);
  assert.equal(result.hasOnlyAllowedRuntimeDrift, true);
  assert.equal(result.isEffectivelyClean, true);
  assert.deepEqual(result.runtimeDriftPaths, ['agentdb.rvf.lock', 'Jacobs-2']);
});

test('isAllowedRuntimeDriftEntry rejects real repo changes', () => {
  assert.equal(isAllowedRuntimeDriftEntry({ status: ' M', path: 'services/task-router/src/executor.mjs' }), false);
  assert.equal(isAllowedRuntimeDriftEntry({ status: '??', path: 'Jacobs-2' }), true);
});

test('classifyMacSyncState allows behind pulls with allowed runtime drift only', () => {
  const result = classifyMacSyncState({
    currentBranch: 'main',
    upstreamRef: 'origin/main',
    isClean: false,
    hasOnlyAllowedRuntimeDrift: true,
    aheadCount: 0,
    behindCount: 1,
  });

  assert.equal(result.status, 'behind');
  assert.equal(result.canPull, true);
  assert.equal(result.blocked, false);
});

test('classifyMacSyncState allows safe behind pulls', () => {
  const result = classifyMacSyncState({
    currentBranch: 'main',
    upstreamRef: 'origin/main',
    isClean: true,
    aheadCount: 0,
    behindCount: 3,
  });

  assert.equal(result.status, 'behind');
  assert.equal(result.canPull, true);
  assert.equal(result.blocked, false);
});

test('summarizeHealthChecks counts unhealthy checks', () => {
  const summary = summarizeHealthChecks([
    { action: 'a', severity: 'healthy' },
    { action: 'b', severity: 'warning' },
    { action: 'c', severity: 'critical' },
  ]);

  assert.equal(summary.totalChecks, 3);
  assert.equal(summary.healthyCount, 1);
  assert.equal(summary.unhealthyCount, 2);
});

test('buildMacSyncDescription summarizes pull, restart, and health state', () => {
  const description = buildMacSyncDescription({
    syncState: {
      summary: 'Local branch is behind origin/main by 1 commit.',
    },
    didPull: true,
    dryRun: false,
    restartedDiscordBot: true,
    restartedRufloWorkerService: false,
    healthSummary: {
      healthyCount: 5,
      unhealthyCount: 0,
    },
  });

  assert.match(description, /behind origin\/main/u);
  assert.match(description, /Fast-forward pull applied/u);
  assert.match(description, /Discord bot restarted/u);
  assert.match(description, /All 5 health checks are healthy/u);
});

test('buildMacSyncDescription notes when the worker service is not installed', () => {
  const description = buildMacSyncDescription({
    syncState: {
      summary: 'Local branch is up to date with origin/main.',
    },
    didPull: false,
    dryRun: false,
    restartedDiscordBot: false,
    rufloWorkerServiceStatus: 'not_installed',
    healthSummary: {
      healthyCount: 4,
      unhealthyCount: 0,
    },
  });

  assert.match(description, /not installed in this session/u);
  assert.match(description, /All 4 health checks are healthy/u);
});
