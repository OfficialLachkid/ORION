import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { executeHealthAction } from '../../task-router/src/executor.mjs';
import { recordOpsMetric } from '../../lib/metrics-store.mjs';
import { buildHealthNotificationDiscordPayload } from './message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getHealthCheckActions(config) {
  const actions = [
    'discord_bot_runtime_health_check',
    'tailscale_health_check',
    'docker_colima_health_check',
    'ollama_health_check',
    'disk_space_health_check',
  ];

  if (config?.rufloWorkerService?.expected !== false) {
    actions.unshift('ruflo_daemon_health_check');
  }

  return actions;
}

const HEALTH_CHECK_LABELS = {
  ruflo_daemon_health_check: 'Ruflo daemon',
  discord_bot_runtime_health_check: 'Discord bot runtime',
  tailscale_health_check: 'Tailscale',
  docker_colima_health_check: 'Docker and Colima',
  ollama_health_check: 'Ollama',
  disk_space_health_check: 'Disk space',
};

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method: 'POST',
    headers: buildAuthHeaders(token),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

function ensureParentDirectory(filePath) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

function healthMonitorStatePath(config) {
  return resolve(
    config.runtimePaths.healthMonitorStateFile || resolve(config.runtimePaths.logDir, 'health-monitor-state.json')
  );
}

function loadHealthMonitorState(config) {
  const filePath = healthMonitorStatePath(config);
  if (!existsSync(filePath)) {
    return {
      checks: {},
      updatedAt: '',
    };
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {
      checks: {},
      updatedAt: '',
    };
  }
}

function saveHealthMonitorState(config, state) {
  const filePath = healthMonitorStatePath(config);
  ensureParentDirectory(filePath);
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return filePath;
}

function kbToGb(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }

  return numeric / (1024 * 1024);
}

function parsePercentValue(value) {
  const match = /(\d+)/u.exec(String(value || ''));
  if (!match) {
    return 0;
  }

  return Number.parseInt(match[1], 10);
}

function normalizeSeverity(value) {
  return ['healthy', 'warning', 'critical'].includes(value) ? value : 'critical';
}

function buildCheckSignature(check) {
  return `${check.severity}:${check.state || 'unknown'}`;
}

function buildRecoveryCommand(action, check) {
  if (action === 'ruflo_daemon_health_check') {
    return 'launchctl kickstart -k gui/$(id -u)/io.ruv.ruflo.daemon';
  }

  if (action === 'discord_bot_runtime_health_check') {
    return 'launchctl kickstart -k gui/$(id -u)/io.ruv.ruflo.discord-bot';
  }

  if (action === 'tailscale_health_check') {
    return 'open -a Tailscale';
  }

  if (action === 'docker_colima_health_check') {
    if (check?.severity === 'warning') {
      return 'docker context use colima';
    }

    return 'colima start';
  }

  if (action === 'ollama_health_check') {
    return 'brew services start ollama';
  }

  if (action === 'disk_space_health_check') {
    return 'du -sh ~/Library/Logs/vbj ~/Workspace/ruflo ~/.ollama 2>/dev/null';
  }

  return '';
}

function describeFailedCheck(action, error) {
  const summary = error?.message || 'Health check failed.';
  return {
    action,
    label: HEALTH_CHECK_LABELS[action] || action,
    severity: 'critical',
    state: 'failed',
    summary,
    details: [],
    recoveryCommand: buildRecoveryCommand(action, { severity: 'critical', state: 'failed', summary }),
  };
}

