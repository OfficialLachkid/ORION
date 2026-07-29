#!/usr/bin/env node

import { argv } from 'node:process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { sweepExpiredTemporarySources } from '../src/media-retention.mjs';
import { SupabaseProductVideoStateStore } from '../src/persistence.mjs';
import { resolveInsideRoot } from '../src/paths.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '../../..');

function getArgValue(flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? '' : argv[index + 1] || '';
}

function nextExpiry(manifest) {
  return manifest.asset_storage_locations
    .filter((location) => (
      location.retention_class === 'temporary_source'
      && location.deletion_status !== 'deleted'
      && location.delete_after
    ))
    .map((location) => Date.parse(location.delete_after))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
}

async function waitUntil(timestamp) {
  const delay = Math.max(0, timestamp - Date.now());
  if (delay > 0) await new Promise((resolveWait) => setTimeout(resolveWait, delay));
}

async function main() {
  const manifestPath = resolveInsideRoot(
    projectRoot,
    getArgValue('--manifest'),
    'Retention worker manifest path',
  );
  const outputPath = resolveInsideRoot(
    projectRoot,
    getArgValue('--write-manifest'),
    'Retention worker output path',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expiry = nextExpiry(manifest);
  if (!expiry) throw new Error('No retained temporary source has a deletion deadline.');

  await waitUntil(expiry);
  const swept = await sweepExpiredTemporarySources({
    manifest,
    asOf: new Date().toISOString(),
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(swept.manifest, null, 2)}\n`, 'utf8');

  let persistence = null;
  if (argv.includes('--persist-supabase')) {
    const { env } = loadRuntimeConfig();
    const store = new SupabaseProductVideoStateStore({
      supabaseUrl: env.SUPABASE_URL,
      apiKey: env.SUPABASE_SECRET_KEY,
    });
    persistence = await store.saveRun(swept.manifest);
  }
  process.stdout.write(`${JSON.stringify({
    report: swept.report,
    manifest_path: outputPath,
    persistence,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
