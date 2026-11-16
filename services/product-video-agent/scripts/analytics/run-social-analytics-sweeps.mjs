#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  parseInstagramAnalyticsSweepArgs,
  runInstagramAnalyticsSweep,
} from './run-instagram-analytics-sweep.mjs';
import { runFacebookAnalyticsSweep } from './run-facebook-analytics-sweep.mjs';

export async function runSocialAnalyticsSweeps(argv = [], dependencies = {}) {
  const args = parseInstagramAnalyticsSweepArgs(argv);
  const instagram = await (dependencies.runInstagramAnalyticsSweep || runInstagramAnalyticsSweep)(
    args,
    dependencies.instagram || { logger: console },
  );
  const facebook = await (dependencies.runFacebookAnalyticsSweep || runFacebookAnalyticsSweep)(
    args,
    dependencies.facebook || { logger: console },
  );
  return {
    retry_recommended: Boolean(instagram.retry_recommended || facebook.retry_recommended),
    platforms: { instagram_reels: instagram, facebook_reels: facebook },
  };
}

async function main() {
  const result = await runSocialAnalyticsSweeps(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.retry_recommended) process.exitCode = 1;
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
