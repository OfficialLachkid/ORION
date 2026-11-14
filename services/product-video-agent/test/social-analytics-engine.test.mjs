import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  runInstagramAnalyticsSweep,
} from '../scripts/analytics/run-instagram-analytics-sweep.mjs';
import {
  runSocialAnalyticsSweep,
  SOCIAL_ANALYTICS_PUBLICATION_SELECT,
} from '../src/analytics/social-analytics-engine.mjs';

function buildTarget(accountKey) {
  return {
    platform: 'instagram_reels',
    accountKey,
    enabled: true,
    instagram: {
      user_id: `user-${accountKey}`,
      access_token_env: `TOKEN_${accountKey.toUpperCase().replaceAll('-', '_')}`,
    },
  };
}

test('shared social analytics uses compact candidates, due-only capture, minimal writes, and local resume state', async () => {
  const statePath = resolve(tmpdir(), `orion-social-analytics-${Date.now()}.json`);
  const candidateQueries = [];
  const snapshotQueries = [];
  const upserts = [];
  const captureCalls = [];
  const publications = [
    {
      id: 'publication-due',
      video_id: 'video-due',
      platform: 'instagram_reels',
      account_key: 'poke-quizzz-instagram',
      status: 'published',
      external_id: 'media-due',
      title: 'Due Reel',
      published_at: '2026-11-13T10:00:00.000Z',
    },
    {
      id: 'publication-fresh',
      video_id: 'video-fresh',
      platform: 'instagram_reels',
      account_key: 'poke-quizzz-instagram',
      status: 'published',
      external_id: 'media-fresh',
      title: 'Fresh Reel',
      published_at: '2026-11-13T09:00:00.000Z',
    },
  ];
  const store = {
    async fetchPublicationsByChannel(options) {
      candidateQueries.push(options);
      return publications;
    },
    async fetchAnalyticsSnapshotsByPublicationIds(ids, options) {
      snapshotQueries.push({ ids, options });
      return [{
        publication_id: 'publication-fresh',
        captured_at: '2026-11-14T08:00:00.000Z',
        metrics: { views: 12 },
      }];
    },
    async upsertVideoAnalyticsSnapshot(row, options) {
      upserts.push({ row, options });
      return null;
    },
  };

  try {
    const result = await runSocialAnalyticsSweep({
      platform: 'instagram_reels',
      targets: [buildTarget('poke-quizzz-instagram')],
      store,
      statePath,
      capturedAt: '2026-11-14T09:00:00.000Z',
      sleepMs: 0,
      retrySleep: async () => {},
      captureMetrics: async ({ publication, capturedAt }) => {
        captureCalls.push(publication.id);
        return {
          metrics: { views: 25, captured_at: capturedAt },
          raw_payload: { source: 'instagram' },
        };
      },
    });

    assert.equal(result.candidate_count, 2);
    assert.equal(result.due_count, 1);
    assert.equal(result.captured_count, 1);
    assert.deepEqual(captureCalls, ['publication-due']);
    assert.equal(candidateQueries[0].select, SOCIAL_ANALYTICS_PUBLICATION_SELECT);
    assert.equal(candidateQueries[0].select.includes('metadata'), false);
    assert.equal(candidateQueries[0].status, 'eq.published');
    assert.equal(candidateQueries[0].queryClass, 'instagram_reels_analytics_candidates');
    assert.equal(candidateQueries[0].publishedAfter, '2026-10-31T09:00:00.000Z');
    assert.equal(snapshotQueries[0].options.select, 'publication_id,captured_at,metrics');
    assert.deepEqual(upserts[0].options, {
      returnRepresentation: false,
      queryClass: 'instagram_reels_analytics_snapshot_upsert',
    });

    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(
      state.platforms.instagram_reels.latest_snapshots['publication-fresh'].captured_at,
      '2026-11-14T08:00:00.000Z',
    );
    assert.equal(
      state.platforms.instagram_reels.latest_snapshots['publication-due'].captured_at,
      '2026-11-14T09:00:00.000Z',
    );

    snapshotQueries.length = 0;
    captureCalls.length = 0;
    const resumed = await runSocialAnalyticsSweep({
      platform: 'instagram_reels',
      targets: [buildTarget('poke-quizzz-instagram')],
      store,
      statePath,
      capturedAt: '2026-11-14T10:00:00.000Z',
      sleepMs: 0,
      retrySleep: async () => {},
      captureMetrics: async ({ publication }) => {
        captureCalls.push(publication.id);
        return { metrics: {}, raw_payload: {} };
      },
    });

    assert.equal(resumed.due_count, 0);
    assert.equal(snapshotQueries.length, 0);
    assert.equal(captureCalls.length, 0);
  } finally {
    await rm(statePath, { force: true });
  }
});

test('Instagram wrapper discovers enabled accounts dynamically and isolates a failed account', async () => {
  const statePath = resolve(tmpdir(), `orion-instagram-wrapper-${Date.now()}.json`);
  const requestedAccounts = [];
  const profiles = [
    {
      account_key: 'source-one',
      metadata: {
        publisher: {
          targets: [
            {
              platform: 'instagram_reels',
              account_key: 'trivamon-instagram',
              enabled: true,
              instagram: { user_id: 'trivamon-user', access_token_env: 'TRIVAMON_TOKEN' },
            },
            {
              platform: 'instagram_reels',
              account_key: 'disabled-instagram',
              enabled: false,
              instagram: { user_id: 'disabled-user', access_token_env: 'DISABLED_TOKEN' },
            },
          ],
        },
      },
    },
    {
      account_key: 'source-two',
      metadata: {
        publisher: {
          targets: [{
            platform: 'instagram_reels',
            account_key: 'poke-guess-instagram',
            enabled: true,
            instagram: { user_id: 'poke-guess-user', access_token_env: 'POKE_GUESS_TOKEN' },
          }],
        },
      },
    },
  ];
  const store = {
    async fetchPublicationsByChannel({ accountKey }) {
      requestedAccounts.push(accountKey);
      if (accountKey === 'trivamon-instagram') {
        throw new Error('Supabase request failed (503): temporarily unavailable');
      }
      return [];
    },
    async fetchAnalyticsSnapshotsByPublicationIds() {
      return [];
    },
  };

  try {
    const result = await runInstagramAnalyticsSweep({ statePath }, {
      runtimeConfig: { env: {}, runtimePaths: {} },
      profiles,
      store,
      sleepMs: 0,
      retrySleep: async () => {},
      fetchInstagramPublicationMetrics: async () => ({ metrics: {}, raw_payload: {} }),
    });

    assert.deepEqual(requestedAccounts, [
      'trivamon-instagram',
      'trivamon-instagram',
      'trivamon-instagram',
      'trivamon-instagram',
      'poke-guess-instagram',
    ]);
    assert.equal(result.target_count, 2);
    assert.equal(result.failed_count, 1);
    assert.equal(result.failures[0].account_key, 'trivamon-instagram');
    assert.equal(result.retry_recommended, true);
  } finally {
    await rm(statePath, { force: true });
  }
});
