#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';

const PLIST_LABEL = 'io.vbj.orion.discord-bot';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function ensureDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    mkdirSync(directoryPath, { recursive: true });
  }
}

// Match the PATH the other ORION LaunchAgents set (leadgen-schedule,
// qualification-schedule, night-shift). Without this, launchd hands the
// bot a bare PATH=/usr/bin:/bin:/usr/sbin:/sbin — /opt/homebrew/bin is
// missing, so subprocesses the bot spawns (notably run-lead-qualification
// → claude -p → Bash "playwright-cli ...") crash with ENOENT. Observed
// 2026-09-26 as "manual /lead-qualification is stuck on first lead" —
// the qualifier's fire-and-forget playwright-cli cleanup crashed the
// whole child process before it could report back.
const LAUNCHAGENT_PATH = '/opt/homebrew/bin:/opt/homebrew/opt/node/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

function buildPlistContent({ nodePath, scriptPath, workingDirectory, stdoutPath, stderrPath }) {
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
    <string>--live</string>
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
  <key>StandardOutPath</key>
  <string>${stdoutPath}</string>
  <key>StandardErrorPath</key>
  <string>${stderrPath}</string>
</dict>
</plist>
`;
}

export { buildPlistContent, LAUNCHAGENT_PATH, PLIST_LABEL };

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
      'Usage: node scripts/install-discord-live-launch-agent.mjs [--no-load]',
      '',
      'Writes ~/Library/LaunchAgents/io.vbj.orion.discord-bot.plist and loads it by default.',
      'The LaunchAgent uses RunAtLoad + KeepAlive so the Discord bot auto-starts and relaunches on exit.',
    ].join('\n'));
    return;
  }

  if (process.platform !== 'darwin') {
    throw new Error('Discord bot LaunchAgent installation is supported only on macOS.');
  }

  const config = loadRuntimeConfig();
  const shouldLoad = !hasFlag('--no-load');

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${PLIST_LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'discord-bot.launchagent.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'discord-bot.launchagent.stderr.log');
  const scriptPath = resolve(projectRoot, 'services', 'discord-bot', 'index.mjs');
  const nodePath = process.execPath;

  ensureDirectory(launchAgentsDir);
  ensureDirectory(dirname(stdoutPath));

  writeFileSync(plistPath, buildPlistContent({
    nodePath,
    scriptPath,
    workingDirectory: projectRoot,
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
