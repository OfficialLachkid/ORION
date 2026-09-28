#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

// Run shortly after Monday's 09:00 analytics sweep so the review includes
// the freshest weekly snapshots without competing with the collector.
export const DEFAULT_WEEKDAY = 1; // 1 = Monday under macOS launchd (same as JS Date)
export const DEFAULT_HOUR = 9;
export const DEFAULT_MINUTE = 15;
export const DEFAULT_LAUNCH_AGENT_PATH = [
  '/opt/homebrew/bin',
  '/opt/homebrew/opt/node/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');
export const PLIST_LABEL = 'io.vbj.orion.weekly-analytics-review';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return '';
  return process.argv[index + 1] || '';
}

function getNumberArgValue(flag, fallbackValue, maxValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) return fallbackValue;
  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw new Error(`Flag ${flag} expects an integer between 0 and ${maxValue}.`);
  }
  return parsed;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

export function buildWeeklyAnalyticsReviewPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  weekday,
  hour,
  minute,
  executablePath = DEFAULT_LAUNCH_AGENT_PATH,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${executablePath}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>${weekday}</integer>
    <key>Hour</key>
    <integer>${hour}</integer>
    <key>Minute</key>
    <integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;
}

function loadLaunchAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded or not present.
  }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function uninstallLaunchAgent(plistPath) {
  if (!existsSync(plistPath)) {
    process.stdout.write(`No weekly analytics review plist at ${plistPath} — nothing to uninstall.\n`);
    return;
  }
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded — safe to continue.
  }
  unlinkSync(plistPath);
  process.stdout.write(`Uninstalled ${basename(plistPath)}. Weekly analytics review will no longer fire on the fixed schedule.\n`);
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-weekly-analytics-review-schedule.mjs [--weekday 1] [--hour 9] [--minute 15] [--no-load]',
      '       node scripts/install-weekly-analytics-review-schedule.mjs --uninstall',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.weekly-analytics-review.plist and loads it by default.',
      'Each run pulls the last 7 days of pokemon YouTube Shorts analytics from Supabase, feeds a',
      'compact JSON data pack to Claude (claude -p, sonnet) for an "analyst" pass, and posts',
      'the resulting summary to a Discord thread in the ORION analytics channel. The operator',
      'reads the summary and applies changes manually — the script does NOT open PRs.',
      '',
      '--weekday N picks the launchd weekday (0 = Sunday, 6 = Saturday). Default: 1 (Monday).',
      '--hour + --minute pick the launchd fire time (macOS local time). Defaults: 09:15.',
      '',
      '--uninstall unloads and removes the plist.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Weekly analytics review LaunchAgent installation is supported only on macOS.');
  }

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);

  if (hasFlag('--uninstall')) {
    uninstallLaunchAgent(plistPath);
    return;
  }

  const config = loadRuntimeConfig();
  const weekday = getNumberArgValue('--weekday', DEFAULT_WEEKDAY, 6);
  const hour = getNumberArgValue('--hour', DEFAULT_HOUR, 23);
  const minute = getNumberArgValue('--minute', DEFAULT_MINUTE, 59);
  const shouldLoad = !hasFlag('--no-load');
  const stdoutPath = resolve(config.runtimePaths.logDir, 'weekly-analytics-review.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'weekly-analytics-review.stderr.log');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-weekly-analytics-review.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  const plistContent = buildWeeklyAnalyticsReviewPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    weekday,
    hour,
    minute,
  });

  writeFileSync(plistPath, plistContent, 'utf8');
  process.stdout.write(`Wrote ${plistPath} (weekday=${weekday} hour=${hour} minute=${String(minute).padStart(2, '0')}).\n`);

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
    process.stdout.write('Loaded LaunchAgent. First fire is at the next matching weekday+hour+minute.\n');
  } else {
    process.stdout.write('Skipped loading (--no-load). Run `launchctl load -w <plistPath>` manually to activate.\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.url.replace(/^file:\/\//u, '')) {
  main();
}
