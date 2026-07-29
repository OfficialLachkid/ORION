import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  buildExecutionPlan,
  executeHealthAction,
  executeTask,
  findOpsToolMatcher,
} from '../src/executor.mjs';

test('findOpsToolMatcher recognizes the seven /ops phrases', () => {
  const phrases = {
    'run claude runner doctor': 'claude_runner_doctor',
    'run claude runner canary': 'claude_runner_canary',
    'run claude runner resume': 'claude_runner_resume',
    'run session pre-limit checkpoint': 'session_pre_limit_checkpoint',
    'run mac reboot recovery check': 'mac_reboot_recovery_check',
    'verify memory promotion rules': 'verify_memory_promotion_rules',
    'restart the discord bot': 'restart_discord_bot',
  };
  for (const [phrase, tool] of Object.entries(phrases)) {
    const matcher = findOpsToolMatcher({ full_text: phrase, summary: phrase });
    assert.ok(matcher, `no matcher for phrase "${phrase}"`);
    assert.equal(matcher.tool, tool);
  }
});

test('buildExecutionPlan routes ops phrases to ops_tool_run', () => {
  const plan = buildExecutionPlan({ full_text: 'run claude runner doctor', summary: 'run claude runner doctor' });
  assert.equal(plan.action, 'ops_tool_run');
  assert.equal(plan.opsTool, 'claude_runner_doctor');
  assert.match(plan.opsToolScriptPath, /scripts\/claude-runner-doctor\.mjs$/u);
  assert.deepEqual(plan.opsToolArgs, ['--json']);
});

test('executeHealthAction surfaces a parsed JSON report and channel key', async () => {
  const config = loadRuntimeConfig();
  const stubbedRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({ state: 'ready', checks: [{ name: 'x', state: 'ready', detail: 'ok' }] }),
    stderr: '',
  });
  const outcome = await executeHealthAction('ops_tool_run', config, {
    commandRunner: stubbedRunner,
    executionPlan: {
      opsTool: 'claude_runner_doctor',
      opsToolScriptPath: 'scripts/claude-runner-doctor.mjs',
      opsToolArgs: ['--json'],
      opsToolChannelKey: 'agentResults',
    },
  });
  assert.equal(outcome.outcome, 'completed');
  assert.equal(outcome.executionResult.report.state, 'ready');
  assert.equal(outcome.executionResult.report.channelKey, 'agentResults');
  assert.equal(outcome.executionResult.report.opsTool, 'claude_runner_doctor');
});

test('executeHealthAction reports blocked when the ops tool returns invalid JSON', async () => {
  const config = loadRuntimeConfig();
  const stubbedRunner = async () => ({ code: 0, stdout: 'not-json', stderr: '' });
  const outcome = await executeHealthAction('ops_tool_run', config, {
    commandRunner: stubbedRunner,
    executionPlan: {
      opsTool: 'claude_runner_doctor',
      opsToolScriptPath: 'scripts/claude-runner-doctor.mjs',
      opsToolArgs: ['--json'],
    },
  });
  assert.equal(outcome.outcome, 'completed');
  assert.equal(outcome.executionResult.report.state, 'blocked');
  assert.equal(outcome.executionResult.report.blocked, true);
});

test('executeTask emits completed events on the tool-specific channel', async () => {
  const config = loadRuntimeConfig();
  const stubbedRunner = async () => ({
    code: 0,
    stdout: JSON.stringify({
      state: 'ok',
      audit: {
        namespaces: ['patterns', 'learnings', 'results', 'decisions', 'approvals', 'products', 'infra'],
        findings: [],
        errorCount: 0,
        warnCount: 0,
      },
    }),
    stderr: '',
  });
  const outbound = await executeTask({
    task_id: 'TASK-OPS-1',
    summary: 'verify memory promotion rules',
    full_text: 'verify memory promotion rules',
    domain: 'infra',
    priority: 'normal',
    target_agent: 'orchestrator',
  }, config, { commandRunner: stubbedRunner });
  assert.equal(outbound.outcome, 'completed');
  assert.ok(outbound.outboundEvents.some((event) => event.channelKey === 'memoryUpdates' && event.type === 'task_execution_result'));
});
