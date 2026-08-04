#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const currentScriptDirectory = dirname(fileURLToPath(import.meta.url));
const syncScriptPath = resolve(currentScriptDirectory, 'sync-pokedex.mjs');
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const child = spawn(
    process.execPath,
    [syncScriptPath, '--generation', '5', ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );

  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}
