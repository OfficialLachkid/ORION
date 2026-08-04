#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../../scripts/lib/supabase-bridge-api.mjs';
import {
  loadPublicationChannelProfiles,
  toVideoChannelRow,
} from '../../src/publication-channels.mjs';

async function upsertVideoChannels(rows, runtimeEnv) {
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/video_channels', supabaseUrl);
  url.searchParams.set('on_conflict', 'id');
  return fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(apiKey, {
      Prefer: 'resolution=merge-duplicates,return=representation',
    }),
    body: JSON.stringify(rows),
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/sync-video-publication-channels.mjs [options]',
      '',
      'Options:',
      '  --channels <path>   Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
    ]);
    process.exit(0);
  }

  const runtimeConfig = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(
    getStringOption(options, 'channels', 'services/product-video-agent/publication-channels.example.json'),
    { projectRoot },
  );
  const rows = profiles.map((profile) => toVideoChannelRow(profile));
  const upserted = await upsertVideoChannels(rows, runtimeConfig.env || {});
  printInfo(`Upserted ${Array.isArray(upserted) ? upserted.length : rows.length} video channel row(s).`);
}
