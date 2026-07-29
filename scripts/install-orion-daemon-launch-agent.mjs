#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.vbj.orion.daemon';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

function resolveGlobalCliScriptPath() {
  let npmRoot = '';
  try {
    npmRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error('Could not resolve the global npm root for the ORION daemon LaunchAgent.');
  }

  const cliScriptPath = resolve(npmRoot, '@claude-flow', 'cli', 'bin', 'cli.js');
  if (!existsSync(cliScriptPath)) {
    throw new Error(
      'Global @claude-flow/cli binary not found. Install it first with `npm install -g @claude-flow/cli@latest`.'
    );
  }

  return cliScriptPath;
}

function buildPlistContent({
  nodePath,
  nodeBinDir,
  cliScriptPath,
  launchWorkingDirectory,
  workspaceRoot,
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
  <string>${launchWorkingDirectory}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${cliScriptPath}</string>
    <string>daemon</string>
    <string>start</string>
    <string>--foreground</string>
    <string>--quiet</string>
    <string>--workspace</string>
    <string>${workspaceRoot}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${nodeBinDir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>CLAUDE_FLOW_DAEMON</key>
    <string>1</string>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;
}

function loadLaunchAgent(plistPath) {
  const launchdTarget = `gui/${process.getuid()}/${PLIST_LABEL}`;

  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded or not present.
  }

  execFileSync('launchctl', ['enable', launchdTarget], { stdio: 'ignore' });
  execFileSync('launchctl', ['load', '-w', plistPath], { stdio: 'ignore' });
}

function disableLaunchAgent(plistPath) {
  const launchdTarget = `gui/${process.getuid()}/${PLIST_LABEL}`;

  try {
    execFileSync('launchctl', ['unload', plistPath], { stdio: 'ignore' });
  } catch {
    // Already unloaded or not present.
  }

  execFileSync('launchctl', ['disable', launchdTarget], { stdio: 'ignore' });
}

function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node scripts/install-orion-daemon-launch-agent.mjs [--enable|--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.daemon.plist and disables it by default.',
      'Use --enable only when autonomous claude-flow workers are explicitly wanted.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('ORION daemon LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const shouldLoad = hasFlag('--enable') && !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(projectRoot, '.claude-flow', 'logs', 'supervisor.out.log');
  const stderrPath = resolve(projectRoot, '.claude-flow', 'logs', 'supervisor.err.log');
  const nodePath = process.execPath;
  const nodeBinDir = dirname(nodePath);
  const cliScriptPath = resolveGlobalCliScriptPath();
  const launchWorkingDirectory = homedir();

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));
  ensureDirectory(config.runtimePaths.logDir);

  writeFileSync(plistPath, buildPlistContent({
    nodePath,
    nodeBinDir,
    cliScriptPath,
    launchWorkingDirectory,
    workspaceRoot: projectRoot,
    stdoutPath,
    stderrPath,
  }), 'utf8');

  if (shouldLoad) {
    loadLaunchAgent(plistPath);
  } else {
    disableLaunchAgent(plistPath);
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'disabled'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
