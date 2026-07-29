#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
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
import { buildBridgeRecord, createBridgeSyncPlan } from './lib/supabase-memory-sync-utils.mjs';
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

function buildSyncRunRecord(plan, options, env, exportRoot, status) {
  const sourceDevice = getSourceDevice(env, options);
  return {
    sync_name: 'vault_bridge_push',
    source_kind: 'vault_bridge_note',
    source_device: sourceDevice,
    status,
    records_scanned: plan.scannedCount,
    inserted_count: plan.insertedCount,
    updated_count: plan.updatedCount,
    unchanged_count: plan.unchangedCount,
    export_path: exportRoot,
    metadata: {
      bridgeSubpath: getStringOption(options, 'bridge-subpath', '90_Ruflo_Bridge'),
      dryRun: getBooleanOption(options, 'dry-run', false),
    },
  };
}

function printPlan(plan, options, exportRoot) {
  printInfo(`Bridge export root: ${exportRoot}`);
  printInfo(`Bridge records scanned: ${plan.scannedCount}`);
  printInfo(`Bridge records to insert: ${plan.insertedCount}`);
  printInfo(`Bridge records to update: ${plan.updatedCount}`);
  printInfo(`Bridge records unchanged: ${plan.unchangedCount}`);

  if (plan.upserts.length > 0) {
    printInfo(`Changed records: ${plan.upserts.map((record) => record.record_key).join(', ')}`);
  }

  if (getBooleanOption(options, 'dry-run', false)) {
    printWarn('Dry run enabled. No Supabase rows were written.');
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/supabase-sync-bridge.mjs [options]',
      '',
      'Options:',
      '  --sync-vault                 Refresh the vault bridge export before pushing (default: true)',
      '  --no-sync-vault              Reuse the current bridge export as-is',
      '  --vault-path <path>          Override the vault root used by scripts/sync-vault.mjs',
      '  --bridge-subpath <path>      Bridge path inside the vault. Default: 90_Ruflo_Bridge',
      '  --export-path <path>         Bridge export root. Default: data/vault-bridge/current',
      '  --source-device <value>      Override the device label stored in Supabase',
      '  --memory-table <name>        Override the memory records table name',
      '  --sync-runs-table <name>     Override the sync runs table name',
      '  --dry-run                    Print the sync plan without writing to Supabase',
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
  const shouldSyncVault = getBooleanOption(options, 'sync-vault', true);
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
  const existingRecords = await fetchBridgeRecords(supabaseUrl, memoryTable, apiKey, {
    select: 'id,record_key,source_sha256,version',
  });
  const plan = createBridgeSyncPlan(localRecords, Array.isArray(existingRecords) ? existingRecords : []);

  printPlan(plan, options, exportRoot);

  if (!dryRun && plan.upserts.length > 0) {
    await upsertBridgeRecords(supabaseUrl, memoryTable, apiKey, plan.upserts);
    printInfo(`Upserted ${plan.upserts.length} bridge record(s) into ${memoryTable}.`);
  }

  if (!dryRun) {
    await insertSyncRun(
      supabaseUrl,
      syncRunsTable,
      apiKey,
      buildSyncRunRecord(plan, options, env, exportRoot, 'completed')
    );
    printInfo(`Recorded sync run in ${syncRunsTable}.`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
