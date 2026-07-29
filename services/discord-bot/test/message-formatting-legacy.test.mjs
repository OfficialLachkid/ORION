import test from 'node:test';
import assert from 'node:assert/strict';
import { upgradeLegacyDiscordPayload } from '../src/message-formatting.mjs';

test('upgradeLegacyDiscordPayload converts legacy queue markdown into an embed card', () => {
  const payload = upgradeLegacyDiscordPayload({
    content: '**Queue Update**\nTask: `TASK-123`\nStatus: `completed`\nPriority: `normal`\nAction: `disk_space_health_check`\nTASK-123 completed disk_space_health_check.',
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].title, 'Queue Update');
  assert.equal(payload.embeds[0].fields[0].name, 'Task');
  assert.match(payload.embeds[0].description, /completed disk_space_health_check/u);
});
