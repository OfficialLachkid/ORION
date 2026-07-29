#!/usr/bin/env node

import {
  defaultCliPackage,
  ensureDaemonRunning,
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
  runNpx,
} from './lib/ruflo-wrapper-utils.mjs';
import { formatCheckpointSummary, readLatestCheckpoint } from './lib/session-checkpoint-utils.mjs';
import { syncVaultBridge } from './sync-vault.mjs';

const options = parseArgs();

if (options.help) {
  printUsage([
    'Usage: node scripts/session-restore.mjs [options]',
    '',
    'Options:',
    '  --session-id <id>       Session to restore. Default: latest',
    '  --cli-package <pkg>     CLI package to invoke. Default: @claude-flow/cli@latest',
    '  --no-restore-agents     Skip restoring agents',
    '  --no-restore-tasks      Skip restoring tasks',
    '  --skip-daemon           Do not ensure the daemon is running after restore',
    '  --skip-vault-sync       Do not export bridge notes before restoring',
  ]);
  process.exit(0);
}

const cliPackage = getStringOption(options, 'cli-package', defaultCliPackage);
const sessionId = getStringOption(options, 'session-id', 'latest');
const restoreAgents = getBooleanOption(options, 'restore-agents', true);
const restoreTasks = getBooleanOption(options, 'restore-tasks', true);
const skipDaemon = getBooleanOption(options, 'skip-daemon', false);
const skipVaultSync = getBooleanOption(options, 'skip-vault-sync', false);

if (!skipVaultSync) {
  printInfo('Syncing bridge notes into the runtime export surface.');
  syncVaultBridge();
}

printInfo(`Restoring session '${sessionId}' with ${cliPackage}.`);
runNpx(
  cliPackage,
  [
    'hooks',
    'session-restore',
    '--session-id',
    sessionId,
    '--restore-agents',
    restoreAgents ? 'true' : 'false',
    '--restore-tasks',
    restoreTasks ? 'true' : 'false',
  ],
  { cwd: projectRoot }
);

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
