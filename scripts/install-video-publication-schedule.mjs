#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { loadPublicationChannelProfiles } from '../services/product-video-agent/src/publication-channels.mjs';

export const PLIST_LABEL = 'io.vbj.orion.video-publication-scheduler';
export const RECONCILE_PLIST_LABEL = 'io.vbj.orion.video-publication-reconciler';
export const DEFAULT_SCHEDULE_MINUTE = 0;
export const DEFAULT_RECONCILE_DELAY_MINUTES = 5;

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

function getHourListArgValue(flag, fallbackValue = []) {
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

function normalizeScheduleEntry(entry = {}) {
  const hour = Number(entry.hour);
  const minute = Number(entry.minute);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function sortAndDedupeScheduleEntries(entries = []) {
  const byTime = new Map();
  for (const entry of entries) {
    const normalized = normalizeScheduleEntry(entry);
    if (!normalized) continue;
    byTime.set(`${normalized.hour}:${normalized.minute}`, normalized);
  }
  return [...byTime.values()].sort((left, right) => (
    (left.hour * 60 + left.minute) - (right.hour * 60 + right.minute)
  ));
}

export function collectActivePublicationScheduleEntries(profiles = []) {
  return sortAndDedupeScheduleEntries(
    profiles
      .filter((profile) => profile.status === 'active')
      .flatMap((profile) => profile.schedule_slots || []),
  );
}

export function offsetScheduleEntries(entries = [], offsetMinutes = DEFAULT_RECONCILE_DELAY_MINUTES) {
  const normalizedOffset = Number(offsetMinutes);
  if (!Number.isInteger(normalizedOffset) || normalizedOffset < 0) {
    throw new Error('Reconciliation delay must be a non-negative integer.');
  }
  return sortAndDedupeScheduleEntries(entries.map(({ hour, minute }) => {
    const minutesAfterMidnight = ((hour * 60 + minute + normalizedOffset) % 1_440 + 1_440) % 1_440;
    return {
      hour: Math.floor(minutesAfterMidnight / 60),
      minute: minutesAfterMidnight % 60,
    };
  }));
}

function formatScheduleEntries(entries = []) {
  return entries.map(({ hour, minute }) => (
    `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  )).join(', ');
}

export function buildPlistContent({
  label = PLIST_LABEL,
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  scheduleEntries,
  reconcileOnly = false,
}) {
  const entries = scheduleEntries.map(({ hour, minute }) => [
    '  <dict>',
    '    <key>Hour</key>',
    `    <integer>${hour}</integer>`,
    '    <key>Minute</key>',
    `    <integer>${minute}</integer>`,
    '  </dict>',
  ].join('\n')).join('\n');

  const extraArguments = reconcileOnly
    ? '    <string>--reconcile-only</string>\n'
    : '';

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
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
${extraArguments}  </array>
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

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-video-publication-schedule.mjs [--channels <path>] [--reconcile-delay-minutes 5] [--no-load]',
      '',
      'Writes and loads the publication scheduler plus a lightweight reconciliation LaunchAgent.',
      'Publication times come from active channel schedule_slots; reconciliation runs five minutes later.',
      'Use --hours and --minute only when an explicit temporary schedule override is required.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Video publication LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const channelsPath = getArgValue('--channels')
    || 'services/product-video-agent/publication-channels.example.json';
  const configuredProfiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const overrideHours = getHourListArgValue('--hours');
  const scheduleEntries = overrideHours.length > 0
    ? overrideHours.map((hour) => ({
      hour,
      minute: getMinuteArgValue('--minute', DEFAULT_SCHEDULE_MINUTE),
    }))
    : collectActivePublicationScheduleEntries(configuredProfiles);
  if (scheduleEntries.length === 0) {
    throw new Error(`No active publication schedule slots were found in ${channelsPath}.`);
  }
  const reconcileDelayMinutes = getMinuteArgValue(
    '--reconcile-delay-minutes',
    DEFAULT_RECONCILE_DELAY_MINUTES,
  );
  const reconcileScheduleEntries = offsetScheduleEntries(scheduleEntries, reconcileDelayMinutes);
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const reconcilePlistPath = resolve(launchAgentsDir, `${RECONCILE_PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'video-publication.schedule.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'video-publication.schedule.stderr.log');
  const reconcileStdoutPath = resolve(config.runtimePaths.logDir, 'video-publication.reconcile.stdout.log');
  const reconcileStderrPath = resolve(config.runtimePaths.logDir, 'video-publication.reconcile.stderr.log');
  const scriptPath = resolve(projectRoot, 'services', 'product-video-agent', 'scripts', 'run-video-publication-scheduler.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  writeFileSync(plistPath, buildPlistContent({
    label: PLIST_LABEL,
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    scheduleEntries,
  }), 'utf8');
  writeFileSync(reconcilePlistPath, buildPlistContent({
    label: RECONCILE_PLIST_LABEL,
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath: reconcileStdoutPath,
    stderrPath: reconcileStderrPath,
    scheduleEntries: reconcileScheduleEntries,
    reconcileOnly: true,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
    loadLaunchAgent(reconcilePlistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Schedule: ${formatScheduleEntries(scheduleEntries)} local time.`,
    `Reconciliation (+${reconcileDelayMinutes}m): ${formatScheduleEntries(reconcileScheduleEntries)} local time.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Reconciliation plist: ${reconcilePlistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
    `Reconciliation stdout: ${reconcileStdoutPath}`,
    `Reconciliation stderr: ${reconcileStderrPath}`,
  ].join('\n'));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