function evaluateSuccessfulCheck(action, report, config) {
  const label = HEALTH_CHECK_LABELS[action] || action;

  if (action === 'ruflo_daemon_health_check') {
    const rawState = String(report.state || 'unknown').toLowerCase();
    const isRunning = rawState.includes('running') && !rawState.includes('not');
    return {
      action,
      label,
      severity: isRunning ? 'healthy' : 'critical',
      state: report.state || 'unknown',
      summary: isRunning
        ? `Ruflo daemon is ${report.state || 'running'}.`
        : `Ruflo daemon is ${report.state || 'not running'}.`,
      details: [
        report.activeCount !== undefined ? `Active count: ${report.activeCount}` : '',
        report.runs !== undefined ? `Runs: ${report.runs}` : '',
        report.lastExitCode !== undefined ? `Last exit code: ${report.lastExitCode}` : '',
      ].filter(Boolean),
      recoveryCommand: isRunning ? '' : buildRecoveryCommand(action, { severity: 'critical', state: report.state || 'unknown' }),
    };
  }

  if (action === 'discord_bot_runtime_health_check') {
    const processCount = Number(report.processCount || 0);
    return {
      action,
      label,
      severity: processCount > 0 ? 'healthy' : 'critical',
      state: report.state || 'unknown',
      summary: processCount > 0
        ? `Discord bot runtime is running with ${processCount} process${processCount === 1 ? '' : 'es'}.`
        : 'Discord bot runtime is not running.',
      details: [
        report.logPath ? `Log path: ${report.logPath}` : '',
      ].filter(Boolean),
      recoveryCommand: processCount > 0 ? '' : buildRecoveryCommand(action, { severity: 'critical', state: report.state || 'unknown' }),
    };
  }

  if (action === 'tailscale_health_check') {
    const backendState = String(report.backendState || report.state || 'unknown');
    const isRunning = backendState.toLowerCase() === 'running';
    const isDegraded = backendState.toLowerCase() === 'degraded';
    const hasIp = Array.isArray(report.tailscaleIps) && report.tailscaleIps.length > 0;
    return {
      action,
      label,
      severity: isRunning
        ? hasIp ? 'healthy' : 'warning'
        : isDegraded
          ? 'warning'
          : 'critical',
      state: backendState,
      summary: !isRunning && !isDegraded
        ? `Tailscale backend is ${backendState}.`
        : isDegraded
          ? 'Tailscale backend is degraded.'
        : hasIp
          ? `Tailscale is running on ${report.hostName || 'this host'}.`
          : 'Tailscale is running but no Tailscale IP is present.',
      details: [
        hasIp ? `IP: ${report.tailscaleIps[0]}` : '',
        report.dnsName ? `DNS: ${report.dnsName}` : '',
        report.relay ? `Relay: ${report.relay}` : '',
        report.version ? `Version: ${report.version}` : '',
      ].filter(Boolean),
      recoveryCommand: (isRunning && hasIp) ? '' : buildRecoveryCommand(action, {
        severity: isDegraded || !hasIp ? 'warning' : 'critical',
        state: backendState,
      }),
    };
  }

  if (action === 'docker_colima_health_check') {
    const dockerRunning = String(report.state || '').toLowerCase() === 'running';
    const colimaRunning = String(report.colimaState || '').toLowerCase() === 'running';
    const onColimaContext = String(report.dockerContext || '') === 'colima';
    const severity = !dockerRunning || !colimaRunning ? 'critical' : onColimaContext ? 'healthy' : 'warning';

    return {
      action,
      label,
      severity,
      state: report.state || 'unknown',
      summary: !dockerRunning || !colimaRunning
        ? `Docker is ${report.state || 'unknown'} and Colima is ${report.colimaState || 'unknown'}.`
        : onColimaContext
          ? `Docker and Colima are running on context ${report.dockerContext}.`
          : `Docker and Colima are running, but Docker context is ${report.dockerContext || 'unknown'}.`,
      details: [
        report.dockerContext ? `Context: ${report.dockerContext}` : '',
        report.dockerServerVersion ? `Docker version: ${report.dockerServerVersion}` : '',
      ].filter(Boolean),
      recoveryCommand: severity === 'healthy' ? '' : buildRecoveryCommand(action, { severity, state: report.state || 'unknown' }),
    };
  }

  if (action === 'ollama_health_check') {
    const activeModelCount = Number(report.activeModelCount || 0);
    const state = String(report.state || '').toLowerCase() === 'running'
      ? activeModelCount > 0 ? 'active' : 'idle'
      : report.state || 'unknown';
    return {
      action,
      label,
      severity: String(report.state || '').toLowerCase() === 'running' ? 'healthy' : 'critical',
      state,
      summary: activeModelCount > 0
        ? `Ollama is active with ${activeModelCount} loaded model${activeModelCount === 1 ? '' : 's'}.`
        : 'Ollama is healthy but idle with no active models.',
      details: [],
      recoveryCommand: String(report.state || '').toLowerCase() === 'running' ? '' : buildRecoveryCommand(action, { severity: 'critical', state }),
    };
  }

  if (action === 'disk_space_health_check') {
    const usePercentValue = parsePercentValue(report.usePercent);
    const warnThreshold = Number(config.healthThresholds.diskUsageWarnPercent || 85);
    const criticalThreshold = Number(config.healthThresholds.diskUsageCriticalPercent || 92);
    const severity = usePercentValue >= criticalThreshold
      ? 'critical'
      : usePercentValue >= warnThreshold
        ? 'warning'
        : 'healthy';

    return {
      action,
      label,
      severity,
      state: report.usePercent || 'unknown',
      summary: `Disk usage is ${report.usePercent || 'unknown'} on ${report.mountPoint || 'unknown'}.`,
      details: [
        Number.isFinite(report.availableKb) ? `Free: ${kbToGb(report.availableKb).toFixed(1)} GB` : '',
        Number.isFinite(report.totalKb) ? `Total: ${kbToGb(report.totalKb).toFixed(1)} GB` : '',
        `Thresholds: warn ${warnThreshold}% / critical ${criticalThreshold}%`,
      ].filter(Boolean),
      recoveryCommand: severity === 'healthy' ? '' : buildRecoveryCommand(action, { severity, state: report.usePercent || 'unknown' }),
    };
  }

  return {
    action,
    label,
    severity: 'healthy',
    state: report.state || 'unknown',
    summary: `${label} check completed.`,
    details: [],
    recoveryCommand: '',
  };
}

