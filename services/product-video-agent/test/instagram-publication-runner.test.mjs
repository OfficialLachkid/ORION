import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diagnoseInstagramAccount,
  executeDueInstagramPublications,
  resolveInstagramDueAction,
} from '../scripts/publication/social/instagram/execute-due-publications.mjs';
import {
  executeDueSocialPublications,
} from '../scripts/publication/social/execute-due-publications.mjs';

const targetProfile = {
  id: 'channel-poke-quizz',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  metadata: {
    automatic_comments: {
      enabled: true,
      default_variants: [{ id: 'question', text: 'How many did you get right?' }],
    },
    publisher: {
      targets: [{
        platform: 'instagram_reels',
        account_key: 'poke-quizzz-instagram',
        enabled: false,
        instagram: {
          user_id: '17841467563066221',
          expected_username: 'pokequizzz',
          access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
        },
      }],
    },
  },
};

function publication(overrides = {}) {
  return {
    id: 'publication-instagram-1',
    video_id: 'video-1',
    platform: 'instagram_reels',
    account_key: 'poke-quizzz-instagram',
    status: 'scheduled',
    scheduled_for: '2026-10-09T10:00:00.000Z',
    external_id: null,
    metadata: {
      workflow_state: 'scheduled',
      source_account_key: 'poke-quizz-youtube',
      source_publication_id: 'source-publication-1',
      publisher_target: {
        platform: 'instagram_reels',
        account_key: 'poke-quizzz-instagram',
        delivery_provider: 'instagram_graph',
        instagram: targetProfile.metadata.publisher.targets[0].instagram,
      },
    },
    ...overrides,
  };
}

function passThroughAlerts({ publications }) {
  return Promise.resolve({ publications, results: [] });
}

test('diagnoseInstagramAccount verifies exact configured id and username without publishing', async () => {
  const result = await diagnoseInstagramAccount({
    'diagnose-account': 'poke-quizzz-instagram',
  }, {
    runtimeConfig: {
      env: {
        INSTAGRAM_GRAPH_API_VERSION: 'v25.0',
        INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN: 'secret',
        INSTAGRAM_DELIVERY_ENABLED: 'false',
      },
    },
    loadPublicationChannelProfiles: async () => [targetProfile],
    graphClient: {
      async fetchAuthenticatedProfile() {
        return {
          userId: '17841467563066221',
          appScopedId: '28693385720310895',
          username: 'pokequizzz',
          accountType: 'MEDIA_CREATOR',
        };
      },
    },
  });

  assert.deepEqual(result, {
    account_key: 'poke-quizzz-instagram',
    instagram_user_id: '17841467563066221',
    app_scoped_user_id: '28693385720310895',
    username: 'pokequizzz',
    account_type: 'MEDIA_CREATOR',
    identity_verified: true,
    delivery_enabled: false,
  });
});

test('resolveInstagramDueAction uses the inherited scheduled time and polling cadence', () => {
  assert.equal(
    resolveInstagramDueAction(publication(), '2026-10-09T10:00:00.000Z'),
    'upload',
  );
  assert.equal(
    resolveInstagramDueAction(publication(), '2026-10-09T09:59:59.000Z'),
    '',
  );
  assert.equal(resolveInstagramDueAction(publication({
    status: 'publishing',
    external_id: 'container-1',
    metadata: { workflow_state: 'publishing', next_status_poll_at: '2026-10-09T10:05:00.000Z' },
  }), '2026-10-09T10:05:00.000Z'), 'status');
});

test('executeDueInstagramPublications blocks unattended upload while the live gate is off', async () => {
  const row = publication();
  const results = await executeDueInstagramPublications({
    'as-of': '2026-10-09T10:00:00.000Z',
  }, {
    runtimeConfig: { env: { INSTAGRAM_DELIVERY_ENABLED: 'false' } },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [row]; },
      async fetchPublicationById() { return null; },
      async updatePublication() { throw new Error('must not update'); },
    },
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].action, 'instagram_publish_blocked');
  assert.equal(results[0].reason, 'instagram_live_delivery_disabled');
});

