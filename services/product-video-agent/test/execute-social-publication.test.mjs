import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupBufferStaging,
  executeDueSocialPublications,
  provisionBufferStaging,
  resolveTikTokLifecycleAction,
  retryTikTokPublication,
} from '../scripts/publication/social/tiktok/execute-due-publications.mjs';
import {
  TikTokPublicationAuthRequiredError,
} from '../src/tiktok-publication-executor.mjs';
import { TikTokDirectPostValidationError } from '../src/tiktok-publication.mjs';

function createStore(publications, videos = {}) {
  const rows = new Map(publications.map((publication) => [publication.id, structuredClone(publication)]));
  const updateCalls = [];
  return {
    updateCalls,
    async fetchPublicationsByPlatform({ platform }) {
      return [...rows.values()].filter((publication) => publication.platform === platform);
    },
    async fetchPublicationsByChannel({ platform, accountKey }) {
      return [...rows.values()].filter((publication) => (
        publication.platform === platform
        && publication.account_key === accountKey
      ));
    },
    async fetchVideoById(id) {
      return structuredClone(videos[id] || null);
    },
    async fetchPublicationById(id) {
      return structuredClone(rows.get(id) || null);
    },
    async claimPublicationForUpload(id, patch) {
      const current = rows.get(id);
      if (!current || !['queued', 'scheduled'].includes(current.status) || current.external_id) {
        return null;
      }
      return this.updatePublication(id, patch);
    },
    async updatePublication(id, patch) {
      const current = rows.get(id);
      const next = {
        ...current,
        ...patch,
        metadata: {
          ...(current?.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
      rows.set(id, next);
      updateCalls.push({ id, patch: structuredClone(patch) });
      return structuredClone(next);
    },
    current(id) {
      return structuredClone(rows.get(id));
    },
  };
}

const dueTikTokPublication = {
  id: 'publication-target-tiktok',
  video_id: 'video-1',
  platform: 'tiktok_video',
  account_key: 'poke-quizz-tiktok',
  status: 'scheduled',
  scheduled_for: '2026-09-07T10:00:00.000Z',
  title: 'Guess the Cry!',
  hashtags: ['#pokemon'],
  metadata: {
    workflow_state: 'scheduled',
    render_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
    publisher_target: {
      account_key: 'poke-quizz-tiktok',
      platform: 'tiktok_video',
      tiktok: {
        access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
      },
    },
  },
};

function asBufferPublication(overrides = {}) {
  return {
    ...dueTikTokPublication,
    ...overrides,
    metadata: {
      ...dueTikTokPublication.metadata,
      ...(overrides.metadata || {}),
      publisher_target: {
        account_key: 'poke-quizz-tiktok',
        platform: 'tiktok_video',
        delivery_provider: 'buffer',
        buffer: {
          organization_id: 'organization-1',
          channel_id: 'channel-1',
          expected_service: 'tiktok',
          expected_username: 'pokequizz7',
        },
      },
    },
  };
}

test('executeDueSocialPublications dry-runs due TikTok rows only', async () => {
  const store = createStore([
    dueTikTokPublication,
    {
      ...dueTikTokPublication,
      id: 'future-tiktok',
      scheduled_for: '2026-09-09T10:00:00.000Z',
    },
    {
      ...dueTikTokPublication,
      id: 'youtube-row',
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
    },
  ]);

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
    'dry-run': true,
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
  });

  assert.deepEqual(results, [
    {
      publication_id: 'publication-target-tiktok',
      platform: 'tiktok_video',
      account_key: 'poke-quizz-tiktok',
      action: 'tiktok_publish_due',
      workflow_state: 'scheduled',
      scheduled_for: '2026-09-07T10:00:00.000Z',
      external_id: '',
    },
  ]);
});

test('Buffer staging provisioning delegates to the isolated storage adapter', async () => {
  let calls = 0;
  const result = await provisionBufferStaging({}, {
    runtimeConfig: { env: {} },
    stagingClient: {
      async provisionBucket() {
        calls += 1;
        return { created: true, bucket: { name: 'orion-publication-staging' } };
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.created, true);
});

test('Buffer staging cleanup protects every object still referenced by publication state', async () => {
  const store = createStore([
    asBufferPublication({
      metadata: {
        buffer_staging_object_path: 'buffer/active.mp4',
      },
    }),
    asBufferPublication({
      id: 'published-buffer',
      metadata: {
        buffer_staging_object_path: 'buffer/already-removed.mp4',
        buffer_staging_removed_at: '2026-09-07T11:00:00.000Z',
      },
    }),
  ]);
  let cleanupInput;

  await cleanupBufferStaging({
    'as-of': '2026-09-07T12:00:00.000Z',
    'max-age-hours': '24',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
    stagingClient: {
      async cleanupStaleObjects(input) {
        cleanupInput = input;
        return { removedPaths: [] };
      },
    },
  });

  assert.equal(cleanupInput.olderThan, '2026-09-06T12:00:00.000Z');
  assert.deepEqual(cleanupInput.protectedPaths, ['buffer/active.mp4']);
});

test('executeDueSocialPublications withdraws a due child when its source was cancelled', async () => {
  const sourcePublication = {
    id: 'publication-source-youtube',
    video_id: 'video-1',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'deleted',
    scheduled_for: null,
    metadata: { workflow_state: 'revision_requested' },
  };
  const childPublication = {
    ...dueTikTokPublication,
    metadata: {
      ...dueTikTokPublication.metadata,
      source_publication_id: sourcePublication.id,
    },
  };
  const store = createStore([sourcePublication, childPublication]);
  let publishCalls = 0;

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
    publishTikTokVideo: async () => {
      publishCalls += 1;
      return {};
    },
  });

  assert.equal(publishCalls, 0);
  assert.equal(store.current(childPublication.id).status, 'withdrawn');
  assert.equal(store.current(childPublication.id).scheduled_for, null);
  assert.deepEqual(results, [{
    publication_id: childPublication.id,
    platform: 'tiktok_video',
    account_key: 'poke-quizz-tiktok',
    action: 'source_lifecycle_withdrawn',
    workflow_state: 'withdrawn',
    source_publication_id: sourcePublication.id,
    source_workflow_state: 'revision_requested',
    scheduled_for: '',
  }]);
});

test('executeDueSocialPublications alerts the source review thread after delivery started', async () => {
  const sourcePublication = {
    id: 'publication-source-youtube',
    video_id: 'video-1',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'deleted',
    scheduled_for: null,
    metadata: { workflow_state: 'deleted' },
  };
  const childPublication = {
    ...dueTikTokPublication,
    status: 'publishing',
    external_id: 'publish-123',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'publishing',
      source_publication_id: sourcePublication.id,
      source_review_thread_id: 'review-thread-1',
      next_status_poll_at: '2026-09-08T12:00:00.000Z',
    },
  };
  const store = createStore([sourcePublication, childPublication]);
  const messages = [];

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    publicationStore: store,
    sendDiscordMessage: async (_config, channelId, payload) => {
      messages.push({ channelId, payload });
      return { posted: true, channelId, messageId: 'message-1' };
    },
  });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].channelId, 'review-thread-1');
  assert.equal(store.current(childPublication.id).metadata.source_lifecycle_alert_status, 'sent');
  assert.deepEqual(results.map((result) => result.action), [
    'source_lifecycle_manual_action_required',
    'source_lifecycle_alert_sent',
  ]);
});

