#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.vbj.orion.video-analytics-scheduler';

function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return process.argv[index + 1] || '';
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
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

function getHourListArgValue(flag, fallbackValue) {
  const rawValue = getArgValue(flag);
  if (!rawValue) {
    return fallbackValue;
  }
  const values = rawValue
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value));
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 23) {
      throw new Error(`Flag ${flag} expects comma-separated hours between 0 and 23.`);
    }
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

function buildPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  scheduleHours,
  minute,
  postDiscord,
}) {
  const entries = scheduleHours.map((hour) => [
    '  <dict>',
    '    <key>Hour</key>',
    `    <integer>${hour}</integer>`,
    '    <key>Minute</key>',
    `    <integer>${minute}</integer>`,
    '  </dict>',
  ].join('\n')).join('\n');
  const programArguments = [
    `    <string>${nodePath}</string>`,
    `    <string>${scriptPath}</string>`,
    ...(postDiscord ? ['    <string>--post-discord</string>'] : []),
  ].join('\n');

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
${programArguments}
  </array>
  <key>StartCalendarInterval</key>
  <array>
${entries}
  </array>
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
      'Usage: node scripts/install-video-analytics-schedule.mjs [--hours 1,5,9,13,17,21 --minute 15] [--no-discord] [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.video-analytics-scheduler.plist and loads it by default.',
      'The scheduled worker captures YouTube analytics snapshots and posts the weekly Discord digest when due.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Video analytics LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const scheduleHours = getHourListArgValue('--hours', [1, 5, 9, 13, 17, 21]);
  const minute = getMinuteArgValue('--minute', 15);
  const shouldLoad = !hasFlag('--no-load');
  const postDiscord = !hasFlag('--no-discord');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'video-analytics.schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'video-analytics.schedule.stderr.log');
  const scriptPath = resolve(projectRoot, 'services', 'product-video-agent', 'scripts', 'run-video-analytics-sweep.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  writeFileSync(plistPath, buildPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    scheduleHours,
    minute,
    postDiscord,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${scheduleHours.map((hour) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`).join(', ')} local time.`,
    `Discord digest posting: ${postDiscord ? 'enabled' : 'disabled'}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
