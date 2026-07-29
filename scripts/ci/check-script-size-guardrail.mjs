#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import process from 'node:process';
import { projectRoot } from '../../services/lib/runtime-config.mjs';
import { getArgValue, listChangedFiles } from './lib/ci-diff-utils.mjs';

const SOFT_LIMIT = 500;
const HARD_LIMIT = 700;
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts', '.sh']);

function isScriptPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/gu, '/');
  return normalized.startsWith('scripts/') && SCRIPT_EXTENSIONS.has(extname(normalized));
}

function main() {
  const base = getArgValue('--base');
  const head = getArgValue('--head') || 'HEAD';
  const changedScripts = listChangedFiles({ base, head }).filter(isScriptPath);
  const warnings = [];
  const failures = [];

  for (const relativePath of changedScripts) {
    const absolutePath = `${projectRoot}/${relativePath}`.replace(/\\/gu, '/');
    if (!existsSync(absolutePath)) {
      continue;
    }

    const lineCount = readFileSync(absolutePath, 'utf8').split(/\r?\n/u).length;
    if (lineCount > HARD_LIMIT) {
      failures.push({ file: relativePath, lineCount });
    } else if (lineCount > SOFT_LIMIT) {
      warnings.push({ file: relativePath, lineCount });
    }
  }

  for (const warning of warnings) {
    process.stdout.write(`Warning: ${warning.file} is ${warning.lineCount} lines and is approaching the ${HARD_LIMIT}-line guardrail.\n`);
  }

  if (failures.length > 0) {
    process.stderr.write('Script-size guardrail exceeded:\n');
    for (const failure of failures) {
      process.stderr.write(`- ${failure.file}: ${failure.lineCount} lines (max ${HARD_LIMIT})\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Script-size guardrail passed for ${changedScripts.length} changed script file(s).\n`);
}

main();
