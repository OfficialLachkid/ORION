#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../scripts/lib/supabase-bridge-api.mjs';
import {
  DEFAULT_SEREBII_GEN1_SOURCE_URL,
  fetchSerebiiPokedex,
  getSerebiiPokedexGenerationConfig,
} from '../src/pokedex-source.mjs';

async function upsertPokedexRows(rows, options = {}) {
  const runtimeConfig = loadRuntimeConfig();
  const env = runtimeConfig.env || {};
  const supabaseUrl = env.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(env);
  const table = options.table || 'pokedex';

  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${table}`, supabaseUrl);
  url.searchParams.set('on_conflict', 'id');

  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });
}

async function writeRowsToJson(rows, outputPath) {
  const absoluteOutputPath = resolve(projectRoot, outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
  return absoluteOutputPath;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/sync-pokedex.mjs [options]',
      '',
      'Options:',
      '  --generation <n>          National generation page to sync. Default: 1',
      '  --source-url <url>        Override the Serebii generation page',
      '  --write-json <path>       Write the parsed rows to a JSON file under the repo root',
      '  --persist-supabase        Upsert the parsed rows into Supabase table `pokedex`',
      '  --table <name>            Target Supabase table. Default: pokedex',
      '  --print-json              Print the parsed rows to stdout',
    ]);
    process.exit(0);
  }

  const generation = Number.parseInt(getStringOption(options, 'generation', '1'), 10);
  const defaultSourceUrl = generation === 1
    ? DEFAULT_SEREBII_GEN1_SOURCE_URL
    : getSerebiiPokedexGenerationConfig(generation).sourceUrl;
  const sourceUrl = getStringOption(options, 'source-url', defaultSourceUrl);
  const rows = await fetchSerebiiPokedex({ sourceUrl, generation });
  printInfo(`Parsed ${rows.length} Gen ${generation} Pokedex row(s) from ${sourceUrl}.`);

  const writeJsonPath = getStringOption(options, 'write-json', '');
  if (writeJsonPath) {
    const absolutePath = await writeRowsToJson(rows, writeJsonPath);
    printInfo(`Wrote parsed rows to ${absolutePath}`);
  }

  if (getBooleanOption(options, 'persist-supabase', false)) {
    const table = getStringOption(options, 'table', 'pokedex');
    const upserted = await upsertPokedexRows(rows, { table });
    printInfo(`Upserted ${Array.isArray(upserted) ? upserted.length : rows.length} row(s) into ${table}.`);
  }

  if (getBooleanOption(options, 'print-json', false)) {
    process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
  }
}
