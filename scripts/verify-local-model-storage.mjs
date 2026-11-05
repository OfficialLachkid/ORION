#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { inspectLocalModelStorage } from '../services/lib/local-model-storage.mjs';
import { ensureLocalModelVolumeMounted } from './lib/local-model-volume.mjs';

function parseOllamaModels(output) {
  return String(output || '')
    .split(/\r?\n/u)
    .slice(1)
    .map((line) => line.trim().split(/\s+/u)[0])
    .filter(Boolean);
}

function main() {
  const config = loadRuntimeConfig();
  ensureLocalModelVolumeMounted(config.localModels);
  const inspection = inspectLocalModelStorage(config.localModels);
  let installedOllamaModels = [];
  let ollamaError = '';
  try {
    installedOllamaModels = parseOllamaModels(execFileSync('ollama', ['list'], {
      encoding: 'utf8',
    }));
  } catch (error) {
    ollamaError = String(error.message || error);
  }
  const missingOllamaModels = inspection.expectedOllamaModels
    .filter((model) => !installedOllamaModels.includes(model));
  const ready = inspection.ready && !ollamaError && missingOllamaModels.length === 0;
  process.stdout.write(`${JSON.stringify({
    ...inspection,
    ready,
    state: ready ? 'ready' : 'unavailable',
    installedOllamaModels,
    missingOllamaModels,
    ollamaError,
  }, null, 2)}\n`);
  if (!ready) process.exitCode = 1;
}

main();
