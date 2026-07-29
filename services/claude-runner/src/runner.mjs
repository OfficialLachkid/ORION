import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { formatCheckpointSummary, writeCheckpointFile } from '../../../scripts/lib/session-checkpoint-utils.mjs';
import {
  readClaudeTaskPayload,
  writeClaudeTaskArtifact,
  writeClaudeTaskPayload,
} from './payload-store.mjs';
import { buildClaudeTaskPrompt } from './prompt-builder.mjs';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function truncateText(value, maxLength = 280) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildCheckpointBasePath(config, payload) {
  const absolutePath = payload?.contextRefs?.sessionCheckpointPath || config?.env?.CLAUDE_CHECKPOINTS_PATH || config?.env?.SESSION_CHECKPOINTS_PATH;
  if (!absolutePath) {
    return 'data/session-checkpoints';
  }

  const normalizedProjectRoot = projectRoot.replace(/\\/gu, '/').toLowerCase();
  const normalizedAbsolute = String(absolutePath).replace(/\\/gu, '/');
  if (normalizedAbsolute.toLowerCase().startsWith(normalizedProjectRoot)) {
    return normalizedAbsolute.slice(normalizedProjectRoot.length).replace(/^\/+/u, '') || 'data/session-checkpoints';
  }

  return absolutePath;
}

function buildCheckpointRecord(payload, status, summary, nextStep, files = [], blockers = []) {
  return {
    sessionId: payload.sessionId,
    taskId: payload.taskId,
    status,
    summary,
    nextStep,
    blockers,
    files,
    namespace: 'results',
    memoryKey: `checkpoint-${payload.sessionId}-latest`,
    updatedAtUtc: new Date().toISOString(),
  };
}

function recordCheckpoint(config, payload, status, summary, nextStep, files = [], blockers = []) {
  const checkpoint = buildCheckpointRecord(payload, status, summary, nextStep, files, blockers);
  const { latestPath, historyPath, payload: savedPayload } = writeCheckpointFile(
    checkpoint,
    { basePath: buildCheckpointBasePath(config, payload) }
  );

  return {
    latestPath,
    historyPath,
    summaryLines: formatCheckpointSummary(savedPayload),
  };
}

function buildCommandArgs(config, payload, prompt) {
  const args = ['-p', '--output-format', 'text', '--session-id', payload.sessionId];

  if (config?.claude?.model) {
    args.push('--model', config.claude.model);
  }

  if (config?.claude?.fallbackModel) {
    args.push('--fallback-model', config.claude.fallbackModel);
  }

  if (config?.claude?.permissionMode) {
    args.push('--permission-mode', config.claude.permissionMode);
  }

  if (config?.claude?.allowedTools?.length) {
    args.push('--allowedTools', config.claude.allowedTools.join(','));
  }

  if (config?.claude?.appendSystemPrompt) {
    args.push('--append-system-prompt', config.claude.appendSystemPrompt);
  }

  args.push(prompt);
  return args;
}

function buildRunnerEnv(config) {
  return {
    ...process.env,
    ...config?.env,
  };
}

function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start command '${command}': ${error.message}`));
    });

    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function parseStructuredList(lines, label) {
  const startIndex = lines.findIndex((line) => line === `${label}:`);
  if (startIndex === -1) {
    return [];
  }

  const items = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^[A-Z_]+:\s*/u.test(line)) {
      break;
    }

    if (/^- /u.test(line)) {
      items.push(line.replace(/^- /u, '').trim());
      continue;
    }

    if (line && items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1]} ${line}`.trim();
    }
  }

  return items;
}

export function parseClaudeStructuredResponse(output) {
  const text = String(output || '').replace(/\r\n/gu, '\n').trim();
  const lines = text.split('\n').map((line) => line.trim());

  const statusMatch = lines.find((line) => /^STATUS:/iu.test(line));
  const summaryMatch = lines.find((line) => /^SUMMARY:/iu.test(line));

  const rawStatus = statusMatch ? statusMatch.replace(/^STATUS:\s*/iu, '').trim().toLowerCase() : '';
  const summary = summaryMatch ? summaryMatch.replace(/^SUMMARY:\s*/iu, '').trim() : '';

  let status = rawStatus;
  if (!['completed', 'blocked', 'paused'].includes(status)) {
    status = summary ? 'completed' : 'blocked';
  }

  return {
    status,
    summary,
    details: parseStructuredList(lines, 'DETAILS'),
    files: parseStructuredList(lines, 'FILES'),
    nextSteps: parseStructuredList(lines, 'NEXT_STEP'),
    rawText: text,
  };
}

function isUsageLimitBlock(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return [
    'usage limit',
    'rate limit',
    'too many requests',
    'quota',
    'credit balance',
    'try again later',
  ].some((pattern) => normalized.includes(pattern));
}

