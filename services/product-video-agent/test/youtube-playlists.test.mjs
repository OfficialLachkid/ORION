import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildYoutubePlaylistTargets,
  resolveYoutubePlaylistConfig,
  syncYoutubePlaylistState,
} from '../src/youtube-playlists/sync.mjs';

function channelProfile(overrides = {}) {
  return {
    id: 'channel-new',
    name: 'New Quiz Channel',
    status: 'active',
    platform: 'youtube_shorts',
    account_key: 'new-quiz-youtube',
    youtube: { channel_id: 'UC-NEW' },
    metadata: {},
    ...overrides,
  };
}

function publication(overrides = {}) {
  return {
    id: 'publication-1',
    account_key: 'new-quiz-youtube',
    platform: 'youtube_shorts',
    external_id: 'youtube-video-1',
    status: 'published',
    visibility: 'public',
    metadata: {
      content_surface: 'youtube_shorts',
      template_id: 'pokemon.find-the-shiny.v1',
      playlist_classification: {
        template_key: 'pokemon.find-the-shiny',
        template_title: 'Find The Shiny',
        difficulty_key: 'hard',
      },
    },
    ...overrides,
  };
}

function createStore() {
  const assignments = new Map();
  const registry = new Map();
  const summaries = [];
  let nextId = 1;
  return {
    assignments,
    registry,
    summaries,
    async ensureYoutubePlaylistAssignments(rows) {
      for (const row of rows) {
        const key = `${row.publication_id}:${row.playlist_key}`;
        if (!assignments.has(key)) assignments.set(key, { id: `assignment-${nextId++}`, attempt_count: 0, ...row });
      }
    },
    async fetchYoutubePlaylistAssignments(publicationId) {
      return [...assignments.values()]
        .filter((row) => row.publication_id === publicationId)
        .map((row) => structuredClone(row));
    },
    async claimYoutubePlaylistAssignment(id, patch) {
      const row = [...assignments.values()].find((entry) => entry.id === id);
      if (!row || !['pending', 'retry'].includes(row.status)) return null;
      Object.assign(row, patch);
      return structuredClone(row);
    },
    async updateYoutubePlaylistAssignment(id, patch) {
      const row = [...assignments.values()].find((entry) => entry.id === id);
      Object.assign(row, patch);
      return structuredClone(row);
    },
    async ensureYoutubePlaylistRegistryEntry(row) {
      const key = `${row.account_key}:${row.playlist_key}`;
      if (!registry.has(key)) registry.set(key, { id: `registry-${nextId++}`, attempt_count: 0, ...row });
    },
    async fetchYoutubePlaylistRegistryEntry(accountKey, playlistKey) {
      return structuredClone(registry.get(`${accountKey}:${playlistKey}`) || null);
    },
    async claimYoutubePlaylistRegistryEntry(id, patch) {
      const row = [...registry.values()].find((entry) => entry.id === id);
      if (!row || !['pending', 'retry'].includes(row.status)) return null;
      Object.assign(row, patch);
      return structuredClone(row);
    },
    async updateYoutubePlaylistRegistryEntry(id, patch) {
      const row = [...registry.values()].find((entry) => entry.id === id);
      Object.assign(row, patch);
      return structuredClone(row);
    },
    async setYoutubePlaylistSummary(publicationId, summary) {
      summaries.push({ publicationId, summary: structuredClone(summary) });
    },
  };
}

test('new active YouTube channels inherit playlist automation without channel-specific code', () => {
  assert.equal(resolveYoutubePlaylistConfig(channelProfile()).enabled, true);
  assert.equal(resolveYoutubePlaylistConfig(channelProfile({ status: 'paused' })).enabled, false);
  assert.equal(resolveYoutubePlaylistConfig(channelProfile({ metadata: { youtube_playlists: { enabled: false } } })).enabled, false);
});

test('a classified short creates template and difficulty targets while long-form creates none', () => {
  const targets = buildYoutubePlaylistTargets({ publication: publication(), channelProfile: channelProfile() });
  assert.deepEqual(targets.map((target) => target.playlist_key), [
    'template:pokemon.find-the-shiny',
    'difficulty:hard',
  ]);
  assert.equal(buildYoutubePlaylistTargets({
    publication: publication({ metadata: { content_surface: 'youtube_watch' } }),
    channelProfile: channelProfile(),
  }).length, 0);
});

test('playlist synchronization lazily creates registries and verifies each video assignment', async () => {
  const store = createStore();
  let tokenRefreshes = 0;
  const result = await syncYoutubePlaylistState({
    store,
    publication: publication(),
    channelProfile: channelProfile(),
    clientConfig: {},
    refreshToken: 'refresh-token',
    asOf: '2026-11-05T12:00:00.000Z',
  }, {
    refreshYoutubeAccessTokenImpl: async () => {
      tokenRefreshes += 1;
      return { accessToken: 'access-token' };
    },
    findYoutubePlaylistByTitleImpl: async () => ({ found: false }),
    createYoutubePlaylistImpl: async ({ title }) => ({
      playlistId: `playlist-${title.toLowerCase().replaceAll(/[^a-z]+/gu, '-')}`,
      title,
      privacy: 'public',
    }),
    insertYoutubePlaylistItemImpl: async ({ playlistId, videoId }) => ({
      playlistItemId: `item-${playlistId}-${videoId}`,
      playlistId,
      videoId,
    }),
  });

  assert.equal(tokenRefreshes, 1);
  assert.equal(result.status, 'verified');
  assert.equal(result.summary.expected_count, 2);
  assert.equal(result.summary.verified_count, 2);
  assert.equal([...store.registry.values()].every((row) => row.status === 'active'), true);
  assert.equal([...store.assignments.values()].every((row) => row.status === 'verified'), true);
});

test('a verified summary prevents Supabase assignment reads and YouTube calls', async () => {
  const current = publication();
  current.metadata.youtube_playlists = {
    status: 'verified',
    configuration_version: 'youtube-playlists-v1',
    target_signature: 'difficulty:hard|template:pokemon.find-the-shiny',
  };
  const result = await syncYoutubePlaylistState({
    store: {
      ensureYoutubePlaylistAssignments() { throw new Error('should not query assignments'); },
    },
    publication: current,
    channelProfile: channelProfile(),
  }, {
    refreshYoutubeAccessTokenImpl: async () => { throw new Error('should not refresh'); },
  });
  assert.equal(result.status, 'verified');
  assert.equal(result.updated, false);
});

test('legacy publications without normalized classification are not silently backfilled', async () => {
  const legacy = publication({
    metadata: {
      content_surface: 'youtube_shorts',
      template_id: 'pokemon.find-the-shiny.v1',
    },
  });
  const result = await syncYoutubePlaylistState({
    store: {},
    publication: legacy,
    channelProfile: channelProfile(),
  });
  assert.equal(result.status, 'skipped');
});
