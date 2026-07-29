#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const DEFAULT_HOUR = 22;
const DEFAULT_MINUTE = 0;
const DEFAULT_WINDOW_HOURS = 24;
const PLIST_LABEL = 'io.ruv.ruflo.daily-summary';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

function getNumberArgValue(flag, fallbackValue, maxValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return fallbackValue;
  }

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

function buildPlistContent({ nodePath, scriptPath, workingDirectory, stdoutPath, stderrPath, hour, minute, windowHours }) {
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
    <string>--daily-summary</string>
    <string>--window-hours</string>
    <string>${windowHours}</string>
  </array>
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

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-daily-summary-schedule.mjs [--hour 22] [--minute 0] [--window-hours 24] [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.ruv.ruflo.daily-summary.plist and loads it by default.',
      'Schedule uses macOS local time.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Daily summary LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArgValue('--hour', DEFAULT_HOUR, 23);
  const minute = getNumberArgValue('--minute', DEFAULT_MINUTE, 59);
  const windowHours = getNumberArgValue('--window-hours', DEFAULT_WINDOW_HOURS, 168);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'daily-summary.schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'daily-summary.schedule.stderr.log');
  const scriptPath = resolve(projectRoot, 'services', 'discord-bot', 'index.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  const plistContent = buildPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    hour,
    minute,
    windowHours,
  });

  writeFileSync(plistPath, plistContent, 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} local time.`,
    `Window: last ${windowHours}h.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
