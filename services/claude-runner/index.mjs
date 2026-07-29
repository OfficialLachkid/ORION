#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import { executeClaudeTaskFromPayloadFile } from './src/runner.mjs';

function getArgValue(flag) {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return argv[index + 1] || '';
}

function hasFlag(flag) {
  return argv.includes(flag);
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/claude-runner/index.mjs --task-file <path>',
      '',
      'Runs one persisted O.R.I.O.N. Claude task payload through the local Claude CLI.',
    ].join('\n'));
    return;
  }

  const taskFilePath = getArgValue('--task-file');
  if (!taskFilePath) {
    throw new Error('Missing required flag: --task-file <path>');
  }

  const config = loadRuntimeConfig();
  const result = await executeClaudeTaskFromPayloadFile(taskFilePath, config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
