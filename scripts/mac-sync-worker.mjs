#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { buildNoticeDiscordPayload } from '../services/discord-bot/src/message-formatting.mjs';
import { evaluateHealthCheckResult } from '../services/discord-bot/src/health-monitor.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { executeHealthAction } from '../services/task-router/src/executor.mjs';
import {
  MAC_SYNC_HEALTH_ACTIONS,
  buildMacSyncDescription,
  classifyWorktreeStatus,
  classifyMacSyncState,
  parseRevListCounts,
  summarizeHealthChecks,
} from './lib/mac-sync-worker-utils.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_BOT_LAUNCH_AGENT = 'io.ruv.ruflo.discord-bot';
const RUFLO_WORKER_SERVICE_LAUNCH_AGENT = 'io.ruv.ruflo.daemon';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeHealthChecks(healthChecks = []) {
  return healthChecks.map((check) => ({
    action: check.action || '',
    label: check.label || '',
    severity: check.severity || 'unknown',
    state: check.state || '',
    summary: check.summary || '',
    details: Array.isArray(check.details) ? check.details : [],
    recoveryCommand: check.recoveryCommand || '',
  }));
}

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

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd || projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...(options.env || {}),
    },
  }).trim();
}

function getUserLaunchdDomain() {
  if (typeof process.getuid !== 'function') {
    throw new Error('Could not resolve the current macOS user id for launchctl actions.');
  }

  return `gui/${process.getuid()}`;
}

function restartLaunchAgent(label) {
  runCommand('launchctl', ['kickstart', '-k', `${getUserLaunchdDomain()}/${label}`], {
    cwd: process.env.HOME || projectRoot,
  });
}

function isMissingLaunchAgentError(error) {
  const message = String(error?.stderr || error?.message || error || '');
  return message.includes('Could not find service');
}

function isLaunchAgentInstalled(label) {
  try {
    runCommand('launchctl', ['print', `${getUserLaunchdDomain()}/${label}`], {
      cwd: process.env.HOME || projectRoot,
    });
    return true;
  } catch (error) {
    if (isMissingLaunchAgentError(error)) {
      return false;
    }

    throw error;
  }
}