test('executeDueSocialPublications uploads a due TikTok row and stores publish id', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': {
      id: 'video-1',
      render: {
        output_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
      },
    },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'token',
      },
    },
    publicationStore: store,
    publishTikTokVideo: async ({ publication, videoRow, target, onInitialized }) => {
      assert.equal(publication.id, 'publication-target-tiktok');
      assert.equal(videoRow.id, 'video-1');
      assert.equal(target.tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
      await onInitialized({
        publishId: 'publish-123',
        externalId: 'publish-123',
        initializedAt: '2026-09-07T12:00:00.000Z',
        tokenEnv: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
      });
      return {
        status: 'publishing',
        workflowState: 'publishing',
        externalId: 'publish-123',
        publishId: 'publish-123',
        uploadedAt: '2026-09-07T12:00:00.000Z',
        tokenEnv: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
      };
    },
  });

  assert.equal(results[0].action, 'tiktok_publish_upload');
  assert.equal(results[0].external_id, 'publish-123');
  assert.equal(store.current('publication-target-tiktok').external_id, 'publish-123');
  assert.equal(store.current('publication-target-tiktok').metadata.tiktok_publish_id, 'publish-123');
  assert.ok(store.current('publication-target-tiktok').metadata.next_status_poll_at);
});

test('executeDueSocialPublications polls an uploaded TikTok row and marks it published', async () => {
  const store = createStore([{
    ...dueTikTokPublication,
    status: 'publishing',
    external_id: 'publish-123',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'publishing',
      next_status_poll_at: '2026-09-07T11:59:00.000Z',
    },
  }]);

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'token',
      },
    },
    publicationStore: store,
    fetchTikTokPublicationStatus: async ({ publishId, target }) => {
      assert.equal(publishId, 'publish-123');
      assert.equal(target.tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
      return {
        status: 'published',
        rawStatus: 'PUBLISH_COMPLETE',
        failReason: '',
        postId: '7420000000000000001',
        publicUrl: 'https://www.tiktok.com/@pokequizz7/video/7420000000000000001',
      };
    },
  });

  assert.equal(results[0].action, 'tiktok_status_fetch');
  assert.equal(results[0].workflow_state, 'published');
  assert.equal(store.current('publication-target-tiktok').status, 'published');
  assert.equal(store.current('publication-target-tiktok').published_at, '2026-09-07T12:00:00.000Z');
  assert.equal(store.current('publication-target-tiktok').metadata.tiktok_post_id, '7420000000000000001');
  assert.equal(
    store.current('publication-target-tiktok').public_url,
    'https://www.tiktok.com/@pokequizz7/video/7420000000000000001',
  );
  assert.equal(results[0].tiktok_post_id, '7420000000000000001');
});

