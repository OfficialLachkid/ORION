import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const originalArgv1 = process.argv[1];
process.argv[1] = '';
const { reconcileScheduledPublications } = await import('../scripts/execute-youtube-publication.mjs');
process.argv[1] = originalArgv1;

const channelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  timezone: 'Europe/Amsterdam',
  schedule_slots: [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 16, minute: 0 },
  ],
  workflow: {
    preview_visibility: 'unlisted',
    publish_visibility: 'public',
    require_preview_approval: true,
    require_publish_approval: true,
    delete_preview_on_reject: true,
  },
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
});

function createStore(initialPublication) {
  let currentPublication = structuredClone(initialPublication);
  const updateCalls = [];
  return {
    updateCalls,
    async updatePublication(id, patch) {
      assert.equal(id, currentPublication.id);
      currentPublication = {
        ...currentPublication,
        ...patch,
        metadata: {
          ...(currentPublication.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
      updateCalls.push({ id, patch: structuredClone(patch) });
      return structuredClone(currentPublication);
    },
    async fetchVideoById() {
      return null;
    },
    current() {
      return structuredClone(currentPublication);
    },
  };
}

test('scheduled queue reconciliation reopens a missing YouTube video for approval', async () => {
  const publication = {
    id: 'pub-missing',
    video_id: 'video-1',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'scheduled',
    visibility: 'private',
    external_id: 'yt-missing',
    preview_url: 'https://youtube.com/shorts/yt-missing',
    scheduled_for: '2026-08-03T06:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      type_pair: ['water', 'fire'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcileScheduledPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-02T12:00:00.000Z',
    fetchYoutubeStatus: async () => ({ found: false }),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'deleted');
  assert.equal(store.current().external_id, null);
  assert.equal(store.current().scheduled_for, null);
  assert.equal(store.current().metadata.workflow_state, 'deleted');
  assert.equal(store.current().metadata.schedule_reconciled_reason, 'youtube_video_missing');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-missing',
      action: 'queue_reconcile',
      workflow_state: 'deleted',
      reason: 'youtube_video_missing',
    },
  ]);
});

test('scheduled queue reconciliation returns hidden previews to preview_approved so slots can refill', async () => {
  const publication = {
    id: 'pub-unscheduled',
    video_id: 'video-2',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'scheduled',
    visibility: 'private',
    external_id: 'yt-unscheduled',
    preview_url: 'https://youtube.com/shorts/yt-unscheduled',
    scheduled_for: '2026-08-03T10:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      type_pair: ['electric', 'ghost'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcileScheduledPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-02T12:00:00.000Z',
    fetchYoutubeStatus: async () => ({
      found: true,
      privacyStatus: 'private',
      publishAt: '',
    }),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'approved');
  assert.equal(store.current().scheduled_for, null);
  assert.equal(store.current().metadata.workflow_state, 'preview_approved');
  assert.equal(store.current().metadata.schedule_reconciled_reason, 'youtube_publish_time_missing');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-unscheduled',
      action: 'queue_reconcile',
      workflow_state: 'preview_approved',
      reason: 'youtube_publish_time_missing',
    },
  ]);
});

test('scheduled queue reconciliation keeps just-due private videos scheduled during publish grace', async () => {
  const publication = {
    id: 'pub-grace',
    video_id: 'video-3',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'scheduled',
    visibility: 'private',
    external_id: 'yt-grace',
    preview_url: 'https://youtube.com/shorts/yt-grace',
    scheduled_for: '2026-08-03T06:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      type_pair: ['bug', 'poison'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcileScheduledPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-03T06:10:00.000Z',
    fetchYoutubeStatus: async () => ({
      found: true,
      privacyStatus: 'private',
      publishAt: '',
    }),
  });

  assert.equal(store.updateCalls.length, 0);
  assert.equal(store.current().status, 'scheduled');
  assert.equal(store.current().scheduled_for, '2026-08-03T06:00:00.000Z');
  assert.equal(store.current().metadata.workflow_state, 'scheduled');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-grace',
      action: 'queue_reconcile',
      workflow_state: 'scheduled',
      scheduled_for: '2026-08-03T06:00:00.000Z',
      reason: 'awaiting_youtube_publish_grace',
    },
  ]);
});

test('scheduled queue reconciliation marks overdue public videos as published', async () => {
  const publication = {
    id: 'pub-live',
    video_id: 'video-4',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'scheduled',
    visibility: 'private',
    external_id: 'yt-live',
    preview_url: 'https://youtube.com/shorts/yt-live',
    scheduled_for: '2026-08-03T06:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      type_pair: ['bug', 'poison'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcileScheduledPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-03T06:05:00.000Z',
    fetchYoutubeStatus: async () => ({
      found: true,
      privacyStatus: 'public',
      publicUrl: 'https://youtube.com/shorts/yt-live',
      publishedAt: '2026-08-03T06:00:20.000Z',
      title: 'Bug/Poison Type Quiz - Can You Guess?',
    }),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'published');
  assert.equal(store.current().visibility, 'public');
  assert.equal(store.current().metadata.workflow_state, 'published');
  assert.equal(store.current().published_at, '2026-08-03T06:00:20.000Z');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-live',
      action: 'queue_reconcile',
      workflow_state: 'published',
      reason: 'already_public',
    },
  ]);
});
