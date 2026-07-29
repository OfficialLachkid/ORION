#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
} from './lib/ruflo-wrapper-utils.mjs';

const execFileAsync = promisify(execFile);
const SERVICE_LABEL = 'io.ruv.ruflo.discord-bot';

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

async function resolveUid() {
  const { stdout } = await execFileAsync('id', ['-u']);
  return String(stdout || '').trim();
}

function scheduleDetachedKickstart(serviceId, delaySeconds) {
  const child = spawn('bash', ['-c', `sleep ${delaySeconds} && launchctl kickstart -k "${serviceId}"`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export async function runDiscordBotRestart(config, options = {}) {
  const delaySeconds = Number.isFinite(options.delaySeconds) ? options.delaySeconds : 3;
  const uid = await resolveUid();
  const serviceId = `gui/${uid}/${SERVICE_LABEL}`;
  const scheduledAtUtc = new Date().toISOString();

  if (options.dryRun !== true) {
    scheduleDetachedKickstart(serviceId, delaySeconds);
  }

  const report = {
    action: 'restart_discord_bot',
    verdict: options.dryRun === true ? 'dry_run' : 'scheduled',
    serviceId,
    delaySeconds,
    scheduledAtUtc,
    summary: options.dryRun === true
      ? `Dry run: would kick-start ${serviceId} in ${delaySeconds}s.`
      : `Scheduled restart of ${serviceId} in ${delaySeconds}s. LaunchAgent KeepAlive will restart it.`,
  };

  try {
    recordOpsMetric(config, 'discord_bot_restart_requested', {
      serviceId,
      delaySeconds,
      dryRun: options.dryRun === true,
    });
  } catch (error) {
    printError(`Could not record ops metric: ${error.message}`);
  }

  return report;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/discord-bot-restart.mjs [options]',
      '',
      'Options:',
      '  --delay-seconds <n>   Grace period before kicking the service. Default: 3',
      '  --dry-run             Print the plan but do not schedule the kickstart.',
      '  --json                Emit the report as JSON.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const delaySeconds = parsePositiveInt(getStringOption(options, 'delay-seconds', '3'), 3);
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const report = await runDiscordBotRestart(config, { delaySeconds, dryRun });

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  printInfo(report.summary);
  printInfo(`serviceId: ${report.serviceId}`);
  printInfo(`verdict: ${report.verdict}`);
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