function classifyClaudeRunnerBlock(text) {
  const normalized = normalizeWhitespace(text).toLowerCase();
  const compactReason = truncateText(text, 240);

  if (
    normalized.includes('not logged in')
    || normalized.includes('please run /login')
    || normalized.includes('please run /login')
  ) {
    return {
      summary: 'Claude CLI is installed but not logged in for the Agent runtime user.',
      nextSteps: ['Run `claude auth login --claudeai` in the Agent session on the Mac, then retry the task.'],
      reason: compactReason,
      recoveryCommand: 'claude auth login --claudeai',
    };
  }

  if (normalized.includes('permission denied') || normalized.includes('operation not permitted')) {
    return {
      summary: 'Claude runner is blocked by local filesystem or macOS permissions.',
      nextSteps: ['Grant the required permission or adjust the working path, then retry the task.'],
      reason: compactReason,
      recoveryCommand: 'claude --version',
    };
  }

  return null;
}

function buildBlockedReport(payload, paths, summary, nextSteps = [], reason = '', recoveryCommand = '') {
  return {
    report: {
      state: 'blocked',
      severity: 'blocked',
      blocked: true,
      summary,
      details: reason ? [reason] : [],
      files: [],
      nextSteps,
      recoveryCommand,
      claudeSessionId: payload.sessionId,
      taskPayloadPath: paths.payloadPath,
      promptPath: paths.promptPath,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      resultPath: paths.resultPath,
      bridgeExportPath: payload.contextRefs.bridgeExportPath,
      supabaseCachePath: payload.contextRefs.supabaseMemoryCachePath,
      checkpointRoot: payload.contextRefs.sessionCheckpointPath,
      attachmentCount: payload.task.attachments.length,
      targetAgent: payload.task.targetAgent,
    },
  };
}

function buildCompletedReport(payload, paths, parsed, stdout, stderr) {
  const normalizedSummary = parsed.summary || truncateText(stdout, 220) || 'Claude completed the task.';
  const status = parsed.status === 'paused' ? 'paused' : parsed.status === 'blocked' ? 'blocked' : 'completed';
  const isBlocked = status !== 'completed';

  return {
    report: {
      state: status,
      severity: isBlocked ? 'blocked' : 'healthy',
      blocked: isBlocked,
      summary: normalizedSummary,
      details: parsed.details,
      files: parsed.files,
      nextSteps: parsed.nextSteps,
      rawResponseExcerpt: truncateText(stdout, 800),
      stderrExcerpt: truncateText(stderr, 300),
      claudeSessionId: payload.sessionId,
      taskPayloadPath: paths.payloadPath,
      promptPath: paths.promptPath,
      stdoutPath: paths.stdoutPath,
      stderrPath: paths.stderrPath,
      resultPath: paths.resultPath,
      bridgeExportPath: payload.contextRefs.bridgeExportPath,
      supabaseCachePath: payload.contextRefs.supabaseMemoryCachePath,
      checkpointRoot: payload.contextRefs.sessionCheckpointPath,
      attachmentCount: payload.task.attachments.length,
      targetAgent: payload.task.targetAgent,
    },
  };
}

