import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchAnalyticsSnapshotHistory,
  mergeAnalyticsSnapshotRows,
  retryAnalyticsOperation,
} from '../src/analytics/snapshot-reader.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';

test('retryAnalyticsOperation retries transient gateway failures with exponential delays', async () => {
  let attempts = 0;
  const delays = [];

  const result = await retryAnalyticsOperation(async () => {
    attempts += 1;
    if (attempts < 3) {
      throw new Error('Supabase video_analytics request failed (504): Gateway Timeout');
    }
    return 'ok';
  }, {
    maxAttempts: 4,
    baseDelayMs: 100,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('fetchAnalyticsSnapshotHistory reads publication histories in bounded batches', async () => {
  const publications = Array.from({ length: 51 }, (_value, index) => ({
    id: `publication-${index + 1}`,
  }));
  const batchSizes = [];
  const queryOptions = [];
  let calls = 0;
  const store = {
    async fetchAnalyticsSnapshotsByPublicationIds(publicationIds, options) {
      calls += 1;
      batchSizes.push(publicationIds.length);
      queryOptions.push(options);
      if (calls === 1) {
        throw new Error('Supabase video_analytics request failed (504): Gateway Timeout');
      }
      return publicationIds.map((publicationId) => ({
        publication_id: publicationId,
        captured_at: '2026-09-14T07:00:00.000Z',
        metrics: { views: 100 },
      }));
    },
  };

  const history = await fetchAnalyticsSnapshotHistory({
    store,
    publications,
    batchSize: 25,
    maxAttempts: 2,
    baseDelayMs: 1,
    sleep: async () => {},
    capturedAfter: '2026-09-06T07:00:00.000Z',
  });

  assert.deepEqual(batchSizes, [25, 25, 25, 1]);
  assert.equal(queryOptions.every((options) => (
    options.capturedAfter === '2026-09-06T07:00:00.000Z'
      && options.select === 'publication_id,captured_at,metrics'
  )), true);
  assert.equal(history.snapshots.length, 51);
  assert.equal(history.snapshotsByPublicationId.size, 51);
  assert.equal(history.latestByPublicationId.size, 51);
});

test('SupabasePublicationStore applies the analytics lookback filter and compact projection', async () => {
  let requestUrl = '';
  const store = new SupabasePublicationStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'service-key',
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    },
  });

  await store.fetchAnalyticsSnapshotsByPublicationIds(['publication-1'], {
    select: 'publication_id,captured_at,metrics',
    capturedAfter: '2026-09-06T07:00:00.000Z',
  });

  const url = new URL(requestUrl);
  assert.equal(url.searchParams.get('select'), 'publication_id,captured_at,metrics');
  assert.equal(url.searchParams.get('captured_at'), 'gte.2026-09-06T07:00:00.000Z');
});

test('SupabasePublicationStore supports compact channel publication projections', async () => {
  let requestUrl = '';
  const store = new SupabasePublicationStore({
    supabaseUrl: 'https://example.supabase.co',
    apiKey: 'service-key',
    fetchImpl: async (url) => {
      requestUrl = String(url);
      return {
        ok: true,
        status: 200,
        text: async () => '[]',
      };
    },
  });

  await store.fetchPublicationsByChannel({
    platform: 'youtube_shorts',
    accountKey: 'poke-quizz-youtube',
    select: 'id,status,workflow_state:metadata->>workflow_state',
    status: 'not.in.(published,deleted)',
  });

  const url = new URL(requestUrl);
  assert.equal(url.searchParams.get('select'), 'id,status,workflow_state:metadata->>workflow_state');
  assert.equal(url.searchParams.get('platform'), 'eq.youtube_shorts');
  assert.equal(url.searchParams.get('account_key'), 'eq.poke-quizz-youtube');
  assert.equal(url.searchParams.get('status'), 'not.in.(published,deleted)');
});

test('mergeAnalyticsSnapshotRows deduplicates overlap and prunes stale or unrelated cache rows', () => {
  const rows = mergeAnalyticsSnapshotRows({
    cachedSnapshots: [
      { publication_id: 'publication-1', captured_at: '2026-09-05T07:00:00.000Z', metrics: { views: 5 } },
      { publication_id: 'publication-1', captured_at: '2026-09-10T07:00:00.000Z', metrics: { views: 10 } },
      { publication_id: 'removed-publication', captured_at: '2026-09-10T07:00:00.000Z', metrics: { views: 20 } },
    ],
    fetchedSnapshots: [
      { publication_id: 'publication-1', captured_at: '2026-09-10T07:00:00.000Z', metrics: { views: 11 } },
      { publication_id: 'publication-2', captured_at: '2026-09-11T07:00:00.000Z', metrics: { views: 30 } },
    ],
    publicationIds: ['publication-1', 'publication-2'],
    retainedAfter: '2026-09-06T07:00:00.000Z',
  });

  assert.deepEqual(rows.map((row) => [row.publication_id, row.metrics.views]), [
    ['publication-2', 30],
    ['publication-1', 11],
  ]);
});
