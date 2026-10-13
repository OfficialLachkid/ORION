import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  buildPublicationRenderPathCandidates,
  resolveAvailablePublicationRender,
} from '../src/publication-render-path.mjs';

test('publication render candidates include the known preview archive location', () => {
  assert.deepEqual(
    buildPublicationRenderPathCandidates('Previews/Stat Clash/video.mp4', '/workspace'),
    [
      resolve('/workspace/Previews/Stat Clash/video.mp4'),
      resolve('/workspace/Previews/Stat Clash/Older Generated Videos/video.mp4'),
    ],
  );
});

test('publication render resolution falls back only after the configured path is missing', async () => {
  const checked = [];
  const result = await resolveAvailablePublicationRender({
    configuredPath: 'Previews/Stat Clash/video.mp4',
    projectRoot: '/workspace',
    statImpl: async (filePath) => {
      checked.push(filePath);
      if (!filePath.includes('Older Generated Videos')) {
        const error = new Error('missing');
        error.code = 'ENOENT';
        throw error;
      }
      return { size: 4_000 };
    },
  });

  assert.equal(checked.length, 2);
  assert.equal(result.relocated, true);
  assert.equal(result.fileStats.size, 4_000);
  assert.match(result.renderPath, /Older Generated Videos[/\\]video\.mp4$/u);
});

test('publication render resolution does not hide non-missing filesystem errors', async () => {
  const denied = new Error('permission denied');
  denied.code = 'EACCES';
  await assert.rejects(
    () => resolveAvailablePublicationRender({
      configuredPath: 'video.mp4',
      projectRoot: '/workspace',
      statImpl: async () => { throw denied; },
    }),
    denied,
  );
});
