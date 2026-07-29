#!/usr/bin/env node

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { projectRoot } from '../services/lib/runtime-config.mjs';
import {
  getBooleanOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';

const VAULT_CANDIDATE = ['Vault', 'Jacobs-2', '05_Playbooks', 'Ruflo_Memory_Promotion_Rules.md'];
const REPO_TARGET = 'config/runtime/memory-promotion-rules-playbook.md';

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/sync-promotion-rules-playbook.mjs [--check]',
      '',
      'Copies ~/Vault/Jacobs-2/05_Playbooks/Ruflo_Memory_Promotion_Rules.md into',
      'config/runtime/memory-promotion-rules-playbook.md so CI has a repo-canonical copy.',
      '',
      'Options:',
      '  --check   Only report drift; do not copy. Exit code 1 if the two paths differ.',
    ]);
    return;
  }

  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) {
    throw new Error('HOME is not set; cannot resolve the vault playbook path.');
  }
  const vaultPath = resolve(home, ...VAULT_CANDIDATE);
  const repoPath = resolve(projectRoot, REPO_TARGET);

  if (!existsSync(vaultPath)) {
    printWarn(`Vault playbook not present at ${vaultPath}; skipping sync.`);
    return;
  }

  const check = getBooleanOption(options, 'check', false);
  const repoExists = existsSync(repoPath);
  const vaultHash = sha256File(vaultPath);
  const repoHash = repoExists ? sha256File(repoPath) : '';

  if (vaultHash === repoHash) {
    printInfo('Vault and repo playbook are in sync.');
    return;
  }

  if (check) {
    printWarn(`Drift detected: vault ${vaultHash.slice(0, 12)} vs repo ${repoHash.slice(0, 12) || '(missing)'}.`);
    process.exitCode = 1;
    return;
  }

  copyFileSync(vaultPath, repoPath);
  printInfo(`Copied ${vaultPath} -> ${repoPath}`);
}

main();
