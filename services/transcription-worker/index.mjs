#!/usr/bin/env node

import { argv } from 'node:process';
import { loadRuntimeConfig, parseJsonFromString, readJsonInput, readStdin } from '../lib/runtime-config.mjs';
import { processTranscriptionRequest } from './src/worker.mjs';

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
    throw new Error('No transcription payload provided. Use --input-file <path> or pipe JSON to stdin.');
  }

  return parseJsonFromString(stdinText);
}

async function main() {
  if (hasFlag('--help')) {
    process.stdout.write([
      'Usage: node services/transcription-worker/index.mjs [--input-file path]',
      '',
      'Reads a voice-note transcription request payload and returns a phase-1 transcript contract.',
    ].join('\n'));
    return;
  }

  const payload = await loadPayload();
  const config = loadRuntimeConfig();
  const result = await processTranscriptionRequest(payload, config);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
