import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  avatarImageDataUri,
  resolveInstagramStoryAvatar,
} from '../src/instagram-story-avatar.mjs';

const target = {
  account_key: 'poke-quizzz-instagram',
  instagram: {
    user_id: 'ig-user-1',
    expected_username: 'pokequizzz',
    access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
    story: { avatar_cache_ttl_hours: 168 },
  },
};

const runtimeEnv = {
  INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
  INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
};

test('Story avatar resolution reuses a fresh account-bound local cache', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-avatar-cache-'));
  const cacheDir = join(root, 'data', 'runtime', 'instagram-story-avatars');
  const cachePath = join(cacheDir, 'poke-quizzz-instagram--ig-user-1.png');
  const cachedImage = Buffer.from('cached-avatar');
  try {
    await import('node:fs/promises').then(({ mkdir }) => mkdir(cacheDir, { recursive: true }));
    await writeFile(cachePath, cachedImage);
    let graphCalls = 0;
    const resolved = await resolveInstagramStoryAvatar({
      target,
      runtimeEnv,
      projectRoot: root,
      graphClient: { async request() { graphCalls += 1; } },
    });
    assert.equal(graphCalls, 0);
    assert.equal(resolved.source, 'cache');
    assert.deepEqual(resolved.image, cachedImage);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Story avatar resolution verifies the live account and caches its normalized image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-avatar-live-'));
  const normalizedImage = Buffer.from('normalized-avatar');
  const fakeSharp = () => ({
    resize() { return this; },
    png() { return this; },
    async toBuffer() { return normalizedImage; },
  });
  try {
    const resolved = await resolveInstagramStoryAvatar({
      target,
      runtimeEnv,
      projectRoot: root,
      graphClient: {
        async request(path, options) {
          assert.equal(path, 'me');
          assert.match(options.query.fields, /profile_picture_url/u);
          return {
            user_id: 'ig-user-1',
            username: 'PokeQuizzz',
            profile_picture_url: 'https://example.test/avatar.png',
          };
        },
      },
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => String(128) },
        async arrayBuffer() { return Buffer.from('remote-avatar'); },
      }),
      sharpImpl: fakeSharp,
    });
    assert.equal(resolved.source, 'instagram_graph');
    assert.deepEqual(resolved.image, normalizedImage);
    assert.deepEqual(await readFile(resolved.cachePath), normalizedImage);
    assert.match(avatarImageDataUri(resolved.image), /^data:image\/png;base64,/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Story avatar resolution never displays another account avatar on identity mismatch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-avatar-mismatch-'));
  try {
    const resolved = await resolveInstagramStoryAvatar({
      target,
      runtimeEnv,
      projectRoot: root,
      graphClient: {
        async request() {
          return {
            user_id: 'wrong-user',
            username: 'wrong-account',
            profile_picture_url: 'https://example.test/wrong.png',
          };
        },
      },
    });
    assert.equal(resolved.source, 'generic_fallback');
    assert.match(resolved.refreshError, /does not match/u);
    assert.ok(resolved.image.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
