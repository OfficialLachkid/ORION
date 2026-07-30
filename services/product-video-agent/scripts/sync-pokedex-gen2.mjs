#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const currentScriptDirectory = dirname(fileURLToPath(import.meta.url));
const syncScriptPath = resolve(currentScriptDirectory, 'sync-pokedex.mjs');
const child = spawn(
  process.execPath,
  [syncScriptPath, '--generation', '2', ...process.argv.slice(2)],
  { stdio: 'inherit' },
);

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
