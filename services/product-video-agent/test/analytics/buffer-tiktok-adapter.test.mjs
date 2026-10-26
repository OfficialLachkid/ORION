import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchTikTokPublicationMetrics,
  findBufferTikTokTargetAcrossProfiles,
  isBufferInsightsScopeMissing,
  pickBufferMetric,
} from '../../src/analytics/buffer-tiktok-adapter.mjs';

function makeMockClient(responses = []) {
  const calls = [];
  const client = {
    async request(query, variables = {}) {
      calls.push({ query, variables });
      // Match by order of configured responses
      const next = responses.shift();
      if (!next) throw new Error('no scripted response');
      if (next.throws) throw next.throws;
      return next.data;
    },
  };
  return { client, calls };
}

test('pickBufferMetric: picks the first matching name, case-insensitive, from a mixed list', () => {
  const list = [
    { __typename: 'PostMetricNumeric', name: 'Likes', value: 42 },
    { __typename: 'PostMetricNumeric', name: 'comments', value: 7 },
    { __typename: 'PostMetricNumeric', name: 'views', value: 1500 },
  ];
  assert.equal(pickBufferMetric(list, ['views']), 1500);
  assert.equal(pickBufferMetric(list, ['LIKES', 'reactions']), 42);
  // Falls through aliases
  assert.equal(pickBufferMetric(list, ['video_views', 'views']), 1500);
  // Nothing matches
  assert.equal(pickBufferMetric(list, ['shares']), null);
  // Null-safe
  assert.equal(pickBufferMetric(null, ['views']), null);
});

test('pickBufferMetric: ignores non-numeric values', () => {
  const list = [
    { name: 'views', value: 'not-a-number' },
    { name: 'views', value: 500 },
  ];
  assert.equal(pickBufferMetric(list, ['views']), 500);
});

test('isBufferInsightsScopeMissing matches the exact Buffer scope-missing error shape', () => {
  const err = new Error('Buffer API request failed (200): [{"message":"Insufficient scope. Required: insights:read. Granted: posts:read..."}]');
  assert.equal(isBufferInsightsScopeMissing(err), true);
  assert.equal(isBufferInsightsScopeMissing(new Error('Buffer API request failed (401): invalid token')), false);
  assert.equal(isBufferInsightsScopeMissing(new Error('Insufficient scope. Required: posts:write')), false,
    'wrong-scope errors must NOT match insights:read');
});

test('fetchTikTokPublicationMetrics: full-metrics happy path shapes a snapshot matching the YouTube adapter contract', async () => {
  const publication = {
    id: 'pub-tt-001',
    external_id: 'buffer-post-abc',
    title: 'TikTok Reel',
    published_at: '2026-10-18T15:00:00Z',
  };
  const { client, calls } = makeMockClient([
    { data: { post: {
      id: 'buffer-post-abc',
      status: 'sent',
      externalLink: 'https://www.tiktok.com/@pokequizz7/video/7281234567890',
      sentAt: '2026-10-18T15:01:12Z',
      channelService: 'tiktok',
      metricsUpdatedAt: '2026-10-19T06:00:00Z',
      metrics: [
        { __typename: 'PostMetricNumeric', name: 'views', value: 8432 },
        { __typename: 'PostMetricNumeric', name: 'likes', value: 312 },
        { __typename: 'PostMetricNumeric', name: 'comments', value: 11 },
        { __typename: 'PostMetricNumeric', name: 'shares', value: 24 },
      ],
    } } },
  ]);

  const { metrics, raw_payload } = await fetchTikTokPublicationMetrics({
    publication,
    bufferClient: client,
    capturedAt: '2026-10-19T10:00:00Z',
  });

  assert.equal(calls.length, 1, 'single request when the enriched query succeeds');
  assert.equal(metrics.platform, 'tiktok_video');
  assert.equal(metrics.external_id, 'buffer-post-abc');
  assert.equal(metrics.public_url, 'https://www.tiktok.com/@pokequizz7/video/7281234567890');
  assert.equal(metrics.views, 8432);
  assert.equal(metrics.likes, 312);
  assert.equal(metrics.comments, 11);
  assert.equal(metrics.shares, 24);
  assert.equal(metrics.buffer_metrics_updated_at, '2026-10-19T06:00:00Z');
  assert.strictEqual(metrics.buffer_insights_scope_missing, null);
  assert.strictEqual(metrics.buffer_fetch_error, null);
  assert.deepEqual(metrics.viewer_countries, []);
  assert.deepEqual(metrics.traffic_sources, []);
  assert.ok(raw_payload.buffer_post);
});

