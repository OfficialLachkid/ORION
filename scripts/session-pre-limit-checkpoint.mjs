#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import {
  ensureCheckpointDirectory,
  formatCheckpointSummary,
  writeCheckpointFile,
} from './lib/session-checkpoint-utils.mjs';
import {
  resolveClaudeTasksArtifactRoot,
} from './lib/claude-runner-recovery.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
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

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function collectActiveClaudeTasks(claudeTasksRoot) {
  if (!existsSync(claudeTasksRoot)) {
    return [];
  }
  const taskDirs = readdirSync(claudeTasksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  const active = [];
  for (const taskId of taskDirs) {
    const payloadPath = join(claudeTasksRoot, taskId, 'payload.json');
    const resultPath = join(claudeTasksRoot, taskId, 'result.json');
    if (!existsSync(payloadPath)) {
      continue;
    }
    const payload = safeReadJson(payloadPath);
    if (!payload || !payload.sessionId) {
      continue;
    }
    const result = existsSync(resultPath) ? safeReadJson(resultPath) : null;
    const state = String(result?.report?.state || 'unknown').toLowerCase();
    if (['completed', 'blocked'].includes(state)) {
      continue;
    }
    active.push({
      taskId,
      sessionId: payload.sessionId,
      state,
      summary: payload.task?.summary || payload.task?.request || '',
      payloadPath,
      resultPath: existsSync(resultPath) ? resultPath : '',
    });
  }
  return active;
}

export function buildPreLimitCheckpoint(sessionId, reason, activeTasks, options = {}) {
  const files = activeTasks.map((task) => task.payloadPath).filter(Boolean);
  const blockerSummaries = activeTasks.map((task) => `${task.taskId} (${task.state || 'active'})`);
  return {
    sessionId,
    taskId: options.taskId || null,
    status: 'pre_limit',
    summary: reason || 'Pre-limit emergency checkpoint captured before token exhaustion.',
    nextStep: options.nextStep || 'Wait for provider limits to renew, then run claude:resume --resume-paused.',
    blockers: activeTasks.length > 0 ? blockerSummaries : ['No active Claude tasks at pre-limit time.'],
    files,
    namespace: 'results',
    memoryKey: `checkpoint-${sessionId}-latest`,
    updatedAtUtc: new Date().toISOString(),
  };
}

export async function runSessionPreLimitCheckpoint(config, options = {}) {
  const sessionId = options.sessionId || 'latest';
  const claudeTasksRoot = resolveClaudeTasksArtifactRoot(config);
  ensureCheckpointDirectory('data/session-checkpoints');

  const activeTasks = collectActiveClaudeTasks(claudeTasksRoot);
  const checkpoint = buildPreLimitCheckpoint(sessionId, options.reason, activeTasks, {
    taskId: options.taskId,
    nextStep: options.nextStep,
  });
  const written = writeCheckpointFile(checkpoint);

  recordOpsMetric(config, 'session_pre_limit_checkpoint_written', {
    sessionId,
    activeTaskCount: activeTasks.length,
    reason: options.reason || 'pre_limit',
    latestPath: written.latestPath,
  });

  return {
    sessionId,
    reason: options.reason || 'pre_limit',
    latestPath: written.latestPath,
    historyPath: written.historyPath,
    activeTasks,
    checkpoint: written.payload,
    summaryLines: formatCheckpointSummary(written.payload),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/session-pre-limit-checkpoint.mjs [options]',
      '',
      'Options:',
      '  --session-id <id>       Session identifier. Default: latest',
      '  --task-id <id>          Optional task identifier.',
      '  --reason <text>         Why the pre-limit checkpoint was triggered.',
      '  --next-step <text>      Override the default next-step guidance.',
      '  --json                  Print the report as JSON.',
      '  --post-to-discord       Post the checkpoint summary to the memory-updates Discord channel.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const report = await runSessionPreLimitCheckpoint(config, {
    sessionId: getStringOption(options, 'session-id', 'latest'),
    taskId: getStringOption(options, 'task-id', ''),
    reason: getStringOption(options, 'reason', ''),
    nextStep: getStringOption(options, 'next-step', ''),
  });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printInfo(`Pre-limit checkpoint written for '${report.sessionId}' at ${report.latestPath}`);
  for (const line of report.summaryLines) {
    process.stdout.write(`${line}\n`);
  }
  if (report.activeTasks.length === 0) {
    printWarn('No active Claude tasks were found at pre-limit time.');
  } else {
    printInfo(`Captured ${report.activeTasks.length} active Claude task(s).`);
    for (const task of report.activeTasks) {
      process.stdout.write(`- ${task.taskId} (session ${task.sessionId}, state ${task.state})\n`);
    }
  }

  if (getBooleanOption(options, 'post-to-discord', false)) {
    try {
      const fields = [
        { name: 'sessionId', value: report.sessionId, inline: true },
        { name: 'reason', value: report.reason, inline: true },
        { name: 'activeTaskCount', value: String(report.activeTasks.length), inline: true },
        { name: 'latestPath', value: report.latestPath },
      ];
      if (report.activeTasks.length > 0) {
        fields.push({
          name: 'active_tasks',
          value: report.activeTasks
            .map((task) => `${task.taskId} (session ${task.sessionId}, ${task.state})`)
            .join('\n'),
        });
      }
      const summary = `Pre-limit checkpoint written for '${report.sessionId}' capturing ${report.activeTasks.length} active Claude task(s).`;
      const post = await postToolReport(config, 'session_pre_limit_checkpoint', 'pre_limit', summary, fields, { explicit: true });
      if (post.posted) {
        printInfo(`Posted pre-limit checkpoint to Discord channel ${post.channelKey}.`);
      } else {
        printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
      }
    } catch (error) {
      printError(`Could not post pre-limit checkpoint to Discord: ${error.message || error}`);
    }
  }
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
