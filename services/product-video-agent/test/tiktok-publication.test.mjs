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

test('mapTikTokPublishStatus normalizes terminal and in-flight states', () => {
  assert.equal(mapTikTokPublishStatus('PUBLISH_COMPLETE'), 'published');
  assert.equal(mapTikTokPublishStatus('FAILED'), 'failed');
  assert.equal(mapTikTokPublishStatus('PROCESSING_UPLOAD'), 'publishing');
});
