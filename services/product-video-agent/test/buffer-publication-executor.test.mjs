import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';
import {
  BufferApiClient,
  BufferPublicationUncertainError,
  fetchBufferPublicationStatus,
  publishBufferVideo,
} from '../src/buffer-publication-executor.mjs';

const publication = {
  id: 'publication-target-buffer',
  video_id: 'video-1',
  platform: 'tiktok_video',
  account_key: 'poke-quizz-tiktok',
  title: 'Guess the Pokemon!',
  metadata: {
    render_path: 'renders/video.mp4',
    tiktok_direct_post_approval: {
      approved: true,
      account_key: 'poke-quizz-tiktok',
      delivery_provider: 'buffer',
      buffer_organization_id: 'organization-1',
      buffer_channel_id: 'channel-1',
      creator_username: 'pokequizz7',
      video_size_bytes: 6_638_795,
      video_sha256: 'a'.repeat(64),
      caption: 'Guess the Pokemon!\n\n#pokemon',
      is_aigc: false,
      video_cover_timestamp_ms: 1000,
    },
  },
};

const target = {
  platform: 'tiktok_video',
  accountKey: 'poke-quizz-tiktok',
  deliveryProvider: 'buffer',
  buffer: {
    organization_id: 'organization-1',
    channel_id: 'channel-1',
    expected_service: 'tiktok',
    expected_username: 'pokequizz7',
  },
};

test('BufferApiClient creates an automatic share-now video post without an AI label', async () => {
  let requestBody;
  const client = new BufferApiClient({
    apiKey: 'buffer-key',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({
        data: {
          createPost: {
            __typename: 'PostActionSuccess',
            post: {
              id: 'buffer-post-1',
              status: 'sending',
              externalLink: null,
              sentAt: null,
              createdAt: '2026-10-08T12:00:00.000Z',
              assets: [{ source: 'https://project.supabase.co/video.mp4' }],
            },
          },
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.createVideoPost({
    channelId: 'channel-1',
    text: 'Guess the Pokemon!\n\n#pokemon',
    videoUrl: 'https://project.supabase.co/video.mp4',
    thumbnailOffset: 1000,
    isAiGenerated: false,
  });

  assert.equal(result.id, 'buffer-post-1');
  assert.deepEqual(requestBody.variables.input, {
    text: 'Guess the Pokemon!\n\n#pokemon',
    channelId: 'channel-1',
    schedulingType: 'automatic',
    mode: 'shareNow',
    source: 'orion',
    aiAssisted: false,
    metadata: { tiktok: { isAiGenerated: false } },
    assets: [{
      video: {
        url: 'https://project.supabase.co/video.mp4',
        metadata: { thumbnailOffset: 1000 },
      },
    }],
  });
});

test('publishBufferVideo validates the exact approved file before staging and creating a post', async () => {
  const calls = [];
  const result = await publishBufferVideo({
    publication,
    videoRow: { id: 'video-1' },
    target,
    projectRoot: '/workspace',
    asOf: '2026-10-08T12:00:00.000Z',
    statImpl: async (filePath) => {
      assert.equal(filePath, resolvePath('/workspace', 'renders/video.mp4'));
      return { size: 6_638_795 };
    },
    hashFileImpl: async () => 'a'.repeat(64),
    stagingClient: {
      async stageFile(input) {
        calls.push(['stage', input]);
        return {
          objectPath: 'buffer/publication-target-buffer/random.mp4',
          publicUrl: 'https://project.supabase.co/video.mp4',
          sizeBytes: 6_638_795,
        };
      },
      async verifyPublicObject(url) {
        calls.push(['verify-public', url]);
        return { reachable: true };
      },
    },
    bufferClient: {
      async createVideoPost(input) {
        calls.push(['create', input]);
        return { id: 'buffer-post-1', status: 'sending', createdAt: '2026-10-08T12:00:00.000Z' };
      },
    },
    onStaged: async (staged) => calls.push(['persist-stage', staged]),
    onInitialized: async (initialized) => calls.push(['persist-id', initialized]),
  });

  assert.deepEqual(
    calls.map(([name]) => name),
    ['stage', 'persist-stage', 'verify-public', 'create', 'persist-id'],
  );
  assert.equal(result.externalId, 'buffer-post-1');
  assert.equal(result.workflowState, 'publishing');
  assert.equal(result.stagingObjectPath, 'buffer/publication-target-buffer/random.mp4');
});

test('publishBufferVideo fails closed when the file no longer matches shared approval', async () => {
  let staged = false;
  await assert.rejects(
    () => publishBufferVideo({
      publication,
      videoRow: { id: 'video-1' },
      target,
      projectRoot: '/workspace',
      statImpl: async () => ({ size: 6_638_796 }),
      hashFileImpl: async () => 'a'.repeat(64),
      stagingClient: {
        async stageFile() { staged = true; },
      },
      bufferClient: {},
    }),
    /size no longer matches/u,
  );
  assert.equal(staged, false);
});

test('publishBufferVideo reports an uncertain write when create times out and recovery finds no post', async () => {
  await assert.rejects(
    () => publishBufferVideo({
      publication,
      videoRow: { id: 'video-1' },
      target,
      projectRoot: '/workspace',
      asOf: '2026-10-08T12:00:00.000Z',
      statImpl: async () => ({ size: 6_638_795 }),
      hashFileImpl: async () => 'a'.repeat(64),
      stagingClient: {
        async stageFile() {
          return {
            objectPath: 'buffer/publication-target-buffer/random.mp4',
            publicUrl: 'https://project.supabase.co/video.mp4',
            sizeBytes: 6_638_795,
          };
        },
      },
      bufferClient: {
        async createVideoPost() { throw new TypeError('fetch failed'); },
        async recoverVideoPost() { return null; },
      },
    }),
    BufferPublicationUncertainError,
  );
});

test('fetchBufferPublicationStatus removes staging only after Buffer reports sent', async () => {
  const removed = [];
  const result = await fetchBufferPublicationStatus({
    postId: 'buffer-post-1',
    publication: {
      ...publication,
      external_id: 'buffer-post-1',
      metadata: {
        ...publication.metadata,
        buffer_staging_object_path: 'buffer/publication-target-buffer/random.mp4',
      },
    },
    target,
    bufferClient: {
      async fetchPost() {
        return {
          id: 'buffer-post-1',
          status: 'sent',
          externalLink: 'https://www.tiktok.com/@pokequizz7/video/123',
          sentAt: '2026-10-08T12:01:00.000Z',
          error: null,
        };
      },
    },
    stagingClient: {
      async removeObject(path) { removed.push(path); },
    },
  });

  assert.equal(result.status, 'published');
  assert.equal(result.publicUrl, 'https://www.tiktok.com/@pokequizz7/video/123');
  assert.deepEqual(removed, ['buffer/publication-target-buffer/random.mp4']);
  assert.equal(result.stagingRemoved, true);
});