test('executeDueInstagramPublications persists every irreversible delivery boundary', async () => {
  let stored = publication();
  const patches = [];
  const store = {
    async fetchPublicationsByPlatform() { return [stored]; },
    async fetchPublicationById() { return null; },
    async fetchVideoById() { return { id: 'video-1' }; },
    async claimPublicationForUpload(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata };
      patches.push(patch);
      return stored;
    },
    async updatePublication(_id, patch) {
      stored = {
        ...stored,
        ...patch,
        metadata: patch.metadata || stored.metadata,
      };
      patches.push(patch);
      return stored;
    },
  };
  const results = await executeDueInstagramPublications({
    'as-of': '2026-10-09T10:00:00.000Z',
  }, {
    runtimeConfig: { env: { INSTAGRAM_DELIVERY_ENABLED: 'true' } },
    publicationStore: store,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    publishInstagramReel: async ({ onStaged, onInitialized, onPublished }) => {
      await onStaged({
        objectPath: 'instagram/publication-instagram-1.mp4',
        publicUrl: 'https://storage.example/video.mp4',
        videoSha256: 'a'.repeat(64),
      });
      await onInitialized({ containerId: 'container-1' });
      await onPublished({ mediaId: 'media-1' });
      return {
        workflowState: 'published',
        status: 'published',
        containerId: 'container-1',
        mediaId: 'media-1',
        externalId: 'media-1',
        publicUrl: 'https://www.instagram.com/reel/example/',
        publishedAt: '2026-10-09T10:01:00.000Z',
        stagingRemoved: true,
      };
    },
  });

  assert.equal(results.at(-1).action, 'instagram_published');
  assert.equal(stored.status, 'published');
  assert.equal(stored.external_id, 'media-1');
  assert.equal(stored.metadata.instagram_container_id, 'container-1');
  assert.equal(stored.metadata.instagram_media_id, 'media-1');
  assert.match(stored.public_url, /instagram\.com\/reel/u);
  assert.ok(patches.some((patch) => patch.metadata?.instagram_staging_object_path));
  assert.ok(patches.some((patch) => patch.external_id === 'container-1'));
  assert.ok(patches.some((patch) => patch.metadata?.instagram_media_id === 'media-1'));
});

test('executeDueInstagramPublications schedules processing follow-up before the five-minute reconciler', async () => {
  let stored = publication();
  const store = {
    async fetchPublicationsByPlatform() { return [stored]; },
    async fetchPublicationById() { return null; },
    async fetchVideoById() { return { id: 'video-1' }; },
    async claimPublicationForUpload(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata };
      return stored;
    },
    async updatePublication(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata || stored.metadata };
      return stored;
    },
  };

  const results = await executeDueInstagramPublications({
    'as-of': '2026-10-09T10:00:00.000Z',
  }, {
    runtimeConfig: { env: { INSTAGRAM_DELIVERY_ENABLED: 'true' } },
    publicationStore: store,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    publishInstagramReel: async ({ onInitialized }) => {
      await onInitialized({ containerId: 'container-1' });
      return {
        workflowState: 'publishing',
        status: 'IN_PROGRESS',
        externalId: 'container-1',
        containerId: 'container-1',
        stagingRemoved: false,
      };
    },
  });

  assert.equal(results.at(-1).action, 'instagram_processing');
  assert.equal(stored.metadata.next_status_poll_at, '2026-10-09T10:04:00.000Z');
  assert.equal(resolveInstagramDueAction(stored, '2026-10-09T10:05:00.000Z'), 'status');
});

test('executeDueInstagramPublications runs the inherited comment policy after a Reel is published', async () => {
  let stored = publication();
  const store = {
    async fetchPublicationsByPlatform() { return [stored]; },
    async fetchPublicationById(id) {
      return id === 'source-publication-1'
        ? { id, metadata: { publication_policy: { auto_comment_enabled: true } } }
        : null;
    },
    async fetchVideoById() { return { id: 'video-1' }; },
    async claimPublicationForUpload(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata };
      return stored;
    },
    async updatePublication(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata || stored.metadata };
      return stored;
    },
  };
  const commentCalls = [];
  const results = await executeDueInstagramPublications({
    'as-of': '2026-10-09T10:00:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        INSTAGRAM_DELIVERY_ENABLED: 'true',
        INSTAGRAM_COMMENTING_ENABLED: 'true',
        INSTAGRAM_COMMENTING_ENABLED_SINCE: '2026-10-09T00:00:00.000Z',
      },
    },
    publicationStore: store,
    loadPublicationChannelProfiles: async () => [targetProfile],
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    deliverPublicationFailureAlerts: passThroughAlerts,
    publishInstagramReel: async () => ({
      workflowState: 'published',
      status: 'published',
      mediaId: 'media-1',
      externalId: 'media-1',
      publicUrl: 'https://www.instagram.com/reel/example/',
      publishedAt: '2026-10-09T10:01:00.000Z',
      stagingRemoved: true,
    }),
    syncInstagramAutoCommentState: async (input) => {
      commentCalls.push(input);
      return {
        publication: input.publication,
        action: 'posted',
        status: 'posted',
        reason: 'posted',
        commentId: 'comment-1',
        variantId: 'default-question',
      };
    },
  });

  assert.equal(commentCalls.length, 1);
  assert.equal(commentCalls[0].sourceChannelProfile.account_key, 'poke-quizz-youtube');
  assert.equal(results.at(-1).action, 'instagram_comment_posted');
  assert.equal(results.at(-1).comment_id, 'comment-1');
});

