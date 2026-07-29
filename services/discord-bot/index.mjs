#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig, parseJsonFromString, readJsonInput, readStdin } from '../lib/runtime-config.mjs';
import { processDiscordEvent } from './src/intake.mjs';

function getArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return argv[index + 1] || '';
}

function hasFlag(flag) {
  return argv.includes(flag);
}

function getNumberArgValue(flag, fallbackValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return fallbackValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Flag ${flag} expects a positive number.`);
  }

  return parsed;
}

async function loadPayload() {
  const inputFile = getArgValue('--input-file');
  if (inputFile) {
    return readJsonInput(inputFile);
  }

  const stdinText = await readStdin();
  if (!stdinText.trim()) {
    throw new Error('No JSON input provided. Use --input-file <path> or pipe JSON to stdin.');
  }

  return parseJsonFromString(stdinText);
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/discord-bot/index.mjs [--input-file path] [--live]',
      '',
      'Use --live to connect to the Discord gateway with the runtime config under config/discord/.env.',
      'Use --daily-summary to summarize local ops events and post into #daily-summary.',
      'Add --dry-run with --daily-summary to print the summary instead of posting it.',
      'Use --health-monitor to evaluate runtime thresholds and post alerts into #alerts.',
      'Add --dry-run with --health-monitor to print the monitor report instead of posting alerts.',
      'Without --live, reads a Discord-style event payload and emits the phase-1 routing result for commands, approvals, or voice note intake.',
    ].join('\n'));
    return;
  }

  const config = loadRuntimeConfig();

  if (hasFlag('--live')) {
    const { runLiveDiscordBot } = await import('./src/live-runtime.mjs');
    await runLiveDiscordBot(config);
    return;
  }

  if (hasFlag('--daily-summary')) {
    const options = {
      windowHours: getNumberArgValue('--window-hours', 24),
    };
    const { generateDailySummary, postDailySummary } = await import('./src/daily-summary.mjs');

    if (hasFlag('--dry-run')) {
      const { content } = generateDailySummary(config, options);
      process.stdout.write(`${content}\n`);
      return;
    }

    const { content } = await postDailySummary(config, options);
    process.stdout.write(`${content}\n`);
    return;
  }

  if (hasFlag('--health-monitor')) {
    const { formatHealthMonitorReport, runHealthMonitor } = await import('./src/health-monitor.mjs');
    const run = await runHealthMonitor(config, {
      dryRun: hasFlag('--dry-run'),
    });
    process.stdout.write(`${formatHealthMonitorReport(run)}\n`);
    return;
  }

  const payload = await loadPayload();
  const result = processDiscordEvent(payload, config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
