import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function normalizeTaskRecord(task) {
  if (!task || typeof task !== 'object' || !task.task_id) {
    return null;
  }

  return task;
}

function readPendingTasksFile(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((task) => normalizeTaskRecord(task)).filter(Boolean);
  } catch {
    return [];
  }
}

function writePendingTasksFile(filePath, tasks) {
  ensureDirectory(dirname(filePath));
  writeFileSync(filePath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
}

export function resolvePendingTaskStorePath(config) {
  const explicitPath = config?.env?.PENDING_APPROVAL_TASKS_PATH;
  if (explicitPath) {
    return resolve(projectRoot, explicitPath);
  }

  return resolve(config?.runtimePaths?.tmpDir || projectRoot, 'pending-approval-tasks.json');
}

export function loadPersistedPendingTasks(config) {
  return readPendingTasksFile(resolvePendingTaskStorePath(config));
}

export function savePersistedPendingTasks(config, tasks = []) {
  const normalizedTasks = Array.isArray(tasks)
    ? tasks.map((task) => normalizeTaskRecord(task)).filter(Boolean)
    : [];
  writePendingTasksFile(resolvePendingTaskStorePath(config), normalizedTasks);
  return normalizedTasks;
}

export function upsertPersistedPendingTask(config, task) {
  const normalizedTask = normalizeTaskRecord(task);
  if (!normalizedTask) {
    return loadPersistedPendingTasks(config);
  }

  const tasks = loadPersistedPendingTasks(config);
  const nextTasks = tasks.filter((item) => item.task_id !== normalizedTask.task_id);
  nextTasks.push(normalizedTask);
  return savePersistedPendingTasks(config, nextTasks);
}

export function removePersistedPendingTask(config, taskId) {
  const tasks = loadPersistedPendingTasks(config);
  const nextTasks = tasks.filter((item) => item.task_id !== taskId);
  savePersistedPendingTasks(config, nextTasks);
  return nextTasks;
}

export function findPersistedPendingTask(config, taskId) {
  return loadPersistedPendingTasks(config).find((task) => task.task_id === taskId) || null;
}