function readGitSyncState() {
  const currentBranch = runCommand('git', ['branch', '--show-current']);
  const worktreeStatus = runCommand('git', ['status', '--porcelain']);
  const worktree = classifyWorktreeStatus(worktreeStatus);
  let upstreamRef = '';

  try {
    upstreamRef = runCommand('git', ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    upstreamRef = '';
  }

  let aheadCount = 0;
  let behindCount = 0;
  if (upstreamRef) {
    const counts = parseRevListCounts(runCommand('git', ['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]));
    aheadCount = counts.aheadCount;
    behindCount = counts.behindCount;
  }

  return {
    currentBranch,
    upstreamRef,
    isClean: worktree.isClean,
    hasOnlyAllowedRuntimeDrift: worktree.hasOnlyAllowedRuntimeDrift,
    isEffectivelyClean: worktree.isEffectivelyClean,
    runtimeDriftEntries: worktree.runtimeDriftEntries,
    runtimeDriftPaths: worktree.runtimeDriftPaths,
    blockingEntries: worktree.blockingEntries,
    aheadCount,
    behindCount,
  };
}

function cleanAllowedRuntimeDrift(gitState) {
  const restoredPaths = [];

  for (const entry of gitState.runtimeDriftEntries || []) {
    if (entry.path === 'agentdb.rvf.lock' && entry.status !== '??') {
      runCommand('git', ['restore', '--worktree', '--', entry.path]);
      restoredPaths.push(entry.path);
    }
  }

  return restoredPaths;
}

async function runSyncHealthChecks(config, options = {}) {
  const checks = [];
  const includeRufloWorkerService = options.includeRufloWorkerService !== false;

  for (const action of MAC_SYNC_HEALTH_ACTIONS) {
    if (action === 'ruflo_daemon_health_check' && !includeRufloWorkerService) {
      continue;
    }

    const result = await executeHealthAction(action, config);
    checks.push(evaluateHealthCheckResult(action, result, config));
  }

  return checks;
}

function buildMacSyncResult({
  syncState,
  gitState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  rufloWorkerServiceStatus,
  restartedRufloWorkerService,
  healthChecks,
}) {
  const normalizedHealthChecks = normalizeHealthChecks(healthChecks);
  const healthSummary = summarizeHealthChecks(normalizedHealthChecks);

  return {
    summary: buildMacSyncDescription({
      syncState,
      didPull,
      dryRun,
      restartedDiscordBot,
      restartDiscordBotDeferred,
      rufloWorkerServiceStatus,
      restartedRufloWorkerService,
      healthSummary,
    }),
    dryRun,
    didPull,
    restartedDiscordBot,
    restartDiscordBotDeferred,
    rufloWorkerServiceStatus,
    restartedRufloWorkerService,
    syncState,
    gitState,
    healthSummary,
    healthChecks: normalizedHealthChecks,
  };
}

function buildDiscordSyncPayload({
  summary,
  syncState,
  gitState,
  didPull,
  dryRun,
  restartedDiscordBot,
  restartDiscordBotDeferred,
  rufloWorkerServiceStatus,
  restartedRufloWorkerService,
  healthSummary,
}) {
  const workerServiceStatus = rufloWorkerServiceStatus
    || (restartedRufloWorkerService ? 'restarted' : 'unchanged');
  return buildNoticeDiscordPayload({
    title: 'Mac Sync Worker',
    description: summary,
    fields: [
      {
        name: 'Branch',
        value: gitState.currentBranch ? `\`${gitState.currentBranch}\`` : '`unknown`',
        inline: true,
      },
      {
        name: 'Upstream',
        value: gitState.upstreamRef ? `\`${gitState.upstreamRef}\`` : '`none`',
        inline: true,
      },
      {
        name: 'Git State',
        value: `ahead \`${gitState.aheadCount}\` / behind \`${gitState.behindCount}\``,
        inline: true,
      },
      {
        name: 'Sync Status',
        value: `\`${syncState.status}\``,
        inline: true,
      },
      {
        name: 'Pull',
        value: didPull
          ? 'Applied'
          : syncState.blocked
            ? 'Blocked'
            : syncState.canPull
              ? 'Skipped'
              : 'Not needed',
        inline: true,
      },
      {
        name: 'Discord Bot',
        value: restartedDiscordBot
          ? 'Restarted'
          : restartDiscordBotDeferred
            ? 'Deferred'
            : 'Unchanged',
        inline: true,
      },
      {
        name: 'Ruflo Worker Service',
        value: workerServiceStatus === 'restarted'
          ? 'Restarted'
          : workerServiceStatus === 'not_installed'
            ? 'Not installed'
            : workerServiceStatus === 'disabled'
              ? 'Disabled'
              : 'Unchanged',
        inline: true,
      },
      {
        name: 'Health',
        value: healthSummary.unhealthyCount > 0
          ? healthSummary.unhealthyChecks.map((check) => `- ${check.label}: ${check.severity} (${check.state || 'unknown'})`).join('\n')
          : `All ${healthSummary.healthyCount} checks healthy.`,
        inline: false,
      },
    ],
    footerText: 'Ruflo safe sync',
  });
}

async function maybePostDiscordSummary(config, payload, result) {
  const targetChannelId = result?.didPull && config.channelIds.deployments
    ? config.channelIds.deployments
    : config.channelIds.systemLogs;

  if (!config.env.DISCORD_BOT_TOKEN || !targetChannelId) {
    return;
  }

  await sendDiscordApiRequest(
    config.env.DISCORD_BOT_TOKEN,
    `/channels/${targetChannelId}/messages`,
    payload
  );
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/mac-sync-worker.mjs [--dry-run] [--json] [--no-post]',
      '',
      'Runs a safe Mac sync workflow:',
      '- fetch origin',
      '- inspect dirty / ahead / behind state',
      '- fast-forward pull only when safe',
      '- restart the Discord bot after a pull unless deferred for an automation caller',
      '- restart the Ruflo worker service if health shows it unhealthy',
      '- validate post-sync runtime health',
      '- optionally post the result into Discord system logs',
      '- emit structured JSON for automation callers when --json is used',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Mac sync worker is intended to run on the Mac mini (macOS only).');
  }

  const dryRun = hasFlag('--dry-run');
  const jsonOutput = hasFlag('--json');
  const noPost = hasFlag('--no-post');
  const skipDiscordRestart = hasFlag('--skip-discord-restart');
  const config = loadRuntimeConfig();

  runCommand('git', ['fetch', 'origin']);

  let gitState = readGitSyncState();
  let restoredRuntimeDriftPaths = [];
  if (!dryRun && gitState.hasOnlyAllowedRuntimeDrift) {
    restoredRuntimeDriftPaths = cleanAllowedRuntimeDrift(gitState);
    gitState = readGitSyncState();
  }
  const syncState = classifyMacSyncState(gitState);
  let didPull = false;
  let restartedDiscordBot = false;
  let restartDiscordBotDeferred = false;
  let restartedRufloWorkerService = false;
  let rufloWorkerServiceStatus = config.rufloWorkerService?.expected === false ? 'disabled' : 'unchanged';
  const includeRufloWorkerService = config.rufloWorkerService?.expected !== false
    && isLaunchAgentInstalled(RUFLO_WORKER_SERVICE_LAUNCH_AGENT);

  if (config.rufloWorkerService?.expected !== false && !includeRufloWorkerService) {
    rufloWorkerServiceStatus = 'not_installed';
  }

  if (syncState.canPull && !dryRun) {
    runCommand('git', ['pull', '--ff-only']);
    didPull = true;
    if (skipDiscordRestart) {
      restartDiscordBotDeferred = true;
    } else {
      restartLaunchAgent(DISCORD_BOT_LAUNCH_AGENT);
      restartedDiscordBot = true;
    }
  }

  let healthChecks = await runSyncHealthChecks(config, {
    includeRufloWorkerService,
  });
  const workerCheck = healthChecks.find((check) => check.action === 'ruflo_daemon_health_check');
  const discordCheck = healthChecks.find((check) => check.action === 'discord_bot_runtime_health_check');

  if (!dryRun && discordCheck?.severity !== 'healthy' && !restartedDiscordBot) {
    if (skipDiscordRestart) {
      restartDiscordBotDeferred = true;
    } else {
      restartLaunchAgent(DISCORD_BOT_LAUNCH_AGENT);
      restartedDiscordBot = true;
    }
  }

  if (!dryRun && includeRufloWorkerService && workerCheck?.severity !== 'healthy') {
    restartLaunchAgent(RUFLO_WORKER_SERVICE_LAUNCH_AGENT);
    restartedRufloWorkerService = true;
    rufloWorkerServiceStatus = 'restarted';
  }

  if (!dryRun && (restartedDiscordBot || restartedRufloWorkerService)) {
    healthChecks = await runSyncHealthChecks(config, {
      includeRufloWorkerService,
    });
  }

  const result = buildMacSyncResult({
    syncState,
    gitState,
    didPull,
    dryRun,
    restartedDiscordBot,
    restartDiscordBotDeferred,
    rufloWorkerServiceStatus,
    restartedRufloWorkerService,
    healthChecks,
  });
  const payload = buildDiscordSyncPayload(result);

  recordOpsMetric(config, 'mac_sync_worker_completed', {
    status: result.syncState.status,
    blocked: result.syncState.blocked === true,
    canPull: result.syncState.canPull === true,
    didPull: result.didPull === true,
    dryRun: result.dryRun === true,
    branch: result.gitState.currentBranch || '',
    upstream: result.gitState.upstreamRef || '',
    aheadCount: result.gitState.aheadCount || 0,
    behindCount: result.gitState.behindCount || 0,
    hasOnlyAllowedRuntimeDrift: result.gitState.hasOnlyAllowedRuntimeDrift === true,
    runtimeDriftPaths: result.gitState.runtimeDriftPaths || [],
    restoredRuntimeDriftPaths,
    restartedDiscordBot: result.restartedDiscordBot === true,
    restartDiscordBotDeferred: result.restartDiscordBotDeferred === true,
    rufloWorkerServiceStatus: result.rufloWorkerServiceStatus || '',
    restartedRufloWorkerService: result.restartedRufloWorkerService === true,
    healthyCount: result.healthSummary.healthyCount || 0,
    unhealthyCount: result.healthSummary.unhealthyCount || 0,
    unhealthyChecks: result.healthSummary.unhealthyChecks || [],
  });

  process.stdout.write(jsonOutput ? `${JSON.stringify(result)}\n` : `${result.summary}\n`);
  if (!noPost) {
    await maybePostDiscordSummary(config, payload, result);
  }

  if (result.syncState.blocked) {
    process.exitCode = 2;
    return;
  }

  if (result.healthSummary.unhealthyCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