export function evaluateHealthCheckResult(action, result, config) {
  if (!result || result.outcome !== 'completed') {
    return describeFailedCheck(action, result?.error);
  }

  return evaluateSuccessfulCheck(action, result.executionResult?.report || {}, config);
}

export function planHealthNotifications(currentChecks, previousChecks = {}) {
  const notifications = [];
  const nextChecksState = {};

  for (const check of currentChecks) {
    const previous = previousChecks[check.action];
    const previousSeverity = normalizeSeverity(previous?.severity || '');
    const signature = buildCheckSignature(check);
    const sameSignature = previous?.signature === signature;
    const consecutiveHealthy = check.severity === 'healthy'
      ? sameSignature
        ? Number(previous?.consecutiveHealthy || 0) + 1
        : 1
      : 0;
    const consecutiveUnhealthy = check.severity !== 'healthy'
      ? sameSignature
        ? Number(previous?.consecutiveUnhealthy || 0) + 1
        : 1
      : 0;
    const nextState = {
      severity: check.severity,
      state: check.state,
      summary: check.summary,
      signature,
      consecutiveHealthy,
      consecutiveUnhealthy,
      lastNotificationKind: previous?.lastNotificationKind || '',
      lastNotifiedSignature: previous?.lastNotifiedSignature || '',
    };

    if (check.severity === 'healthy') {
      const recoveryThreshold = Number(check.thresholds?.recoveryConsecutiveHealthy || 2);
      if (
        previous &&
        previous.lastNotificationKind === 'alert' &&
        consecutiveHealthy >= recoveryThreshold &&
        nextState.lastNotifiedSignature !== signature
      ) {
      notifications.push({
        kind: 'recovery',
        action: check.action,
        label: check.label,
        severity: check.severity,
        state: check.state,
        summary: `${check.label} recovered to healthy.`,
        details: check.details,
        recoveryCommand: '',
      });
        nextState.lastNotificationKind = 'recovery';
        nextState.lastNotifiedSignature = signature;
      }
    } else {
      const unhealthyThreshold = Number(check.thresholds?.alertConsecutiveUnhealthy || 2);
      if (
        consecutiveUnhealthy >= unhealthyThreshold &&
        (nextState.lastNotificationKind !== 'alert' || nextState.lastNotifiedSignature !== signature)
      ) {
        notifications.push({
          kind: 'alert',
          action: check.action,
          label: check.label,
          severity: check.severity,
          state: check.state,
          summary: check.summary,
          details: check.details,
          recoveryCommand: check.recoveryCommand || '',
        });
        nextState.lastNotificationKind = 'alert';
        nextState.lastNotifiedSignature = signature;
      }
    }

    nextChecksState[check.action] = nextState;
  }

  return {
    notifications,
    nextChecksState,
  };
}