test('fetchTikTokPublicationMetrics: insights:read scope missing degrades to sparse snapshot (no throw)', async () => {
  // Regression guard for the 2026-10-19 Buffer scope issue — the
  // production token lacked insights:read, so the enriched query 400s
  // on `metrics` + `metricsUpdatedAt`. We retry with the minimal query
  // (status + external link) so the publication still gets a row and
  // the next sweep (post-scope-grant) rolls in real metrics.
  const scopeErr = new Error('Buffer API request failed (200): [{"message":"Insufficient scope. Required: insights:read. Granted: posts:read, posts:write, account:read."}]');
  const publication = { id: 'pub-tt-002', external_id: 'buffer-post-xyz', title: 'Stubbed', published_at: '2026-10-18T15:00:00Z' };
  const { client, calls } = makeMockClient([
    { throws: scopeErr },
    { data: { post: {
      id: 'buffer-post-xyz',
      status: 'sent',
      externalLink: 'https://www.tiktok.com/@pokequizz7/video/7281987654321',
      sentAt: '2026-10-18T15:01:00Z',
      channelService: 'tiktok',
    } } },
  ]);

  const { metrics } = await fetchTikTokPublicationMetrics({
    publication, bufferClient: client, capturedAt: '2026-10-19T10:00:00Z',
  });
  assert.equal(calls.length, 2, 'enriched query failed, minimal query retried');
  assert.strictEqual(metrics.views, null);
  assert.strictEqual(metrics.likes, null);
  assert.equal(metrics.public_url, 'https://www.tiktok.com/@pokequizz7/video/7281987654321');
  assert.equal(metrics.buffer_insights_scope_missing, true);
  assert.match(metrics.buffer_fetch_error, /insights:read scope not granted/u);
});

test('fetchTikTokPublicationMetrics: non-scope errors propagate (we only degrade for the known scope case)', async () => {
  const publication = { id: 'pub-tt-003', external_id: 'buffer-post-xxx', published_at: '2026-10-18T00:00:00Z' };
  const randomErr = new Error('Buffer API request failed (500): internal');
  const { client } = makeMockClient([{ throws: randomErr }]);
  await assert.rejects(
    () => fetchTikTokPublicationMetrics({ publication, bufferClient: client }),
    /500/u,
  );
});

test('fetchTikTokPublicationMetrics refuses on missing external_id or client', async () => {
  await assert.rejects(
    () => fetchTikTokPublicationMetrics({ publication: { id: 'x' }, bufferClient: { request: async () => ({}) } }),
    /external_id/u,
  );
  await assert.rejects(
    () => fetchTikTokPublicationMetrics({ publication: { id: 'x', external_id: 'bp' }, bufferClient: null }),
    /bufferClient/u,
  );
});

test('findBufferTikTokTargetAcrossProfiles finds the target by account_key', () => {
  const target = {
    platform: 'tiktok_video',
    account_key: 'poke-quizz-tiktok',
    buffer: { channel_id: 'buf-abc', organization_id: 'org-123' },
  };
  const profiles = [{
    account_key: 'poke-quizz-youtube',
    metadata: { publisher: { targets: [
      { platform: 'instagram_reels', account_key: 'poke-quizzz-instagram' },
      target,
    ] } },
  }];
  assert.equal(findBufferTikTokTargetAcrossProfiles(profiles, 'poke-quizz-tiktok'), target);
  assert.equal(findBufferTikTokTargetAcrossProfiles(profiles, 'poke-quizzz-instagram'), null,
    'must NOT match an Instagram target even if the account_key is close');
  assert.equal(findBufferTikTokTargetAcrossProfiles([], 'anything'), null);
});
