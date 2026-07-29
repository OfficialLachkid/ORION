import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildResumeCommand,
  classifyCheckpointForRecovery,
  scanClaudeRunnerRecovery,
} from '../lib/claude-runner-recovery.mjs';

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('classifyCheckpointForRecovery routes paused to resume_candidate', () => {
  const result = classifyCheckpointForRecovery(
    { status: 'paused', updatedAtUtc: '2026-07-10T00:00:00.000Z' },
    { now: new Date('2026-07-10T01:00:00.000Z') }
  );
  assert.equal(result.classification, 'resume_candidate');
});

test('classifyCheckpointForRecovery routes pre_limit to resume_candidate', () => {
  const result = classifyCheckpointForRecovery(
    { status: 'pre_limit', updatedAtUtc: '2026-07-10T00:00:00.000Z' },
    { now: new Date('2026-07-10T00:30:00.000Z') }
  );
  assert.equal(result.classification, 'resume_candidate');
});

test('classifyCheckpointForRecovery routes stale running to stalled_running', () => {
  const result = classifyCheckpointForRecovery(
    { status: 'running', updatedAtUtc: '2026-07-10T00:00:00.000Z' },
    { now: new Date('2026-07-10T02:00:00.000Z'), staleRunningMs: 60 * 60 * 1000 }
  );
  assert.equal(result.classification, 'stalled_running');
});

test('classifyCheckpointForRecovery keeps recent running as running_recent', () => {
  const result = classifyCheckpointForRecovery(
    { status: 'running', updatedAtUtc: '2026-07-10T00:00:00.000Z' },
    { now: new Date('2026-07-10T00:05:00.000Z'), staleRunningMs: 60 * 60 * 1000 }
  );
  assert.equal(result.classification, 'running_recent');
});

test('scanClaudeRunnerRecovery buckets checkpoints correctly', () => {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-recovery-'));
  const checkpointRoot = join(tmpRoot, 'data', 'session-checkpoints');
  const claudeTasksRoot = join(tmpRoot, 'data', 'runtime', 'tmp', 'claude-runner');
  mkdirSync(join(checkpointRoot, 'paused-session'), { recursive: true });
  mkdirSync(join(checkpointRoot, 'stalled-session'), { recursive: true });
  mkdirSync(join(checkpointRoot, 'completed-session'), { recursive: true });
  writeJson(join(checkpointRoot, 'paused-session', 'latest.json'), {
    sessionId: 'paused-session',
    status: 'paused',
    taskId: 'TASK-1',
    updatedAtUtc: '2026-07-10T00:00:00.000Z',
  });
  writeJson(join(checkpointRoot, 'stalled-session', 'latest.json'), {
    sessionId: 'stalled-session',
    status: 'running',
    taskId: 'TASK-2',
    updatedAtUtc: '2026-07-09T00:00:00.000Z',
  });
  writeJson(join(checkpointRoot, 'completed-session', 'latest.json'), {
    sessionId: 'completed-session',
    status: 'completed',
    taskId: 'TASK-3',
    updatedAtUtc: '2026-07-10T00:00:00.000Z',
  });
  mkdirSync(join(claudeTasksRoot, 'TASK-1'), { recursive: true });
  writeJson(join(claudeTasksRoot, 'TASK-1', 'payload.json'), {
    taskId: 'TASK-1',
    sessionId: 'paused-session',
  });

  const config = {
    env: { SESSION_CHECKPOINTS_PATH: checkpointRoot, CLAUDE_TASKS_PATH: claudeTasksRoot },
    runtimePaths: { tmpDir: join(tmpRoot, 'data', 'runtime', 'tmp') },
  };
  const scan = scanClaudeRunnerRecovery(config, {
    now: new Date('2026-07-10T02:00:00.000Z'),
    staleRunningMs: 60 * 60 * 1000,
  });
  assert.equal(scan.resumeCandidates.length, 1);
  assert.equal(scan.resumeCandidates[0].sessionId, 'paused-session');
  assert.ok(scan.resumeCandidates[0].taskPayloadPath.endsWith('payload.json'));
  assert.equal(scan.stalledRunning.length, 1);
  assert.equal(scan.stalledRunning[0].sessionId, 'stalled-session');
  assert.equal(scan.completed.length, 1);
});

test('buildResumeCommand prefers npm task-file form when payload path is present', () => {
  const command = buildResumeCommand({
    taskPayloadPath: '/tmp/payload.json',
    checkpoint: { sessionId: 'abc' },
  });
  assert.match(command, /npm run claude:run-task/u);
  assert.match(command, /payload\.json/u);
});

test('buildResumeCommand falls back to claude resume when payload missing', () => {
  const command = buildResumeCommand({
    checkpoint: { sessionId: '11111111-1111-4111-8111-111111111111' },
  });
  assert.match(command, /claude -p --resume/u);
});
