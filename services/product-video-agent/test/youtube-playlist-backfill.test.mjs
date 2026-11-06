import assert from 'node:assert/strict';
import test from 'node:test';

import { SupabasePublicationStore } from '../src/publication-store.mjs';
import { normalizeRuntimePublication } from '../src/publication-runtime-snapshot.mjs';
import {
  resolvePublicationPlaylistClassification,
  YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
} from '../src/youtube-playlists/classification.mjs';
import {
  deriveLegacyPlaylistClassification,
  executeYoutubePlaylistBackfill,
  MAX_PLAYLIST_BACKFILL_LIMIT,
  normalizePlaylistBackfillLimit,
  planYoutubePlaylistBackfill,
} from '../src/youtube-playlists/backfill.mjs';

function channelProfile(overrides = {}) {
  return {
    id: 'proffmon-youtube',
    name: 'ProffMon',
    status: 'active',
    platform: 'youtube_shorts',
    account_key: 'proffmon-youtube',
    youtube: { channel_id: 'UC-PROFFMON' },
    metadata: {},
    ...overrides,
  };
}

function publicationRow(overrides = {}) {
  return {
    id: 'publication-1',
    account_key: 'proffmon-youtube',
    platform: 'youtube_shorts',
    status: 'published',
    visibility: 'public',
    external_id: 'youtube-video-1',
    published_at: '2026-11-05T12:00:00.000Z',
    content_surface: 'youtube_shorts',
    playlist_enabled: 'true',
    template_id: 'pokemon.find-the-shiny.v1',
    video_difficulty: 'hard',
    ...overrides,
  };
}

test('legacy playlist classification uses reusable template and difficulty signals', () => {
  assert.equal(normalizePlaylistBackfillLimit(500), MAX_PLAYLIST_BACKFILL_LIMIT);
  const result = deriveLegacyPlaylistClassification(publicationRow());
  assert.equal(result.reason, 'legacy_classification_derived');
  assert.deepEqual(result.classification, {
    schema_version: 'youtube-playlist-classification-v1',
    template_key: 'pokemon.find-the-shiny',
    template_title: 'Find The Shiny',
    difficulty_key: 'hard',
  });

  assert.equal(deriveLegacyPlaylistClassification(publicationRow({ visibility: 'private' })).classification, null);
  assert.equal(deriveLegacyPlaylistClassification(publicationRow({ content_surface: 'youtube_watch' })).classification, null);
  assert.equal(deriveLegacyPlaylistClassification(publicationRow({ playlist_enabled: 'false' })).classification, null);
});

test('backfill is channel-scoped, capped, idempotency-aware, and reports quota upper bounds', () => {
  assert.equal(normalizePlaylistBackfillLimit(5_000), MAX_PLAYLIST_BACKFILL_LIMIT);
  const rows = [
    publicationRow(),
    publicationRow({
      id: 'publication-verified',
      external_id: 'youtube-video-2',
      youtube_playlist_status: 'verified',
      youtube_playlist_configuration_version: YOUTUBE_PLAYLIST_CONFIGURATION_VERSION,
      youtube_playlist_target_signature: 'difficulty:hard|template:pokemon.find-the-shiny',
    }),
    publicationRow({ id: 'wrong-channel', account_key: 'another-channel' }),
  ];
  const plan = planYoutubePlaylistBackfill({ rows, channelProfile: channelProfile(), limit: 10 });

  assert.equal(plan.rows_examined, 3);
  assert.equal(plan.eligible_videos, 2);
  assert.equal(plan.pending_videos, 1);
  assert.equal(plan.already_verified_videos, 1);
  assert.deepEqual(plan.unique_playlist_keys, [
    'template:pokemon.find-the-shiny',
    'difficulty:hard',
  ]);
  assert.equal(plan.estimated_playlist_creates_upper_bound, 2);
  assert.equal(plan.estimated_assignment_inserts, 2);
  assert.equal(plan.estimated_write_quota_units_upper_bound, 200);
  assert.deepEqual(plan.skipped, [{ publication_id: 'wrong-channel', reason: 'channel_scope_mismatch' }]);
});

