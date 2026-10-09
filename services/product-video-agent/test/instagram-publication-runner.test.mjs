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
          id: '17841467563066221',
          username: 'pokequizzz',
          accountType: 'CREATOR',
        };
      },
    },
  });

  assert.deepEqual(result, {
    account_key: 'poke-quizzz-instagram',
    instagram_user_id: '17841467563066221',
    username: 'pokequizzz',
    account_type: 'CREATOR',
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
