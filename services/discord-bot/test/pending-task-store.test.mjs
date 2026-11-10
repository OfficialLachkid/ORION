import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  findPersistedPendingTask,
  loadPersistedPendingTasks,
  removePersistedPendingTask,
  resolvePendingTaskStorePath,
  selectPendingTaskForDecision,
  upsertPersistedPendingTask,
} from '../src/pending-task-store.mjs';

function buildConfig() {
  const runtimeTmpDir = mkdtempSync(join(tmpdir(), 'ruflo-pending-task-store-'));
  return {
    env: {},
    runtimePaths: {
      tmpDir: runtimeTmpDir,
    },
  };
}

test('pending task store persists and removes approval-gated tasks', () => {
  const config = buildConfig();
  const task = {
    task_id: 'TASK-STORE-1',
    summary: 'Sync the Mac runtime with origin/main.',
    approval_required: true,
  };

  const filePath = resolvePendingTaskStorePath(config);
  assert.equal(loadPersistedPendingTasks(config).length, 0);

  upsertPersistedPendingTask(config, task);

  assert.equal(loadPersistedPendingTasks(config).length, 1);
  assert.equal(findPersistedPendingTask(config, 'TASK-STORE-1')?.summary, task.summary);
  assert.match(filePath, /pending-approval-tasks\.json$/u);

  removePersistedPendingTask(config, 'TASK-STORE-1');

  assert.equal(loadPersistedPendingTasks(config).length, 0);
  assert.equal(findPersistedPendingTask(config, 'TASK-STORE-1'), null);
});

test('persisted task wins when an external refresher replaced an in-memory review', () => {
  const inMemoryTask = {
    task_id: 'TASK-STORE-2',
    destinations: ['youtube'],
  };
  const refreshedPersistedTask = {
    task_id: 'TASK-STORE-2',
    destinations: ['youtube', 'facebook'],
  };

  assert.equal(
    selectPendingTaskForDecision(inMemoryTask, refreshedPersistedTask),
    refreshedPersistedTask,
  );
  assert.equal(selectPendingTaskForDecision(inMemoryTask, null), inMemoryTask);
});
