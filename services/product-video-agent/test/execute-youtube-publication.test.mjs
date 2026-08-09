import test from 'node:test';
import assert from 'node:assert/strict';
import process from 'node:process';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const originalArgv1 = process.argv[1];
process.argv[1] = '';
const {
  reconcilePreviewPublications,
  reconcilePublishedPublications,
  reconcileScheduledPublications,
  refreshRelatedVideoAssignments,
} = await import('../scripts/execute-youtube-publication.mjs');
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
    { hour: 14, minute: 0 },
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

function createStore(initialPublication, videoRow = null) {
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
      return videoRow ? structuredClone(videoRow) : null;
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

test('preview reconciliation marks manually published previews as published', async () => {
  const publication = {
    id: 'pub-preview-live',
    video_id: 'video-4a',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'approved',
    visibility: 'unlisted',
    external_id: 'yt-preview-live',
    preview_url: 'https://youtube.com/shorts/yt-preview-live',
    scheduled_for: null,
    metadata: {
      workflow_state: 'preview_uploaded',
      type_pair: ['fairy', 'steel'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcilePreviewPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-04T10:00:00.000Z',
    fetchYoutubeStatuses: async () => ([
      {
        externalId: 'yt-preview-live',
        found: true,
        privacyStatus: 'public',
        publicUrl: 'https://youtube.com/shorts/yt-preview-live',
        publishedAt: '2026-08-04T09:58:00.000Z',
        title: 'Fairy/Steel Pokemon Quiz - Beat the Timer',
      },
    ]),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'published');
  assert.equal(store.current().visibility, 'public');
  assert.equal(store.current().metadata.workflow_state, 'published');
  assert.equal(store.current().metadata.preview_state_reconciled_reason, 'preview_made_public');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-preview-live',
      action: 'preview_reconcile',
      workflow_state: 'published',
      reason: 'preview_made_public',
    },
  ]);
});

test('preview reconciliation marks manually scheduled previews as scheduled', async () => {
  const publication = {
    id: 'pub-preview-scheduled',
    video_id: 'video-4b',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'approved',
    visibility: 'unlisted',
    external_id: 'yt-preview-scheduled',
    preview_url: 'https://youtube.com/shorts/yt-preview-scheduled',
    scheduled_for: null,
    metadata: {
      workflow_state: 'preview_uploaded',
      type_pair: ['rock', 'ground'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcilePreviewPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-04T10:05:00.000Z',
    fetchYoutubeStatuses: async () => ([
      {
        externalId: 'yt-preview-scheduled',
        found: true,
        privacyStatus: 'private',
        publishAt: '2026-08-05T10:00:00.000Z',
        publicUrl: 'https://youtube.com/shorts/yt-preview-scheduled',
      },
    ]),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'scheduled');
  assert.equal(store.current().scheduled_for, '2026-08-05T10:00:00.000Z');
  assert.equal(store.current().metadata.workflow_state, 'scheduled');
  assert.equal(store.current().metadata.preview_state_reconciled_reason, 'preview_scheduled_on_youtube');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-preview-scheduled',
      action: 'preview_reconcile',
      workflow_state: 'scheduled',
      scheduled_for: '2026-08-05T10:00:00.000Z',
      reason: 'preview_scheduled_on_youtube',
    },
  ]);
});

test('published queue reconciliation marks manually hidden videos as withdrawn', async () => {
  const publication = {
    id: 'pub-withdrawn',
    video_id: 'video-5',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'published',
    visibility: 'public',
    external_id: 'yt-withdrawn',
    preview_url: 'https://youtube.com/shorts/yt-withdrawn',
    public_url: 'https://youtube.com/shorts/yt-withdrawn',
    published_at: '2026-08-02T12:00:00.000Z',
    metadata: {
      workflow_state: 'published',
      type_pair: ['ground', 'bug'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcilePublishedPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-03T10:00:00.000Z',
    fetchYoutubeStatuses: async () => ([
      {
        externalId: 'yt-withdrawn',
        found: true,
        privacyStatus: 'private',
        publishAt: null,
        publishedAt: '2026-08-02T12:00:00.000Z',
        title: 'Ground/Bug Type Quiz - Can You Guess?',
        publicUrl: 'https://youtube.com/shorts/yt-withdrawn',
      },
    ]),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'withdrawn');
  assert.equal(store.current().visibility, 'private');
  assert.equal(store.current().metadata.workflow_state, 'withdrawn');
  assert.equal(store.current().metadata.withdrawn_preview_visibility, 'private');
  assert.equal(store.current().metadata.published_state_reconciled_reason, 'youtube_visibility_private');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-withdrawn',
      action: 'published_reconcile',
      workflow_state: 'withdrawn',
      reason: 'youtube_visibility_private',
    },
  ]);
});

