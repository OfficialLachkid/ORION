const REQUIRED_CHECKS = [
  'launch_agents_health_check',
  'discord_bot_runtime_health_check',
  'ruflo_daemon_health_check',
  'session_checkpoint_health_check',
  'memory_bridge_sync_health_check',
  'claude_runtime_health_check',
  'runtime_logs_health_check',
];

const OPTIONAL_CHECKS = [
  'tailscale_health_check',
  'disk_space_health_check',
];

const HEALTHY_STATES = new Set([
  'ready',
  'healthy',
  'running',
  'authenticated',
  'active',
]);

const DEGRADED_STATES = new Set([
  'degraded',
  'warning',
  'empty',
  'idle',
  'stopped',
]);

const BLOCKED_STATES = new Set([
  'blocked',
  'missing',
  'auth_required',
  'not running',
  'error',
  'unknown',
]);

function classifyDiskPercent(percentString, options = {}) {
  const match = /^(\d+)%$/u.exec(String(percentString || '').trim());
  if (!match) {
    return null;
  }
  const percent = Number.parseInt(match[1], 10);
  if (!Number.isFinite(percent)) {
    return null;
  }
  const criticalThreshold = Number.isFinite(options.criticalPercent) ? options.criticalPercent : 92;
  const warnThreshold = Number.isFinite(options.warnPercent) ? options.warnPercent : 85;
  if (percent >= criticalThreshold) {
    return 'blocked';
  }
  if (percent >= warnThreshold) {
    return 'degraded';
  }
  return 'healthy';
}

export function classifyCheckState(rawState, options = {}) {
  const normalized = String(rawState || '').trim().toLowerCase();
  if (options.action === 'disk_space_health_check') {
    const diskVerdict = classifyDiskPercent(rawState, options);
    if (diskVerdict) {
      return diskVerdict;
    }
  }
  if (options.tailscaleState && normalized === 'stopped') {
    return 'blocked';
  }
  if (normalized === 'not running') {
    return 'blocked';
  }
  if (HEALTHY_STATES.has(normalized)) {
    return 'healthy';
  }
  if (DEGRADED_STATES.has(normalized)) {
    return 'degraded';
  }
  if (BLOCKED_STATES.has(normalized)) {
    return 'blocked';
  }
  return 'unknown';
}

export function summarizeRebootRecoveryChecks(rawChecks = [], options = {}) {
  const summary = {
    total: rawChecks.length,
    healthy: 0,
    degraded: 0,
    blocked: 0,
    unknown: 0,
    perAction: {},
  };
  const detail = [];
  for (const check of rawChecks) {
    const verdict = classifyCheckState(check.state, {
      action: check.action,
      tailscaleState: check.action === 'tailscale_health_check',
      warnPercent: options.diskWarnPercent,
      criticalPercent: options.diskCriticalPercent,
    });
    summary[verdict] += 1;
    summary.perAction[check.action] = verdict;
    detail.push({
      action: check.action,
      required: REQUIRED_CHECKS.includes(check.action),
      verdict,
      state: check.state,
      summary: check.summary || '',
      report: check.report || null,
      error: check.error || '',
    });
  }
  return { summary, detail };
}

export function classifyOverallReadiness(detail, options = {}) {
  const requireOptional = options.requireOptional === true;
  const missingRequired = REQUIRED_CHECKS.filter(
    (action) => !detail.some((entry) => entry.action === action)
  );
  const failingRequired = detail
    .filter((entry) => entry.required && entry.verdict !== 'healthy');
  const failingOptional = detail
    .filter((entry) => !entry.required && OPTIONAL_CHECKS.includes(entry.action) && entry.verdict !== 'healthy');

  if (missingRequired.length > 0) {
    return {
      readiness: 'blocked',
      missingRequired,
      failingRequired,
      failingOptional,
    };
  }
  if (failingRequired.length > 0) {
    return {
      readiness: 'blocked',
      missingRequired: [],
      failingRequired,
      failingOptional,
    };
  }
  if (requireOptional && failingOptional.length > 0) {
    return {
      readiness: 'degraded',
      missingRequired: [],
      failingRequired: [],
      failingOptional,
    };
  }
  if (failingOptional.length > 0) {
    return {
      readiness: 'degraded_soft',
      missingRequired: [],
      failingRequired: [],
      failingOptional,
    };
  }
  return {
    readiness: 'ready',
    missingRequired: [],
    failingRequired: [],
    failingOptional: [],
  };
}

export function getRequiredRebootChecks() {
  return [...REQUIRED_CHECKS];
}

export function getOptionalRebootChecks() {
  return [...OPTIONAL_CHECKS];
}
