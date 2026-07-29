#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';
import { syncVaultBridge } from './sync-vault.mjs';
import {
  buildBridgeCacheManifestEntry,
  buildBridgeRecord,
  buildBridgeTopicSlug,
  createBridgeMergePlan,
  createBridgeSyncPlan,
} from './lib/supabase-memory-sync-utils.mjs';
import {
  DEFAULT_MEMORY_TABLE,
  DEFAULT_SYNC_RUNS_TABLE,
  fetchBridgeRecords,
  getRuntimeApiKey,
  getSourceDevice,
  insertSyncRun,
  upsertBridgeRecords,
} from './lib/supabase-bridge-api.mjs';

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveExportRoot(options) {
  return resolve(projectRoot, getStringOption(options, 'export-path', 'data/vault-bridge/current'));
}

function resolveCacheRoot(options) {
  return resolve(projectRoot, getStringOption(options, 'cache-path', 'data/supabase-memory/current'));
}

function loadBridgeRecords(exportRoot, options, env) {
  const manifestPath = join(exportRoot, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error(`Bridge manifest not found: ${manifestPath}`);
  }

  const manifest = readJsonFile(manifestPath);
  if (!Array.isArray(manifest)) {
    throw new Error(`Bridge manifest is not a JSON array: ${manifestPath}`);
  }

  const syncedAtUtc = new Date().toISOString();
  const sourceDevice = getSourceDevice(env, options);

  return manifest.map((entry) => {
    const filePath = join(exportRoot, entry.name || '');
    const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
    return buildBridgeRecord({
      manifestEntry: entry,
      content,
      sourceDevice,
      syncedAtUtc,
    });
  });
}

function buildSyncRunRecord(plan, pushPlan, options, env, exportRoot, cacheRoot) {
  return {
    sync_name: 'vault_bridge_merge',
    source_kind: 'vault_bridge_note',
    source_device: getSourceDevice(env, options),
    status: plan.conflictCount > 0 ? 'completed_with_conflicts' : 'completed',
    records_scanned: plan.scannedCount,
    inserted_count: pushPlan.insertedCount,
    updated_count: pushPlan.updatedCount,
    unchanged_count: pushPlan.unchangedCount,
    export_path: exportRoot,
    metadata: {
      cacheRoot,
      pushLocal: getBooleanOption(options, 'push-local', false),
      syncVault: getBooleanOption(options, 'sync-vault', true),
      inSyncCount: plan.inSyncCount,
      remoteOnlyCount: plan.remoteOnlyCount,
      localOnlyCount: plan.localOnlyCount,
      remoteAheadCount: plan.remoteAheadCount,
      localAheadCount: plan.localAheadCount,
      conflictCount: plan.conflictCount,
      conflictKeys: plan.conflictKeys,
    },
  };
}

function printMergePlan(plan, pushPlan, options, exportRoot, cacheRoot) {
  printInfo(`Bridge export root: ${exportRoot}`);
  printInfo(`Supabase memory cache root: ${cacheRoot}`);
  printInfo(`Bridge keys scanned: ${plan.scannedCount}`);
  printInfo(`In sync: ${plan.inSyncCount}`);
  printInfo(`Remote only: ${plan.remoteOnlyCount}`);
  printInfo(`Local only: ${plan.localOnlyCount}`);
  printInfo(`Remote ahead: ${plan.remoteAheadCount}`);
  printInfo(`Local ahead: ${plan.localAheadCount}`);
  printInfo(`Conflicts: ${plan.conflictCount}`);

  if (plan.conflictKeys.length > 0) {
    printWarn(`Conflict keys: ${plan.conflictKeys.join(', ')}`);
  }

  if (getBooleanOption(options, 'push-local', false)) {
    printInfo(`Local push inserts: ${pushPlan.insertedCount}`);
    printInfo(`Local push updates: ${pushPlan.updatedCount}`);
    printInfo(`Local push unchanged: ${pushPlan.unchangedCount}`);
  }

  if (getBooleanOption(options, 'dry-run', false)) {
    printWarn('Dry run enabled. No cache files or Supabase rows were written.');
  }
}

