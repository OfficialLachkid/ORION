import { execFileSync } from 'node:child_process';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';

export function getArgValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }

  return process.argv[index + 1] || '';
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeLines(value) {
  return String(value || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function listChangedFiles({ base = '', head = 'HEAD', diffFilter = 'ACMR' } = {}) {
  if (base && head) {
    return normalizeLines(runGit(['diff', '--name-only', `--diff-filter=${diffFilter}`, `${base}..${head}`]));
  }

  if (head) {
    return normalizeLines(runGit(['show', '--pretty=', '--name-only', '--diff-filter=' + diffFilter, head]));
  }

  return normalizeLines(runGit(['ls-files']));
}

export function listCommitSubjects({ base = '', head = 'HEAD' } = {}) {
  if (base && head) {
    return normalizeLines(runGit(['log', '--format=%s', `${base}..${head}`]));
  }

  if (head) {
    return normalizeLines(runGit(['log', '--format=%s', '-n', '1', head]));
  }

  return [];
}
