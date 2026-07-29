#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig, parseJsonFromString, readJsonInput, readStdin } from '../lib/runtime-config.mjs';
import { normalizeTaskMessage, parseApprovalResponse } from './src/router.mjs';

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

async function loadPayload() {
  const inputFile = getArgValue('--input-file');
  if (inputFile) {
    return readJsonInput(inputFile);
  }

  const stdinText = await readStdin();
  if (!stdinText.trim()) {
    throw new Error('No JSON input provided. Use --input-file <path> or pipe JSON to stdin.');
  }

  return parseJsonFromString(stdinText);
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/task-router/index.mjs [--mode command|approval] [--input-file path]',
      '',
      'Reads a Discord-style event payload from stdin or a JSON file and returns the normalized task or approval decision.',
    ].join('\n'));
    return;
  }

  const payload = await loadPayload();
  const config = loadRuntimeConfig();
  const mode = getArgValue('--mode') || 'command';

  const result = mode === 'approval'
    ? parseApprovalResponse(payload)
    : normalizeTaskMessage(payload, config);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
