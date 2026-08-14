#!/usr/bin/env node
// Installs the evening lead-qualification schedule — a second qualification
// pass per day, distinct from the 01:30 night-shift primary and the 07:00
// fallback that already exist (install-night-shift-schedule.mjs).
//
// After this runs:
//   io.vbj.orion.evening-qualification  19:00 → run-lead-qualification.mjs --limit N
//
// Why call run-lead-qualification.mjs directly rather than run-night-shift.mjs:
// the night-shift script also runs draft reconcile, follow-ups, reply
// detection, video queue maintenance, review backlog replenishment, and the
// full digest — those either don't need to run twice a day (reconcile/reply
// are cheap enough that a second daily pass is fine but not useful) or
// actively shouldn't (replenishment generates NEW videos, running it twice
// could over-fill the review queue). Qualification is the ONLY step the
// operator explicitly asked to double up on, so call it standalone.
//
// The live-progress card + rich summary post live inside
// run-lead-qualification.mjs itself, so the 19:00 run posts its own progress
// + summary to #lead-qualification-agent just like the 01:30 primary does.
//
// The 01:30 primary's rate-limit-marker failsafe (skip marker → 07:00
// fallback retries) is NOT invoked here — an evening rate-limit doesn't
// arm any short-term retry. That's acceptable: leads that error stay
// status='new', so the next day's 01:30 primary picks them up.
//
// Fully reversible: `launchctl unload ~/Library/LaunchAgents/io.vbj.orion.evening-qualification.plist`

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const EVENING_LABEL = 'io.vbj.orion.evening-qualification';
// Kept in sync with install-night-shift-schedule.mjs DEFAULT_LIMIT so both
// scheduled qualification slots default to the same volume; both can still
// be overridden with --limit.
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;
const DEFAULT_HOUR = 19;
const DEFAULT_MINUTE = 0;

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function getNumberArg(flag, fallbackValue, minValue, maxValue) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallbackValue;
  const parsed = Number(process.argv[index + 1]);
  if (!Number.isInteger(parsed) || parsed < minValue || parsed > maxValue) {
    throw new Error(`Flag ${flag} expects an integer between ${minValue} and ${maxValue}.`);
  }
  return parsed;
}

export function buildEveningQualificationPlistContent({
  label = EVENING_LABEL,
  nodePath,
  nodeBinDir,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  hour,
  minute,
  limit,
}) {
  const argLines = [
    `    <string>${nodePath}</string>`,
    `    <string>${scriptPath}</string>`,
    `    <string>--limit</string>`,
    `    <string>${limit}</string>`,
  ].join('\n');
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
    // Not loaded yet.
  }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-evening-qualification-schedule.mjs [--hour 19] [--minute 0] [--limit 30] [--no-load]',
      '',
      'Installs io.vbj.orion.evening-qualification (default 19:00) — a second',
      'daily qualification pass in addition to the 01:30 night-shift primary and',
      'the 07:00 fallback. Runs run-lead-qualification.mjs directly, so it does',
      'NOT trigger draft reconcile / follow-ups / video maintenance (those still',
      'only run once a day, in the 01:30 night-shift).',
    ].join('\n') + '\n');
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Evening-qualification schedule installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const hour = getNumberArg('--hour', DEFAULT_HOUR, 0, 23);
  const minute = getNumberArg('--minute', DEFAULT_MINUTE, 0, 59);
  const limit = getNumberArg('--limit', DEFAULT_LIMIT, 1, MAX_LIMIT);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const scriptPath = resolve(projectRoot, 'scripts', 'run-lead-qualification.mjs');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);
  const logDir = config.runtimePaths.logDir;
  if (!existsSync(launchAgentsDir)) mkdirSync(launchAgentsDir, { recursive: true });
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  const plistPath = resolve(launchAgentsDir, `${EVENING_LABEL}.plist`);
  writeFileSync(plistPath, buildEveningQualificationPlistContent({
    nodePath,
    nodeBinDir,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath: resolve(logDir, 'evening-qualification.stdout.log'),
    stderrPath: resolve(logDir, 'evening-qualification.stderr.log'),
    hour,
    minute,
    limit,
  }), 'utf8');

  if (shouldLoad) {
    loadAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)} — ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} daily, qualify up to ${limit}.`,
    `Runs run-lead-qualification.mjs directly (no reconcile / follow-ups / video maintenance).`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
  ].join('\n') + '\n');
}

const IS_MAIN_MODULE = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (IS_MAIN_MODULE) {
  main();
}
