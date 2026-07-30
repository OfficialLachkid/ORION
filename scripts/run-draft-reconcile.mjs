#!/usr/bin/env node

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { reconcileDrafts } from './lib/draft-reconciler.mjs';

async function main() {
  const result = await reconcileDrafts(loadRuntimeConfig());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Draft reconciliation failed: ${error.message}\n`);
  process.exitCode = 1;
});
