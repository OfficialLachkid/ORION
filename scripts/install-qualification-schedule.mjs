#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const DEFAULT_HOUR = 7;
const DEFAULT_MINUTE = 0;
const DEFAULT_LIMIT = 10; // conservative — this spends real Claude usage, not free like leadgen search
const PLIST_LABEL = 'io.ruv.ruflo.qualification-schedule';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
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

function buildPlistContent({ nodePath, nodeBinDir, scriptPath, workingDirectory, stdoutPath, stderrPath, hour, minute, limit }) {
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
    <string>--limit</string>
    <string>${limit}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
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

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-qualification-schedule.mjs [--hour 7] [--minute 0] [--limit 10] [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.ruv.ruflo.qualification-schedule.plist and loads it by default.',
      'Each run qualifies the oldest N leads with status=new via Claude (claude -p), drafts',
      'Gmail outreach for fits with an email, and posts a summary to #sales-agent.',
      '',
      'This spends real Claude Code usage (not free like the leadgen search/extraction sweep) —',
      '--limit defaults conservatively to 10/day. Raise it once the usage-cost trend is known.',
      'Schedule uses macOS local time.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Qualification schedule LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArgValue('--hour', DEFAULT_HOUR, 23);
  const minute = getNumberArgValue('--minute', DEFAULT_MINUTE, 59);
  const limit = getNumberArgValue('--limit', DEFAULT_LIMIT, 10);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'qualification-schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'qualification-schedule.stderr.log');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  const plistContent = buildPlistContent({
    nodePath,
    nodeBinDir,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    hour,
    minute,
    limit,
  });

  writeFileSync(plistPath, plistContent, 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} local time, once daily, qualifying up to ${limit} lead(s).`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
