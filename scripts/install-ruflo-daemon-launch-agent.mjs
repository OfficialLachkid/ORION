#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.ruv.ruflo.daemon';

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
    throw new Error('Could not resolve the global npm root for the Ruflo daemon LaunchAgent.');
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
      'Usage: node scripts/install-ruflo-daemon-launch-agent.mjs [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.ruv.ruflo.daemon.plist and loads it by default.',
      'The LaunchAgent uses RunAtLoad + KeepAlive so the Ruflo daemon auto-starts and relaunches on exit.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Ruflo daemon LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const shouldLoad = !hasFlag('--no-load');

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
  }

  process.stdout.write([
    `Installed ${basename(plistPath)}.`,
    `Load state: ${shouldLoad ? 'loaded' : 'written only'}.`,
    `Plist: ${plistPath}`,
    `Stdout: ${stdoutPath}`,
    `Stderr: ${stderrPath}`,
  ].join('\n'));
}

main();
