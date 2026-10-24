import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { withGenerationLock } from '../src/generation-lock.mjs';

test('generation lock reports active contention as a retryable runtime resource condition', async () => {
  const projectRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-lock-'));
  await withGenerationLock({ projectRoot }, async () => {
    await assert.rejects(
      withGenerationLock({ projectRoot }, async () => null),
      (error) => error.code === 'RUNTIME_RESOURCE_BUSY'
        && error.resource === 'digital_asset_generation_lock',
    );
  });
});
