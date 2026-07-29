#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { executeClaudeTaskFromPayloadFile } from '../services/claude-runner/src/runner.mjs';
import { writeCheckpointFile } from './lib/session-checkpoint-utils.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import {
  buildResumeCommand,
  scanClaudeRunnerRecovery,
} from './lib/claude-runner-recovery.mjs';
import { postToolReport } from './lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';

const HEARTBEAT_STATE_FILE = resolve(projectRoot, 'data', 'runtime', 'resume-watch-heartbeat.json');

function readHeartbeatState() {
  if (!existsSync(HEARTBEAT_STATE_FILE)) {
    return { lastPostAtMs: 0 };
  }
  try {
    return JSON.parse(readFileSync(HEARTBEAT_STATE_FILE, 'utf8')) || { lastPostAtMs: 0 };
  } catch {
    return { lastPostAtMs: 0 };
  }
}

function writeHeartbeatState(state) {
  mkdirSync(dirname(HEARTBEAT_STATE_FILE), { recursive: true });
  writeFileSync(HEARTBEAT_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

async function markStalledAsBlocked(config, entry) {
  const checkpoint = {
    sessionId: entry.sessionId,
    taskId: entry.taskId,
    status: 'blocked',
    summary: 'Claude runner appears to have died before completion; auto-marked by resume scanner.',
    nextStep: 'Investigate and either re-run the task or clean up the checkpoint.',
    blockers: [entry.reason || 'stalled_running'],
    files: entry.taskPayloadPath ? [entry.taskPayloadPath] : [],
    namespace: 'results',
    memoryKey: `checkpoint-${entry.sessionId}-latest`,
    updatedAtUtc: new Date().toISOString(),
  };
  writeCheckpointFile(checkpoint);
  recordOpsMetric(config, 'claude_runner_stalled_marked_blocked', {
    sessionId: entry.sessionId,
    taskId: entry.taskId,
    reason: entry.reason || 'stalled_running',
  });
}

async function attemptResume(config, entry) {
  if (!entry.taskPayloadPath) {
    return {
      sessionId: entry.sessionId,
      resumed: false,
      reason: 'no_task_payload_path',
    };
  }
  try {
    const result = await executeClaudeTaskFromPayloadFile(entry.taskPayloadPath, config);
    const state = result?.report?.state || 'unknown';
    recordOpsMetric(config, 'claude_runner_resumed', {
      sessionId: entry.sessionId,
      taskId: entry.taskId,
      state,
      resultPath: result?.report?.resultPath || '',
    });
    return {
      sessionId: entry.sessionId,
      resumed: true,
      state,
      summary: result?.report?.summary || '',
    };
  } catch (error) {
    recordOpsMetric(config, 'claude_runner_resume_failed', {
      sessionId: entry.sessionId,
      taskId: entry.taskId,
      error: error.message || 'unknown_error',
    });
    return {
      sessionId: entry.sessionId,
      resumed: false,
      reason: error.message || 'resume_failed',
    };
  }
}

export async function runClaudeRunnerResume(config, options = {}) {
  const scan = scanClaudeRunnerRecovery(config, {
    now: options.now,
    staleRunningMs: options.staleRunningMs,
  });

  const actions = [];
  if (options.markStalled === true) {
    for (const entry of scan.stalledRunning) {
      await markStalledAsBlocked(config, entry);
      actions.push({ type: 'marked_blocked', sessionId: entry.sessionId, reason: entry.reason });
    }
  }

  const resumeResults = [];
  if (options.resumePaused === true) {
    const limit = Number.isFinite(options.limit) ? options.limit : scan.resumeCandidates.length;
    const batch = scan.resumeCandidates.slice(0, Math.max(0, limit));
    for (const entry of batch) {
      const result = await attemptResume(config, entry);
      resumeResults.push(result);
      actions.push({ type: 'resume_attempted', sessionId: entry.sessionId, resumed: result.resumed, state: result.state });
    }
  }

  return {
    ...scan,
    resumeCandidatesWithCommands: scan.resumeCandidates.map((entry) => ({
      sessionId: entry.sessionId,
      taskId: entry.taskId,
      taskPayloadPath: entry.taskPayloadPath,
      resumeCommand: buildResumeCommand(entry),
      ageMs: entry.ageMs,
      status: entry.checkpoint?.status || '',
    })),
    stalledRunningWithCommands: scan.stalledRunning.map((entry) => ({
      sessionId: entry.sessionId,
      taskId: entry.taskId,
      taskPayloadPath: entry.taskPayloadPath,
      resumeCommand: buildResumeCommand(entry),
      ageMs: entry.ageMs,
    })),
    actions,
    resumeResults,
  };
}

function printSummary(report) {
  printInfo(`Scanned ${report.scannedSessionCount} session checkpoint(s) at ${report.checkpointRoot}`);
  printInfo(`Resume candidates: ${report.resumeCandidatesWithCommands.length}`);
  for (const entry of report.resumeCandidatesWithCommands) {
    process.stdout.write(`- ${entry.sessionId} (${entry.status}, ${Math.round(entry.ageMs / 1000)}s old)\n`);
    if (entry.resumeCommand) {
      process.stdout.write(`    ${entry.resumeCommand}\n`);
    }
  }
  if (report.stalledRunningWithCommands.length > 0) {
    printWarn(`Stalled running sessions: ${report.stalledRunningWithCommands.length}`);
    for (const entry of report.stalledRunningWithCommands) {
      process.stdout.write(`- ${entry.sessionId} stuck for ${Math.round(entry.ageMs / 1000)}s\n`);
    }
  }
  if (report.actions.length > 0) {
    printInfo(`Actions taken: ${report.actions.length}`);
    for (const action of report.actions) {
      process.stdout.write(`- ${action.type} ${action.sessionId}${action.state ? ` -> ${action.state}` : ''}\n`);
    }
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/claude-runner-resume.mjs [options]',
      '',
      'Options:',
      '  --resume-paused         Actually re-execute paused / pre_limit task payloads.',
      '  --mark-stalled          Mark running-but-stalled checkpoints as blocked.',
      '  --stale-minutes <n>     Minutes before a running checkpoint counts as stalled. Default: 30',
      '  --limit <n>             Cap on how many paused sessions to resume. Default: all.',
      '  --json                  Print the report as JSON.',
      '  --post-to-discord       Post the resume report to the agent-results Discord channel.',
      '  --quiet-if-empty        Skip the Discord post when there is nothing to resume or mark.',
      '  --heartbeat-hours <n>   Force a heartbeat post at least every N hours even if empty. Default: 0 (disabled).',
      '  --launchagent           Marker for LaunchAgent-triggered runs; adds a trigger field to Discord.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const staleMinutes = parsePositiveInt(getStringOption(options, 'stale-minutes', '30'), 30);
  const limit = parsePositiveInt(getStringOption(options, 'limit', ''), Number.POSITIVE_INFINITY);
  const report = await runClaudeRunnerResume(config, {
    resumePaused: getBooleanOption(options, 'resume-paused', false),
    markStalled: getBooleanOption(options, 'mark-stalled', false),
    staleRunningMs: staleMinutes * 60 * 1000,
    limit,
  });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printSummary(report);
  }

  const heartbeatHours = parsePositiveInt(getStringOption(options, 'heartbeat-hours', '0'), 0);
  await maybePostResumeReport(config, report, {
    explicit: getBooleanOption(options, 'post-to-discord', false),
    quiet: getBooleanOption(options, 'quiet-if-empty', false),
    triggeredByLaunchAgent: getBooleanOption(options, 'launchagent', false),
    heartbeatHours,
  });
}

async function maybePostResumeReport(config, report, options = {}) {
  if (!options.explicit) {
    return;
  }
  const totalActionable = report.resumeCandidatesWithCommands.length
    + report.stalledRunningWithCommands.length
    + report.actions.length;

  const heartbeatState = readHeartbeatState();
  const heartbeatIntervalMs = Number.isFinite(options.heartbeatHours) && options.heartbeatHours > 0
    ? options.heartbeatHours * 60 * 60 * 1000
    : 0;
  const nowMs = Date.now();
  const heartbeatDue = heartbeatIntervalMs > 0
    && (heartbeatState.lastPostAtMs === 0 || (nowMs - heartbeatState.lastPostAtMs) >= heartbeatIntervalMs);

  if (options.quiet && totalActionable === 0 && !heartbeatDue) {
    return;
  }
  const isHeartbeatOnly = totalActionable === 0 && heartbeatDue;
  const verdict = isHeartbeatOnly
    ? 'ok'
    : report.actions.some((action) => action.resumed === false)
      ? 'degraded'
      : totalActionable === 0
        ? 'ok'
        : 'ready';
  const summary = isHeartbeatOnly
    ? `Heartbeat: auto-resume watch is alive. Last ${report.scannedSessionCount} checkpoints scanned cleanly.`
    : totalActionable === 0
      ? `Scanned ${report.scannedSessionCount} session checkpoint(s). Nothing to resume.`
      : `Scanned ${report.scannedSessionCount} session checkpoint(s). Resume candidates: ${report.resumeCandidatesWithCommands.length}. Stalled: ${report.stalledRunningWithCommands.length}. Actions: ${report.actions.length}.`;
  const fields = [];
  if (isHeartbeatOnly) {
    fields.push({ name: 'kind', value: 'heartbeat', inline: true });
    fields.push({
      name: 'nextHeartbeatAtUtc',
      value: new Date(nowMs + heartbeatIntervalMs).toISOString(),
      inline: true,
    });
  }
  if (report.resumeCandidatesWithCommands.length > 0) {
    fields.push({
      name: 'resume_candidates',
      value: report.resumeCandidatesWithCommands
        .map((entry) => `${entry.sessionId} (${entry.status})`)
        .join('\n'),
    });
  }
  if (report.stalledRunningWithCommands.length > 0) {
    fields.push({
      name: 'stalled_running',
      value: report.stalledRunningWithCommands
        .map((entry) => `${entry.sessionId} stuck ${Math.round(entry.ageMs / 60000)} min`)
        .join('\n'),
    });
  }
  if (report.actions.length > 0) {
    fields.push({
      name: 'actions',
      value: report.actions
        .map((action) => `${action.type} ${action.sessionId}${action.state ? ` -> ${action.state}` : ''}`)
        .join('\n'),
    });
  }
  if (options.triggeredByLaunchAgent) {
    fields.push({ name: 'trigger', value: 'launchagent (claude-resume-watch)', inline: true });
  }
  try {
    const post = await postToolReport(config, 'claude_runner_resume', verdict, summary, fields, { explicit: true });
    if (post.posted) {
      writeHeartbeatState({ lastPostAtMs: nowMs, lastPostAtUtc: new Date(nowMs).toISOString(), lastPostKind: isHeartbeatOnly ? 'heartbeat' : 'action' });
      printInfo(`Posted resume report to Discord channel ${post.channelKey}${isHeartbeatOnly ? ' (heartbeat)' : ''}.`);
    } else if (post.reason !== 'disabled') {
      printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
    }
  } catch (error) {
    printError(`Could not post resume report to Discord: ${error.message || error}`);
  }
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
