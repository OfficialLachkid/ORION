import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_DEFAULT_PRIVACY_LEVEL,
  buildTikTokDirectPostInitRequest,
  buildTikTokStatusFetchRequest,
  resolveTikTokChunking,
} from '../src/tiktok-publication.mjs';
import {
  TikTokPublicationAuthRequiredError,
  fetchTikTokPublicationStatus,
  mapTikTokPublishStatus,
  publishTikTokVideo,
} from '../src/tiktok-publication-executor.mjs';

test('buildTikTokDirectPostInitRequest uses FILE_UPLOAD and private SELF_ONLY defaults', () => {
  const request = buildTikTokDirectPostInitRequest({
    publication: {
      title: 'Guess the Cry!',
      hashtags: ['#pokemon', 'shorts'],
    },
    target: {
      tiktok: {
        access_token_env: 'TIKTOK_ACCESS_TOKEN',
      },
    },
    videoSizeBytes: 4_000_000,
  });

  assert.equal(request.body.post_info.title, 'Guess the Cry!\n\n#pokemon #shorts');
  assert.equal(request.body.post_info.privacy_level, TIKTOK_DEFAULT_PRIVACY_LEVEL);
  assert.equal(request.body.source_info.source, 'FILE_UPLOAD');
  assert.equal(request.body.source_info.video_size, 4_000_000);
  assert.equal(request.body.source_info.total_chunk_count, 1);
});

test('resolveTikTokChunking splits videos larger than the configured chunk size', () => {
  const chunking = resolveTikTokChunking(10_000_000, {
    tiktok: {
      chunk_size_bytes: 4_000_000,
    },
  });

  assert.equal(chunking.chunkSizeBytes, 4_000_000);
  assert.equal(chunking.totalChunkCount, 3);
});

test('buildTikTokStatusFetchRequest requires publish id', () => {
  assert.deepEqual(buildTikTokStatusFetchRequest('publish-123').body, {
    publish_id: 'publish-123',
  });
  assert.throws(() => buildTikTokStatusFetchRequest(''), /publish id/u);
});

test('publishTikTokVideo maps missing token to auth required before reading the file', async () => {
  await assert.rejects(
    () => publishTikTokVideo({
      publication: {
        id: 'pub-tiktok',
        metadata: {
          render_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
        },
      },
      videoRow: {},
      target: {
        tiktok: {
          access_token_env: 'TIKTOK_MISSING_TOKEN',
        },
      },
      runtimeEnv: {},
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
      statImpl: async () => {
        throw new Error('stat should not be called');
      },
    }),
    TikTokPublicationAuthRequiredError,
  );
});

test('TikTok status polling refreshes an expired access token and persists rotation', async () => {
  const runtimeEnv = {
    TIKTOK_CLIENT_KEY: 'client-key',
    TIKTOK_CLIENT_SECRET: 'client-secret',
    TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'expired-access',
    TIKTOK_POKE_QUIZZ_REFRESH_TOKEN: 'refresh-one',
    TIKTOK_POKE_QUIZZ_ACCESS_TOKEN_EXPIRES_AT: '2026-10-06T10:00:00.000Z',
    TIKTOK_POKE_QUIZZ_REFRESH_TOKEN_EXPIRES_AT: '2027-10-06T10:00:00.000Z',
    TIKTOK_POKE_QUIZZ_OPEN_ID: 'open-id-one',
    TIKTOK_POKE_QUIZZ_SCOPES: 'user.info.basic,video.publish',
  };
  let persisted;
  const result = await fetchTikTokPublicationStatus({
    publishId: 'publish-123',
    target: {
      tiktok: { access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN' },
    },
    runtimeEnv,
    asOf: '2026-10-06T12:00:00.000Z',
    persistEnvValues: (_filePath, values) => {
      persisted = values;
    },
    fetchImpl: async (url, request) => {
      if (url === 'https://open.tiktokapis.com/v2/oauth/token/') {
        const body = new URLSearchParams(request.body);
        assert.equal(body.get('refresh_token'), 'refresh-one');
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              access_token: 'access-two',
              refresh_token: 'refresh-two',
              open_id: 'open-id-one',
              expires_in: 86400,
              refresh_expires_in: 31536000,
              scope: 'user.info.basic,video.publish',
            });
          },
        };
      }

      assert.equal(request.headers.Authorization, 'Bearer access-two');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            data: { status: 'PROCESSING_UPLOAD' },
            error: { code: 'ok', message: '', log_id: 'log-one' },
          });
        },
      };
    },
  });

  assert.equal(result.status, 'publishing');
  assert.equal(runtimeEnv.TIKTOK_POKE_QUIZZ_ACCESS_TOKEN, 'access-two');
  assert.equal(runtimeEnv.TIKTOK_POKE_QUIZZ_REFRESH_TOKEN, 'refresh-two');
  assert.equal(persisted.TIKTOK_POKE_QUIZZ_ACCESS_TOKEN, 'access-two');
  assert.equal(persisted.TIKTOK_POKE_QUIZZ_REFRESH_TOKEN, 'refresh-two');
});

test('mapTikTokPublishStatus normalizes terminal and in-flight states', () => {
  assert.equal(mapTikTokPublishStatus('PUBLISH_COMPLETE'), 'published');
  assert.equal(mapTikTokPublishStatus('FAILED'), 'failed');
  assert.equal(mapTikTokPublishStatus('PROCESSING_UPLOAD'), 'publishing');
});
