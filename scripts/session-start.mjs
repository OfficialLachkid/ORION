#!/usr/bin/env node

import {
  defaultCliPackage,
  ensureDaemonRunning,
  getBooleanOption,
  getStringOption,
  looksLikeMissingMemoryDatabase,
  looksLikeMissingSession,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
  runNpx,
} from './lib/ruflo-wrapper-utils.mjs';
import { formatCheckpointSummary, readLatestCheckpoint } from './lib/session-checkpoint-utils.mjs';
import { syncVaultBridge } from './sync-vault.mjs';

const options = parseArgs();

if (options.help) {
  printUsage([
    'Usage: node scripts/session-start.mjs [options]',
    '',
    'Options:',
    '  --session-id <id>              Session to restore. Default: latest',
    '  --cli-package <pkg>            CLI package to invoke. Default: @claude-flow/cli@latest',
    '  --query <text>                 Optional memory search query',
    '  --namespace <name>             Memory namespace for query. Default: patterns',
    '  --pre-task-description <text>  Optional pre-task registration text',
    '  --skip-daemon                  Do not ensure the daemon is running',
    '  --skip-vault-sync              Do not export bridge notes before session work',
    '  --allow-missing-session        Continue if no previous session is available. Default: true',
  ]);
  process.exit(0);
}

const cliPackage = getStringOption(options, 'cli-package', defaultCliPackage);
const sessionId = getStringOption(options, 'session-id', 'latest');
const query = getStringOption(options, 'query');
const namespace = getStringOption(options, 'namespace', 'patterns');
const preTaskDescription = getStringOption(options, 'pre-task-description');
const skipDaemon = getBooleanOption(options, 'skip-daemon', false);
const skipVaultSync = getBooleanOption(options, 'skip-vault-sync', false);
const allowMissingSession = getBooleanOption(options, 'allow-missing-session', true);

if (!skipVaultSync) {
  printInfo('Syncing bridge notes into the runtime export surface.');
  syncVaultBridge();
}

printInfo(`Starting session flow with ${cliPackage}.`);

const restoreResult = runNpx(
  cliPackage,
  [
    'hooks',
    'session-restore',
    '--session-id',
    sessionId,
    '--restore-agents',
    'true',
    '--restore-tasks',
    'true',
  ],
  { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
);

const restoreOutput = [restoreResult.stdout, restoreResult.stderr]
  .filter(Boolean)
  .join('\n')
  .trim();

if (restoreResult.status === 0) {
  if (restoreOutput) {
    process.stdout.write(`${restoreOutput}\n`);
  }
} else if (allowMissingSession && looksLikeMissingSession(restoreOutput)) {
  printWarn(`No prior session could be restored for '${sessionId}'. Continuing with a fresh runtime context.`);
  if (restoreOutput) {
    process.stderr.write(`${restoreOutput}\n`);
  }
} else {
  throw new Error(restoreOutput || `Session restore failed for '${sessionId}'.`);
}

if (!skipDaemon) {
  ensureDaemonRunning(cliPackage);
}

const latestCheckpoint = readLatestCheckpoint(sessionId);
if (latestCheckpoint) {
  printInfo(`Latest checkpoint found for '${sessionId}'.`);
  for (const line of formatCheckpointSummary(latestCheckpoint)) {
    process.stdout.write(`${line}\n`);
  }
}

if (query) {
  printInfo(`Searching memory namespace '${namespace}' with query: ${query}`);
  const memoryResult = runNpx(
    cliPackage,
    ['memory', 'search', '--query', query, '--namespace', namespace],
    { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
  );
  const memoryOutput = [memoryResult.stdout, memoryResult.stderr].filter(Boolean).join('\n').trim();

  if (memoryResult.status === 0) {
    if (memoryOutput) {
      process.stdout.write(`${memoryOutput}\n`);
    }
  } else if (looksLikeMissingMemoryDatabase(memoryOutput)) {
    printWarn('Memory search skipped because the memory database is not initialized yet.');
    if (memoryOutput) {
      process.stderr.write(`${memoryOutput}\n`);
    }
  } else {
    throw new Error(memoryOutput || 'Ruflo memory search failed.');
  }
}

if (preTaskDescription) {
  printInfo('Recording pre-task description.');
  runNpx(
    cliPackage,
    ['hooks', 'pre-task', '--description', preTaskDescription],
    { cwd: projectRoot }
  );
}