function writeMergedCache(cacheRoot, mergedRecords) {
  mkdirSync(cacheRoot, { recursive: true });

  const bridgeDir = join(cacheRoot, 'bridge');
  mkdirSync(bridgeDir, { recursive: true });

  const manifest = [];
  for (const record of mergedRecords) {
    const topic = buildBridgeTopicSlug(record?.topic || record?.record_key || 'bridge-note');
    const fileName = `${topic}.md`;
    const filePath = join(bridgeDir, fileName);
    writeFileSync(filePath, String(record?.content_markdown || ''), 'utf8');
    manifest.push(buildBridgeCacheManifestEntry({
      ...record,
      topic,
    }));
  }

  writeFileSync(join(cacheRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(cacheRoot, 'merge-report.json'),
    `${JSON.stringify({
      generatedAtUtc: new Date().toISOString(),
      records: manifest,
    }, null, 2)}\n`,
    'utf8'
  );
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/supabase-merge-bridge.mjs [options]',
      '',
      'Options:',
      '  --sync-vault                 Refresh the vault bridge export before merging (default: true)',
      '  --no-sync-vault              Reuse the current bridge export as-is',
      '  --vault-path <path>          Override the vault root used by scripts/sync-vault.mjs',
      '  --bridge-subpath <path>      Bridge path inside the vault. Default: 90_Ruflo_Bridge',
      '  --export-path <path>         Bridge export root. Default: data/vault-bridge/current',
      '  --cache-path <path>          Machine-facing merged cache root. Default: data/supabase-memory/current',
      '  --source-device <value>      Override the device label stored in Supabase',
      '  --memory-table <name>        Override the memory records table name',
      '  --sync-runs-table <name>     Override the sync runs table name',
      '  --push-local                 After merge, upsert local bridge changes back into Supabase',
      '  --dry-run                    Print the merge plan without writing cache files or Supabase rows',
    ]);
    process.exit(0);
  }

  const config = loadRuntimeConfig();
  const env = config.env;
  const supabaseUrl = env.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(env);
  const memoryTable = getStringOption(options, 'memory-table', DEFAULT_MEMORY_TABLE);
  const syncRunsTable = getStringOption(options, 'sync-runs-table', DEFAULT_SYNC_RUNS_TABLE);
  const exportRoot = resolveExportRoot(options);
  const cacheRoot = resolveCacheRoot(options);
  const shouldSyncVault = getBooleanOption(options, 'sync-vault', true);
  const pushLocal = getBooleanOption(options, 'push-local', false);
  const dryRun = getBooleanOption(options, 'dry-run', false);

  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL in config/supabase/.env');
  }

  if (!apiKey) {
    throw new Error('Missing SUPABASE_SECRET_KEY or SUPABASE_PUBLISHABLE_KEY in config/supabase/.env');
  }

  if (shouldSyncVault) {
    syncVaultBridge({
      'vault-path': getStringOption(options, 'vault-path'),
      'bridge-subpath': getStringOption(options, 'bridge-subpath', '90_Ruflo_Bridge'),
      'export-path': getStringOption(options, 'export-path', 'data/vault-bridge/current'),
      'allow-missing-bridge': true,
    });
  }

  const localRecords = loadBridgeRecords(exportRoot, options, env);
  const remoteRecords = await fetchBridgeRecords(supabaseUrl, memoryTable, apiKey, {
    select: 'id,record_key,source_kind,memory_namespace,topic,title,summary,content_markdown,source_path,source_sha256,source_device,review_status,version,conflict_flag,metadata,updated_at',
  });

  const mergePlan = createBridgeMergePlan(localRecords, Array.isArray(remoteRecords) ? remoteRecords : []);
  const pushPlan = pushLocal
    ? createBridgeSyncPlan(localRecords, Array.isArray(remoteRecords) ? remoteRecords : [])
    : { insertedCount: 0, updatedCount: 0, unchangedCount: 0, upserts: [] };

  printMergePlan(mergePlan, pushPlan, options, exportRoot, cacheRoot);

  if (!dryRun) {
    writeMergedCache(cacheRoot, mergePlan.mergedRecords);
    printInfo(`Wrote merged Supabase bridge cache to ${cacheRoot}.`);
  }

  if (!dryRun && pushLocal && pushPlan.upserts.length > 0) {
    await upsertBridgeRecords(supabaseUrl, memoryTable, apiKey, pushPlan.upserts);
    printInfo(`Upserted ${pushPlan.upserts.length} local bridge record(s) into ${memoryTable}.`);
  }

  if (!dryRun) {
    await insertSyncRun(
      supabaseUrl,
      syncRunsTable,
      apiKey,
      buildSyncRunRecord(mergePlan, pushPlan, options, env, exportRoot, cacheRoot)
    );
    printInfo(`Recorded merge run in ${syncRunsTable}.`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
