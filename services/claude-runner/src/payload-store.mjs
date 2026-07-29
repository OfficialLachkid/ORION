import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function resolveBridgeExportPath(config) {
  if (config?.env?.CLAUDE_BRIDGE_EXPORT_PATH) {
    return resolve(projectRoot, config.env.CLAUDE_BRIDGE_EXPORT_PATH);
  }

  if (config?.env?.VAULT_BRIDGE_EXPORT_PATH) {
    return resolve(projectRoot, config.env.VAULT_BRIDGE_EXPORT_PATH);
  }

  return resolve(projectRoot, 'data', 'vault-bridge', 'current');
}

function resolveSupabaseCachePath(config) {
  if (config?.env?.CLAUDE_SUPABASE_CACHE_PATH) {
    return resolve(projectRoot, config.env.CLAUDE_SUPABASE_CACHE_PATH);
  }

  return resolve(projectRoot, 'data', 'supabase-memory', 'current');
}

function resolveCheckpointPath(config) {
  if (config?.env?.CLAUDE_CHECKPOINTS_PATH) {
    return resolve(projectRoot, config.env.CLAUDE_CHECKPOINTS_PATH);
  }

  if (config?.env?.SESSION_CHECKPOINTS_PATH) {
    return resolve(projectRoot, config.env.SESSION_CHECKPOINTS_PATH);
  }

  return resolve(projectRoot, 'data', 'session-checkpoints');
}

function normalizeAttachment(attachment = {}) {
  return {
    id: attachment.id || '',
    filename: attachment.filename || '',
    url: attachment.url || '',
    proxyUrl: attachment.proxyUrl || '',
    contentType: attachment.contentType || '',
    size: attachment.size || 0,
  };
}

export function isValidClaudeSessionId(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

export function resolveClaudeSessionId(task = {}, options = {}) {
  const candidates = [
    options.sessionId,
    task.session_id,
    task.resume_session_id,
  ];

  for (const candidate of candidates) {
    if (isValidClaudeSessionId(candidate)) {
      return String(candidate).trim();
    }
  }

  return randomUUID();
}

export function resolveClaudeTasksRoot(config) {
  if (config?.env?.CLAUDE_TASKS_PATH) {
    return resolve(projectRoot, config.env.CLAUDE_TASKS_PATH);
  }

  return resolve(config?.runtimePaths?.tmpDir || resolve(projectRoot, 'data', 'runtime', 'tmp'), 'claude-runner');
}

export function resolveClaudeTaskPaths(taskId, config) {
  const tasksRoot = resolveClaudeTasksRoot(config);
  const taskRoot = resolve(tasksRoot, taskId);

  return {
    tasksRoot,
    taskRoot,
    payloadPath: resolve(taskRoot, 'payload.json'),
    promptPath: resolve(taskRoot, 'prompt.txt'),
    stdoutPath: resolve(taskRoot, 'stdout.txt'),
    stderrPath: resolve(taskRoot, 'stderr.txt'),
    resultPath: resolve(taskRoot, 'result.json'),
  };
}

export function buildClaudeTaskPayload(task, config, options = {}) {
  const sessionId = resolveClaudeSessionId(task, options);

  return {
    schemaVersion: 1,
    taskId: task.task_id,
    sessionId,
    createdAtUtc: new Date().toISOString(),
    task: {
      summary: task.summary || '',
      request: task.full_text || task.summary || '',
      domain: task.domain || '',
      priority: task.priority || '',
      targetAgent: task.target_agent || '',
      status: task.status || '',
      sourceType: task.source_type || '',
      sourceChannel: task.source_channel || '',
      sourceMessageId: task.message_id || '',
      submittedAtUtc: task.submitted_at || '',
      submittedBy: task.submitted_by || '',
      approval: {
        required: task.approval_required === true,
        state: task.approval_state || (task.approval_required ? 'approved' : 'not_required'),
        reason: task.approval_reason || '',
        approvedBy: task.approved_by || '',
        approvedById: task.approved_by_id || '',
      },
      attachments: Array.isArray(task.image_attachments)
        ? task.image_attachments.map((attachment) => normalizeAttachment(attachment))
        : [],
    },
    contextRefs: {
      repoRoot: config?.claude?.workingDirectory || projectRoot,
      bridgeExportPath: resolveBridgeExportPath(config),
      supabaseMemoryCachePath: resolveSupabaseCachePath(config),
      sessionCheckpointPath: resolveCheckpointPath(config),
    },
  };
}

export function writeClaudeTaskPayload(task, config, options = {}) {
  const payload = buildClaudeTaskPayload(task, config, options);
  const paths = resolveClaudeTaskPaths(payload.taskId, config);
  ensureDirectory(paths.taskRoot);
  writeFileSync(paths.payloadPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { payload, paths };
}

export function writeClaudeTaskArtifact(filePath, value, type = 'text') {
  ensureDirectory(dirname(filePath));
  const serialized = type === 'json'
    ? `${JSON.stringify(value, null, 2)}\n`
    : String(value || '');
  writeFileSync(filePath, serialized, 'utf8');
}

export function readClaudeTaskPayload(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}
