import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import {
  reconcilePokeQuizzPreviewFallbackStorage,
  resolveManagedPokeQuizzPreviewOutputPath,
} from '../src/poke-quizz-preview-storage.mjs';

test('managed preview output stays on the preferred SSD root when it is writable', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-pq-preview-storage-'));
  const preferredRoot = resolve(root, 'preferred');
  const fallbackRoot = resolve(root, 'fallback');
  await mkdir(preferredRoot, { recursive: true });
  await mkdir(fallbackRoot, { recursive: true });

  const preferredOutputPath = resolve(preferredRoot, 'water-fire.mp4');
  const resolved = await resolveManagedPokeQuizzPreviewOutputPath(preferredOutputPath, {
    preferredRoot,
    fallbackRoot,
  });

  assert.equal(resolved.outputPath, preferredOutputPath);
  assert.equal(resolved.usingFallback, false);
  assert.equal(resolved.locationType, 'external_ssd_preview');
});

test('managed preview output falls back to Desktop-style storage when the SSD root is unavailable', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-pq-preview-storage-'));
  const preferredRoot = resolve(root, 'preferred-missing');
  const fallbackRoot = resolve(root, 'fallback');
  await mkdir(fallbackRoot, { recursive: true });

  const preferredOutputPath = resolve(preferredRoot, 'nested', 'water-fire.mp4');
  const resolved = await resolveManagedPokeQuizzPreviewOutputPath(preferredOutputPath, {
    preferredRoot,
    fallbackRoot,
  });

  assert.equal(resolved.outputPath, resolve(fallbackRoot, 'nested', 'water-fire.mp4'));
  assert.equal(resolved.usingFallback, true);
  assert.equal(resolved.locationType, 'mac_desktop_fallback_preview');
});

test('preview fallback reconciliation moves stranded MP4s back onto the preferred SSD root', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-pq-preview-storage-'));
  const preferredRoot = resolve(root, 'preferred');
  const fallbackRoot = resolve(root, 'fallback');
  const fallbackFile = resolve(fallbackRoot, 'nested', 'water-fire.mp4');
  const expectedDestination = resolve(preferredRoot, 'nested', 'water-fire.mp4');

  await mkdir(resolve(fallbackRoot, 'nested'), { recursive: true });
  await mkdir(preferredRoot, { recursive: true });
  await writeFile(fallbackFile, Buffer.from('preview-bytes'));

  const result = await reconcilePokeQuizzPreviewFallbackStorage({
    preferredRoot,
    fallbackRoot,
  });

  assert.equal(result.preferredAvailable, true);
  assert.equal(result.strandedCount, 1);
  assert.deepEqual(result.moved, [{ sourcePath: fallbackFile, destinationPath: expectedDestination }]);
  assert.equal(result.skipped.length, 0);
  assert.equal(await readFile(expectedDestination, 'utf8'), 'preview-bytes');
  await assert.rejects(access(fallbackFile));
});
