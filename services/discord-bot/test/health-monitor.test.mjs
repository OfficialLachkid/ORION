import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  evaluateHealthCheckResult,
  formatHealthMonitorReport,
  planHealthNotifications,
  runHealthMonitor,
} from '../src/health-monitor.mjs';

test('evaluateHealthCheckResult marks Discord bot runtime healthy when process matches exist', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('discord_bot_runtime_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'running',
        processCount: 2,
        logPath: '/tmp/discord-bot.log',
      },
    },
  }, config);

  assert.equal(check.severity, 'healthy');
  assert.equal(check.state, 'running');
  assert.match(check.summary, /running with 2 processes/u);
});

test('evaluateHealthCheckResult points Discord bot recovery to launchctl kickstart', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('discord_bot_runtime_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'not running',
        processCount: 0,
        logPath: '/tmp/discord-bot.log',
      },
    },
  }, config);

  assert.equal(check.severity, 'critical');
  assert.match(check.recoveryCommand, /io\.ruv\.ruflo\.discord-bot/u);
});

test('evaluateHealthCheckResult marks disk usage critical above critical threshold', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('disk_space_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        usePercent: '93%',
        mountPoint: '/System/Volumes/Data',
        availableKb: 1024,
        totalKb: 2048,
      },
    },
  }, config);

  assert.equal(check.severity, 'critical');
  assert.equal(check.state, '93%');
});

test('evaluateHealthCheckResult marks Docker context drift as warning', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('docker_colima_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'running',
        colimaState: 'running',
        dockerContext: 'default',
        dockerServerVersion: '29.5.2',
      },
    },
  }, config);

  assert.equal(check.severity, 'warning');
  assert.match(check.summary, /context is default/u);
  assert.match(check.recoveryCommand, /docker context use colima/u);
});

test('evaluateHealthCheckResult marks Ruflo daemon not running as critical', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('ruflo_daemon_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'not running',
        activeCount: 0,
        runs: 7,
        lastExitCode: 0,
      },
    },
  }, config);

  assert.equal(check.severity, 'critical');
  assert.match(check.summary, /Ruflo daemon is not running/u);
  assert.match(check.recoveryCommand, /launchctl kickstart/u);
});

test('evaluateHealthCheckResult marks Tailscale degraded as warning', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('tailscale_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'Degraded',
        backendState: 'Degraded',
        tailscaleIps: [],
        hostName: 'vbj-orchestrator-01',
      },
    },
  }, config);

  assert.equal(check.severity, 'warning');
  assert.match(check.summary, /degraded/u);
  assert.match(check.recoveryCommand, /open -a Tailscale/u);
});

test('evaluateHealthCheckResult marks idle Ollama as healthy and idle', () => {
  const config = loadRuntimeConfig();
  const check = evaluateHealthCheckResult('ollama_health_check', {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'running',
        activeModelCount: 0,
      },
    },
  }, config);

  assert.equal(check.severity, 'healthy');
  assert.equal(check.state, 'idle');
  assert.match(check.summary, /healthy but idle/u);
});

test('planHealthNotifications waits for repeated unhealthy checks before alerting', () => {
  const currentChecks = [
    {
      action: 'tailscale_health_check',
      label: 'Tailscale',
      severity: 'critical',
      state: 'Stopped',
      summary: 'Tailscale backend is Stopped.',
      details: [],
      recoveryCommand: 'open -a Tailscale',
      thresholds: {
        alertConsecutiveUnhealthy: 2,
        recoveryConsecutiveHealthy: 2,
      },
    },
  ];

  const previousChecks = {
    tailscale_health_check: {
      severity: 'critical',
      state: 'Stopped',
      summary: 'Unhealthy before.',
      signature: 'critical:Stopped',
      consecutiveUnhealthy: 1,
      consecutiveHealthy: 0,
      lastNotificationKind: '',
      lastNotifiedSignature: '',
    },
  };

  const { notifications, nextChecksState } = planHealthNotifications(currentChecks, previousChecks);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'alert');
  assert.equal(notifications[0].action, 'tailscale_health_check');
  assert.equal(nextChecksState.tailscale_health_check.consecutiveUnhealthy, 2);
  assert.match(notifications[0].recoveryCommand, /open -a Tailscale/u);
});

test('planHealthNotifications waits for repeated healthy checks before recovery', () => {
  const currentChecks = [
    {
      action: 'disk_space_health_check',
      label: 'Disk space',
      severity: 'healthy',
      state: '17%',
      summary: 'Disk usage is healthy.',
      details: [],
      thresholds: {
        alertConsecutiveUnhealthy: 2,
        recoveryConsecutiveHealthy: 2,
      },
    },
  ];

  const previousChecks = {
    disk_space_health_check: {
      severity: 'healthy',
      state: '17%',
      summary: 'Healthy now.',
      signature: 'healthy:17%',
      consecutiveHealthy: 1,
      consecutiveUnhealthy: 0,
      lastNotificationKind: 'alert',
      lastNotifiedSignature: 'critical:93%',
    },
  };

  const { notifications, nextChecksState } = planHealthNotifications(currentChecks, previousChecks);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].kind, 'recovery');
  assert.equal(notifications[0].action, 'disk_space_health_check');
  assert.equal(nextChecksState.disk_space_health_check.consecutiveHealthy, 2);
});

test('formatHealthMonitorReport renders readable monitor output', () => {
  const content = formatHealthMonitorReport({
    checks: [
      {
        label: 'Discord bot runtime',
        severity: 'healthy',
        state: 'running',
        summary: 'Discord bot runtime is running with 2 processes.',
      },
      {
        label: 'Disk space',
        severity: 'warning',
        state: '88%',
        summary: 'Disk usage is 88% on /System/Volumes/Data.',
      },
    ],
    notifications: [
      {
        kind: 'alert',
        label: 'Disk space',
        severity: 'warning',
      },
    ],
  });

  assert.match(content, /\*\*Runtime Health Monitor\*\*/u);
  assert.match(content, /Checks evaluated: 2/u);
  assert.match(content, /Disk space: warning \(88%\)/u);
  assert.match(content, /Notifications planned: 1/u);
});

test('runHealthMonitor skips Ruflo worker service checks when the service is not expected', async () => {
  const config = loadRuntimeConfig();
  config.rufloWorkerService = { expected: false };
  const seenActions = [];

  const result = await runHealthMonitor(config, {
    dryRun: true,
    commandRunner: async (_command, args = []) => {
      const action = Array.isArray(args) ? args[0] : '';
      if (action) {
        seenActions.push(action);
      }

      return { stdout: '', stderr: '' };
    },
  });

  assert.equal(seenActions.includes('ruflo_daemon_health_check'), false);
  assert.equal(result.checks.some((check) => check.action === 'ruflo_daemon_health_check'), false);
});
