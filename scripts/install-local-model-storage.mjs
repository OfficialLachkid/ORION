#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { inspectLocalModelStorage } from '../services/lib/local-model-storage.mjs';
import {
  buildOllamaLaunchAgentPlist,
  ensureModelCompatibilityLinks,
} from './lib/local-model-install.mjs';
import { ensureLocalModelVolumeMounted } from './lib/local-model-volume.mjs';

const LABEL = 'io.vbj.orion.ollama';

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function loadLaunchAgent(plistPath) {
  const domain = `gui/${process.getuid()}`;
  try {
    execFileSync('launchctl', ['bootout', domain, plistPath], { stdio: 'ignore' });
  } catch {
    // Service was not loaded.
  }
  execFileSync('launchctl', ['bootstrap', domain, plistPath], { stdio: 'inherit' });
  execFileSync('launchctl', ['enable', `${domain}/${LABEL}`], { stdio: 'inherit' });
  execFileSync('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`], { stdio: 'inherit' });
}

function stopHomebrewOllama() {
  const brew = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']
    .find((candidate) => existsSync(candidate));
  if (!brew) return;
  try {
    execFileSync(brew, ['services', 'stop', 'ollama'], { stdio: 'inherit' });
  } catch {
    // A missing or already stopped Homebrew service is safe.
  }
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Local model service installation is supported only on macOS.');
  }
  const config = loadRuntimeConfig();
  const storage = config.localModels;
  ensureLocalModelVolumeMounted(storage);
  const inspection = inspectLocalModelStorage(storage);
  if (inspection.missing.length > 0) {
    throw new Error(`T7 model data is incomplete: ${inspection.missing.join(', ')}`);
  }

  const launchAgentsDir = resolve(homedir(), 'Library', 'LaunchAgents');
  const plistPath = resolve(launchAgentsDir, `${LABEL}.plist`);
  const stdoutPath = resolve(config.runtimePaths.logDir, 'ollama.launchagent.stdout.log');
  const stderrPath = resolve(config.runtimePaths.logDir, 'ollama.launchagent.stderr.log');
  const serviceScriptPath = resolve(projectRoot, 'scripts', 'run-ollama-model-service.mjs');
  mkdirSync(launchAgentsDir, { recursive: true });
  mkdirSync(dirname(stdoutPath), { recursive: true });
  writeFileSync(plistPath, buildOllamaLaunchAgentPlist({
    nodePath: process.execPath,
    serviceScriptPath,
    workingDirectory: projectRoot,
    stdoutPath,
    stderrPath,
  }), 'utf8');

  const links = hasFlag('--link-caches')
    ? ensureModelCompatibilityLinks(storage)
    : { created: [], unchanged: [] };
  if (hasFlag('--activate')) {
    stopHomebrewOllama();
    loadLaunchAgent(plistPath);
  }

  process.stdout.write(`${JSON.stringify({
    status: 'installed',
    plistPath,
    modelRoot: storage.root,
    activated: hasFlag('--activate'),
    links,
  }, null, 2)}\n`);
}

main();
