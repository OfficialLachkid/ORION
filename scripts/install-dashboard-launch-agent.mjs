#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.vbj.orion.dashboard';
const LAUNCHAGENT_PATH = '/opt/homebrew/bin:/opt/homebrew/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) mkdirSync(directoryPath, { recursive: true });
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildDashboardPlistContent({
  nodePath,
  scriptPath,
  workingDirectory,
  stdoutPath,
  stderrPath,
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(nodePath)}</string>
    <string>${escapeXml(scriptPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${LAUNCHAGENT_PATH}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${escapeXml(stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`;
}

function loadLaunchAgent(plistPath) {
  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // The dashboard was not loaded yet.
  }
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-dashboard-launch-agent.mjs [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.dashboard.plist and loads it by default.',
      'The ignored config/dashboard/.env must already contain the dashboard credentials.',
    ].join('\n'));
    return;
  }
  if (process.platform !== 'darwin') {
    throw new Error('Dashboard LaunchAgent installation is supported only on macOS.');
  }

  const envPath = resolve(projectRoot, 'config', 'dashboard', '.env');
  if (!existsSync(envPath)) {
    throw new Error('Dashboard configuration is missing. Run `npm run dashboard:provision-admin` first.');
  }

  const config = loadRuntimeConfig();
  const shouldLoad = !hasFlag('--no-load');
  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'dashboard.launchagent.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'dashboard.launchagent.stderr.log');

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));
  writeFileSync(plistPath, buildDashboardPlistContent({
    nodePath: process.execPath,
    scriptPath: resolve(projectRoot, 'services', 'dashboard', 'index.mjs'),
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
  }), 'utf8');

  if (shouldLoad) loadLaunchAgent(plistPath);
  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