export async function executeClaudeTask(task, config, options = {}) {
  const { payload, paths } = writeClaudeTaskPayload(task, config, options);
  const prompt = buildClaudeTaskPrompt(payload);
  writeClaudeTaskArtifact(paths.promptPath, prompt);

  recordCheckpoint(
    config,
    payload,
    'running',
    payload.task.summary || payload.task.request,
    'Wait for the Claude runner result.',
    []
  );

  const enabled = parseBoolean(config?.claude?.enabled, true);
  if (!enabled) {
    const blocked = buildBlockedReport(
      payload,
      paths,
      'Claude runner is disabled in runtime config.',
      ['Enable the Claude runner and re-run the task.'],
      'Set CLAUDE_RUNNER_ENABLED=true on the Mac runtime.',
      'export CLAUDE_RUNNER_ENABLED=true'
    );
    writeClaudeTaskArtifact(paths.resultPath, blocked, 'json');
    recordCheckpoint(config, payload, 'blocked', blocked.report.summary, blocked.report.nextSteps[0] || '', [], blocked.report.details);
    return blocked;
  }

  const command = config?.claude?.command || 'claude';
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const workingDirectory = config?.claude?.workingDirectory || projectRoot;
  const commandArgs = buildCommandArgs(config, payload, prompt);

  if (!existsSync(workingDirectory)) {
    const blocked = buildBlockedReport(
      payload,
      paths,
      'Claude working directory is missing.',
      ['Fix CLAUDE_WORKING_DIRECTORY and retry the task.'],
      `Missing working directory: ${workingDirectory}`,
      `mkdir -p "${workingDirectory}"`
    );
    writeClaudeTaskArtifact(paths.resultPath, blocked, 'json');
    recordCheckpoint(config, payload, 'blocked', blocked.report.summary, blocked.report.nextSteps[0] || '', [], blocked.report.details);
    return blocked;
  }

  try {
    const result = await commandRunner(command, commandArgs, {
      cwd: workingDirectory,
      env: buildRunnerEnv(config),
    });

    writeClaudeTaskArtifact(paths.stdoutPath, result.stdout || '');
    writeClaudeTaskArtifact(paths.stderrPath, result.stderr || '');

    const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');
    if ((result.code ?? 0) !== 0 && isUsageLimitBlock(combinedOutput)) {
      const paused = {
        report: {
          ...buildBlockedReport(
            payload,
            paths,
            'Claude hit a usage limit before finishing the task.',
            ['Resume the same task session after limits renew.'],
            truncateText(combinedOutput, 240),
            `claude -p --resume "${payload.sessionId}" "Continue the pending O.R.I.O.N. task."`
          ).report,
          state: 'paused',
          severity: 'warning',
          blocked: false,
          paused: true,
        },
      };
      writeClaudeTaskArtifact(paths.resultPath, paused, 'json');
      recordCheckpoint(config, payload, 'paused', paused.report.summary, paused.report.nextSteps[0] || '', [], paused.report.details);
      return paused;
    }

    if ((result.code ?? 0) !== 0) {
      const classifiedBlock = classifyClaudeRunnerBlock(combinedOutput);
      if (classifiedBlock) {
        const blocked = buildBlockedReport(
          payload,
          paths,
          classifiedBlock.summary,
          classifiedBlock.nextSteps,
          classifiedBlock.reason,
          classifiedBlock.recoveryCommand
        );
        writeClaudeTaskArtifact(paths.resultPath, blocked, 'json');
        recordCheckpoint(config, payload, 'blocked', blocked.report.summary, blocked.report.nextSteps[0] || '', [], blocked.report.details);
        return blocked;
      }

      throw new Error(combinedOutput || `Claude exited with code ${result.code ?? 1}.`);
    }

    const parsed = parseClaudeStructuredResponse(result.stdout || '');
    const completed = buildCompletedReport(payload, paths, parsed, result.stdout || '', result.stderr || '');
    writeClaudeTaskArtifact(paths.resultPath, completed, 'json');
    recordCheckpoint(
      config,
      payload,
      completed.report.state,
      completed.report.summary,
      completed.report.nextSteps[0] || '',
      completed.report.files,
      completed.report.state === 'completed' ? [] : completed.report.details
    );
    return completed;
  } catch (error) {
    writeClaudeTaskArtifact(paths.stderrPath, error.message || '');
    const classifiedBlock = classifyClaudeRunnerBlock(error.message || '');
    if (classifiedBlock) {
      const blocked = buildBlockedReport(
        payload,
        paths,
        classifiedBlock.summary,
        classifiedBlock.nextSteps,
        classifiedBlock.reason,
        classifiedBlock.recoveryCommand
      );
      writeClaudeTaskArtifact(paths.resultPath, blocked, 'json');
      recordCheckpoint(config, payload, 'blocked', blocked.report.summary, blocked.report.nextSteps[0] || '', [], blocked.report.details);
      return blocked;
    }

    const blocked = buildBlockedReport(
      payload,
      paths,
      'Claude runner could not start or complete this task.',
      ['Verify the Claude CLI is installed and callable by the Agent runtime user, then retry the task.'],
      error.message || 'Unknown Claude runner error.',
      'claude --version'
    );
    writeClaudeTaskArtifact(paths.resultPath, blocked, 'json');
    recordCheckpoint(config, payload, 'blocked', blocked.report.summary, blocked.report.nextSteps[0] || '', [], blocked.report.details);
    return blocked;
  }
}

export async function executeClaudeTaskFromPayloadFile(taskFilePath, config, options = {}) {
  const payload = readClaudeTaskPayload(taskFilePath);
  const syntheticTask = {
    task_id: payload.taskId,
    summary: payload.task.summary,
    full_text: payload.task.request,
    domain: payload.task.domain,
    priority: payload.task.priority,
    target_agent: payload.task.targetAgent,
    source_type: payload.task.sourceType,
    source_channel: payload.task.sourceChannel,
    submitted_at: payload.task.submittedAtUtc,
    submitted_by: payload.task.submittedBy,
    approval_required: payload.task.approval.required,
    approval_reason: payload.task.approval.reason,
    approval_state: payload.task.approval.state,
    approved_by: payload.task.approval.approvedBy,
    approved_by_id: payload.task.approval.approvedById,
    image_attachments: payload.task.attachments,
  };

  return executeClaudeTask(syntheticTask, config, options);
}

export function resolveClaudeRunnerConfig(config) {
  return {
    enabled: parseBoolean(config?.env?.CLAUDE_RUNNER_ENABLED, true),
    command: config?.env?.CLAUDE_COMMAND || 'claude',
    model: config?.env?.CLAUDE_MODEL || '',
    fallbackModel: config?.env?.CLAUDE_FALLBACK_MODEL || '',
    permissionMode: config?.env?.CLAUDE_PERMISSION_MODE || 'acceptEdits',
    allowedTools: splitCsv(config?.env?.CLAUDE_ALLOWED_TOOLS || ''),
    appendSystemPrompt: config?.env?.CLAUDE_APPEND_SYSTEM_PROMPT || '',
    workingDirectory: config?.claude?.workingDirectory || projectRoot,
  };
}