test('published queue reconciliation marks manually deleted videos as deleted', async () => {
  const publication = {
    id: 'pub-deleted',
    video_id: 'video-6',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'published',
    visibility: 'public',
    external_id: 'yt-deleted',
    preview_url: 'https://youtube.com/shorts/yt-deleted',
    public_url: 'https://youtube.com/shorts/yt-deleted',
    published_at: '2026-08-02T12:00:00.000Z',
    metadata: {
      workflow_state: 'published',
      type_pair: ['ground', 'bug'],
    },
  };
  const store = createStore(publication);

  const reconciled = await reconcilePublishedPublications({
    publications: [publication],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-08-03T10:05:00.000Z',
    fetchYoutubeStatuses: async () => ([
      {
        externalId: 'yt-deleted',
        found: false,
        privacyStatus: '',
        publishAt: null,
        publishedAt: null,
        title: '',
        publicUrl: 'https://youtube.com/shorts/yt-deleted',
      },
    ]),
  });

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.current().status, 'deleted');
  assert.equal(store.current().external_id, null);
  assert.equal(store.current().metadata.workflow_state, 'deleted');
  assert.equal(store.current().metadata.deleted_preview_url, 'https://youtube.com/shorts/yt-deleted');
  assert.equal(store.current().metadata.published_state_reconciled_reason, 'youtube_video_missing');
  assert.deepEqual(reconciled.results, [
    {
      publication_id: 'pub-deleted',
      action: 'published_reconcile',
      workflow_state: 'deleted',
      reason: 'youtube_video_missing',
    },
  ]);
});

