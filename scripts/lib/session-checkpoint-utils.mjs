import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRoot } from './ruflo-wrapper-utils.mjs';

function sanitizeSessionId(sessionId) {
  return String(sessionId || 'default').replace(/[^A-Za-z0-9._-]+/g, '-');
}

function buildTimestamp() {
  return new Date().toISOString().replaceAll(':', '-');
}

export function getCheckpointPaths(sessionId, basePath = 'data/session-checkpoints') {
  const safeSessionId = sanitizeSessionId(sessionId);
  const sessionRoot = resolve(projectRoot, basePath, safeSessionId);
  return {
    sessionRoot,
    latestPath: resolve(sessionRoot, 'latest.json'),
    historyPath: resolve(sessionRoot, `${buildTimestamp()}.json`),
  };
}

export function writeCheckpointFile(checkpoint, options = {}) {
  const basePath = options.basePath || 'data/session-checkpoints';
  const paths = getCheckpointPaths(checkpoint.sessionId, basePath);
  const payload = {
    sessionId: checkpoint.sessionId,
    taskId: checkpoint.taskId || null,
    status: checkpoint.status || 'active',
    summary: checkpoint.summary || '',
    nextStep: checkpoint.nextStep || '',
    blockers: checkpoint.blockers || [],
    files: checkpoint.files || [],
    namespace: checkpoint.namespace || null,
    memoryKey: checkpoint.memoryKey || null,
    updatedAtUtc: checkpoint.updatedAtUtc || new Date().toISOString(),
  };

  mkdirSync(paths.sessionRoot, { recursive: true });

  const serialized = `${JSON.stringify(payload, null, 2)}\n`;
  writeFileSync(paths.latestPath, serialized, 'utf8');
  writeFileSync(paths.historyPath, serialized, 'utf8');

  return { ...paths, payload };
}

export function readLatestCheckpoint(sessionId, options = {}) {
  const basePath = options.basePath || 'data/session-checkpoints';
  const { latestPath } = getCheckpointPaths(sessionId, basePath);
  if (!existsSync(latestPath)) {
    return null;
  }

  return JSON.parse(readFileSync(latestPath, 'utf8'));
}

export function formatCheckpointSummary(checkpoint) {
  if (!checkpoint) {
    return [];
  }

  const lines = [
    `sessionId: ${checkpoint.sessionId}`,
    `status: ${checkpoint.status || 'unknown'}`,
    `updatedAtUtc: ${checkpoint.updatedAtUtc || 'unknown'}`,
  ];

  if (checkpoint.taskId) {
    lines.push(`taskId: ${checkpoint.taskId}`);
  }

  if (checkpoint.summary) {
    lines.push(`summary: ${checkpoint.summary}`);
  }

  if (checkpoint.nextStep) {
    lines.push(`nextStep: ${checkpoint.nextStep}`);
  }

  if (Array.isArray(checkpoint.blockers) && checkpoint.blockers.length > 0) {
    lines.push(`blockers: ${checkpoint.blockers.join(' | ')}`);
  }

  if (Array.isArray(checkpoint.files) && checkpoint.files.length > 0) {
    lines.push(`files: ${checkpoint.files.join(', ')}`);
  }

  return lines;
}

export function parseListOption(rawValue) {
  if (!rawValue) {
    return [];
  }

  return String(rawValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function ensureCheckpointDirectory(basePath = 'data/session-checkpoints') {
  const absoluteBasePath = resolve(projectRoot, basePath);
  mkdirSync(dirname(absoluteBasePath), { recursive: true });
  mkdirSync(absoluteBasePath, { recursive: true });
  return absoluteBasePath;
}
