import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuildSlashCommands,
  isSupportedSlashCommandInteraction,
  normalizeInteractionAsHelpMessage,
  normalizeSupportedSlashCommandInteraction,
} from '../src/slash-commands.mjs';

test('buildGuildSlashCommands returns the supported slash commands', () => {
  const commands = buildGuildSlashCommands();

  assert.equal(commands.length, 9);
  assert.deepEqual(commands.map((command) => command.name), [
    'commands',
    'help',
    'health',
    'status',
    'sync',
    'ops',
    'leadgen',
    'create-developer-issue',
    'email-draft',
  ]);
  const opsCommand = commands.find((command) => command.name === 'ops');
  const opsChoiceValues = (opsCommand?.options?.[0]?.choices || []).map((choice) => choice.value).sort();
  assert.deepEqual(opsChoiceValues, [
    'claude_runner_canary',
    'claude_runner_doctor',
    'claude_runner_resume',
    'mac_reboot_recovery_check',
    'restart_discord_bot',
    'session_pre_limit_checkpoint',
    'verify_memory_promotion_rules',
  ]);
});

test('normalizeSupportedSlashCommandInteraction routes /ops choices into router phrases', async () => {
  const { normalizeSupportedSlashCommandInteraction } = await import('../src/slash-commands.mjs');
  const opsInteraction = {
    id: 'interaction-ops-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      name: 'ops',
      options: [{ name: 'action', value: 'claude_runner_doctor' }],
    },
    member: { user: { id: 'u', username: 'v' } },
  };
  const message = normalizeSupportedSlashCommandInteraction(opsInteraction);
  assert.equal(message.content, 'run claude runner doctor');
  assert.equal(message.channelKey, 'commands');
});

test('isSupportedSlashCommandInteraction accepts supported slash commands', () => {
  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'commands' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'help' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'health' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'status' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'sync' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'email-draft' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'create-developer-issue' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'unknown' },
  }), false);
});

test('normalizeInteractionAsHelpMessage converts slash commands into operator help messages', () => {
  const message = normalizeInteractionAsHelpMessage({
    id: 'interaction-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      name: 'commands',
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.deepEqual(message, {
    guildId: 'guild-1',
    channelId: 'channel-1',
    channelKey: 'commands',
    messageId: 'interaction-1',
    content: '/commands',
    attachments: [],
    author: {
      id: 'user-1',
      username: 'vbjservices',
      displayName: 'Valen',
      roleIds: ['role-1'],
      isOperator: false,
    },
  });
});

test('normalizeSupportedSlashCommandInteraction converts a health slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-2',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-2',
    data: {
      name: 'health',
      options: [
        {
          name: 'target',
          value: 'tailscale',
        },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.deepEqual(message, {
    guildId: 'guild-1',
    channelId: 'channel-2',
    channelKey: 'commands',
    messageId: 'interaction-2',
    content: 'check tailscale health',
    attachments: [],
    author: {
      id: 'user-1',
      username: 'vbjservices',
      displayName: 'Valen',
      roleIds: ['role-1'],
      isOperator: false,
    },
  });
});

test('normalizeSupportedSlashCommandInteraction converts a sync slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-3',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-3',
    data: {
      name: 'sync',
      options: [
        {
          name: 'target',
          value: 'mac_runtime_safe_sync',
        },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.equal(message?.content, 'sync the mac');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts an email draft slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-4',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-4',
    data: {
      name: 'email-draft',
      options: [
        { name: 'to', value: 'vbjtechservices@gmail.com' },
        { name: 'subject', value: 'Smoke test' },
        { name: 'body', value: 'Hello from O.R.I.O.N.' },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.equal(message?.content, 'draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello from O.R.I.O.N.');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a leadgen slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-5',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-5',
    data: {
      name: 'leadgen',
      options: [
        { name: 'query', value: 'electricians in Rotterdam' },
        { name: 'max', value: '8' },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.equal(message?.content, 'find leads for electricians in Rotterdam max: 8');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a developer issue into an approval-gated router phrase', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-6',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-6',
    data: {
      name: 'create-developer-issue',
      options: [
        { name: 'objective', value: 'Fix the CI branch labels and add regression tests.' },
      ],
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.equal(
    message?.content,
    'create issue for developer: Fix the CI branch labels and add regression tests.'
  );
  assert.equal(message?.channelKey, 'commands');
});
