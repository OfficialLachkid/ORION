#!/usr/bin/env node

import {
  defaultCliPackage,
  getBooleanOption,
  getStringOption,
  looksLikeMissingMemoryDatabase,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
  runNpx,
} from './lib/ruflo-wrapper-utils.mjs';
import {
  ensureCheckpointDirectory,
  formatCheckpointSummary,
  parseListOption,
  writeCheckpointFile,
} from './lib/session-checkpoint-utils.mjs';

const options = parseArgs();

if (options.help) {
  printUsage([
    'Usage: node scripts/session-checkpoint.mjs [options]',
    '',
    'Options:',
    '  --session-id <id>            Session identifier. Default: latest',
    '  --task-id <id>               Optional task identifier',
    '  --status <state>             Checkpoint status. Default: active',
    '  --summary <text>             Short summary of current work',
    '  --next-step <text>           The immediate next action after resume',
    '  --blockers <a,b,c>           Comma-separated blockers',
    '  --files <a,b,c>              Comma-separated relevant files',
    '  --base-path <path>           Relative checkpoint storage path. Default: data/session-checkpoints',
    '  --cli-package <pkg>          CLI package to invoke. Default: @claude-flow/cli@latest',
    '  --memory-namespace <name>    Namespace for optional checkpoint memory store. Default: results',
    '  --memory-key <key>           Explicit memory key. Default: checkpoint-<session-id>-latest',
    '  --skip-memory-store          Write only the local checkpoint files',
  ]);
  process.exit(0);
}

const sessionId = getStringOption(options, 'session-id', 'latest');
const taskId = getStringOption(options, 'task-id');
const status = getStringOption(options, 'status', 'active');
const summary = getStringOption(options, 'summary', '');
const nextStep = getStringOption(options, 'next-step', '');
const blockers = parseListOption(getStringOption(options, 'blockers', ''));
const files = parseListOption(getStringOption(options, 'files', ''));
const basePath = getStringOption(options, 'base-path', 'data/session-checkpoints');
const cliPackage = getStringOption(options, 'cli-package', defaultCliPackage);
const memoryNamespace = getStringOption(options, 'memory-namespace', 'results');
const memoryKey = getStringOption(options, 'memory-key', `checkpoint-${sessionId}-latest`);
const skipMemoryStore = getBooleanOption(options, 'skip-memory-store', false);

ensureCheckpointDirectory(basePath);

const checkpoint = {
  sessionId,
  taskId,
  status,
  summary,
  nextStep,
  blockers,
  files,
  namespace: memoryNamespace,
  memoryKey,
  updatedAtUtc: new Date().toISOString(),
};

const { latestPath, historyPath, payload } = writeCheckpointFile(checkpoint, { basePath });

printInfo(`Checkpoint written to ${latestPath}`);
printInfo(`Checkpoint history written to ${historyPath}`);
for (const line of formatCheckpointSummary(payload)) {
  process.stdout.write(`${line}\n`);
}

if (!skipMemoryStore) {
  const serializedCheckpoint = JSON.stringify(payload);
  const memoryResult = runNpx(
    cliPackage,
    ['memory', 'store', '--key', memoryKey, '--value', serializedCheckpoint, '--namespace', memoryNamespace],
    { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
  );
  const memoryOutput = [memoryResult.stdout, memoryResult.stderr].filter(Boolean).join('\n').trim();

  if (memoryResult.status === 0) {
    if (memoryOutput) {
      process.stdout.write(`${memoryOutput}\n`);
    }
  } else if (looksLikeMissingMemoryDatabase(memoryOutput)) {
    printWarn('Checkpoint memory store skipped because the memory database is not initialized yet.');
    if (memoryOutput) {
      process.stderr.write(`${memoryOutput}\n`);
    }
  } else {
    throw new Error(memoryOutput || 'Checkpoint memory store failed.');
  }
}
