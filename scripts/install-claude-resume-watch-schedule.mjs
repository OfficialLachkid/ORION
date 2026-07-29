#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.claude-resume-watch';

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

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function buildPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  intervalSeconds,
  staleMinutes,
  postToDiscord,
  quietIfEmpty,
  heartbeatHours,
}) {
  const args = [
    scriptPath,
    '--resume-paused',
    '--mark-stalled',
    '--launchagent',
  ];
  args.push('--stale-minutes', String(staleMinutes));
  if (postToDiscord) {
    args.push('--post-to-discord');
  }
  if (quietIfEmpty) {
    args.push('--quiet-if-empty');
  }
  if (Number.isFinite(heartbeatHours) && heartbeatHours > 0) {
    args.push('--heartbeat-hours', String(heartbeatHours));
  }
  const argEntries = [nodePath, ...args].map((entry) => `    <string>${entry}</string>`).join('\n');

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
${argEntries}
  </array>
  <key>StartInterval</key>
  <integer>${intervalSeconds}</integer>
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
      'Usage: node scripts/install-claude-resume-watch-schedule.mjs [--interval-seconds 900] [--stale-minutes 30] [--heartbeat-hours 6] [--no-load] [--no-post-to-discord] [--no-quiet-if-empty]',
      '',
      `Writes ~/Library/LaunchAgents/${PLIST_LABEL}.plist and loads it by default.`,
      'By default the LaunchAgent runs every 15 minutes, resumes paused/pre_limit Claude tasks, marks stalled runs as blocked,',
      'posts a compact summary into the #agent-results Discord channel when something was actioned,',
      'and posts a heartbeat card at least every 6 hours so you can see it is still alive.',
    ].join('\n'));
    process.stdout.write('\n');
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('claude-resume-watch LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const intervalSeconds = getNumberArgValue('--interval-seconds', 900);
  const staleMinutes = getNumberArgValue('--stale-minutes', 30);
  const heartbeatHours = getNumberArgValue('--heartbeat-hours', 6);
  const shouldLoad = !hasFlag('--no-load');
  const postToDiscord = !hasFlag('--no-post-to-discord');
  const quietIfEmpty = !hasFlag('--no-quiet-if-empty');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'claude-resume-watch.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'claude-resume-watch.stderr.log');
  const scriptPath = resolve(projectRoot, 'scripts', 'claude-runner-resume.mjs');
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
    staleMinutes,
    postToDiscord,
    quietIfEmpty,
    heartbeatHours,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Interval: every ${intervalSeconds}s.`,
    `Stale-run threshold: ${staleMinutes} minutes.`,
    `Heartbeat interval: every ${heartbeatHours} hours (0 = disabled).`,
    `Post to Discord: ${postToDiscord}.`,
    `Quiet when empty: ${quietIfEmpty}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
  process.stdout.write('\n');
}

main();
