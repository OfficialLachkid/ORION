import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyCheckState,
  classifyOverallReadiness,
  getRequiredRebootChecks,
  summarizeRebootRecoveryChecks,
} from '../lib/reboot-recovery-check.mjs';

test('classifyCheckState routes healthy/degraded/blocked states correctly', () => {
  assert.equal(classifyCheckState('ready'), 'healthy');
  assert.equal(classifyCheckState('healthy'), 'healthy');
  assert.equal(classifyCheckState('running'), 'healthy');
  assert.equal(classifyCheckState('degraded'), 'degraded');
  assert.equal(classifyCheckState('empty'), 'degraded');
  assert.equal(classifyCheckState('blocked'), 'blocked');
  assert.equal(classifyCheckState('missing'), 'blocked');
  assert.equal(classifyCheckState('not running'), 'blocked');
  assert.equal(classifyCheckState('unknown'), 'blocked');
  assert.equal(classifyCheckState('mystery'), 'unknown');
});

test('classifyCheckState maps disk percent against thresholds', () => {
  const opts = { action: 'disk_space_health_check', warnPercent: 85, criticalPercent: 92 };
  assert.equal(classifyCheckState('25%', opts), 'healthy');
  assert.equal(classifyCheckState('85%', opts), 'degraded');
  assert.equal(classifyCheckState('90%', opts), 'degraded');
  assert.equal(classifyCheckState('92%', opts), 'blocked');
  assert.equal(classifyCheckState('99%', opts), 'blocked');
});

test('summarizeRebootRecoveryChecks counts verdicts per action', () => {
  const { summary, detail } = summarizeRebootRecoveryChecks([
    { action: 'ruflo_daemon_health_check', state: 'ready' },
    { action: 'discord_bot_runtime_health_check', state: 'not running' },
    { action: 'session_checkpoint_health_check', state: 'empty' },
    { action: 'tailscale_health_check', state: 'Running' },
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.healthy, 2);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.degraded, 1);
  assert.equal(detail.find((entry) => entry.action === 'discord_bot_runtime_health_check').verdict, 'blocked');
});

test('classifyOverallReadiness reports ready when all required checks healthy', () => {
  const detail = getRequiredRebootChecks().map((action) => ({
    action,
    required: true,
    verdict: 'healthy',
    state: 'ready',
  }));
  const readiness = classifyOverallReadiness(detail);
  assert.equal(readiness.readiness, 'ready');
});

test('classifyOverallReadiness reports blocked when a required check fails', () => {
  const detail = getRequiredRebootChecks().map((action) => ({
    action,
    required: true,
    verdict: action === 'ruflo_daemon_health_check' ? 'blocked' : 'healthy',
    state: 'ready',
  }));
  const readiness = classifyOverallReadiness(detail);
  assert.equal(readiness.readiness, 'blocked');
  assert.equal(readiness.failingRequired.length, 1);
  assert.equal(readiness.failingRequired[0].action, 'ruflo_daemon_health_check');
});

test('classifyOverallReadiness reports blocked when a required check is missing', () => {
  const detail = getRequiredRebootChecks()
    .filter((action) => action !== 'session_checkpoint_health_check')
    .map((action) => ({ action, required: true, verdict: 'healthy', state: 'ready' }));
  const readiness = classifyOverallReadiness(detail);
  assert.equal(readiness.readiness, 'blocked');
  assert.deepEqual(readiness.missingRequired, ['session_checkpoint_health_check']);
});

test('classifyOverallReadiness downgrades optional-only failures softly', () => {
  const detail = [
    ...getRequiredRebootChecks().map((action) => ({ action, required: true, verdict: 'healthy', state: 'ready' })),
    { action: 'tailscale_health_check', required: false, verdict: 'blocked', state: 'Stopped' },
    { action: 'disk_space_health_check', required: false, verdict: 'healthy', state: 'ready' },
  ];
  const readiness = classifyOverallReadiness(detail);
  assert.equal(readiness.readiness, 'degraded_soft');
  const strictReadiness = classifyOverallReadiness(detail, { requireOptional: true });
  assert.equal(strictReadiness.readiness, 'degraded');
});
