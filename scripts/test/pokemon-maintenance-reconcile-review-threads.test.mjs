import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePokeQuizzReviewThreads } from '../lib/night-shift/pokemon-maintenance.mjs';

function buildPub(id, overrides = {}) {
  return {
    id,
    status: 'approved',
    external_id: `yt-${id}`,
    preview_url: `https://youtube.com/shorts/yt-${id}`,
    title: `Pub ${id}`,
    account_key: 'poke-quizz-youtube',
    platform: 'youtube_shorts',
    metadata: {
      workflow_state: 'preview_uploaded',
      review_message_id: `msg-${id}`,
      ...overrides.metadata,
    },
    ...overrides,
  };
}

function profilesStub() {
  return [{
    id: 'ch-pq',
    account_key: 'poke-quizz-youtube',
    platform: 'youtube_shorts',
    name: 'Poke Quizz',
    metadata: { review_thread_id: 'thread-1' },
    youtube: { oauth_refresh_token_env: 'YT_REFRESH', oauth_client_secret_path: '/dev/null' },
  }];
}

function storeStub({ pubs, updateCalls }) {
  return {
    async fetchPublicationsByChannel() { return pubs; },
    async updatePublication(id, patch) {
      updateCalls.push({ id, patch });
      const row = pubs.find((p) => p.id === id);
      return { ...row, ...patch, metadata: { ...(row?.metadata || {}), ...(patch.metadata || {}) } };
    },
  };
}

test('reconcilePokeQuizzReviewThreads walks all configured channels and withdraws 404 orphans', async () => {
  const pubs = [
    buildPub('present'),
    buildPub('orphan-1'),
    buildPub('orphan-2'),
    buildPub('other-state', { metadata: { workflow_state: 'published', review_message_id: 'msg-published' } }),
  ];
  const updateCalls = [];
  const youtubeDeleted = [];
  const summary = await reconcilePokeQuizzReviewThreads(
    { env: { YT_REFRESH: 'refresh-token', DISCORD_BOT_TOKEN: 'bot' } },
    '2026-10-03T12:00:00Z',
    {
      loadPublicationChannelProfiles: async () => profilesStub(),
      publicationStore: storeStub({ pubs, updateCalls }),
      checkMessagePresence: async ({ messageId }) => (messageId === 'msg-present' ? { status: 'present' } : { status: 'missing' }),
      deleteYoutubeVideo: async ({ externalId }) => {
        youtubeDeleted.push(externalId);
        return { externalId, deletedAt: '2026-10-03T12:00:00Z' };
      },
      loadYoutubeClientCredentials: async () => ({ clientId: 'x', clientSecret: 'y' }),
      deleteRenderFile: async () => ({ deleted: false, error: '', skipped: true }),
    },
  );

  assert.equal(summary.status, 'completed');
  assert.equal(summary.attemptedChannels, 1);
  assert.equal(summary.processedChannels, 1);
  assert.equal(summary.candidates, 3, 'only preview_uploaded pubs counted');
  assert.equal(summary.present, 1);
  assert.equal(summary.missing, 2);
  assert.equal(summary.errors, 0);
  assert.deepEqual(summary.withdrawnPublicationIds.sort(), ['orphan-1', 'orphan-2']);
  assert.deepEqual(youtubeDeleted.sort(), ['yt-orphan-1', 'yt-orphan-2']);
  const patches = Object.fromEntries(updateCalls.map((c) => [c.id, c.patch]));
  assert.equal(patches['orphan-1'].status, 'withdrawn');
  assert.equal(patches['orphan-1'].metadata.workflow_state, 'withdrawn');
  assert.equal(patches['orphan-1'].metadata.withdrawn_reason, 'review_message_404');
});

test('reconcilePokeQuizzReviewThreads: skips channels without a review thread configured', async () => {
  const profiles = [{
    id: 'ch-noreview',
    account_key: 'other-channel-youtube',
    platform: 'youtube_shorts',
    name: 'Other',
    metadata: {},
    youtube: { oauth_refresh_token_env: 'YT_REFRESH', oauth_client_secret_path: '/dev/null' },
  }];
  const summary = await reconcilePokeQuizzReviewThreads(
    { env: {}, channelIds: {} },
    '2026-10-03T12:00:00Z',
    {
      loadPublicationChannelProfiles: async () => profiles,
      publicationStore: storeStub({ pubs: [], updateCalls: [] }),
      checkMessagePresence: async () => ({ status: 'present' }),
    },
  );
  assert.equal(summary.status, 'skipped');
  assert.equal(summary.attemptedChannels, 0);
});

test('reconcilePokeQuizzReviewThreads: a per-channel exception is isolated and reported, other channels still run', async () => {
  const profiles = [
    { id: 'ch-a', account_key: 'poke-quizz-youtube', platform: 'youtube_shorts', name: 'Poke Quizz', metadata: { review_thread_id: 'thread-a' }, youtube: {} },
    { id: 'ch-b', account_key: 'dexguess-youtube', platform: 'youtube_shorts', name: 'Dexguess', metadata: { review_thread_id: 'thread-b' }, youtube: {} },
  ];
  const updateCalls = [];
  const pubs = { 'poke-quizz-youtube': [buildPub('a-present')], 'dexguess-youtube': [buildPub('b-ok')] };
  const summary = await reconcilePokeQuizzReviewThreads(
    { env: { DISCORD_BOT_TOKEN: 'bot' } },
    '2026-10-03T12:00:00Z',
    {
      loadPublicationChannelProfiles: async () => profiles,
      publicationStore: {
        async fetchPublicationsByChannel({ accountKey }) {
          if (accountKey === 'poke-quizz-youtube') throw new Error('Supabase 500');
          return pubs[accountKey];
        },
        async updatePublication(id, patch) {
          updateCalls.push({ id, patch });
          return { id, ...patch };
        },
      },
      checkMessagePresence: async () => ({ status: 'present' }),
    },
  );
  assert.equal(summary.attemptedChannels, 2);
  assert.equal(summary.processedChannels, 1);
  assert.equal(summary.failedChannels, 1);
  assert.equal(summary.status, 'completed', 'status is completed because one channel succeeded');
  assert.equal(summary.channelErrors[0].channelKey, 'poke-quizz-youtube');
  assert.match(summary.channelErrors[0].error, /Supabase 500/u);
});
