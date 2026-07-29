import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMacRebootRecoveryCheck } from '../mac-reboot-recovery-check.mjs';

function buildConfig() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-rr-'));
  return {
    env: {
      REBOOT_RECOVERY_AUDIT_PATH: join(tmpRoot, 'reboot-recovery'),
    },
    runtimePaths: {
      tmpDir: join(tmpRoot, 'tmp'),
      logDir: join(tmpRoot, 'logs'),
      metricsEventsFile: join(tmpRoot, 'logs', 'ops-events.jsonl'),
    },
    claude: { workingDirectory: tmpRoot },
    memoryNamespaces: {},
    memoryPromotionRules: {},
  };
}

function stubHealthExecutor(states) {
  return async (action) => {
    if (Object.prototype.hasOwnProperty.call(states, action)) {
      const state = states[action];
      if (state === 'THROW') {
        return { outcome: 'failed', error: new Error(`${action} intentionally failed`) };
      }
      return {
        outcome: 'completed',
        executionResult: {
          report: { state, summary: `${action} ${state}` },
        },
      };
    }
    return {
      outcome: 'completed',
      executionResult: { report: { state: 'ready', summary: `${action} default` } },
    };
  };
}

test('runMacRebootRecoveryCheck reports ready when all required checks pass', async () => {
  const config = buildConfig();
  const report = await runMacRebootRecoveryCheck(config, {
    executeHealthAction: stubHealthExecutor({
      ruflo_daemon_health_check: 'ready',
      discord_bot_runtime_health_check: 'running',
      session_checkpoint_health_check: 'healthy',
      memory_bridge_sync_health_check: 'healthy',
      claude_runtime_health_check: 'ready',
      launch_agents_health_check: 'healthy',
      runtime_logs_health_check: 'healthy',
      tailscale_health_check: 'Running',
      disk_space_health_check: 'ready',
    }),
  });
  assert.equal(report.readiness, 'ready');
  assert.equal(report.summary.blocked, 0);
});

test('runMacRebootRecoveryCheck reports blocked when a required check fails', async () => {
  const config = buildConfig();
  const report = await runMacRebootRecoveryCheck(config, {
    executeHealthAction: stubHealthExecutor({
      discord_bot_runtime_health_check: 'not running',
      ruflo_daemon_health_check: 'ready',
      session_checkpoint_health_check: 'healthy',
      memory_bridge_sync_health_check: 'healthy',
      claude_runtime_health_check: 'ready',
      launch_agents_health_check: 'healthy',
      runtime_logs_health_check: 'healthy',
      tailscale_health_check: 'Running',
      disk_space_health_check: 'ready',
    }),
  });
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.failingRequired.some((entry) => entry.action === 'discord_bot_runtime_health_check'));
});

test('runMacRebootRecoveryCheck degrades softly when only optional checks fail', async () => {
  const config = buildConfig();
  const report = await runMacRebootRecoveryCheck(config, {
    executeHealthAction: stubHealthExecutor({
      tailscale_health_check: 'Stopped',
      disk_space_health_check: 'ready',
      ruflo_daemon_health_check: 'ready',
      discord_bot_runtime_health_check: 'running',
      session_checkpoint_health_check: 'healthy',
      memory_bridge_sync_health_check: 'healthy',
      claude_runtime_health_check: 'ready',
      launch_agents_health_check: 'healthy',
      runtime_logs_health_check: 'healthy',
    }),
  });
  assert.equal(report.readiness, 'degraded_soft');
});

test('runMacRebootRecoveryCheck reports blocked when a check throws', async () => {
  const config = buildConfig();
  const report = await runMacRebootRecoveryCheck(config, {
    executeHealthAction: stubHealthExecutor({
      ruflo_daemon_health_check: 'THROW',
      discord_bot_runtime_health_check: 'running',
      session_checkpoint_health_check: 'healthy',
      memory_bridge_sync_health_check: 'healthy',
      claude_runtime_health_check: 'ready',
      launch_agents_health_check: 'healthy',
      runtime_logs_health_check: 'healthy',
      tailscale_health_check: 'Running',
      disk_space_health_check: 'ready',
    }),
  });
  assert.equal(report.readiness, 'blocked');
  assert.ok(report.detail.find((entry) => entry.action === 'ruflo_daemon_health_check').error);
});