test('executeDueSocialPublications marks missing TikTok auth as auth_required', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': {
      id: 'video-1',
      render: {
        output_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
      },
    },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
    publishTikTokVideo: async () => {
      throw new TikTokPublicationAuthRequiredError('Missing TikTok token');
    },
  });

  assert.equal(results[0].action, 'tiktok_publish_failed');
  assert.equal(results[0].workflow_state, 'auth_required');
  assert.equal(store.current('publication-target-tiktok').status, 'blocked');
  assert.equal(store.current('publication-target-tiktok').metadata.workflow_state, 'auth_required');
});

test('executeDueSocialPublications blocks a TikTok row that needs renewed approval', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': {
      id: 'video-1',
      render: {
        output_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
      },
    },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
    publishTikTokVideo: async () => {
      throw new TikTokDirectPostValidationError(
        'TikTok post approval is missing.',
        { code: 'tiktok_consent_required' },
      );
    },
  });

  assert.equal(results[0].action, 'tiktok_publish_failed');
  assert.equal(results[0].workflow_state, 'approval_required');
  assert.equal(results[0].reason, 'tiktok_consent_required');
  assert.equal(store.current('publication-target-tiktok').status, 'blocked');
  assert.equal(store.current('publication-target-tiktok').metadata.workflow_state, 'approval_required');
});

test('executeDueSocialPublications preserves publish id when upload fails after initialization', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': { id: 'video-1', render: { output_path: 'example.mp4' } },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: { TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'token' } },
    publicationStore: store,
    publishTikTokVideo: async ({ onInitialized }) => {
      await onInitialized({
        publishId: 'publish-interrupted',
        externalId: 'publish-interrupted',
        initializedAt: '2026-09-07T12:00:00.000Z',
      });
      throw new Error('connection reset during upload');
    },
  });

  assert.equal(results[0].action, 'tiktok_upload_interrupted');
  assert.equal(results[0].reason, 'upload_interrupted_after_init');
  assert.equal(store.current('publication-target-tiktok').status, 'publishing');
  assert.equal(store.current('publication-target-tiktok').external_id, 'publish-interrupted');
  assert.ok(store.current('publication-target-tiktok').metadata.next_status_poll_at);
});

