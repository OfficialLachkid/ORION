import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { moveOlderPreviewFiles } from '../scripts/organize-poke-quizz-previews.mjs';

async function createPreviewFile(filePath, modifiedAt) {
  await writeFile(filePath, 'preview');
  await utimes(filePath, modifiedAt, modifiedAt);
}

test('preview organizer keeps the two newest visible mp4 files and ignores AppleDouble sidecars', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-previews-'));
  const previewsDirectory = resolve(root, 'Previews');
  const archiveDirectory = resolve(previewsDirectory, 'Older Generated Videos');
  await mkdir(previewsDirectory, { recursive: true });

  const now = new Date('2026-07-31T16:00:00.000Z');
  await createPreviewFile(resolve(previewsDirectory, 'older.mp4'), new Date(now.getTime() - 30_000));
  await createPreviewFile(resolve(previewsDirectory, 'latest.mp4'), new Date(now.getTime() - 10_000));
  await createPreviewFile(resolve(previewsDirectory, 'middle.mp4'), new Date(now.getTime() - 20_000));
  await createPreviewFile(resolve(previewsDirectory, '._latest.mp4'), new Date(now.getTime() - 1_000));

  const result = await moveOlderPreviewFiles({
    previewsDirectory,
    archiveDirectory,
    keepCount: 2,
  });

  assert.deepEqual(
    result.kept.map((filePath) => basename(filePath)),
    ['latest.mp4', 'middle.mp4'],
  );
  assert.deepEqual(
    result.archived.map((filePath) => basename(filePath)),
    ['older.mp4'],
  );

  const rootEntries = await readdir(previewsDirectory);
  assert.ok(rootEntries.includes('latest.mp4'));
  assert.ok(rootEntries.includes('middle.mp4'));
  assert.ok(rootEntries.includes('._latest.mp4'));
  assert.ok(!rootEntries.includes('older.mp4'));

  const archiveEntries = await readdir(archiveDirectory);
  assert.deepEqual(archiveEntries, ['older.mp4']);

  const hiddenSidecarStats = await stat(resolve(previewsDirectory, '._latest.mp4'));
  assert.ok(hiddenSidecarStats.isFile());
});
