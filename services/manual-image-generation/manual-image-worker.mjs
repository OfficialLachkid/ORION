#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../lib/runtime-config.mjs';
import { resolveManualImageGenerationConfig } from './src/config.mjs';
import { drainManualImageGenerationQueue } from './src/queue-worker.mjs';

function parseArguments(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--archive-root') args.archiveRoot = argv[++index];
    else if (token === '--runtime-env') args.runtimeEnv = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

const args = parseArguments(process.argv);
const runtimeConfig = loadRuntimeConfig({ envFilePath: args.runtimeEnv });
const config = resolveManualImageGenerationConfig(runtimeConfig, { archiveRoot: args.archiveRoot });

drainManualImageGenerationQueue({ runtimeConfig, config, projectRoot })
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