test('dry-run performs no schema checks, metadata writes, or YouTube synchronization', async () => {
  const result = await executeYoutubePlaylistBackfill({
    store: {
      verifyYoutubePlaylistAutomationSchema() { throw new Error('dry-run must not query schema'); },
      setYoutubePlaylistBackfillClassification() { throw new Error('dry-run must not write'); },
    },
    rows: [publicationRow()],
    channelProfile: channelProfile(),
    apply: false,
  }, {
    syncYoutubePlaylistStateImpl() { throw new Error('dry-run must not call YouTube sync'); },
  });

  assert.equal(result.dry_run, true);
  assert.equal(result.pending_videos, 1);
});

test('candidate query is an exact-channel compact projection rather than full metadata', async () => {
  let requestedUrl = null;
  const store = new SupabasePublicationStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'service-key',
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  await store.fetchYoutubePlaylistBackfillCandidates({ accountKey: 'proffmon-youtube', limit: 10 });

  assert.equal(requestedUrl.searchParams.get('account_key'), 'eq.proffmon-youtube');
  assert.equal(requestedUrl.searchParams.get('limit'), '10');
  assert.equal(requestedUrl.searchParams.get('order'), 'published_at.desc');
  assert.doesNotMatch(requestedUrl.searchParams.get('select'), /(^|,)metadata(,|$)/u);
  assert.match(requestedUrl.searchParams.get('select'), /template_id:metadata->>template_id/u);
});

test('compact reconciliation snapshots preserve a persisted backfill classification', () => {
  const publication = normalizeRuntimePublication({
    ...publicationRow(),
    youtube_playlist_status: 'pending',
    youtube_playlist_backfill_template_key: 'pokemon.find-the-shiny',
    youtube_playlist_backfill_template_title: 'Find The Shiny',
    youtube_playlist_backfill_difficulty_key: 'hard',
  });
  assert.equal(
    resolvePublicationPlaylistClassification(publication)?.template_key,
    'pokemon.find-the-shiny',
  );
});

test('compact reconciliation snapshots derive playlist classification from template id', () => {
  const publication = normalizeRuntimePublication(publicationRow({
    published_at: '2026-11-06T11:00:06.000Z',
    playlist_template_key: null,
    youtube_playlist_status: null,
    youtube_playlist_backfill_template_key: null,
  }));

  assert.deepEqual(resolvePublicationPlaylistClassification(publication), {
    schema_version: 'youtube-playlist-classification-v1',
    template_key: 'pokemon.find-the-shiny',
    template_title: 'Find The Shiny',
  });
});

test('apply validates schema and persists resumable classification before sequential sync', async () => {
  const events = [];
  let activeSyncs = 0;
  let maxActiveSyncs = 0;
  const rows = [
    publicationRow(),
    publicationRow({ id: 'publication-2', external_id: 'youtube-video-2' }),
  ];
  const result = await executeYoutubePlaylistBackfill({
    store: {
      async verifyYoutubePlaylistAutomationSchema() { events.push('schema'); },
      async setYoutubePlaylistBackfillClassification(publicationId, classification) {
        events.push(`persist:${publicationId}:${classification.template_key}`);
      },
    },
    rows,
    channelProfile: channelProfile(),
    clientConfig: {},
    refreshToken: 'refresh-token',
    apply: true,
    asOf: '2026-11-05T13:00:00.000Z',
  }, {
    async syncYoutubePlaylistStateImpl({ publication }) {
      activeSyncs += 1;
      maxActiveSyncs = Math.max(maxActiveSyncs, activeSyncs);
      events.push(`sync:${publication.id}`);
      assert.equal(
        publication.metadata.youtube_playlists.backfill_classification.template_key,
        'pokemon.find-the-shiny',
      );
      await Promise.resolve();
      activeSyncs -= 1;
      return { status: 'verified', reason: 'playlist_assignments_verified' };
    },
  });

  assert.equal(result.dry_run, false);
  assert.equal(result.results.length, 2);
  assert.equal(maxActiveSyncs, 1);
  assert.deepEqual(events, [
    'schema',
    'persist:publication-1:pokemon.find-the-shiny',
    'sync:publication-1',
    'persist:publication-2:pokemon.find-the-shiny',
    'sync:publication-2',
  ]);
});
