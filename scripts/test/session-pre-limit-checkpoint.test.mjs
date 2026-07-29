import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildPreLimitCheckpoint,
  collectActiveClaudeTasks,
} from '../session-pre-limit-checkpoint.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('buildPreLimitCheckpoint produces pre_limit status with active-task blockers', () => {
  const checkpoint = buildPreLimitCheckpoint(
    'session-123',
    'Approaching provider rate limit.',
    [
      { taskId: 'TASK-A', state: 'running', payloadPath: '/tmp/a.json' },
      { taskId: 'TASK-B', state: 'paused', payloadPath: '/tmp/b.json' },
    ],
    { taskId: 'TASK-A' }
  );
  assert.equal(checkpoint.status, 'pre_limit');
  assert.equal(checkpoint.sessionId, 'session-123');
  assert.equal(checkpoint.taskId, 'TASK-A');
  assert.deepEqual(checkpoint.files, ['/tmp/a.json', '/tmp/b.json']);
  assert.deepEqual(checkpoint.blockers, ['TASK-A (running)', 'TASK-B (paused)']);
  assert.equal(checkpoint.memoryKey, 'checkpoint-session-123-latest');
  assert.match(checkpoint.summary, /Approaching provider/u);
});

test('buildPreLimitCheckpoint gives explicit blocker text when no active tasks', () => {
  const checkpoint = buildPreLimitCheckpoint('session-none', '', []);
  assert.deepEqual(checkpoint.blockers, ['No active Claude tasks at pre-limit time.']);
  assert.equal(checkpoint.files.length, 0);
});

test('collectActiveClaudeTasks skips completed and blocked tasks', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-prelimit-'));
  const claudeTasksRoot = join(tmpRoot, 'claude-runner');
  mkdirSync(join(claudeTasksRoot, 'TASK-COMPLETED'), { recursive: true });
  mkdirSync(join(claudeTasksRoot, 'TASK-BLOCKED'), { recursive: true });
  mkdirSync(join(claudeTasksRoot, 'TASK-RUNNING'), { recursive: true });
  mkdirSync(join(claudeTasksRoot, 'TASK-NO-PAYLOAD'), { recursive: true });

  writeJson(join(claudeTasksRoot, 'TASK-COMPLETED', 'payload.json'), {
    taskId: 'TASK-COMPLETED',
    sessionId: 'session-completed',
    task: { summary: 'Completed task' },
  });
  writeJson(join(claudeTasksRoot, 'TASK-COMPLETED', 'result.json'), {
    report: { state: 'completed' },
  });

  writeJson(join(claudeTasksRoot, 'TASK-BLOCKED', 'payload.json'), {
    taskId: 'TASK-BLOCKED',
    sessionId: 'session-blocked',
    task: { summary: 'Blocked task' },
  });
  writeJson(join(claudeTasksRoot, 'TASK-BLOCKED', 'result.json'), {
    report: { state: 'blocked' },
  });

  writeJson(join(claudeTasksRoot, 'TASK-RUNNING', 'payload.json'), {
    taskId: 'TASK-RUNNING',
    sessionId: 'session-running',
    task: { summary: 'Running task' },
  });

  const active = collectActiveClaudeTasks(claudeTasksRoot);
  assert.equal(active.length, 1);
  assert.equal(active[0].taskId, 'TASK-RUNNING');
  assert.equal(active[0].sessionId, 'session-running');
});
