#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { localDateInTimeZone } from './lib/ecommerce-discovery.mjs';

export const ECOMMERCE_DISCOVERY_LABEL = 'io.vbj.orion.ecommerce-discovery';
export const ECOMMERCE_DISCOVERY_WEEKDAYS = Object.freeze([2, 4, 6]);
export const ECOMMERCE_DISCOVERY_DEFAULT_HOUR = 0;
export const ECOMMERCE_DISCOVERY_DEFAULT_MINUTE = 15;

function xml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? '' : String(process.argv[index + 1] || '').trim();
}

function numericArg(flag, fallback, maximum) {
  const raw = argValue(flag);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) {
    throw new Error(`${flag} expects an integer between 0 and ${maximum}.`);
  }
  return parsed;
}

function addCalendarDays(dateOnly, days) {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function defaultPilotEnd(now = new Date()) {
  return addCalendarDays(localDateInTimeZone(now), 28);
}

export function buildEcommerceDiscoveryPlist({
  nodePath,
  nodeBinDir,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
  pilotEnd,
  hour = ECOMMERCE_DISCOVERY_DEFAULT_HOUR,
  minute = ECOMMERCE_DISCOVERY_DEFAULT_MINUTE,
  weekdays = ECOMMERCE_DISCOVERY_WEEKDAYS,
}) {
  const intervals = weekdays.map((weekday) => [
    '  <dict>',
    '    <key>Weekday</key>',
    `    <integer>${weekday}</integer>`,
    '    <key>Hour</key>',
    `    <integer>${hour}</integer>`,
    '    <key>Minute</key>',
    `    <integer>${minute}</integer>`,
    '  </dict>',
  ].join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ECOMMERCE_DISCOVERY_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${xml(workingDirectory)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(nodePath)}</string>
    <string>${xml(scriptPath)}</string>
    <string>--pilot-end</string>
    <string>${xml(pilotEnd)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xml(`${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <array>
${intervals}
  </array>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(stderrPath)}</string>
</dict>
</plist>
`;
}

function loadAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // The job may not be loaded yet.
  }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function uninstallAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded.
  }
  if (existsSync(plistPath)) unlinkSync(plistPath);
}

export function installEcommerceDiscoverySchedule(options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'darwin') throw new Error('Ecommerce discovery scheduling is supported only on macOS.');
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig();
  const homeDirectory = options.homeDirectory || homedir();
  const launchAgentsDir = resolve(homeDirectory, 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${ECOMMERCE_DISCOVERY_LABEL}.plist`);
  if (options.uninstall) {
    uninstallAgent(plistPath);
    return { plistPath, uninstalled: true };
  }
  const hour = options.hour ?? ECOMMERCE_DISCOVERY_DEFAULT_HOUR;
  const minute = options.minute ?? ECOMMERCE_DISCOVERY_DEFAULT_MINUTE;
  const pilotEnd = options.pilotEnd || defaultPilotEnd(options.now);
  const nodePath = options.nodePath || process.execPath;
  const scriptPath = resolve(projectRoot, 'scripts', 'run-ecommerce-discovery.mjs');
  const stdoutPath = resolve(runtimeConfig.runtimePaths.logDir, 'ecommerce-discovery.stdout.log');
  const stderrPath = resolve(runtimeConfig.runtimePaths.logDir, 'ecommerce-discovery.stderr.log');
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(dirname(stdoutPath), { recursive: true });
  writeFileSync(plistPath, buildEcommerceDiscoveryPlist({
    nodePath,
    nodeBinDir: dirname(nodePath),
    scriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
    pilotEnd,
    hour,
    minute,
  }), 'utf8');
  if (options.shouldLoad !== false) loadAgent(plistPath);
  return { plistPath, stdoutPath, stderrPath, pilotEnd, hour, minute, uninstalled: false };
}

function main() {
  if (process.argv.includes('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-ecommerce-discovery-schedule.mjs [--hour 0] [--minute 15] [--pilot-end YYYY-MM-DD] [--no-load]',
      '       node scripts/install-ecommerce-discovery-schedule.mjs --uninstall',
      '',
      'Installs a Monday/Wednesday/Friday launchd pilot. The default 00:15 slot',
      'finishes by 00:45, before ORION analytics at 01:00 and night shift at 01:30.',
    ].join('\n') + '\n');
    return;
  }
  const result = installEcommerceDiscoverySchedule({
    hour: numericArg('--hour', ECOMMERCE_DISCOVERY_DEFAULT_HOUR, 23),
    minute: numericArg('--minute', ECOMMERCE_DISCOVERY_DEFAULT_MINUTE, 59),
    pilotEnd: argValue('--pilot-end'),
    shouldLoad: !process.argv.includes('--no-load'),
    uninstall: process.argv.includes('--uninstall'),
  });
  if (result.uninstalled) {
    process.stdout.write(`Uninstalled ${basename(result.plistPath)}.\n`);
    return;
  }
  process.stdout.write([
    `Installed ${basename(result.plistPath)}.`,
    `Schedule: Monday/Wednesday/Friday at ${String(result.hour).padStart(2, '0')}:${String(result.minute).padStart(2, '0')} Europe/Amsterdam local time.`,
    `Pilot stops running after ${result.pilotEnd}.`,
    `Load state: ${process.argv.includes('--no-load') ? 'written only' : 'loaded'}.`,
    `Stdout: ${result.stdoutPath}`,
    `Stderr: ${result.stderrPath}`,
  ].join('\n') + '\n');
}

const isMainModule = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isMainModule) main();
