#!/usr/bin/env node

import process from 'node:process';
import { getArgValue, listCommitSubjects } from './lib/ci-diff-utils.mjs';

const CONVENTIONAL_COMMIT_PATTERN = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([a-z0-9][a-z0-9._/-]*\))?!?: .+/u;

function main() {
  const base = getArgValue('--base');
  const head = getArgValue('--head') || 'HEAD';
  const subjects = listCommitSubjects({ base, head });
  const invalidSubjects = subjects.filter((subject) => {
    if (CONVENTIONAL_COMMIT_PATTERN.test(subject)) {
      return false;
    }

    return !(subject.startsWith('Merge ') || subject.startsWith('Revert "'));
  });

  if (invalidSubjects.length > 0) {
    process.stderr.write('Non-conventional commit subjects found:\n');
    for (const subject of invalidSubjects) {
      process.stderr.write(`- ${subject}\n`);
    }
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`Conventional commit check passed for ${subjects.length} commit(s).\n`);
}

main();
