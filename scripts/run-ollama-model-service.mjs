#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { ensureLocalModelVolumeMounted } from './lib/local-model-volume.mjs';

function findOllamaBinary() {
  return [
    '/opt/homebrew/opt/ollama/bin/ollama',
    '/usr/local/opt/ollama/bin/ollama',
    '/opt/homebrew/bin/ollama',
    '/usr/local/bin/ollama',
  ].find((candidate) => existsSync(candidate)) || '';
}

function main() {
  const storage = loadRuntimeConfig().localModels;
  ensureLocalModelVolumeMounted(storage);
  const ollamaPath = findOllamaBinary();
  if (!ollamaPath) throw new Error('Ollama is not installed.');

  const child = spawn(ollamaPath, ['serve'], {
    env: { ...process.env, OLLAMA_MODELS: storage.providers.ollama.path },
    stdio: 'inherit',
  });
  const forwardSignal = (signal) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', () => forwardSignal('SIGINT'));
  process.on('SIGTERM', () => forwardSignal('SIGTERM'));
  child.once('error', (error) => {
    throw error;
  });
  child.once('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

main();
