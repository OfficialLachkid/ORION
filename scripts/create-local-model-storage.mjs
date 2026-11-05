#!/usr/bin/env node

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import {
  createLocalModelSparseBundle,
  ensureLocalModelVolumeMounted,
} from './lib/local-model-volume.mjs';

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('Local model storage creation is supported only on macOS.');
  }
  const storage = loadRuntimeConfig().localModels;
  const creation = createLocalModelSparseBundle(storage);
  const mount = ensureLocalModelVolumeMounted(storage);
  process.stdout.write(`${JSON.stringify({ creation, mount }, null, 2)}\n`);
}

main();
