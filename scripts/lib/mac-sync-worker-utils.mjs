export const MAC_SYNC_HEALTH_ACTIONS = [
  'ruflo_daemon_health_check',
  'discord_bot_runtime_health_check',
  'tailscale_health_check',
  'docker_colima_health_check',
  'ollama_health_check',
];

const ALLOWED_RUNTIME_DRIFT_PATHS = new Set([
  'agentdb.rvf.lock',
  'Jacobs-2',
]);

export function parseRevListCounts(output) {
  const raw = String(output || '').trim();
  const [aheadRaw = '0', behindRaw = '0'] = raw.split(/\s+/u);
  const aheadCount = Number.parseInt(aheadRaw, 10);
  const behindCount = Number.parseInt(behindRaw, 10);

  return {
    aheadCount: Number.isFinite(aheadCount) ? aheadCount : 0,
    behindCount: Number.isFinite(behindCount) ? behindCount : 0,
  };
}

function normalizeGitPath(value) {
  const text = String(value || '').trim().replace(/\\/gu, '/');
  if (!text) {
    return '';
  }

  return text.includes(' -> ')
    ? text.split(' -> ').at(-1)?.trim() || ''
    : text;
}

export function parseWorktreeStatusEntries(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      raw: line,
      status: line.slice(0, 2),
      path: normalizeGitPath(line.slice(3)),
    }))
    .filter((entry) => entry.path);
}

export function isAllowedRuntimeDriftEntry(entry = {}) {
  return ALLOWED_RUNTIME_DRIFT_PATHS.has(normalizeGitPath(entry.path));
}

export function classifyWorktreeStatus(output) {
  const entries = parseWorktreeStatusEntries(output);
  const runtimeDriftEntries = entries.filter((entry) => isAllowedRuntimeDriftEntry(entry));
  const blockingEntries = entries.filter((entry) => !isAllowedRuntimeDriftEntry(entry));

  return {
    entries,
    runtimeDriftEntries,
    blockingEntries,
    runtimeDriftPaths: [...new Set(runtimeDriftEntries.map((entry) => entry.path))],
    isClean: entries.length === 0,
    hasOnlyAllowedRuntimeDrift: entries.length > 0 && blockingEntries.length === 0,
    isEffectivelyClean: blockingEntries.length === 0,
  };
}

export function classifyMacSyncState({
  currentBranch,
  upstreamRef,
  isClean,
  hasOnlyAllowedRuntimeDrift,
  aheadCount,
  behindCount,
}) {
  const isEffectivelyClean = Boolean(isClean || hasOnlyAllowedRuntimeDrift);

  if (!upstreamRef) {
    return {
      status: 'blocked_no_upstream',
      summary: `Branch ${currentBranch || 'unknown'} has no upstream tracking branch.`,
      canPull: false,
      blocked: true,
    };
  }

  if (!isEffectivelyClean) {
    return {
      status: 'blocked_dirty',
      summary: 'Local worktree is dirty, so automated pull is blocked.',
      canPull: false,
      blocked: true,
    };
  }

  if (aheadCount > 0 && behindCount > 0) {
    return {
      status: 'blocked_diverged',
      summary: `Local branch has diverged from ${upstreamRef}.`,
      canPull: false,
      blocked: true,
    };
  }

  if (aheadCount > 0) {
    return {
      status: 'blocked_ahead',
      summary: `Local branch is ahead of ${upstreamRef}.`,
      canPull: false,
      blocked: true,
    };
  }

  if (behindCount > 0) {
    return {
      status: 'behind',
      summary: `Local branch is behind ${upstreamRef} by ${behindCount} commit${behindCount === 1 ? '' : 's'}.`,
      canPull: true,
      blocked: false,
    };
  }

  return {
    status: 'up_to_date',
    summary: `Local branch is up to date with ${upstreamRef}.`,
    canPull: false,
    blocked: false,
  };
}

export function summarizeHealthChecks(checks = []) {
  const normalizedChecks = Array.isArray(checks) ? checks : [];
  const unhealthyChecks = normalizedChecks.filter((check) => check?.severity !== 'healthy');
  const healthyChecks = normalizedChecks.filter((check) => check?.severity === 'healthy');

  return {
    totalChecks: normalizedChecks.length,
    healthyCount: healthyChecks.length,
    unhealthyCount: unhealthyChecks.length,
    unhealthyChecks,
  };
}

export function buildMacSyncDescription({
  syncState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  rufloWorkerServiceStatus,
  restartedRufloWorkerService,
  healthSummary,
}) {
  const parts = [];
  const workerServiceStatus = rufloWorkerServiceStatus
    || (restartedRufloWorkerService ? 'restarted' : 'unchanged');

  if (dryRun) {
    parts.push('Dry run completed.');
  }

  parts.push(syncState?.summary || 'Sync state evaluated.');

  if (didPull) {
    parts.push('Fast-forward pull applied.');
  }

  if (restartedDiscordBot) {
    parts.push('Discord bot restarted.');
  }

  if (restartDiscordBotDeferred) {
    parts.push('Discord bot restart deferred until completion reporting.');
  }

  if (workerServiceStatus === 'restarted') {
    parts.push('Ruflo worker service restarted.');
  } else if (workerServiceStatus === 'not_installed') {
    parts.push('Ruflo worker service is not installed in this session; restart skipped.');
  } else if (workerServiceStatus === 'disabled') {
    parts.push('Ruflo worker service checks are disabled for this session.');
  }

  if (healthSummary) {
    if (healthSummary.unhealthyCount > 0) {
      parts.push(`${healthSummary.unhealthyCount} health check${healthSummary.unhealthyCount === 1 ? '' : 's'} still unhealthy.`);
    } else {
      parts.push(`All ${healthSummary.healthyCount} health checks are healthy.`);
    }
  }

  return parts.join(' ');
}
