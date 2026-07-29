import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcknowledgementDiscordPayload } from '../src/message-formatting.mjs';

test('buildAcknowledgementDiscordPayload summarizes multi-task command intake', () => {
  const payload = buildAcknowledgementDiscordPayload({
    route: 'command',
    normalizedTasks: [
      {
        task_id: 'TASK-1',
        summary: 'check disk space',
        submitted_by: 'Lachkid',
      },
      {
        task_id: 'TASK-2',
        summary: 'check ollama health',
        submitted_by: 'Lachkid',
      },
    ],
    commandRuntimeSummary: {
      startingCount: 1,
      queuedCount: 1,
      awaitingApprovalCount: 0,
      noExecutorCount: 0,
    },
  }, 'Accepted 2 tasks. Parsed tasks posted to #parsed-tasks.');

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /2 tasks/u);
  assert.match(payload.embeds[0].description, /Accepted 2 tasks/u);
});

test('buildAcknowledgementDiscordPayload renders the operator command guide', () => {
  const payload = buildAcknowledgementDiscordPayload({
    route: 'help',
    helpTopic: 'commands',
  }, 'Showing the current operator command guide.', {
    channelIds: {
      commands: 'commands-id',
      voiceCommands: 'voice-id',
      approvals: 'approvals-id',
      parsedTasks: 'parsed-id',
      taskQueue: 'queue-id',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Operator Command Guide/u);
  assert.match(payload.embeds[0].description, /<#commands-id>/u);
  assert.match(payload.embeds[0].fields[0].value, /<#commands-id>/u);
  assert.match(payload.embeds[0].fields[1].value, /check disk space/u);
});
