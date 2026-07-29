import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCiRefContext } from '../ci/lib/ci-notification-context.mjs';

test('resolveCiRefContext shows pull request head and base branches', () => {
  assert.deepEqual(resolveCiRefContext({
    eventName: 'pull_request',
    refName: '2/merge',
    headRef: 'development',
    baseRef: 'main',
  }), {
    displayRef: 'development -> main',
    sourceBranch: 'development',
    targetBranch: 'main',
    rawRef: '2/merge',
  });
});

test('resolveCiRefContext keeps a push branch without a target branch', () => {
  assert.deepEqual(resolveCiRefContext({ eventName: 'push', refName: 'main' }), {
    displayRef: 'main',
    sourceBranch: 'main',
    targetBranch: '',
    rawRef: 'main',
  });
});