test('executeDueSocialPublications blocks new Buffer delivery while the live gate is off', async () => {
  const publication = asBufferPublication();
  const store = createStore([publication], {
    'video-1': { id: 'video-1', render: { output_path: 'example.mp4' } },
  });
  let publishCalls = 0;

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: { BUFFER_TIKTOK_DELIVERY_ENABLED: 'false' } },
    publicationStore: store,
    publishBufferVideo: async () => { publishCalls += 1; },
  });

  assert.equal(publishCalls, 0);
  assert.equal(results[0].action, 'buffer_publish_blocked');
  assert.equal(store.current(publication.id).status, 'scheduled');
});

test('executeDueSocialPublications rejects a non-targeted Buffer live override', async () => {
  await assert.rejects(
    () => executeDueSocialPublications({ 'allow-buffer-live': true }, {
      runtimeConfig: { env: {} },
      publicationStore: createStore([]),
    }),
    /requires --publication-id/u,
  );
});

test('executeDueSocialPublications permits one targeted supervised Buffer delivery', async () => {
  const publication = asBufferPublication();
  const store = createStore([publication], {
    'video-1': { id: 'video-1', render: { output_path: 'example.mp4' } },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
    'publication-id': publication.id,
    'allow-buffer-live': true,
  }, {
    runtimeConfig: { env: { BUFFER_TIKTOK_DELIVERY_ENABLED: 'false' } },
    publicationStore: store,
    publishBufferVideo: async ({ target, onStaged, onInitialized }) => {
      assert.equal(target.deliveryProvider, 'buffer');
      assert.equal(target.buffer.channel_id, 'channel-1');
      await onStaged({
        objectPath: 'buffer/publication-target-tiktok/random.mp4',
        publicUrl: 'https://project.supabase.co/video.mp4',
        stagedAt: '2026-09-07T12:00:00.000Z',
        videoSha256: 'a'.repeat(64),
      });
      await onInitialized({
        externalId: 'buffer-post-1',
        postId: 'buffer-post-1',
        initializedAt: '2026-09-07T12:00:00.000Z',
        rawStatus: 'sending',
      });
      return {
        status: 'publishing',
        workflowState: 'publishing',
        rawStatus: 'sending',
        externalId: 'buffer-post-1',
        postId: 'buffer-post-1',
        uploadedAt: '2026-09-07T12:00:00.000Z',
        stagingRemoved: false,
      };
    },
  });

  const stored = store.current(publication.id);
  assert.equal(results[0].action, 'buffer_publish_upload');
  assert.equal(stored.external_id, 'buffer-post-1');
  assert.equal(stored.metadata.buffer_post_id, 'buffer-post-1');
  assert.equal(stored.metadata.buffer_staging_object_path, 'buffer/publication-target-tiktok/random.mp4');
  assert.equal(stored.metadata.buffer_create_uncertain, false);
});

test('executeDueSocialPublications keeps an uncertain Buffer create in recovery polling', async () => {
  const publication = asBufferPublication();
  const store = createStore([publication], {
    'video-1': { id: 'video-1', render: { output_path: 'example.mp4' } },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: { BUFFER_TIKTOK_DELIVERY_ENABLED: 'true' } },
    publicationStore: store,
    publishBufferVideo: async ({ onStaged }) => {
      await onStaged({
        objectPath: 'buffer/publication-target-tiktok/random.mp4',
        publicUrl: 'https://project.supabase.co/video.mp4',
        stagedAt: '2026-09-07T12:00:00.000Z',
        videoSha256: 'a'.repeat(64),
      });
      const error = new Error('create outcome unknown');
      error.code = 'buffer_create_uncertain';
      throw error;
    },
  });

  const stored = store.current(publication.id);
  assert.equal(results[0].action, 'buffer_create_uncertain');
  assert.equal(stored.status, 'publishing');
  assert.equal(stored.external_id || null, null);
  assert.equal(stored.metadata.buffer_create_uncertain, true);
  assert.ok(stored.metadata.next_status_poll_at);
});

