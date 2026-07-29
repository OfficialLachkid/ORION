#!/usr/bin/env node
// Installs the durable night-shift schedule and reconfigures the old
// qualification schedule into the 07:00 fallback.
//
// After this runs:
//   io.ruv.ruflo.night-shift          01:30 → run-night-shift.mjs (primary)
//   io.ruv.ruflo.qualification-schedule 07:00 → run-night-shift.mjs --fallback
//     (no-op if the 01:30 run already succeeded; recovers it if not)
//
// The 07:00 LEADGEN sweep (io.ruv.ruflo.leadgen-schedule) is left untouched —
// leadgen is tokenless (local Ollama) and has no reason to move; and at 01:30
// leadgen is not running, so the screenshot-heavy qualification has the
// machine to itself instead of overlapping the sweep the way 07:00 did.
//
// Fully reversible: `node scripts/install-qualification-schedule.mjs` restores
// the original standalone 07:00 qualification job, and
// `launchctl unload ~/Library/LaunchAgents/io.ruv.ruflo.night-shift.plist`
// removes the night shift.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const NIGHT_SHIFT_LABEL = 'io.ruv.ruflo.night-shift';
const FALLBACK_LABEL = 'io.ruv.ruflo.qualification-schedule';
const DEFAULT_LIMIT = 10;

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getNumberArg(flag, fallbackValue, maxValue) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallbackValue;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maxValue) {
    throw new Error(`Flag ${flag} expects an integer between 0 and ${maxValue}.`);
  }
  return parsed;
}

function buildPlist({ label, nodePath, nodeBinDir, scriptPath, extraArgs, workingDirectory, stdoutPath, stderrPath, hour, minute }) {
  const argLines = [`    <string>${nodePath}</string>`, `    <string>${scriptPath}</string>`, ...extraArgs.map((a) => `    <string>${a}</string>`)].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>
  <key>ProgramArguments</key>
  <array>
${argLines}
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
  } catch {
    // not loaded yet
  }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-night-shift-schedule.mjs [--hour 1] [--minute 30] [--limit 10] [--no-load]',
      '',
      'Installs io.ruv.ruflo.night-shift (default 01:30) and reconfigures',
      'io.ruv.ruflo.qualification-schedule (07:00) as its rate-limit fallback.',
    ].join('\n') + '\n');
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Night-shift schedule installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArg('--hour', 1, 23);
  const minute = getNumberArg('--minute', 30, 59);
  const limit = getNumberArg('--limit', DEFAULT_LIMIT, 25);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-night-shift.mjs');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);
  const logDir = config.runtimePaths.logDir;
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  // Primary night-shift job (01:30).
  const nightPlistPath = resolve(launchAgentsDir, `${NIGHT_SHIFT_LABEL}.plist`);
  writeFileSync(nightPlistPath, buildPlist({
    label: NIGHT_SHIFT_LABEL,
    nodePath, nodeBinDir, scriptPath,
    extraArgs: ['--limit', String(limit)],
    workingDirectory: projectRoot,
    stdoutPath: resolve(logDir, 'night-shift.stdout.log'),
    stderrPath: resolve(logDir, 'night-shift.stderr.log'),
    hour, minute,
  }), 'utf8');

  // 07:00 fallback (reuses the existing qualification-schedule label, now
  // pointed at the night-shift script with --fallback).
  const fallbackPlistPath = resolve(launchAgentsDir, `${FALLBACK_LABEL}.plist`);
  writeFileSync(fallbackPlistPath, buildPlist({
    label: FALLBACK_LABEL,
    nodePath, nodeBinDir, scriptPath,
    extraArgs: ['--fallback', '--limit', String(limit)],
    workingDirectory: projectRoot,
    stdoutPath: resolve(logDir, 'qualification-schedule.stdout.log'),
    stderrPath: resolve(logDir, 'qualification-schedule.stderr.log'),
    hour: 7, minute: 0,
  }), 'utf8');

  if (shouldLoad) {
    loadAgent(nightPlistPath);
    loadAgent(fallbackPlistPath);
  }

  process.stdout.write([
    `Installed ${basename(nightPlistPath)} — ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} nightly, qualify up to ${limit}.`,
    `Reconfigured ${basename(fallbackPlistPath)} — 07:00 fallback (no-op if the night shift already ran).`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Leadgen sweep (io.ruv.ruflo.leadgen-schedule) left unchanged at 07:00.`,
  ].join('\n') + '\n');
}

main();
