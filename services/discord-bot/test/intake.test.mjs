import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { processDiscordEvent } from '../src/intake.mjs';

function withConfiguredOperators(config) {
  return {
    ...config,
    operatorRoleId: 'role-operator',
    operatorUserIds: ['owner-user'],
  };
}

function buildAuthorizedOperator(config, overrides = {}) {
  const hasConfiguredOperatorGate = Boolean(config.operatorRoleId)
    || (Array.isArray(config.operatorUserIds) && config.operatorUserIds.length > 0);

  return {
    id: config.operatorUserIds[0] || 'operator-1',
    displayName: 'VBJ Services',
    username: 'vbjservices',
    isOperator: !hasConfiguredOperatorGate,
    roleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
    ...overrides,
  };
}

test('processDiscordEvent routes commands into parsed task, queue, and approval events', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'Please deploy the latest fix to production.',
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'command');
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'parsedTasks'), true);
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'taskQueue'), true);
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'approvals'), true);
  assert.equal(result.outboundEvents.some((item) => item.channelKey === 'memoryUpdates'), true);
});

test('processDiscordEvent rejects unauthorized senders', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'Run this command.',
    author: {
      id: 'random-user',
      displayName: 'Unknown',
      username: 'intruder',
      isOperator: false,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'rejected');
  assert.equal(result.outboundEvents[0].channelKey, 'securityLogs');
  assert.match(result.outboundEvents[0].body, /<@random-user>/u);
  assert.equal(result.outboundEvents[0].metadata.authorId, 'random-user');
  assert.equal(result.outboundEvents[0].metadata.displayName, 'Unknown');
  assert.equal(result.outboundEvents[0].metadata.username, 'intruder');
});

test('processDiscordEvent routes invalid approval replies into security logs', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'approvals',
    channelId: config.channelIds.approvals || 'DISCORD_APPROVALS_CHANNEL_ID',
    content: 'approve this now',
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'approval');
  assert.equal(result.outboundEvents[0].channelKey, 'securityLogs');
  assert.equal(result.outboundEvents[0].type, 'invalid_approval_message');
});

test('processDiscordEvent rejects synthetic operator bypass when a role or owner allowlist is configured', () => {
  const config = withConfiguredOperators(loadRuntimeConfig());
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'pokeQuizzReview',
    channelId: config.channelIds.pokeQuizzReview || 'review-thread-1',
    content: 'approve TASK-1234567890-ABCDE12345',
    author: {
      id: 'random-user',
      displayName: 'Unknown',
      username: 'intruder',
      isOperator: true,
      roleIds: [],
    },
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'rejected');
  assert.equal(result.reason, 'Message sender is not an approved operator.');
});

test('processDiscordEvent accepts approval replies from the configured operator role', () => {
  const baseConfig = loadRuntimeConfig();
  const config = {
    ...withConfiguredOperators(baseConfig),
    channelIds: {
      ...baseConfig.channelIds,
      pokeQuizzReview: 'review-thread-operator',
    },
  };
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelId: 'review-thread-operator',
    content: 'approve TASK-PR-MERGE-42-1234567890AB',
    author: {
      id: 'operator-member',
      displayName: 'Operator',
      username: 'operator',
      isOperator: false,
      roleIds: ['role-operator'],
    },
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'approval');
  assert.equal(result.decision.taskId, 'TASK-PR-MERGE-42-1234567890AB');
});

for (const channelKey of ['outreachAgent', 'pullRequests', 'outreachFollowups', 'orionReview', 'pokeQuizzReview']) {
  test(`processDiscordEvent routes approval replies from ${channelKey}`, () => {
    const baseConfig = loadRuntimeConfig();
    const channelId = `channel-${channelKey}`;
    const config = {
      ...baseConfig,
      channelIds: {
        ...baseConfig.channelIds,
        [channelKey]: channelId,
      },
    };
    const result = processDiscordEvent({
      guildId: config.guildId || 'DISCORD_GUILD_ID',
      channelId,
      content: 'approve TASK-PR-MERGE-42-1234567890AB',
      author: buildAuthorizedOperator(config),
    }, config);

    assert.equal(result.accepted, true);
    assert.equal(result.route, 'approval');
    assert.equal(result.decision.taskId, 'TASK-PR-MERGE-42-1234567890AB');
  });
}

test('processDiscordEvent splits multi-line command messages into multiple normalized tasks', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'check disk space\ncheck ollama health\ncheck tailscale health',
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'command');
  assert.equal(result.normalizedTasks.length, 3);
  assert.equal(result.outboundEvents.filter((item) => item.channelKey === 'parsedTasks').length, 3);
  assert.equal(result.outboundEvents.filter((item) => item.channelKey === 'taskQueue').length, 3);
});

test('processDiscordEvent preserves image context on command tasks', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: 'Review the attached screenshot and tell me what is wrong.',
    attachments: [
      {
        id: 'img-1',
        url: 'https://example.com/screenshot.png',
        proxyUrl: 'https://proxy.example.com/screenshot.png',
        filename: 'screenshot.png',
        contentType: 'image/png',
        size: 1024,
      },
    ],
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.normalizedTask.image_attachment_count, 1);
  assert.deepEqual(result.normalizedTask.image_attachment_filenames, ['screenshot.png']);
});

test('processDiscordEvent rejects image-only command messages for now', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelKey: 'commands',
    channelId: config.channelIds.commands || 'DISCORD_COMMANDS_CHANNEL_ID',
    content: '',
    attachments: [
      {
        id: 'img-1',
        url: 'https://example.com/screenshot.png',
        proxyUrl: 'https://proxy.example.com/screenshot.png',
        filename: 'screenshot.png',
        contentType: 'image/png',
        size: 1024,
      },
    ],
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, false);
  assert.equal(result.route, 'rejected');
  assert.equal(result.outboundEvents[0].type, 'image_command_text_missing');
});

test('processDiscordEvent returns the command guide for /commands requests from an approved operator', () => {
  const config = loadRuntimeConfig();
  const result = processDiscordEvent({
    guildId: config.guildId || 'DISCORD_GUILD_ID',
    channelId: 'some-future-channel',
    content: '/commands',
    author: buildAuthorizedOperator(config),
  }, config);

  assert.equal(result.accepted, true);
  assert.equal(result.route, 'help');
  assert.equal(result.helpTopic, 'commands');
  assert.deepEqual(result.outboundEvents, []);
});