test('executeDueSocialPublications polls Buffer and removes the staging reference after sent', async () => {
  const publication = asBufferPublication({
    status: 'publishing',
    external_id: 'buffer-post-1',
    metadata: {
      workflow_state: 'publishing',
      next_status_poll_at: '2026-09-07T11:59:00.000Z',
      buffer_staging_object_path: 'buffer/publication-target-tiktok/random.mp4',
      buffer_staging_public_url: 'https://project.supabase.co/video.mp4',
    },
  });
  const store = createStore([publication]);

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: { BUFFER_TIKTOK_DELIVERY_ENABLED: 'false' } },
    publicationStore: store,
    fetchBufferPublicationStatus: async ({ postId, target }) => {
      assert.equal(postId, 'buffer-post-1');
      assert.equal(target.buffer.organization_id, 'organization-1');
      return {
        status: 'published',
        rawStatus: 'sent',
        postId: 'buffer-post-1',
        externalId: 'buffer-post-1',
        publicUrl: 'https://www.tiktok.com/@pokequizz7/video/123',
        publishedAt: '2026-09-07T12:00:30.000Z',
        stagingRemoved: true,
      };
    },
  });

  const stored = store.current(publication.id);
  assert.equal(results[0].action, 'buffer_status_fetch');
  assert.equal(stored.status, 'published');
  assert.equal(stored.published_at, '2026-09-07T12:00:30.000Z');
  assert.equal(stored.metadata.buffer_staging_removed_at, '2026-09-07T12:00:00.000Z');
});

test('retryTikTokPublication requeues only an approved row without a publish id', async () => {
  const store = createStore([{
    ...dueTikTokPublication,
    status: 'failed',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'failed',
      tiktok_direct_post_approval: { approved: true },
    },
  }]);

  const result = await retryTikTokPublication({
    'retry-publication-id': 'publication-target-tiktok',
    'as-of': '2026-09-07T13:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
  });

  assert.equal(result.action, 'tiktok_upload_retry_queued');
  assert.equal(store.current('publication-target-tiktok').status, 'scheduled');
  assert.equal(store.current('publication-target-tiktok').metadata.publish_retry_requested_at, '2026-09-07T13:00:00.000Z');
});

test('retryTikTokPublication refuses a row that already has a publish id', async () => {
  const store = createStore([{
    ...dueTikTokPublication,
    status: 'publishing',
    external_id: 'publish-existing',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'publishing',
      tiktok_direct_post_approval: { approved: true },
    },
  }]);

  await assert.rejects(
    () => retryTikTokPublication({
      'retry-publication-id': 'publication-target-tiktok',
    }, {
      runtimeConfig: { env: {} },
      publicationStore: store,
    }),
    /poll status instead of retrying/u,
  );
});

test('retryTikTokPublication requeues a known terminal Buffer error and preserves its prior id', async () => {
  const publication = asBufferPublication({
    status: 'failed',
    external_id: 'buffer-post-failed',
    metadata: {
      workflow_state: 'failed',
      buffer_status: 'error',
      tiktok_direct_post_approval: { approved: true },
    },
  });
  const store = createStore([publication]);

  const result = await retryTikTokPublication({
    'retry-publication-id': publication.id,
    'as-of': '2026-09-07T13:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
  });

  const stored = store.current(publication.id);
  assert.equal(result.action, 'tiktok_upload_retry_queued');
  assert.equal(stored.external_id, null);
  assert.deepEqual(stored.metadata.buffer_previous_post_ids, ['buffer-post-failed']);
});

test('resolveTikTokLifecycleAction records a manual remote outcome', async () => {
  const store = createStore([{
    ...dueTikTokPublication,
    status: 'published',
    external_id: 'publish-existing',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'published',
      source_lifecycle_action_required: true,
      source_lifecycle_reason: 'source_deleted_after_delivery_started',
      source_lifecycle_alert_status: 'sent',
    },
  }]);

  const result = await resolveTikTokLifecycleAction({
    'resolve-lifecycle-publication-id': 'publication-target-tiktok',
    resolution: 'removed',
    'resolution-note': 'Removed in TikTok app.',
    'resolved-by': 'Valentijn',
    'as-of': '2026-10-08T09:30:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
  });

  assert.equal(result.resolution, 'removed');
  assert.equal(store.current('publication-target-tiktok').metadata.source_lifecycle_action_required, false);
  assert.equal(
    store.current('publication-target-tiktok').metadata.source_lifecycle_resolved_reason,
    'source_deleted_after_delivery_started',
  );
});
