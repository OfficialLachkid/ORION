#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { executeClaudeTask } from '../services/claude-runner/src/runner.mjs';
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

const STUB_STDOUT = [
  'STATUS: completed',
  'SUMMARY: canary claude runner smoke test succeeded.',
  'DETAILS:',
  '- payload persistence works',
  '- prompt file was written',
  '- checkpoint state advanced from running to completed',
  'FILES:',
  '- data/runtime/tmp/claude-runner/<task-id>/payload.json',
  'NEXT_STEP:',
  '- Retry with --live to exercise the real claude CLI on the Mac.',
].join('\n');

function stubbedRunner() {
  return async () => ({
    code: 0,
    stdout: STUB_STDOUT,
    stderr: '',
  });
}

export function buildCanaryTask(options = {}) {
  const taskId = options.taskId || `CANARY-${new Date().toISOString().replace(/[^0-9]/gu, '')}`;
  return {
    task_id: taskId,
    summary: options.summary || 'Claude runner canary smoke test.',
    full_text: options.fullText || 'Report STATUS, SUMMARY, DETAILS, FILES, and NEXT_STEP for the canary probe.',
    domain: options.domain || 'infra',
    priority: options.priority || 'low',
    target_agent: options.targetAgent || 'orchestrator',
    source_type: 'canary_synthetic',
    source_channel: options.sourceChannel || 'systemLogs',
    message_id: '',
    submitted_at: new Date().toISOString(),
    submitted_by: 'canary',
    approval_required: false,
    approval_state: 'not_required',
    approval_reason: '',
    approved_by: '',
    approved_by_id: '',
    image_attachments: [],
  };
}

export async function runClaudeRunnerCanary(config, options = {}) {
  const task = buildCanaryTask(options);
  const commandRunner = options.live
    ? undefined
    : stubbedRunner();
  const result = await executeClaudeTask(task, config, {
    sessionId: options.sessionId || randomUUID(),
    commandRunner,
  });

  const paths = result?.report || {};
  const artifacts = {
    payloadExists: paths.taskPayloadPath ? existsSync(paths.taskPayloadPath) : false,
    promptExists: paths.promptPath ? existsSync(paths.promptPath) : false,
    resultExists: paths.resultPath ? existsSync(paths.resultPath) : false,
  };

  let resultFile = null;
  if (artifacts.resultExists) {
    try {
      resultFile = JSON.parse(readFileSync(paths.resultPath, 'utf8'));
    } catch {
      resultFile = null;
    }
  }

  const state = paths.state || 'unknown';
  const verdict = state === 'completed' && artifacts.payloadExists && artifacts.promptExists && artifacts.resultExists
    ? 'ok'
    : 'degraded';

  return {
    verdict,
    live: Boolean(options.live),
    state,
    summary: paths.summary || '',
    task,
    checkpointRoot: paths.checkpointRoot || '',
    artifacts,
    resultFile,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/claude-runner-canary.mjs [options]',
      '',
      'Options:',
      '  --live                  Actually invoke the local claude CLI (default: stubbed).',
      '  --task-id <id>          Optional explicit task id.',
      '  --summary <text>        Optional summary override.',
      '  --full-text <text>      Optional full request override.',
      '  --json                  Print the report as JSON.',
      '  --post-to-discord       Post the canary report to the agent-results Discord channel.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const report = await runClaudeRunnerCanary(config, {
    live: getBooleanOption(options, 'live', false),
    taskId: getStringOption(options, 'task-id', ''),
    summary: getStringOption(options, 'summary', ''),
    fullText: getStringOption(options, 'full-text', ''),
  });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printInfo(`Canary verdict: ${report.verdict} (state=${report.state}, live=${report.live})`);
    if (report.summary) {
      printInfo(`Summary: ${report.summary}`);
    }
    printInfo(`Artifacts: payload=${report.artifacts.payloadExists} prompt=${report.artifacts.promptExists} result=${report.artifacts.resultExists}`);
  }

  try {
    recordOpsMetric(config, 'claude_runner_canary_run', {
      verdict: report.verdict,
      state: report.state,
      live: report.live,
      taskId: report.task.task_id,
    });
  } catch (error) {
    printError(`Could not record ops metric: ${error.message}`);
  }

  if (getBooleanOption(options, 'post-to-discord', false)) {
    try {
      const fields = [
        { name: 'mode', value: report.live ? 'live' : 'stubbed', inline: true },
        { name: 'state', value: report.state || 'unknown', inline: true },
        { name: 'taskId', value: report.task?.task_id || '', inline: true },
        { name: 'payload', value: String(report.artifacts.payloadExists), inline: true },
        { name: 'prompt', value: String(report.artifacts.promptExists), inline: true },
        { name: 'result', value: String(report.artifacts.resultExists), inline: true },
      ];
      const post = await postToolReport(
        config,
        'claude_runner_canary',
        report.verdict,
        report.summary || `Claude runner canary ${report.verdict}.`,
        fields,
        { explicit: true }
      );
      if (post.posted) {
        printInfo(`Posted canary report to Discord channel ${post.channelKey}.`);
      } else {
        printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
      }
    } catch (error) {
      printError(`Could not post canary report to Discord: ${error.message || error}`);
    }
  }

  if (report.verdict !== 'ok') {
    process.exitCode = 1;
  }
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
