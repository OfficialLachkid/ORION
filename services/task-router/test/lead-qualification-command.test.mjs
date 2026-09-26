import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  buildGuildSlashCommands,
  isSupportedSlashCommandInteraction,
  normalizeSupportedSlashCommandInteraction,
} from '../../discord-bot/src/slash-commands.mjs';
import { buildExecutionPlan, executeTask } from '../src/executor.mjs';
import { normalizeTaskMessage } from '../src/router.mjs';

function buildQualificationInteraction(limit) {
  return {
    id: 'interaction-lead-qualification-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'commands-1',
    data: {
      name: 'lead-qualification',
      options: [{ name: 'limit', value: limit }],
    },
    member: {
      nick: 'Valen',
      roles: ['operator-role'],
      user: { id: 'operator-1', username: 'vbjservices' },
    },
  };
}

test('lead qualification slash command requires a bounded lead limit', () => {
  const command = buildGuildSlashCommands()
    .find((candidate) => candidate.name === 'lead-qualification');

  assert.equal(command?.description, 'Run the existing lead qualification workflow now.');
  assert.deepEqual(command?.options, [{
    type: 4,
    name: 'limit',
    description: 'Maximum new leads to qualify in this session (1-100).',
    required: true,
    min_value: 1,
    max_value: 100,
  }]);
});

test('lead qualification slash command routes to an explicit qualification task', () => {
  const interaction = buildQualificationInteraction(12);

  assert.equal(isSupportedSlashCommandInteraction(interaction), true);
  const message = normalizeSupportedSlashCommandInteraction(interaction);
  assert.equal(message?.content, 'run lead qualification limit: 12');

  const { task } = normalizeTaskMessage({
    ...message,
    submittedAt: '2026-09-25T08:00:00.000Z',
  }, loadRuntimeConfig());

  assert.equal(task.runtime_action, 'lead_qualification');
  assert.equal(task.approval_required, false);
  assert.equal(task.status, 'queued');
  assert.equal(task.summary, 'Run lead qualification: up to 12 new lead(s)');
  assert.deepEqual(task.leadgen_request, {
    mode: 'qualification',
    limit: 12,
  });
  assert.deepEqual(buildExecutionPlan(task), {
    action: 'lead_qualification',
    description: 'Start the existing lead qualification workflow for new leads.',
  });
});

test('manual lead qualification launches the existing runner without waiting for night shift', async () => {
  const launches = [];
  const result = await executeTask({
    task_id: 'TASK-LEAD-QUALIFICATION',
    runtime_action: 'lead_qualification',
    leadgen_request: {
      mode: 'qualification',
      limit: 7,
    },
  }, loadRuntimeConfig(), {
    launchLeadQualification: async (request) => {
      launches.push(request);
      return { pid: 4321 };
    },
  });

  assert.deepEqual(launches, [{ limit: 7 }]);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.executionPlan.action, 'lead_qualification');
  assert.equal(result.executionResult.report.state, 'started');
  assert.equal(result.executionResult.report.limit, 7);
  assert.equal(result.executionResult.report.pid, 4321);
  assert.equal(result.outboundEvents[1].channelKey, 'agentResults');
  assert.equal(result.outboundEvents[1].metadata.action, 'lead_qualification');
  assert.equal(result.outboundEvents[1].metadata.limit, 7);
});
