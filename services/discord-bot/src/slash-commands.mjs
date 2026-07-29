import { serializeDraftEmailCommand } from '../../task-router/src/email-command-parser.mjs';
import { serializeLeadgenCommand } from '../../task-router/src/leadgen-command-parser.mjs';
import { serializeDeveloperTaskCommand } from '../../developer-agent/src/command-parser.mjs';

const DISCORD_INTERACTION_TYPE_APPLICATION_COMMAND = 2;
const DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING = 3;
const DISCORD_APPLICATION_COMMAND_OPTION_TYPE_INTEGER = 4;
const HELP_COMMAND_NAMES = new Set(['commands', 'help']);
const STATUS_COMMAND_NAMES = new Set(['health', 'status']);
const SYNC_COMMAND_NAMES = new Set(['sync']);
const OPS_COMMAND_NAMES = new Set(['ops']);
const EMAIL_DRAFT_COMMAND_NAMES = new Set(['email-draft']);
const LEADGEN_COMMAND_NAMES = new Set(['leadgen']);
const DEVELOPER_TASK_COMMAND_NAMES = new Set(['create-developer-issue']);

const HEALTH_TARGETS = [
  {
    name: 'Ruflo worker service',
    value: 'ruflo_worker_service',
    content: 'check ruflo worker service health',
  },
  {
    name: 'Discord bot',
    value: 'discord_bot',
    content: 'check discord bot health',
  },
  {
    name: 'Tailscale',
    value: 'tailscale',
    content: 'check tailscale health',
  },
  {
    name: 'Docker and Colima',
    value: 'docker_colima',
    content: 'check docker and colima health',
  },
  {
    name: 'Ollama',
    value: 'ollama',
    content: 'check ollama health',
  },
  {
    name: 'Disk space',
    value: 'disk_space',
    content: 'check disk space',
  },
  {
    name: 'GitHub auth',
    value: 'github_auth',
    content: 'check github auth health',
  },
  {
    name: 'Launch agents',
    value: 'launch_agents',
    content: 'check current launch agents health',
  },
  {
    name: 'Session checkpoints',
    value: 'session_checkpoint',
    content: 'check current session checkpoint health',
  },
  {
    name: 'Runtime logs',
    value: 'runtime_logs',
    content: 'check current runtime logs health',
  },
  {
    name: 'Memory bridge sync',
    value: 'memory_bridge_sync',
    content: 'check current memory/bridge sync health',
  },
];

const SYNC_TARGETS = [
  {
    name: 'Mac runtime safe sync',
    value: 'mac_runtime_safe_sync',
    content: 'sync the mac',
  },
];

const OPS_TARGETS = [
  {
    name: 'Claude runner doctor',
    value: 'claude_runner_doctor',
    content: 'run claude runner doctor',
  },
  {
    name: 'Claude runner canary',
    value: 'claude_runner_canary',
    content: 'run claude runner canary',
  },
  {
    name: 'Claude runner resume',
    value: 'claude_runner_resume',
    content: 'run claude runner resume',
  },
  {
    name: 'Session pre-limit checkpoint',
    value: 'session_pre_limit_checkpoint',
    content: 'run session pre-limit checkpoint',
  },
  {
    name: 'Mac reboot recovery check',
    value: 'mac_reboot_recovery_check',
    content: 'run mac reboot recovery check',
  },
  {
    name: 'Verify memory promotion rules',
    value: 'verify_memory_promotion_rules',
    content: 'verify memory promotion rules',
  },
  {
    name: 'Restart Discord bot',
    value: 'restart_discord_bot',
    content: 'restart the discord bot',
  },
];

function buildAuthorFromInteraction(interaction) {
  return {
    id: interaction.member?.user?.id || interaction.user?.id || '',
    username: interaction.member?.user?.username || interaction.user?.username || '',
    displayName:
      interaction.member?.nick
      || interaction.member?.user?.global_name
      || interaction.user?.global_name
      || interaction.member?.user?.username
      || interaction.user?.username
      || '',
    roleIds: Array.isArray(interaction.member?.roles) ? interaction.member.roles : [],
    isOperator: false,
  };
}