export function formatHealthMonitorReport(run) {
  const lines = [
    '**Runtime Health Monitor**',
    `Checks evaluated: ${run.checks.length}`,
    `Notifications planned: ${run.notifications.length}`,
    '',
  ];

  for (const check of run.checks) {
    lines.push(
      `- ${check.label}: ${check.severity} (${check.state || 'unknown'})`,
      `  ${check.summary}`
    );
  }

  if (run.notifications.length > 0) {
    lines.push('', '**Notifications**');
    for (const notification of run.notifications) {
      lines.push(`- ${notification.kind}: ${notification.label} -> ${notification.severity}`);
    }
  }

  return lines.join('\n');
}

async function postNotification(config, notification) {
  if (!config.channelIds.alerts) {
    throw new Error('No Discord alerts channel is configured.');
  }

  return sendDiscordApiRequest(
    config.env.DISCORD_BOT_TOKEN,
    `/channels/${config.channelIds.alerts}/messages`,
    buildHealthNotificationDiscordPayload(notification)
  );
}

function buildStateSnapshotFromMonitor(nextChecksState) {
  return {
    updatedAt: new Date().toISOString(),
    checks: nextChecksState,
  };
}

export async function runHealthMonitor(config, options = {}) {
  const previousState = loadHealthMonitorState(config);
  const checks = [];

  for (const action of getHealthCheckActions(config)) {
    const result = await executeHealthAction(action, config, {
      commandRunner: options.commandRunner,
    });
    const check = evaluateHealthCheckResult(action, result, config);
    check.thresholds = {
      alertConsecutiveUnhealthy: config.healthThresholds.alertConsecutiveUnhealthy,
      recoveryConsecutiveHealthy: config.healthThresholds.recoveryConsecutiveHealthy,
    };
    checks.push(check);
    recordOpsMetric(config, 'health_monitor_check', {
      action,
      severity: check.severity,
      state: check.state,
    });
  }

  const { notifications, nextChecksState } = planHealthNotifications(checks, previousState.checks || {});
  const nextState = buildStateSnapshotFromMonitor(nextChecksState);
  const stateFile = saveHealthMonitorState(config, nextState);

  if (!options.dryRun) {
    for (const notification of notifications) {
      await postNotification(config, notification);
      recordOpsMetric(
        config,
        notification.kind === 'recovery' ? 'health_monitor_recovered' : 'health_monitor_alert_emitted',
        {
          action: notification.action,
          severity: notification.severity,
          state: notification.state,
        }
      );
    }
  }

  recordOpsMetric(config, 'health_monitor_run_completed', {
    notifications: notifications.length,
    checksEvaluated: checks.length,
  });

  return {
    checks,
    notifications,
    stateFile,
  };
}
