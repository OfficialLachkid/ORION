import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCanaryTask, runClaudeRunnerCanary } from '../claude-runner-canary.mjs';

function buildConfig() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-canary-'));
  return {
    env: {
      CLAUDE_TASKS_PATH: join(tmpRoot, 'tasks'),
      SESSION_CHECKPOINTS_PATH: join(tmpRoot, 'checkpoints'),
      VAULT_BRIDGE_EXPORT_PATH: join(tmpRoot, 'bridge'),
      CLAUDE_SUPABASE_CACHE_PATH: join(tmpRoot, 'supabase'),
      RUNTIME_LOG_DIR: join(tmpRoot, 'logs'),
    },
    runtimePaths: {
      tmpDir: join(tmpRoot, 'tmp'),
      logDir: join(tmpRoot, 'logs'),
      metricsEventsFile: join(tmpRoot, 'logs', 'ops-events.jsonl'),
    },
    claude: {
      enabled: true,
      command: 'claude',
      permissionMode: 'acceptEdits',
      workingDirectory: tmpRoot,
    },
    memoryNamespaces: {},
    memoryPromotionRules: {},
  };
}

test('buildCanaryTask produces a synthetic non-approval task', () => {
  const task = buildCanaryTask({ taskId: 'CANARY-1', summary: 'smoke', fullText: 'smoke text' });
  assert.equal(task.task_id, 'CANARY-1');
  assert.equal(task.summary, 'smoke');
  assert.equal(task.approval_required, false);
  assert.equal(task.source_type, 'canary_synthetic');
});

test('runClaudeRunnerCanary in stub mode drives runner to completed', async () => {
  const config = buildConfig();
  const report = await runClaudeRunnerCanary(config, { live: false, taskId: 'CANARY-STUB' });
  assert.equal(report.verdict, 'ok');
  assert.equal(report.state, 'completed');
  assert.equal(report.artifacts.payloadExists, true);
  assert.equal(report.artifacts.promptExists, true);
  assert.equal(report.artifacts.resultExists, true);
  assert.match(report.summary, /canary/iu);
});
