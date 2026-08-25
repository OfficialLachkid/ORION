#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const DEFAULT_HOUR = 7;
const DEFAULT_MINUTE = 0;
const DEFAULT_TIMES = 2;
const MAX_TIMES = 10;
const PLIST_LABEL = 'io.vbj.orion.leadgen-schedule';

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

export function buildLeadgenPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  hour,
  minute,
  times = DEFAULT_TIMES,
}) {
  const normalizedTimes = Number.isInteger(times) && times > 0 ? times : DEFAULT_TIMES;
  const argLines = [
    `    <string>${nodePath}</string>`,
    `    <string>${scriptPath}</string>`,
    ...(normalizedTimes > 1
      ? [`    <string>--times</string>`, `    <string>${normalizedTimes}</string>`]
      : []),
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
${argLines}
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
      'Usage: node scripts/install-leadgen-schedule.mjs [--hour 7] [--minute 0] [--times 2] [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.leadgen-schedule.plist and loads it by default.',
      'Each run rotates to the next niche in scripts/run-scheduled-leadgen.mjs and searches',
      'the Dutch market for candidate leads, saving results to the Supabase leads table.',
      'Schedule uses macOS local time.',
      '',
      '--times N chains N sequential sweeps in one launchd fire. Sweep 2 re-reads',
      'rotation-state.json so it lands on the NEXT set of cities (not the same ones).',
      'Default is 2 to use the quiet-machine morning window more efficiently.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Leadgen schedule LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArgValue('--hour', DEFAULT_HOUR, 23);
  const minute = getNumberArgValue('--minute', DEFAULT_MINUTE, 59);
  const times = getNumberArgValue('--times', DEFAULT_TIMES, MAX_TIMES);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'leadgen-schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'leadgen-schedule.stderr.log');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-scheduled-leadgen.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  const plistContent = buildLeadgenPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    hour,
    minute,
    times,
  });

  writeFileSync(plistPath, plistContent, 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} local time, ${times === 1 ? 'one sweep' : `${times} sweeps back-to-back`} per day.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

const IS_MAIN_MODULE = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (IS_MAIN_MODULE) {
  main();
}
