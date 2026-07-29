#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBooleanOption, getStringOption, parseArgs, printInfo, printUsage, printWarn, projectRoot } from './lib/ruflo-wrapper-utils.mjs';

export function syncVaultBridge(options = {}) {
  const bridgeSubpath = getStringOption(options, 'bridge-subpath', '90_Ruflo_Bridge');
  const vaultPath = resolveVaultPath(options, bridgeSubpath);
  const exportPath = getStringOption(options, 'export-path', 'data/vault-bridge/current');
  const allowMissingBridge = getBooleanOption(options, 'allow-missing-bridge', true);

  const vaultRoot = vaultPath;
  const bridgeRoot = resolve(vaultRoot, bridgeSubpath);
  const exportRoot = resolve(projectRoot, exportPath);
  const manifestPath = join(exportRoot, 'manifest.json');

  if (!existsSync(vaultRoot)) {
    throw new Error(`Vault path not found: ${vaultRoot}`);
  }

  mkdirSync(exportRoot, { recursive: true });

  if (!existsSync(bridgeRoot)) {
    if (!allowMissingBridge) {
      throw new Error(`Bridge path not found: ${bridgeRoot}`);
    }

    writeFileSync(manifestPath, '[]\n', 'utf8');
    printWarn(`Bridge path not found at ${bridgeRoot}. Wrote an empty manifest instead of failing hard.`);
    printInfo(`Manifest written to ${manifestPath}`);
    return;
  }

  const bridgeFiles = readdirSync(bridgeRoot)
    .filter((name) => name.endsWith('.md'))
    .sort((left, right) => left.localeCompare(right));

  const manifest = [];

  for (const fileName of bridgeFiles) {
    const sourcePath = join(bridgeRoot, fileName);
    const destinationPath = join(exportRoot, fileName);
    const fileBuffer = readFileSync(sourcePath);
    copyFileSync(sourcePath, destinationPath);

    manifest.push({
      name: fileName,
      source: sourcePath,
      sha256: createHash('sha256').update(fileBuffer).digest('hex').toUpperCase(),
      lastWriteTimeUtc: statSync(sourcePath).mtime.toISOString(),
    });
  }

  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  printInfo(`Synced ${bridgeFiles.length} bridge notes to ${exportRoot}`);
  printInfo(`Manifest written to ${manifestPath}`);
}

export function resolveVaultPath(options, bridgeSubpath) {
  const explicitVaultPath = getStringOption(options, 'vault-path')
    || process.env.RUFLO_VAULT_PATH
    || process.env.JACOBS_VAULT_PATH;

  if (explicitVaultPath) {
    return resolve(projectRoot, explicitVaultPath);
  }

  const candidates = [
    resolve(projectRoot, 'Jacobs-2'),
    resolve(process.env.HOME || process.env.USERPROFILE || projectRoot, 'Vault', 'Jacobs-2'),
  ];

  const existingCandidates = candidates.filter((candidate) => existsSync(candidate));
  const candidatesWithBridge = existingCandidates.filter((candidate) => existsSync(resolve(candidate, bridgeSubpath)));
  const detected = candidatesWithBridge[0] || existingCandidates[0];
  if (!detected) {
    throw new Error(`Vault path not found. Checked: ${candidates.join(', ')}`);
  }

  return detected;
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : null;
const currentPath = fileURLToPath(import.meta.url);

if (executedPath && executedPath === currentPath) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node scripts/sync-vault.mjs [options]',
      '',
      'Options:',
      '  --vault-path <path>        Vault root. Defaults to repo/Jacobs-2 or ~/Vault/Jacobs-2',
      '  --bridge-subpath <path>    Bridge path inside vault. Default: 90_Ruflo_Bridge',
      '  --export-path <path>       Export path relative to repo root. Default: data/vault-bridge/current',
      '  --no-allow-missing-bridge  Fail instead of writing an empty manifest when the bridge is absent',
    ]);
    process.exit(0);
  }

  syncVaultBridge(options);
}
