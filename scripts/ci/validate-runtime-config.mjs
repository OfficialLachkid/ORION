#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../../services/lib/runtime-config.mjs';

const REQUIRED_CHANNEL_KEYS = [
  'orchestrator',
  'commands',
  'voiceCommands',
  'parsedTasks',
  'taskQueue',
  'approvals',
  'pullRequests',
  'alerts',
  'dailySummary',
  'agentResults',
  'memoryUpdates',
  'systemLogs',
  'agentLogs',
  'securityLogs',
  'github',
  'deployments',
];

const REQUIRED_ENV_KEYS = [
  'DISCORD_BOT_TOKEN',
  'DISCORD_GUILD_ID',
  'DISCORD_OPERATOR_ROLE_ID',
  'DISCORD_OPERATOR_USER_IDS',
  'DISCORD_ORCHESTRATOR_CHANNEL_ID',
  'DISCORD_COMMANDS_CHANNEL_ID',
  'DISCORD_VOICE_COMMANDS_CHANNEL_ID',
  'DISCORD_PARSED_TASKS_CHANNEL_ID',
  'DISCORD_TASK_QUEUE_CHANNEL_ID',
  'DISCORD_APPROVALS_CHANNEL_ID',
  'DISCORD_PULL_REQUESTS_CHANNEL_ID',
  'DISCORD_ALERTS_CHANNEL_ID',
  'DISCORD_DAILY_SUMMARY_CHANNEL_ID',
  'DISCORD_AGENT_RESULTS_CHANNEL_ID',
  'DISCORD_MEMORY_UPDATES_CHANNEL_ID',
  'DISCORD_SYSTEM_LOGS_CHANNEL_ID',
  'DISCORD_AGENT_LOGS_CHANNEL_ID',
  'DISCORD_SECURITY_LOGS_CHANNEL_ID',
  'DISCORD_GITHUB_CHANNEL_ID',
  'DISCORD_DEPLOYMENTS_CHANNEL_ID',
  'TRANSCRIPTION_PROVIDER',
  'WHISPER_MODEL',
];

const JSON_CONFIG_FILES = [
  'config/discord/approval-rules.example.json',
  'config/discord/channel-map.example.json',
  'config/runtime/memory-namespaces.json',
  'config/runtime/memory-promotion-rules.json',
];

function readJson(filePath) {
  return JSON.parse(readFileSync(resolve(projectRoot, filePath), 'utf8'));
}

function parseEnvKeys(filePath) {
  return new Set(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('=')).trim())
      .filter(Boolean)
  );
}

function collectPlaceholderKeys(channelMap) {
  const placeholders = new Set();
  for (const value of [channelMap.guildId, ...Object.values(channelMap.channels || {})]) {
    const normalized = String(value || '').trim();
    if (/^[A-Z0-9_]+$/u.test(normalized)) {
      placeholders.add(normalized);
    }
  }

  return placeholders;
}

function main() {
  const errors = [];

  for (const filePath of JSON_CONFIG_FILES) {
    if (!existsSync(resolve(projectRoot, filePath))) {
      errors.push(`Missing required JSON config file: ${filePath}`);
      continue;
    }

    try {
      readJson(filePath);
    } catch (error) {
      errors.push(`Could not parse ${filePath}: ${error.message}`);
    }
  }

  const envExamplePath = resolve(projectRoot, 'config/discord/.env.example');
  if (!existsSync(envExamplePath)) {
    errors.push('Missing config/discord/.env.example');
  }

  const channelMap = readJson('config/discord/channel-map.example.json');
  const envKeys = parseEnvKeys(envExamplePath);

  for (const channelKey of REQUIRED_CHANNEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(channelMap.channels || {}, channelKey)) {
      errors.push(`channel-map.example.json is missing channel key '${channelKey}'.`);
    }
  }

  for (const envKey of REQUIRED_ENV_KEYS) {
    if (!envKeys.has(envKey)) {
      errors.push(`.env.example is missing key '${envKey}'.`);
    }
  }

  for (const placeholder of collectPlaceholderKeys(channelMap)) {
    if (!envKeys.has(placeholder)) {
      errors.push(`channel-map.example.json references '${placeholder}', but .env.example does not define it.`);
    }
  }

  try {
    const config = loadRuntimeConfig({ envFilePath: 'config/discord/.env.example' });
    for (const channelKey of REQUIRED_CHANNEL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(config.channelIds, channelKey)) {
        errors.push(`loadRuntimeConfig() did not resolve channelIds.${channelKey}.`);
      }
    }
  } catch (error) {
    errors.push(`loadRuntimeConfig() failed against examples: ${error.message}`);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      process.stderr.write(`- ${error}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Runtime config example validation passed.\n');
}

main();
