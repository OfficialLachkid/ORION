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

  assert.equal(commands.length, 12);
  assert.deepEqual(commands.map((command) => command.name), [
    'commands',
    'help',
    'health',
    'status',
    'sync',
    'ops',
    'generate-video',
    'analytics',
    'leadgen',
    'leadgen-sweep',
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
  const generateVideoCommand = commands.find((command) => command.name === 'generate-video');
  const generateTemplateChoiceValues = (generateVideoCommand?.options?.find((option) => option.name === 'template')?.choices || [])
    .map((choice) => choice.value)
    .sort();
  assert.deepEqual(generateTemplateChoiceValues, [
    'dual-type-reveal',
    'find-the-shiny',
    'know-your-shiny',
    'memory',
    'stat-clash',
    'tournament',
    'type-speed-quiz',
  ]);
  const generateChannelChoiceValues = (generateVideoCommand?.options?.find((option) => option.name === 'channel')?.choices || [])
    .map((choice) => choice.value)
    .sort();
  assert.deepEqual(generateChannelChoiceValues, [
    'dexguess-youtube',
    'poke-guess-youtube',
    'poke-quizz-youtube',
    'trivamon-youtube',
  ]);
  const analyticsCommand = commands.find((command) => command.name === 'analytics');
  const analyticsChannelChoiceValues = (analyticsCommand?.options?.find((option) => option.name === 'channel')?.choices || [])
    .map((choice) => choice.value)
    .sort();
  assert.deepEqual(analyticsChannelChoiceValues, [
    'all',
    'dexguess-youtube',
    'poke-guess-youtube',
    'poke-quizz-youtube',
    'trivamon-youtube',
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
    data: { name: 'generate-video' },
  }), true);

  assert.equal(isSupportedSlashCommandInteraction({
    type: 2,
    data: { name: 'analytics' },
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

test('normalizeSupportedSlashCommandInteraction converts a leadgen sweep slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-5b',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-5b',
    data: {
      name: 'leadgen-sweep',
      options: [
        { name: 'rounds', value: 2 },
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

  assert.equal(message?.content, 'run leadgen sweep rounds: 2');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a manual video generation slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-7',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'find-the-shiny' },
        { name: 'channel', value: 'trivamon-youtube' },
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

  assert.equal(message?.content, 'generate video template: find-the-shiny channel: trivamon-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a memory slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-memory-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-memory-1',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'memory' },
        { name: 'channel', value: 'poke-quizz-youtube' },
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

  assert.equal(message?.content, 'generate video template: memory channel: poke-quizz-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts an analytics slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-analytics-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-analytics-1',
    data: {
      name: 'analytics',
      options: [
        { name: 'channel', value: 'trivamon-youtube' },
        { name: 'days', value: 3 },
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

  assert.equal(message?.content, 'post analytics channel: trivamon-youtube days: 3');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a type-speed-quiz slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-2',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-8',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'type-speed-quiz' },
        { name: 'channel', value: 'trivamon-youtube' },
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

  assert.equal(message?.content, 'generate video template: type-speed-quiz channel: trivamon-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a know-your-shiny slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-kys-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-know-your-shiny-1',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'know-your-shiny' },
        { name: 'channel', value: 'poke-quizz-youtube' },
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

  assert.equal(message?.content, 'generate video template: know-your-shiny channel: poke-quizz-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a stat-clash slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-stat-clash-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-stat-clash-1',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'stat-clash' },
        { name: 'channel', value: 'poke-quizz-youtube' },
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

  assert.equal(message?.content, 'generate video template: stat-clash channel: poke-quizz-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a tournament slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-tournament-1',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-tournament-1',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'tournament' },
        { name: 'channel', value: 'dexguess-youtube' },
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

  assert.equal(message?.content, 'generate video template: tournament channel: dexguess-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a Poke Guess type-speed-quiz slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-3',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-9',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'type-speed-quiz' },
        { name: 'channel', value: 'poke-guess-youtube' },
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

  assert.equal(message?.content, 'generate video template: type-speed-quiz channel: poke-guess-youtube');
  assert.equal(message?.channelKey, 'commands');
});

test('normalizeSupportedSlashCommandInteraction converts a DexGuess dual-type-reveal slash command into a routed message', () => {
  const message = normalizeSupportedSlashCommandInteraction({
    id: 'interaction-generate-video-4',
    type: 2,
    guild_id: 'guild-1',
    channel_id: 'channel-10',
    data: {
      name: 'generate-video',
      options: [
        { name: 'template', value: 'dual-type-reveal' },
        { name: 'channel', value: 'dexguess-youtube' },
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

  assert.equal(message?.content, 'generate video template: dual-type-reveal channel: dexguess-youtube');
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
