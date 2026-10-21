#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import { runItchThemeRevisionJob } from './src/theme-revision.mjs';

function parseArguments(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--state') args.statePath = argv[++index];
    else if (token === '--runtime-env') args.runtimeEnv = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.statePath) throw new Error('--state is required.');
  return args;
}

const args = parseArguments(process.argv);
runItchThemeRevisionJob({
  statePath: args.statePath,
  runtimeConfig: loadRuntimeConfig({ envFilePath: args.runtimeEnv }),
}).then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