test('executeDueInstagramPublications resumes a pending comment without republishing the Reel', async () => {
  const row = publication({
    status: 'published',
    external_id: 'media-1',
    public_url: 'https://www.instagram.com/reel/example/',
    metadata: {
      workflow_state: 'published',
      instagram_media_id: 'media-1',
      source_account_key: 'poke-quizz-youtube',
      source_publication_id: 'source-publication-1',
      publisher_target: {
        platform: 'instagram_reels',
        account_key: 'poke-quizzz-instagram',
        instagram: targetProfile.metadata.publisher.targets[0].instagram,
      },
      instagram_auto_comment: {
        status: 'pending',
        reason: 'rate_limited',
        attempt_count: 1,
        text: 'How many did you get right?',
      },
    },
  });
  let publishCalls = 0;
  const results = await executeDueInstagramPublications({}, {
    runtimeConfig: {
      env: {
        INSTAGRAM_DELIVERY_ENABLED: 'true',
        INSTAGRAM_COMMENTING_ENABLED: 'true',
        INSTAGRAM_COMMENTING_ENABLED_SINCE: '2026-10-09T00:00:00.000Z',
      },
    },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [row]; },
      async fetchPublicationById() { return { metadata: {} }; },
      async updatePublication() { return row; },
    },
    loadPublicationChannelProfiles: async () => [targetProfile],
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    deliverPublicationFailureAlerts: passThroughAlerts,
    publishInstagramReel: async () => { publishCalls += 1; },
    syncInstagramAutoCommentState: async () => ({
      publication: row,
      action: 'posted',
      status: 'posted',
      commentId: 'comment-2',
    }),
  });

  assert.equal(publishCalls, 0);
  assert.equal(results.at(-1).action, 'instagram_comment_posted');
  assert.equal(results.at(-1).comment_id, 'comment-2');
});

test('executeDueInstagramPublications alerts #alerts when publishing fails', async () => {
  let stored = publication();
  const sent = [];
  const store = {
    async fetchPublicationsByPlatform() { return [stored]; },
    async fetchPublicationById() { return null; },
    async fetchVideoById() { return { id: 'video-1' }; },
    async claimPublicationForUpload(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata };
      return stored;
    },
    async updatePublication(_id, patch) {
      stored = { ...stored, ...patch, metadata: patch.metadata || stored.metadata };
      return stored;
    },
  };

  const results = await executeDueInstagramPublications({
    'as-of': '2026-10-09T10:00:00.000Z',
  }, {
    runtimeConfig: {
      env: { INSTAGRAM_DELIVERY_ENABLED: 'true' },
      channelIds: { alerts: 'alerts-channel-1' },
    },
    publicationStore: store,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    publishInstagramReel: async () => {
      throw new Error('Meta rejected the Reel.');
    },
    sendDiscordMessage: async (_config, channelId, payload) => {
      sent.push({ channelId, payload });
      return { posted: true, channelId, messageId: 'instagram-alert-1' };
    },
  });

  assert.equal(results.at(-2).action, 'instagram_publish_failed');
  assert.equal(results.at(-1).action, 'publication_failure_alert_sent');
  assert.equal(stored.metadata.publication_failure_alert_status, 'sent');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, 'alerts-channel-1');
});

test('generic social runner executes every registered platform adapter', async () => {
  const calls = [];
  const results = await executeDueSocialPublications({ 'as-of': '2026-10-09T10:00:00.000Z' }, {
    executeDueTikTokPublications: async () => {
      calls.push('tiktok');
      return [{ platform: 'tiktok_video' }];
    },
    executeDueInstagramPublications: async () => {
      calls.push('instagram');
      return [{ platform: 'instagram_reels' }];
    },
  });

  assert.deepEqual(calls, ['tiktok', 'instagram']);
  assert.deepEqual(results.map((item) => item.platform), ['tiktok_video', 'instagram_reels']);
});
