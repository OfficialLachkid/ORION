#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../lib/runtime-config.mjs';
import { withItchBrowserLock } from './src/itch-browser-lock.mjs';
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
const runtimeConfig = loadRuntimeConfig({ envFilePath: args.runtimeEnv });
withItchBrowserLock({
  projectRoot,
  onWait: () => process.stdout.write('[queue] Waiting for the authenticated itch.io browser resource.\n'),
}, () => runItchThemeRevisionJob({
  statePath: args.statePath,
  runtimeConfig,
})).then((result) => {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
