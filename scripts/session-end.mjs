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

const options = parseArgs();

if (options.help) {
  printUsage([
    'Usage: node scripts/session-end.mjs [options]',
    '',
    'Options:',
    '  --cli-package <pkg>           CLI package to invoke. Default: @claude-flow/cli@latest',
    '  --task-id <id>                Optional task ID for post-task hook',
    '  --success <true|false>        Post-task outcome. Default: true',
    '  --agent <name>                Agent label for post-task hook. Default: coder',
    '  --pattern-key <key>           Optional memory key to store before ending',
    '  --pattern-value <value>       Optional memory value to store before ending',
    '  --pattern-namespace <name>    Memory namespace. Default: patterns',
    '  --no-save-state               End session without saving restore state',
  ]);
  process.exit(0);
}

const cliPackage = getStringOption(options, 'cli-package', defaultCliPackage);
const taskId = getStringOption(options, 'task-id');
const success = getBooleanOption(options, 'success', true);
const agent = getStringOption(options, 'agent', 'coder');
const patternKey = getStringOption(options, 'pattern-key');
const patternValue = getStringOption(options, 'pattern-value');
const patternNamespace = getStringOption(options, 'pattern-namespace', 'patterns');
const saveState = getBooleanOption(options, 'save-state', true);

if (patternKey && patternValue) {
  printInfo(`Storing pattern in namespace '${patternNamespace}': ${patternKey}`);
  const memoryResult = runNpx(
    cliPackage,
    ['memory', 'store', '--key', patternKey, '--value', patternValue, '--namespace', patternNamespace],
    { cwd: projectRoot, stdio: 'pipe', allowFailure: true }
  );
  const memoryOutput = [memoryResult.stdout, memoryResult.stderr].filter(Boolean).join('\n').trim();

  if (memoryResult.status === 0) {
    if (memoryOutput) {
      process.stdout.write(`${memoryOutput}\n`);
    }
  } else if (looksLikeMissingMemoryDatabase(memoryOutput)) {
    printWarn('Pattern store skipped because the memory database is not initialized yet.');
    if (memoryOutput) {
      process.stderr.write(`${memoryOutput}\n`);
    }
  } else {
    throw new Error(memoryOutput || 'Ruflo memory store failed.');
  }
}

if (taskId) {
  printInfo(`Recording post-task outcome for ${taskId}.`);
  runNpx(
    cliPackage,
    ['hooks', 'post-task', '--task-id', taskId, '--success', success ? 'true' : 'false', '--agent', agent],
    { cwd: projectRoot }
  );
}

printInfo('Ending Ruflo session.');
const sessionEndArgs = ['hooks', 'session-end'];
if (!saveState) {
  sessionEndArgs.push('--save-state', 'false');
}
runNpx(cliPackage, sessionEndArgs, { cwd: projectRoot });
