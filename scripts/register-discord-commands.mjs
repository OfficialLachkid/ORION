#!/usr/bin/env node

import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { buildGuildSlashCommands } from '../services/discord-bot/src/slash-commands.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function buildAuthHeaders(token) {
  return {
    Authorization: `Bot ${token}`,
    'Content-Type': 'application/json',
  };
}

async function sendDiscordApiRequest(token, path, options = {}) {
  const response = await fetch(`${DISCORD_API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: buildAuthHeaders(token),
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord API request failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

async function resolveApplicationId(config) {
  if (config.env.DISCORD_APPLICATION_ID) {
    return config.env.DISCORD_APPLICATION_ID;
  }

  const me = await sendDiscordApiRequest(config.env.DISCORD_BOT_TOKEN, '/users/@me');
  if (!me?.id) {
    throw new Error('Could not resolve Discord application ID from the bot identity.');
  }

  return me.id;
}

async function main() {
  const config = loadRuntimeConfig();
  const token = config.env.DISCORD_BOT_TOKEN || '';
  const guildId = config.guildId || '';

  if (!token) {
    throw new Error('Missing DISCORD_BOT_TOKEN in config/discord/.env.');
  }

  if (!guildId) {
    throw new Error('Missing DISCORD_GUILD_ID in config/discord/.env.');
  }

  const applicationId = await resolveApplicationId(config);
  const commands = buildGuildSlashCommands();

  const registered = await sendDiscordApiRequest(
    token,
    `/applications/${applicationId}/guilds/${guildId}/commands`,
    {
      method: 'PUT',
      body: commands,
    }
  );

  process.stdout.write([
    `Registered ${registered.length} guild slash command(s).`,
    ...registered.map((command) => `- /${command.name}: ${command.description}`),
  ].join('\n'));
  process.stdout.write('\n');
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