test('related-video refresh backfills planned metadata for existing preview rows', async () => {
  const publication = {
    id: 'pub-review',
    video_id: 'video-review',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'approved',
    visibility: 'unlisted',
    preview_url: 'https://youtube.com/shorts/yt-review',
    metadata: {
      workflow_state: 'preview_uploaded',
      type_pair: ['fire', 'water'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const publishedCandidate = {
    id: 'pub-bug-ground',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'published',
    external_id: 'yt-bug-ground',
    public_url: 'https://youtube.com/shorts/yt-bug-ground',
    published_at: '2026-08-04T08:00:00.000Z',
    title: 'Guess the Pokemon: Bug / Ground',
    metadata: {
      workflow_state: 'published',
      type_pair: ['bug', 'ground'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const store = createStore(publication);

  const refreshed = await refreshRelatedVideoAssignments({
    publications: [publication, publishedCandidate],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    asOf: '2026-08-05T10:00:00.000Z',
    dryRun: false,
    applyScheduled: true,
  });

  assert.equal(store.current().metadata.related_video.selection_status, 'planned');
  assert.equal(store.current().metadata.related_video.target_publication_id, 'pub-bug-ground');
  assert.deepEqual(refreshed.results, [
    {
      publication_id: 'pub-review',
      action: 'related_video_refresh',
      workflow_state: 'preview_uploaded',
      related_video_selection_status: 'planned',
      related_video_target_publication_id: 'pub-bug-ground',
      related_video_capability_status: 'pending',
      related_video_apply_status: 'pending',
    },
  ]);
});

test('related-video refresh applies preview_uploaded rows that already carry an external_id', async () => {
  // Preview rows with an external_id have already been uploaded to YouTube as
  // private — the video exists in Studio, so the related-video setting can be
  // pushed there without waiting for the publication to hit `scheduled` state.
  // Safe because the schedule-time flow re-plans and re-applies anyway, so a
  // preview-time apply can only ever be overwritten by a later, better pick.
  const publication = {
    id: 'pub-preview-with-external',
    video_id: 'video-preview-with-external',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'approved',
    visibility: 'unlisted',
    external_id: 'yt-preview-live',
    preview_url: 'https://youtube.com/shorts/yt-preview-live',
    metadata: {
      workflow_state: 'preview_uploaded',
      type_pair: ['electric', 'ghost'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const publishedCandidate = {
    id: 'pub-fighting-water',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'published',
    external_id: 'yt-related',
    public_url: 'https://youtube.com/shorts/yt-related',
    published_at: '2026-08-04T08:00:00.000Z',
    title: 'Guess the Pokemon: Fighting / Water',
    metadata: {
      workflow_state: 'published',
      type_pair: ['fighting', 'water'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const store = createStore(publication);

  const applyCalls = [];
  const refreshed = await refreshRelatedVideoAssignments({
    publications: [publication, publishedCandidate],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    asOf: '2026-08-05T10:10:00.000Z',
    dryRun: false,
    applyScheduled: true,
    applyYoutubeRelatedVideoSelectionImpl: async (args) => {
      applyCalls.push(args);
      return {
        capability: { status: 'configured' },
        applyStatus: 'applied',
        appliedAt: '2026-08-05T10:10:00.000Z',
        lastAttemptedAt: '2026-08-05T10:10:00.000Z',
        lastError: '',
        studioEditUrl: 'https://studio.youtube.com/video/yt-preview-live/edit?hl=en',
      };
    },
  });

  assert.equal(applyCalls.length, 1);
  assert.equal(applyCalls[0].publication.id, 'pub-preview-with-external');
  assert.equal(store.current().metadata.related_video.apply_status, 'applied');
  assert.equal(store.current().metadata.related_video.capability_status, 'configured');
  assert.deepEqual(refreshed.results, [
    {
      publication_id: 'pub-preview-with-external',
      action: 'related_video_refresh',
      workflow_state: 'preview_uploaded',
      related_video_selection_status: 'planned',
      related_video_target_publication_id: 'pub-fighting-water',
      related_video_capability_status: 'configured',
      related_video_apply_status: 'applied',
    },
  ]);
});

test('related-video refresh reapplies scheduled rows through the automation hook', async () => {
  const publication = {
    id: 'pub-scheduled-related',
    video_id: 'video-scheduled-related',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'scheduled',
    visibility: 'private',
    external_id: 'yt-current',
    scheduled_for: '2026-08-06T06:00:00.000Z',
    preview_url: 'https://youtube.com/shorts/yt-current',
    metadata: {
      workflow_state: 'scheduled',
      type_pair: ['electric', 'ghost'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const publishedCandidate = {
    id: 'pub-fighting-water',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'published',
    external_id: 'yt-related',
    public_url: 'https://youtube.com/shorts/yt-related',
    published_at: '2026-08-04T08:00:00.000Z',
    title: 'Guess the Pokemon: Fighting / Water',
    metadata: {
      workflow_state: 'published',
      type_pair: ['fighting', 'water'],
      template_id: 'pokemon-type-challenge-v1',
    },
  };
  const store = createStore(publication);

  const refreshed = await refreshRelatedVideoAssignments({
    publications: [publication, publishedCandidate],
    store,
    runtimeConfig: { env: {} },
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    asOf: '2026-08-05T10:05:00.000Z',
    dryRun: false,
    applyScheduled: true,
    applyYoutubeRelatedVideoSelectionImpl: async () => ({
      capability: { status: 'configured' },
      applyStatus: 'applied',
      appliedAt: '2026-08-05T10:05:00.000Z',
      lastAttemptedAt: '2026-08-05T10:05:00.000Z',
      lastError: '',
      studioEditUrl: 'https://studio.youtube.com/video/yt-current/edit',
    }),
  });

  assert.equal(store.current().metadata.related_video.target_publication_id, 'pub-fighting-water');
  assert.equal(store.current().metadata.related_video.apply_status, 'applied');
  assert.equal(store.current().metadata.related_video.capability_status, 'configured');
  assert.deepEqual(refreshed.results, [
    {
      publication_id: 'pub-scheduled-related',
      action: 'related_video_refresh',
      workflow_state: 'scheduled',
      related_video_selection_status: 'planned',
      related_video_target_publication_id: 'pub-fighting-water',
      related_video_capability_status: 'configured',
      related_video_apply_status: 'applied',
    },
  ]);
});
