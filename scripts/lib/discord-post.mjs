const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

const CHANNEL_KEY_BY_TOOL = {
  claude_runner_doctor: 'agentResults',
  claude_runner_canary: 'agentResults',
  claude_runner_resume: 'agentResults',
  session_pre_limit_checkpoint: 'memoryUpdates',
  mac_reboot_recovery_check: 'agentResults',
  verify_memory_promotion_rules: 'memoryUpdates',
};

function pickChannelId(config, tool) {
  const channelKey = CHANNEL_KEY_BY_TOOL[tool] || 'agentResults';
  const preferred = config?.channelIds?.[channelKey];
  if (preferred && !/DISCORD_/u.test(preferred)) {
    return { channelId: preferred, channelKey };
  }
  const fallbackChannelKey = 'systemLogs';
  const fallback = config?.channelIds?.[fallbackChannelKey];
  if (fallback && !/DISCORD_/u.test(fallback)) {
    return { channelId: fallback, channelKey: fallbackChannelKey };
  }
  return { channelId: '', channelKey };
}

export function shouldPostToDiscord(config, options = {}) {
  const explicit = options.explicit;
  if (explicit === false) {
    return false;
  }
  if (explicit === true) {
    return Boolean(config?.env?.DISCORD_BOT_TOKEN);
  }
  // Default to opt-out. Callers must ask explicitly with --post-to-discord.
  return false;
}

const VERDICT_COLOR_MAP = {
  ready: 0x1f7a3a,
  healthy: 0x1f7a3a,
  ok: 0x1f7a3a,
  completed: 0x1f7a3a,
  degraded: 0xd4a017,
  degraded_soft: 0xd4a017,
  warning: 0xd4a017,
  paused: 0xd4a017,
  pre_limit: 0xd4a017,
  blocked: 0xa11c1c,
  failed: 0xa11c1c,
  error: 0xa11c1c,
  unknown: 0x555555,
};

function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function truncateForDiscord(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function buildToolReportEmbed(tool, verdict, summary, fields = []) {
  const normalizedVerdict = String(verdict || 'unknown').toLowerCase();
  const color = VERDICT_COLOR_MAP[normalizedVerdict] ?? VERDICT_COLOR_MAP.unknown;
  const embedFields = fields
    .filter((field) => field && field.name && (field.value !== undefined && field.value !== null && field.value !== ''))
    .slice(0, 25)
    .map((field) => ({
      name: truncateForDiscord(field.name, 256),
      value: truncateForDiscord(field.value, 1024),
      inline: field.inline === true,
    }));

  return {
    title: truncateForDiscord(`${tool}: ${normalizedVerdict}`, 256),
    description: summary ? truncateForDiscord(summary, 4096) : undefined,
    color,
    fields: embedFields,
    footer: { text: 'O.R.I.O.N. runtime · Ruflo Mac mini' },
    timestamp: new Date().toISOString(),
  };
}

export async function sendDiscordChannelMessage(config, channelId, payload, options = {}) {
  const fetchImpl = options.fetch || fetch;
  const token = config?.env?.DISCORD_BOT_TOKEN;
  if (!token || !channelId) {
    return { posted: false, reason: !token ? 'no_token' : 'no_channel_id' };
  }
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text();
    return { posted: false, reason: `discord_api_${response.status}`, error: text };
  }
  const created = await response.json();
  return { posted: true, messageId: created.id || '', channelId };
}

export async function postToolReport(config, tool, verdict, summary, fields = [], options = {}) {
  if (!shouldPostToDiscord(config, { explicit: options.explicit })) {
    return { posted: false, reason: 'disabled' };
  }
  const { channelId, channelKey } = pickChannelId(config, tool);
  if (!channelId) {
    return { posted: false, reason: 'no_channel_id' };
  }
  const embed = buildToolReportEmbed(tool, verdict, summary, fields);
  const payload = { embeds: [embed] };
  const result = await sendDiscordChannelMessage(config, channelId, payload, options);
  return { ...result, channelKey };
}
