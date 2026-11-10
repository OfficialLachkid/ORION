import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diagnoseFacebookAccount,
  executeDueFacebookPublications,
  resolveFacebookDueAction,
} from '../scripts/publication/social/facebook/execute-due-publications.mjs';

const targetProfile = {
  id: 'channel-poke-quizz',
  name: 'Poke Quizz',
  status: 'active',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  metadata: {
    publisher: {
      targets: [{
        platform: 'facebook_reels',
        account_key: 'poke-quizz-facebook',
        enabled: false,
        facebook: {
          page_id: 'page-123',
          expected_page_name: 'Poke Quizz',
          access_token_env: 'FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN',
        },
      }],
    },
  },
};

function publication(overrides = {}) {
  return {
    id: 'publication-facebook-1',
    video_id: 'video-1',
    platform: 'facebook_reels',
    account_key: 'poke-quizz-facebook',
    status: 'scheduled',
    scheduled_for: '2026-11-09T16:00:00.000Z',
    external_id: null,
    metadata: {
      workflow_state: 'scheduled',
      source_account_key: 'poke-quizz-youtube',
      source_publication_id: 'source-publication-1',
      publisher_target: {
        platform: 'facebook_reels',
        account_key: 'poke-quizz-facebook',
        delivery_provider: 'facebook_graph',
        facebook: targetProfile.metadata.publisher.targets[0].facebook,
      },
    },
    ...overrides,
  };
}

function passThroughAlerts({ publications }) {
  return Promise.resolve({ publications, results: [] });
}

test('diagnoseFacebookAccount verifies the exact Page identity without publishing', async () => {
  const result = await diagnoseFacebookAccount({
    'diagnose-account': 'poke-quizz-facebook',
  }, {
    runtimeConfig: {
      env: {
        FACEBOOK_GRAPH_API_VERSION: 'v27.0',
        FACEBOOK_POKE_QUIZZ_PAGE_ACCESS_TOKEN: 'secret',
        FACEBOOK_DELIVERY_ENABLED: 'false',
      },
    },
    loadPublicationChannelProfiles: async () => [targetProfile],
    graphClient: {
      async fetchPageIdentity(pageId) {
        assert.equal(pageId, 'page-123');
        return {
          pageId: 'page-123',
          name: 'Poke Quizz',
          username: 'pokequizz',
          link: 'https://www.facebook.com/pokequizz',
        };
      },
    },
  });
  assert.equal(result.identity_verified, true);
  assert.equal(result.media_delivery, 'direct_upload');
  assert.equal(result.delivery_enabled, false);
});

test('resolveFacebookDueAction advances only due or in-progress rows', () => {
  assert.equal(
    resolveFacebookDueAction(publication(), '2026-11-09T16:00:00.000Z'),
    'upload',
  );
  assert.equal(
    resolveFacebookDueAction(publication(), '2026-11-09T15:59:59.000Z'),
    '',
  );
  assert.equal(resolveFacebookDueAction(publication({
    status: 'publishing',
    external_id: 'facebook-video-1',
    metadata: {
      workflow_state: 'publishing',
      next_status_poll_at: '2026-11-09T16:04:00.000Z',
    },
  }), '2026-11-09T16:04:00.000Z'), 'continue');
  assert.equal(
    resolveFacebookDueAction(publication(), '2026-11-10T16:00:01.000Z'),
    'expire',
  );
});

test('executeDueFacebookPublications withdraws untouched rows after the delivery window', async () => {
  let stored = publication();
  let publishCalls = 0;
  const results = await executeDueFacebookPublications({
    'as-of': '2026-11-10T16:00:01.000Z',
  }, {
    runtimeConfig: { env: { FACEBOOK_DELIVERY_ENABLED: 'true' } },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [stored]; },
      async fetchPublicationById() { return null; },
      async updatePublication(_id, patch) {
        stored = { ...stored, ...patch, metadata: patch.metadata };
        return stored;
      },
    },
    deliverPublicationFailureAlerts: passThroughAlerts,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    publishFacebookReel: async () => { publishCalls += 1; },
  });

  assert.equal(publishCalls, 0);
  assert.equal(results.at(-1).action, 'facebook_missed_window_withdrawn');
  assert.equal(stored.status, 'withdrawn');
  assert.equal(stored.scheduled_for, null);
  assert.equal(stored.metadata.delivery_expiry_reason, 'missed_delivery_window');
});

test('executeDueFacebookPublications blocks unattended upload while the live gate is off', async () => {
  const row = publication();
  const results = await executeDueFacebookPublications({
    'as-of': '2026-11-09T16:00:00.000Z',
  }, {
    runtimeConfig: { env: { FACEBOOK_DELIVERY_ENABLED: 'false' } },
    publicationStore: {
      async fetchPublicationsByPlatform() { return [row]; },
      async fetchPublicationById() { return null; },
      async updatePublication() { throw new Error('must not update'); },
    },
    deliverPublicationFailureAlerts: passThroughAlerts,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
  });
  assert.equal(results.at(-1).action, 'facebook_publish_blocked');
  assert.equal(results.at(-1).reason, 'facebook_live_delivery_disabled');
});

test('executeDueFacebookPublications persists direct-upload boundaries and final permalink', async () => {
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
      stored = { ...stored, ...patch, metadata: patch.metadata || stored.metadata };
      patches.push(patch);
      return stored;
    },
  };
  const results = await executeDueFacebookPublications({
    'as-of': '2026-11-09T16:00:00.000Z',
  }, {
    runtimeConfig: { env: { FACEBOOK_DELIVERY_ENABLED: 'true' } },
    publicationStore: store,
    deliverPublicationFailureAlerts: passThroughAlerts,
    deliverSocialPublicationLifecycleAlerts: passThroughAlerts,
    publishFacebookReel: async ({ onInitialized, onUploaded, onFinishRequested }) => {
      await onInitialized({
        videoId: 'facebook-video-1',
        uploadUrl: 'https://rupload.facebook.com/video-upload/1',
      });
      await onUploaded({ videoId: 'facebook-video-1' });
      await onFinishRequested({ videoId: 'facebook-video-1' });
      return {
        workflowState: 'published',
        status: 'ready',
        videoId: 'facebook-video-1',
        externalId: 'facebook-video-1',
        publicUrl: 'https://www.facebook.com/reel/123',
        publishedAt: '2026-11-09T16:01:00.000Z',
      };
    },
  });
  assert.equal(results.at(-1).action, 'facebook_published');
  assert.equal(stored.public_url, 'https://www.facebook.com/reel/123');
  assert.equal(stored.metadata.facebook_video_id, 'facebook-video-1');
  assert.ok(patches.some((patch) => patch.metadata?.facebook_upload_url));
  assert.ok(patches.some((patch) => patch.metadata?.facebook_upload_completed_at));
  assert.ok(patches.some((patch) => patch.metadata?.facebook_finish_requested_at));
});
