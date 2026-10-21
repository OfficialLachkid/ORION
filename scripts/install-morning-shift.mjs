#!/usr/bin/env node
// Installs io.vbj.orion.morning-shift (default 07:00) — the shift that
// auto-sends follow-up drafts the night shift queued the previous night.
// Scoped to follow-ups only; fresh outreach drafts still require human
// approval and are intentionally left behind.
//
// Runs BEFORE the 07:15 qualification-schedule fallback by design.
// Sending the drafts the night already created is a sub-minute job;
// the fallback's redraft loop can take several minutes on the
// exceptional morning when 01:30 failed. Draining the follow-up
// backlog first keeps the follow-up SLA tight regardless.
// (Reinstall the fallback at 07:15 via install-night-shift-schedule.mjs
// if it still points at 07:00 from an earlier install.)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const LABEL = 'io.vbj.orion.morning-shift';

function hasFlag(flag) { return process.argv.includes(flag); }

function getNumberArg(flag, fallbackValue, maxValue) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallbackValue;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw new Error(`Flag ${flag} expects an integer between 0 and ${maxValue}.`);
  }
  return parsed;
}

function buildPlist({ nodePath, nodeBinDir, scriptPath, stdoutPath, stderrPath, hour, minute }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
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

function loadAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch { /* not loaded yet */ }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-morning-shift.mjs [--hour 7] [--minute 0] [--no-load]',
      '',
      'Installs io.vbj.orion.morning-shift (default 07:00) to auto-send',
      'follow-up drafts drafted by the previous night shift.',
    ].join('\n') + '\n');
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Morning-shift installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArg('--hour', 7, 23);
  const minute = getNumberArg('--minute', 0, 59);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-morning-shift.mjs');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);
  const logDir = config.runtimePaths.logDir;
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const plistPath = resolve(launchAgentsDir, `${LABEL}.plist`);
  writeFileSync(plistPath, buildPlist({
    nodePath, nodeBinDir, scriptPath,
    stdoutPath: resolve(logDir, 'morning-shift.stdout.log'),
    stderrPath: resolve(logDir, 'morning-shift.stderr.log'),
    hour, minute,
  }), 'utf8');

  if (shouldLoad) loadAgent(plistPath);

  process.stdout.write([
    `Installed ${basename(plistPath)} — ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} daily.`,
    `Scope: lead_follow_up + gmail_send_draft tasks only (outreach drafts untouched).`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
  ].join('\n') + '\n');
}

main();
