#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { scanPokeQuizzAssetInventory } from '../src/poke-quizz-asset-inventory.mjs';

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/scan-poke-quizz-assets.mjs [options]',
      '',
      'Options:',
      '  --write-json <path>       Write the inventory JSON under the repo root',
      '  --print-json              Print the inventory JSON to stdout',
    ]);
    process.exit(0);
  }

  const inventory = await scanPokeQuizzAssetInventory();
  const writeJsonPath = getStringOption(options, 'write-json', '');
  if (writeJsonPath) {
    const absoluteOutputPath = resolve(projectRoot, writeJsonPath);
    await mkdir(dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
    printInfo(`Wrote Poke Quizz asset inventory to ${absoluteOutputPath}`);
  }

  if (options['print-json']) {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  }
}
