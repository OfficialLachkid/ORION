#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDueSocialPublications as executeDueTikTokPublications } from './tiktok/execute-due-publications.mjs';
import { executeDueInstagramPublications } from './instagram/execute-due-publications.mjs';
import { parseArgs, printUsage } from '../../../../../scripts/lib/ruflo-wrapper-utils.mjs';

export { executeDueInstagramPublications } from './instagram/execute-due-publications.mjs';
export { executeDueSocialPublications as executeDueTikTokPublications } from './tiktok/execute-due-publications.mjs';

export async function executeDueSocialPublications(options = {}, dependencies = {}) {
  const executeTikTok = dependencies.executeDueTikTokPublications
    || executeDueTikTokPublications;
  const executeInstagram = dependencies.executeDueInstagramPublications
    || executeDueInstagramPublications;
  const results = [];
  const failures = [];

  for (const [platform, execute] of [
    ['tiktok_video', executeTikTok],
    ['instagram_reels', executeInstagram],
  ]) {
    try {
      results.push(...await execute(options));
    } catch (error) {
      failures.push({ platform, error: error.message || String(error) });
    }
  }
  if (failures.length > 0) {
    const error = new Error(
      `Social publication adapter failure(s): ${failures.map((item) => `${item.platform}: ${item.error}`).join('; ')}`,
    );
    error.failures = failures;
    error.results = results;
    throw error;
  }
  return results;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/publication/social/execute-due-publications.mjs [options]',
      '',
      'Runs every registered social delivery adapter. Platform-specific diagnostics and',
      'maintenance commands remain available through their dedicated scripts.',
    ]);
    return;
  }
  const results = await executeDueSocialPublications(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
