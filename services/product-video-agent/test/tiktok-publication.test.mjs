import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  TIKTOK_DIRECT_POST_APPROVAL_VERSION,
  TikTokDirectPostValidationError,
  buildTikTokDirectPostInitRequest,
  buildTikTokStatusFetchRequest,
  resolveTikTokDirectPostApproval,
  resolveTikTokChunking,
  validateTikTokCreatorCapabilities,
} from '../src/tiktok-publication.mjs';
import {
  TikTokPublicationAuthRequiredError,
  fetchTikTokPublicationStatus,
  mapTikTokPublishStatus,
  preflightTikTokVideo,
  publishTikTokVideo,
} from '../src/tiktok-publication-executor.mjs';

const approvedPostSettings = {
  caption: 'Guess the Cry!\n\n#pokemon #shorts',
  privacyLevel: 'SELF_ONLY',
  creatorUsername: 'pokequizz7',
  allowComment: true,
  allowDuet: false,
  allowStitch: false,
  brandContentToggle: false,
  brandOrganicToggle: false,
  isAigc: true,
  videoCoverTimestampMs: 1000,
};

test('buildTikTokDirectPostInitRequest uses the exact approved Direct Post choices', () => {
  const request = buildTikTokDirectPostInitRequest({
    postSettings: approvedPostSettings,
    target: {
      tiktok: {
        access_token_env: 'TIKTOK_ACCESS_TOKEN',
      },
    },
    videoSizeBytes: 4_000_000,
  });

  assert.equal(request.body.post_info.title, 'Guess the Cry!\n\n#pokemon #shorts');
  assert.equal(request.body.post_info.privacy_level, 'SELF_ONLY');
  assert.equal(request.body.post_info.disable_comment, false);
  assert.equal(request.body.post_info.disable_duet, true);
  assert.equal(request.body.post_info.is_aigc, true);
  assert.equal(request.body.post_info.brand_content_toggle, false);
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

test('resolveTikTokDirectPostApproval fails closed without per-publication consent', () => {
  assert.throws(
    () => resolveTikTokDirectPostApproval({
      publication: { id: 'pub-1', video_id: 'video-1', metadata: {} },
      target: { accountKey: 'poke-quizz-tiktok' },
      renderPath: '/tmp/video.mp4',
      videoSizeBytes: 4000,
      videoSha256: 'a'.repeat(64),
    }),
    (error) => (
      error instanceof TikTokDirectPostValidationError
      && error.code === 'tiktok_consent_required'
    ),
  );
});

test('validateTikTokCreatorCapabilities enforces creator, privacy, interactions, and duration', () => {
  const result = validateTikTokCreatorCapabilities({
    postSettings: approvedPostSettings,
    creatorInfo: {
      creator_username: 'pokequizz7',
      creator_nickname: 'PokeQuizz',
      privacy_level_options: ['SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: true,
      max_video_post_duration_sec: 60,
    },
    target: {
      tiktok: {
        environment: 'sandbox',
        expected_username: 'pokequizz7',
      },
    },
    videoDurationSeconds: 30.5,
  });

  assert.equal(result.creatorUsername, 'pokequizz7');
  assert.equal(result.creatorNickname, 'PokeQuizz');
  assert.equal(result.videoDurationSeconds, 30.5);
  assert.equal(result.maxVideoPostDurationSeconds, 60);
});

test('preflightTikTokVideo performs live checks without initializing an upload', async () => {
  const projectRoot = resolve('workspace');
  const renderPath = resolve(projectRoot, 'video.mp4');
  const publication = {
    id: 'pub-1',
    video_id: 'video-1',
    metadata: {
      render_path: 'video.mp4',
      tiktok_direct_post_approval: {
        version: TIKTOK_DIRECT_POST_APPROVAL_VERSION,
        approved: true,
        approved_at: '2026-10-06T12:00:00.000Z',
        publication_id: 'pub-1',
        video_id: 'video-1',
        account_key: 'poke-quizz-tiktok',
        creator_username: 'pokequizz7',
        render_path: renderPath,
        video_size_bytes: 4000,
        video_sha256: 'a'.repeat(64),
        caption: approvedPostSettings.caption,
        privacy_level: 'SELF_ONLY',
        allow_comment: true,
        allow_duet: false,
        allow_stitch: false,
        brand_content_toggle: false,
        brand_organic_toggle: false,
        is_aigc: true,
      },
    },
  };
  let networkCalls = 0;
  const result = await preflightTikTokVideo({
    publication,
    videoRow: {},
    target: {
      accountKey: 'poke-quizz-tiktok',
      tiktok: {
        access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
        environment: 'sandbox',
        expected_username: 'pokequizz7',
      },
    },
    runtimeEnv: { TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'access-token' },
    projectRoot,
    statImpl: async () => ({ size: 4000 }),
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error('preflight must not initialize or upload');
    },
    fetchCreatorInfoImpl: async () => ({
      creator_username: 'pokequizz7',
      creator_nickname: 'PokeQuizz',
      privacy_level_options: ['SELF_ONLY'],
      comment_disabled: false,
      duet_disabled: true,
      stitch_disabled: true,
      max_video_post_duration_sec: 60,
    }),
    probeDurationImpl: async () => 29.75,
    hashFileImpl: async () => 'a'.repeat(64),
  });

  assert.equal(networkCalls, 0);
  assert.equal(result.action, 'preflight');
  assert.equal(result.creatorUsername, 'pokequizz7');
  assert.equal(result.videoDurationSeconds, 29.75);
  assert.equal(result.request.post_info.privacy_level, 'SELF_ONLY');
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
