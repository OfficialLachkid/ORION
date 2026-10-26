#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

// Daily Instagram Reels analytics sweep, fired 15 minutes before the
// Monday weekly review so Monday's run reads fresh snapshots instead
// of whatever happened to be in Supabase from the last manual pull.
// Running daily (not weekly) catches each reel's metrics as they
// stabilise over the first 48–72h after publish.
export const DEFAULT_HOUR = 9;
export const DEFAULT_MINUTE = 0;
export const DEFAULT_LAUNCH_AGENT_PATH = [
  '/opt/homebrew/bin',
  '/opt/homebrew/opt/node/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].join(':');
export const PLIST_LABEL = 'io.vbj.orion.instagram-analytics-sweep';
export const SWEEP_SCRIPT_RELATIVE_PATH = 'services/product-video-agent/scripts/analytics/run-instagram-analytics-sweep.mjs';

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

export function buildInstagramAnalyticsSweepPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  hour,
  minute,
  executablePath = DEFAULT_LAUNCH_AGENT_PATH,
}) {
  // No <Weekday> key — launchd reads a Hour+Minute-only
  // StartCalendarInterval as "every day at that time."
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
    process.stdout.write(`No Instagram analytics sweep plist at ${plistPath} — nothing to uninstall.\n`);
    return;
  }
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded — safe to continue.
  }
  unlinkSync(plistPath);
  process.stdout.write(`Uninstalled ${basename(plistPath)}. Instagram analytics sweep will no longer fire on the fixed schedule.\n`);
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-instagram-analytics-sweep-schedule.mjs [--hour 9] [--minute 0] [--no-load]',
      '       node scripts/install-instagram-analytics-sweep-schedule.mjs --uninstall',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.instagram-analytics-sweep.plist and loads it by default.',
      'Each run calls run-instagram-analytics-sweep.mjs over the last 14 days (its default window) and',
      'upserts the resulting per-reel snapshots into Supabase video_analytics so the Monday weekly',
      'review reads fresh engagement data.',
      '',
      '--hour + --minute pick the launchd fire time (macOS local time). Defaults: 09:00 — 15 min before',
      'the weekly review on Mondays. Any Hour+Minute without --weekday fires DAILY.',
      '',
      '--uninstall unloads and removes the plist.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Instagram analytics sweep LaunchAgent installation is supported only on macOS.');
  }

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);

  if (hasFlag('--uninstall')) {
    uninstallLaunchAgent(plistPath);
    return;
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArgValue('--hour', DEFAULT_HOUR, 23);
  const minute = getNumberArgValue('--minute', DEFAULT_MINUTE, 59);
  const shouldLoad = !hasFlag('--no-load');
  const stdoutPath = resolve(config.runtimePaths.logDir, 'instagram-analytics-sweep.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'instagram-analytics-sweep.stderr.log');
  const scriptPath = resolve(projectRoot, SWEEP_SCRIPT_RELATIVE_PATH);
  const nodePath = process.execPath;

  if (!existsSync(scriptPath)) {
    throw new Error(`Sweep script not found at ${scriptPath}. Did the Instagram adapter get deleted?`);
  }

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  const plistContent = buildInstagramAnalyticsSweepPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    hour,
    minute,
  });

  writeFileSync(plistPath, plistContent, 'utf8');
  process.stdout.write(`Wrote ${plistPath} (daily at hour=${hour} minute=${String(minute).padStart(2, '0')}).\n`);

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
    process.stdout.write('Loaded LaunchAgent. First fire is at the next matching hour+minute.\n');
  } else {
    process.stdout.write('Skipped loading (--no-load). Run `launchctl load -w <plistPath>` manually to activate.\n');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.url.replace(/^file:\/\//u, '')) {
  main();
}
