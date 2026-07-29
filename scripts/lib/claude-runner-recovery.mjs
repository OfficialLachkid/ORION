import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectRoot } from './ruflo-wrapper-utils.mjs';

const DEFAULT_STALE_RUNNING_MS = 30 * 60 * 1000; // 30 minutes
const PAUSED_STATES = new Set(['paused', 'pre_limit']);
const RESUMABLE_LATEST_STATES = new Set(['paused', 'running', 'pre_limit']);

function safeReadJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export function resolveCheckpointRoot(config) {
  return resolve(config?.env?.SESSION_CHECKPOINTS_PATH || resolve(projectRoot, 'data', 'session-checkpoints'));
}

export function resolveClaudeTasksArtifactRoot(config) {
  const configured = config?.env?.CLAUDE_TASKS_PATH;
  if (configured) {
    return resolve(projectRoot, configured);
  }
  return resolve(config?.runtimePaths?.tmpDir || resolve(projectRoot, 'data', 'runtime', 'tmp'), 'claude-runner');
}

export function listCheckpointSessions(checkpointRoot) {
  if (!existsSync(checkpointRoot)) {
    return [];
  }
  return readdirSync(checkpointRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function readLatestSessionCheckpoint(checkpointRoot, sessionId) {
  const latestPath = join(checkpointRoot, sessionId, 'latest.json');
  if (!existsSync(latestPath)) {
    return null;
  }
  return safeReadJson(latestPath);
}

export function classifyCheckpointForRecovery(checkpoint, options = {}) {
  if (!checkpoint || typeof checkpoint !== 'object') {
    return { classification: 'unknown', reason: 'no_checkpoint_payload' };
  }
  const now = options.now instanceof Date ? options.now.getTime() : Date.now();
  const staleMs = Number.isFinite(options.staleRunningMs) ? options.staleRunningMs : DEFAULT_STALE_RUNNING_MS;
  const status = String(checkpoint.status || '').trim().toLowerCase();
  const updatedAt = checkpoint.updatedAtUtc ? new Date(checkpoint.updatedAtUtc).getTime() : 0;
  const ageMs = updatedAt > 0 ? Math.max(0, now - updatedAt) : Number.POSITIVE_INFINITY;

  if (PAUSED_STATES.has(status)) {
    return { classification: 'resume_candidate', reason: `status=${status}`, ageMs };
  }
  if (status === 'running' && ageMs >= staleMs) {
    return { classification: 'stalled_running', reason: `running_for_${ageMs}ms`, ageMs };
  }
  if (status === 'running') {
    return { classification: 'running_recent', reason: `running_for_${ageMs}ms`, ageMs };
  }
  if (status === 'completed') {
    return { classification: 'completed', reason: 'status=completed', ageMs };
  }
  if (status === 'blocked') {
    return { classification: 'blocked', reason: 'status=blocked', ageMs };
  }
  return { classification: 'other', reason: `status=${status || 'empty'}`, ageMs };
}

export function findLatestClaudeTaskPayload(claudeTasksRoot, sessionId) {
  if (!existsSync(claudeTasksRoot)) {
    return null;
  }
  const taskDirs = readdirSync(claudeTasksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  let bestPath = '';
  let bestMtimeMs = 0;

  for (const taskId of taskDirs) {
    const payloadPath = join(claudeTasksRoot, taskId, 'payload.json');
    if (!existsSync(payloadPath)) {
      continue;
    }
    const payload = safeReadJson(payloadPath);
    if (!payload || payload.sessionId !== sessionId) {
      continue;
    }
    const stats = statSync(payloadPath);
    if (stats.mtimeMs > bestMtimeMs) {
      bestMtimeMs = stats.mtimeMs;
      bestPath = payloadPath;
    }
  }

  return bestPath || null;
}

export function scanClaudeRunnerRecovery(config, options = {}) {
  const checkpointRoot = resolveCheckpointRoot(config);
  const claudeTasksRoot = resolveClaudeTasksArtifactRoot(config);
  const sessionIds = listCheckpointSessions(checkpointRoot);
  const findPayload = options.findLatestPayload || findLatestClaudeTaskPayload;
  const now = options.now instanceof Date ? options.now : new Date();
  const staleRunningMs = Number.isFinite(options.staleRunningMs) ? options.staleRunningMs : DEFAULT_STALE_RUNNING_MS;

  const buckets = {
    resumeCandidates: [],
    stalledRunning: [],
    runningRecent: [],
    completed: [],
    blocked: [],
    other: [],
  };

  for (const sessionId of sessionIds) {
    const checkpoint = readLatestSessionCheckpoint(checkpointRoot, sessionId);
    if (!checkpoint) {
      buckets.other.push({ sessionId, classification: 'no_latest', reason: 'no_latest_json' });
      continue;
    }
    if (!RESUMABLE_LATEST_STATES.has(String(checkpoint.status || '').toLowerCase())
        && String(checkpoint.status || '').toLowerCase() !== 'completed'
        && String(checkpoint.status || '').toLowerCase() !== 'blocked') {
      buckets.other.push({
        sessionId,
        classification: 'other',
        reason: `status=${checkpoint.status || 'empty'}`,
        checkpoint,
      });
      continue;
    }
    const classification = classifyCheckpointForRecovery(checkpoint, { now, staleRunningMs });
    const entry = {
      sessionId,
      classification: classification.classification,
      reason: classification.reason,
      ageMs: classification.ageMs,
      checkpoint,
      taskId: checkpoint.taskId || null,
      taskPayloadPath: '',
    };

    if (classification.classification === 'resume_candidate' || classification.classification === 'stalled_running') {
      entry.taskPayloadPath = findPayload(claudeTasksRoot, sessionId) || '';
    }

    if (classification.classification === 'resume_candidate') {
      buckets.resumeCandidates.push(entry);
    } else if (classification.classification === 'stalled_running') {
      buckets.stalledRunning.push(entry);
    } else if (classification.classification === 'running_recent') {
      buckets.runningRecent.push(entry);
    } else if (classification.classification === 'completed') {
      buckets.completed.push(entry);
    } else if (classification.classification === 'blocked') {
      buckets.blocked.push(entry);
    } else {
      buckets.other.push(entry);
    }
  }

  return {
    checkpointRoot,
    claudeTasksRoot,
    scannedSessionCount: sessionIds.length,
    generatedAtUtc: now.toISOString(),
    ...buckets,
  };
}

export function buildResumeCommand(entry) {
  if (entry?.taskPayloadPath) {
    return `npm run claude:run-task -- --task-file "${entry.taskPayloadPath}"`;
  }
  if (entry?.checkpoint?.sessionId) {
    return `claude -p --resume "${entry.checkpoint.sessionId}" "Continue the pending O.R.I.O.N. task."`;
  }
  return '';
}