export function buildGuildSlashCommands() {
  return [
    {
      name: 'commands',
      description: 'Show the current Ruflo operator command guide.',
      type: 1,
    },
    {
      name: 'help',
      description: 'Show the current Ruflo operator command guide.',
      type: 1,
    },
    {
      name: 'health',
      description: 'Run a safe read-only health check on the Mac runtime.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'target',
          description: 'Which runtime surface to check.',
          required: true,
          choices: HEALTH_TARGETS.map((target) => ({
            name: target.name,
            value: target.value,
          })),
        },
      ],
    },
    {
      name: 'status',
      description: 'Alias for /health with the same safe runtime checks.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'target',
          description: 'Which runtime surface to check.',
          required: true,
          choices: HEALTH_TARGETS.map((target) => ({
            name: target.name,
            value: target.value,
          })),
        },
      ],
    },
    {
      name: 'sync',
      description: 'Start the safe Mac runtime sync workflow.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'target',
          description: 'Which safe sync path to request.',
          required: true,
          choices: SYNC_TARGETS.map((target) => ({
            name: target.name,
            value: target.value,
          })),
        },
      ],
    },
    {
      name: 'ops',
      description: 'Run a Ruflo operator tool (doctor, canary, resume, pre-limit, recovery, audit, bot-restart).',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'action',
          description: 'Which operator tool to run.',
          required: true,
          choices: OPS_TARGETS.map((target) => ({
            name: target.name,
            value: target.value,
          })),
        },
      ],
    },
    {
      name: 'leadgen',
      description: 'Search public pages for candidate leads and extract structured records.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'query',
          description: 'What to search for, e.g. "electricians in Rotterdam".',
          required: true,
        },
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_INTEGER,
          name: 'max',
          description: 'Max candidate URLs to extract (default 10, capped at 50).',
          required: false,
        },
      ],
    },
    {
      name: 'create-developer-issue',
      description: 'Create an approval-gated issue for the developer agent.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'objective',
          description: 'The bug fix or feature outcome the developer agent should implement.',
          required: true,
        },
      ],
    },
    {
      name: 'email-draft',
      description: 'Create a Gmail draft and route its send step through approvals.',
      type: 1,
      options: [
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'to',
          description: 'The recipient email address.',
          required: true,
        },
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'subject',
          description: 'The email subject line.',
          required: true,
        },
        {
          type: DISCORD_APPLICATION_COMMAND_OPTION_TYPE_STRING,
          name: 'body',
          description: 'The draft body text.',
          required: true,
        },
      ],
    },
  ];
}

export function isSupportedSlashCommandInteraction(interaction) {
  const commandName = String(interaction?.data?.name || '').toLowerCase();
  return interaction?.type === DISCORD_INTERACTION_TYPE_APPLICATION_COMMAND
    && (
      HELP_COMMAND_NAMES.has(commandName)
      || STATUS_COMMAND_NAMES.has(commandName)
      || SYNC_COMMAND_NAMES.has(commandName)
      || OPS_COMMAND_NAMES.has(commandName)
      || EMAIL_DRAFT_COMMAND_NAMES.has(commandName)
      || LEADGEN_COMMAND_NAMES.has(commandName)
      || DEVELOPER_TASK_COMMAND_NAMES.has(commandName)
    );
}

export function normalizeInteractionAsHelpMessage(interaction) {
  if (!isSupportedSlashCommandInteraction(interaction)) {
    return null;
  }

  const commandName = String(interaction.data?.name || 'commands').toLowerCase();
  if (!HELP_COMMAND_NAMES.has(commandName)) {
    return null;
  }

  return {
    guildId: interaction.guild_id || '',
    channelId: interaction.channel_id || '',
    channelKey: 'commands',
    messageId: interaction.id || '',
    content: `/${commandName}`,
    attachments: [],
    author: buildAuthorFromInteraction(interaction),
  };
}

function getSlashCommandOptionValue(interaction, optionName) {
  const options = Array.isArray(interaction?.data?.options) ? interaction.data.options : [];
  const option = options.find((item) => String(item?.name || '').toLowerCase() === optionName);
  if (!option) {
    return '';
  }

  return String(option.value || '');
}

function resolveSlashCommandContent(interaction) {
  const commandName = String(interaction?.data?.name || '').toLowerCase();

  if (HELP_COMMAND_NAMES.has(commandName)) {
    return `/${commandName}`;
  }

  if (STATUS_COMMAND_NAMES.has(commandName)) {
    const targetValue = getSlashCommandOptionValue(interaction, 'target').toLowerCase();
    return HEALTH_TARGETS.find((target) => target.value === targetValue)?.content || '';
  }

  if (SYNC_COMMAND_NAMES.has(commandName)) {
    const targetValue = getSlashCommandOptionValue(interaction, 'target').toLowerCase();
    return SYNC_TARGETS.find((target) => target.value === targetValue)?.content || '';
  }

  if (OPS_COMMAND_NAMES.has(commandName)) {
    const actionValue = getSlashCommandOptionValue(interaction, 'action');
    return OPS_TARGETS.find((target) => target.value === actionValue)?.content || '';
  }

  if (EMAIL_DRAFT_COMMAND_NAMES.has(commandName)) {
    return serializeDraftEmailCommand({
      to: getSlashCommandOptionValue(interaction, 'to'),
      subject: getSlashCommandOptionValue(interaction, 'subject'),
      bodyText: getSlashCommandOptionValue(interaction, 'body'),
    });
  }

  if (LEADGEN_COMMAND_NAMES.has(commandName)) {
    return serializeLeadgenCommand({
      query: getSlashCommandOptionValue(interaction, 'query'),
      max: getSlashCommandOptionValue(interaction, 'max'),
    });
  }

  if (DEVELOPER_TASK_COMMAND_NAMES.has(commandName)) {
    return serializeDeveloperTaskCommand({
      objective: getSlashCommandOptionValue(interaction, 'objective'),
    });
  }

  return '';
}

export function normalizeSupportedSlashCommandInteraction(interaction) {
  if (!isSupportedSlashCommandInteraction(interaction)) {
    return null;
  }

  const content = resolveSlashCommandContent(interaction);
  if (!content) {
    return null;
  }

  return {
    guildId: interaction.guild_id || '',
    channelId: interaction.channel_id || '',
    channelKey: 'commands',
    messageId: interaction.id || '',
    content,
    attachments: [],
    author: buildAuthorFromInteraction(interaction),
  };
}
