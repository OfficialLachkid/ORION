#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.mac-sync-watch';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

function getNumberArgValue(flag, fallbackValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return fallbackValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Flag ${flag} expects a positive integer.`);
  }

  return parsed;
}

function getMinuteArgValue(flag, fallbackValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return fallbackValue;
  }

  const parsed = Number(rawValue);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 59) {
    throw new Error(`Flag ${flag} expects an integer between 0 and 59.`);
  }

  return parsed;
}

function getHourListArgValue(flag) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return [];
  }

  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));

  if (values.length === 0) {
    return [];
  }

  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 23) {
      throw new Error(`Flag ${flag} expects comma-separated hours between 0 and 23.`);
    }
  }

  return [...new Set(values)].sort((left, right) => left - right);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function buildScheduleBlock({ intervalSeconds, scheduleHours, minute }) {
  if (scheduleHours.length > 0) {
    const entries = scheduleHours.map((hour) => [
      '  <dict>',
      '    <key>Hour</key>',
      `    <integer>${hour}</integer>`,
      '    <key>Minute</key>',
      `    <integer>${minute}</integer>`,
      '  </dict>',
    ].join('\n')).join('\n');

    return [
      '  <key>StartCalendarInterval</key>',
      '  <array>',
      entries,
      '  </array>',
    ].join('\n');
  }

  return [
    '  <key>StartInterval</key>',
    `  <integer>${intervalSeconds}</integer>`,
  ].join('\n');
}

function buildPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  intervalSeconds,
  scheduleHours,
  minute,
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
${buildScheduleBlock({ intervalSeconds, scheduleHours, minute })}
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
      'Usage: node scripts/install-mac-sync-watch-schedule.mjs [--interval-seconds 1800] [--hours 6,10,14,18,22 --minute 0] [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.ruv.ruflo.mac-sync-watch.plist and loads it by default.',
      'Schedule is detect-only: it can raise approval-gated sync requests, but it does not auto-pull.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Mac sync watch LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const intervalSeconds = getNumberArgValue('--interval-seconds', 1800);
  const scheduleHours = getHourListArgValue('--hours');
  const minute = getMinuteArgValue('--minute', 0);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'mac-sync-watch.schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'mac-sync-watch.schedule.stderr.log');
  const scriptPath = resolve(projectRoot, 'scripts', 'mac-sync-watch.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  writeFileSync(plistPath, buildPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    intervalSeconds,
    scheduleHours,
    minute,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    scheduleHours.length > 0
      ? `Schedule: ${scheduleHours.map((hour) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).join(', ')} local time.`
      : `Interval: every ${intervalSeconds}s.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
