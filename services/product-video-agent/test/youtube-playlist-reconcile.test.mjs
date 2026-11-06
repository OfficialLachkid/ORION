import assert from 'node:assert/strict';
import test from 'node:test';

import {
  planYoutubePlaylistRegistryReconciliation,
  reconcileYoutubePlaylistRegistry,
} from '../src/youtube-playlists/reconcile.mjs';

function entry(overrides = {}) {
  return {
    id: 'registry-1',
    account_key: 'proffmon-youtube',
    playlist_key: 'template:pokemon.find-the-shiny',
    youtube_playlist_id: 'PL-find-shiny',
    title: 'Find The Shiny — All Difficulties',
    description: 'Managed by ORION.',
    privacy: 'public',
    configuration_version: 'youtube-playlists-v1',
    status: 'active',
    ...overrides,
  };
}

test('reconciliation is channel-scoped and reports title and version changes', () => {
  const plan = planYoutubePlaylistRegistryReconciliation({
    accountKey: 'proffmon-youtube',
    entries: [
      entry(),
      entry({
        id: 'registry-stat',
        playlist_key: 'template:pokemon.stat-clash',
        youtube_playlist_id: 'PL-stat',
        title: 'Stat Clash — All Difficulties',
      }),
      entry({ id: 'other-channel', account_key: 'another-channel' }),
    ],
  });
  assert.equal(plan.entries_examined, 2);
  assert.equal(plan.remote_updates, 2);
  assert.equal(plan.registry_updates, 2);
  assert.equal(plan.estimated_write_quota_units, 100);
  assert.equal(plan.items[0].desired_title, 'Find The Shiny');
  assert.equal(plan.items[1].desired_title, 'Stat Clash — Easy to Hard');
});

test('apply updates YouTube only when the title changed and always advances stale policy state', async () => {
  const remoteCalls = [];
  const registryCalls = [];
  const result = await reconcileYoutubePlaylistRegistry({
    accountKey: 'proffmon-youtube',
    apply: true,
    accessToken: 'token',
    entries: [
      entry(),
      entry({
        id: 'registry-stat',
        playlist_key: 'template:pokemon.stat-clash',
        youtube_playlist_id: 'PL-stat',
        title: 'Stat Clash — All Difficulties',
      }),
    ],
    store: {
      async updateYoutubePlaylistRegistryEntry(id, patch) {
        registryCalls.push({ id, patch });
      },
    },
  }, {
    async updateYoutubePlaylistImpl(options) {
      remoteCalls.push(options);
      return { playlistId: options.playlistId, title: options.title, privacy: options.privacy };
    },
  });

  assert.equal(result.dry_run, false);
  assert.equal(remoteCalls.length, 2);
  assert.equal(remoteCalls[0].title, 'Find The Shiny');
  assert.equal(registryCalls.length, 2);
  assert.equal(registryCalls[0].patch.configuration_version, 'youtube-playlists-v3');
  assert.equal(registryCalls[1].patch.title, 'Stat Clash — Easy to Hard');
});

test('rerun is idempotent after title and policy version already match', () => {
  const plan = planYoutubePlaylistRegistryReconciliation({
    accountKey: 'proffmon-youtube',
    entries: [entry({
      title: 'Find The Shiny',
      configuration_version: 'youtube-playlists-v3',
    })],
  });
  assert.equal(plan.remote_updates, 0);
  assert.equal(plan.registry_updates, 0);
  assert.equal(plan.estimated_write_quota_units, 0);
});
