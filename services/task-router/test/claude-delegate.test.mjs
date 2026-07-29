import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { buildExecutionPlan, executeTask } from '../src/executor.mjs';

test('buildExecutionPlan falls back to the Claude runner for non-deterministic work', () => {
  const plan = buildExecutionPlan({
    task_id: 'TASK-CLAUDE-DELEGATE',
    summary: 'Investigate the Discord result formatting and improve it.',
    full_text: 'Investigate the Discord result formatting and improve it.',
    target_agent: 'orchestrator',
  });

  assert.equal(plan.action, 'claude_runtime_delegate');
});

test('executeTask returns completed Claude delegate events', async () => {
  const config = loadRuntimeConfig();
  const result = await executeTask({
    task_id: 'TASK-CLAUDE-COMPLETE',
    summary: 'Investigate the queue issue.',
    full_text: 'Investigate the queue issue and return a summary.',
    domain: 'general',
    priority: 'normal',
    target_agent: 'orchestrator',
  }, config, {
    claudeTaskRunner: async (task) => ({
      report: {
        state: 'completed',
        severity: 'healthy',
        summary: `Claude handled ${task.task_id}.`,
        files: ['services/discord-bot/src/live-runtime.mjs'],
        nextSteps: ['Monitor the next Discord command.'],
        claudeSessionId: task.task_id,
        taskPayloadPath: '/tmp/payload.json',
        promptPath: '/tmp/prompt.txt',
        resultPath: '/tmp/result.json',
        checkpointRoot: '/tmp/checkpoints',
        bridgeExportPath: '/tmp/bridge',
        supabaseCachePath: '/tmp/supabase-cache',
        attachmentCount: 0,
        targetAgent: task.target_agent,
      },
    }),
  });

  assert.equal(result.executionPlan.action, 'claude_runtime_delegate');
  assert.equal(result.outcome, 'completed');
  assert.equal(result.outboundEvents[1].type, 'task_execution_result');
  assert.equal(result.outboundEvents[1].metadata.claudeSessionId, 'TASK-CLAUDE-COMPLETE');
  assert.deepEqual(result.outboundEvents[1].metadata.files, ['services/discord-bot/src/live-runtime.mjs']);
});

test('executeTask surfaces paused Claude delegate runs as paused alert flows', async () => {
  const config = loadRuntimeConfig();
  const result = await executeTask({
    task_id: 'TASK-CLAUDE-PAUSED',
    summary: 'Continue the browser task later.',
    full_text: 'Continue the browser task later.',
    domain: 'general',
    priority: 'normal',
    target_agent: 'orchestrator',
  }, config, {
    claudeTaskRunner: async () => ({
      report: {
        state: 'paused',
        severity: 'warning',
        blocked: false,
        paused: true,
        summary: 'Claude hit a usage limit before finishing the task.',
        files: [],
        nextSteps: ['Resume the same session after limits renew.'],
        claudeSessionId: 'TASK-CLAUDE-PAUSED',
        taskPayloadPath: '/tmp/payload.json',
        promptPath: '/tmp/prompt.txt',
        resultPath: '/tmp/result.json',
        checkpointRoot: '/tmp/checkpoints',
        bridgeExportPath: '/tmp/bridge',
        supabaseCachePath: '/tmp/supabase-cache',
        attachmentCount: 0,
        targetAgent: 'orchestrator',
      },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.outboundEvents[0].metadata.status, 'paused');
  assert.equal(result.outboundEvents.some((event) => event.type === 'task_execution_paused'), true);
});
