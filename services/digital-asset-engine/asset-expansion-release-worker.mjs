#!/usr/bin/env node
import process from 'node:process';
import { loadRuntimeConfig } from '../lib/runtime-config.mjs';
import {
  queueApprovedAssetExpansionRelease,
  runAssetExpansionReleaseJob,
} from './src/asset-expansion-job.mjs';

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

queueApprovedAssetExpansionRelease({ statePath: args.statePath })
  .then(() => runAssetExpansionReleaseJob({
    statePath: args.statePath,
    runtimeConfig,
  }))
  .then((result) => {
    process.stdout.write(`${JSON.stringify({
      product_slug: result.product_slug,
      expansion_id: result.expansion_id,
      target_version: result.target_version,
      release_job: result.release_job,
      reused: result.reused,
    }, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  });
