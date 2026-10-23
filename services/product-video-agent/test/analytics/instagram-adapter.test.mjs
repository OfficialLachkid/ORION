import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchInstagramPublicationMetrics,
  findInstagramTargetAcrossProfiles,
  resolveInstagramTarget,
} from '../../src/analytics/instagram-adapter.mjs';

function makeChannelProfile(instagramTarget) {
  return {
    account_key: 'poke-quizz-youtube',
    platform: 'youtube_shorts',
    metadata: {
      publisher: {
        targets: [
          {
            platform: 'tiktok_video',
            account_key: 'poke-quizz-tiktok',
            buffer: { channel_id: 'buf-123' },
          },
          instagramTarget,
        ],
      },
    },
  };
}

function makeInstagramTarget(overrides = {}) {
  return {
    platform: 'instagram_reels',
    account_key: 'poke-quizzz-instagram',
    enabled: true,
    instagram: {
      user_id: '17841467563066221',
      expected_username: 'pokequizzz',
      access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
    },
    ...overrides,
  };
}

// Mock Graph client — captures the paths it was asked for and returns
// scripted responses by regex. Mirrors what the real client's
// `request(pathname, { query })` does.
function makeMockClient(scriptedResponses = []) {
  const calls = [];
  const client = {
    async request(pathname, options = {}) {
      calls.push({ pathname, query: options.query });
      const match = scriptedResponses.find((entry) => entry.match.test(pathname));
      if (!match) throw new Error(`unexpected request: ${pathname}`);
      if (match.throws) throw match.throws;
      return match.payload;
    },
  };
  return { client, calls };
}

test('resolveInstagramTarget finds the Instagram target in a channel profile by account_key', () => {
  const target = makeInstagramTarget();
  const profile = makeChannelProfile(target);
  assert.equal(resolveInstagramTarget(profile, 'poke-quizzz-instagram'), target);
});

test('resolveInstagramTarget returns null when the key does not match any Instagram target', () => {
  const profile = makeChannelProfile(makeInstagramTarget());
  assert.equal(resolveInstagramTarget(profile, 'poke-guess-instagram'), null);
  assert.equal(resolveInstagramTarget(profile, 'poke-quizz-tiktok'), null,
    'must NOT match a TikTok target even if the account_key accidentally overlapped');
  assert.equal(resolveInstagramTarget(profile, ''), null);
  assert.equal(resolveInstagramTarget({}, 'anything'), null);
});

test('findInstagramTargetAcrossProfiles walks every profile until it finds the Instagram target', () => {
  const targetA = makeInstagramTarget();
  const targetB = makeInstagramTarget({ account_key: 'trivamon-instagram', instagram: { user_id: '999', access_token_env: 'INSTAGRAM_TRIVAMON_ACCESS_TOKEN' } });
  const profiles = [makeChannelProfile(targetA), makeChannelProfile(targetB)];
  assert.equal(findInstagramTargetAcrossProfiles(profiles, 'trivamon-instagram'), targetB);
  assert.equal(findInstagramTargetAcrossProfiles(profiles, 'nowhere-instagram'), null);
});

test('fetchInstagramPublicationMetrics shapes a snapshot that matches the YouTube adapter contract', async () => {
  const publication = {
    id: 'pub-001',
    external_id: '18001234567890',
    title: 'Test Reel',
    published_at: '2026-10-18T12:34:56Z',
  };
  const target = makeInstagramTarget();
  const { client, calls } = makeMockClient([
    {
      match: /^\d+\/insights$/u,
      payload: {
        data: [
          { name: 'views', values: [{ value: 12345 }] },
          { name: 'reach', values: [{ value: 9000 }] },
          { name: 'shares', values: [{ value: 42 }] },
          { name: 'saved', values: [{ value: 17 }] },
          { name: 'total_interactions', values: [{ value: 410 }] },
          { name: 'ig_reels_avg_watch_time', values: [{ value: 8500 }] }, // 8.5s in ms
          { name: 'ig_reels_video_view_total_time', values: [{ value: 90000 }] }, // 1.5min in ms
        ],
      },
    },
    {
      match: /^\d+$/u,
      payload: {
        id: '18001234567890',
        media_type: 'VIDEO',
        permalink: 'https://instagram.com/reel/abcdef',
        timestamp: '2026-10-18T12:34:56Z',
        like_count: 350,
        comments_count: 18,
      },
    },
  ]);

  const result = await fetchInstagramPublicationMetrics({
    publication,
    target,
    graphClient: client,
    capturedAt: '2026-10-19T10:00:00Z',
  });

  // Request shape: media GET + insights GET, both scoped to the external_id.
  // The exact metric name list matters — Instagram Graph 400s the whole
  // response if any metric name is wrong (confirmed 2026-10-19 live). The
  // original `plays` / `saves` spellings were rejected; `views` and `saved`
  // are the accepted canonical names.
  assert.equal(calls.length, 2);
  assert.ok(calls.some((c) => c.pathname === '18001234567890' && (c.query?.fields || '').includes('like_count')));
  const insightsCall = calls.find((c) => c.pathname === '18001234567890/insights');
  assert.ok(insightsCall, 'insights call made');
  const metricParam = insightsCall.query?.metric || '';
  assert.ok(metricParam.includes('views'), 'uses canonical `views` (not `plays`)');
  assert.ok(metricParam.includes('saved'), 'uses canonical `saved` (not `saves`)');
  assert.ok(!metricParam.includes('plays'), 'must not request the deprecated `plays` name');
  assert.ok(!/\bsaves\b/u.test(metricParam), 'must not request the deprecated `saves` name');

  const { metrics, raw_payload } = result;
  assert.equal(metrics.platform, 'instagram_reels');
  assert.equal(metrics.external_id, '18001234567890');
  assert.equal(metrics.public_url, 'https://instagram.com/reel/abcdef');
  assert.equal(metrics.views, 12345);
  assert.equal(metrics.unique_viewers, 9000);
  assert.equal(metrics.likes, 350);
  assert.equal(metrics.comments, 18);
  assert.equal(metrics.shares, 42);
  assert.equal(metrics.saves, 17, 'response `saved` normalises to shared `saves` field');
  assert.equal(metrics.total_interactions, 410);
  // Instagram DOES expose watch-time insights (unlike YouTube today).
  // Milliseconds get normalised to seconds + minutes so the review code
  // reads them with the same keys as YouTube.
  assert.equal(metrics.avg_view_duration_sec, 8.5);
  assert.equal(metrics.watch_time_minutes, 1.5);
  // Fields Instagram Graph doesn't expose must be explicitly null, not undefined
  assert.strictEqual(metrics.retention_curve, null);
  // Empty geo + traffic arrays keep the weekly review's aggregator happy
  assert.deepEqual(metrics.viewer_countries, []);
  assert.deepEqual(metrics.traffic_sources, []);
  assert.equal(metrics.captured_at, '2026-10-19T10:00:00Z');
  assert.equal(metrics.published_at, '2026-10-18T12:34:56Z');
  // Raw payload preserved for later debugging
  assert.ok(raw_payload.instagram_media);
  assert.ok(raw_payload.instagram_insights);
});

test('fetchInstagramPublicationMetrics: insights 400 (e.g. metric unsupported) does NOT tank the snapshot — keeps like/comment counts', async () => {
  // Regression guard: Instagram sometimes 400s the whole /insights
  // response when one requested metric isn't available on that media
  // (e.g. `plays` on an IMAGE). We still want to write a row with the
  // media-level engagement counts.
  const { InstagramGraphApiError } = await import('../../src/instagram-publication-executor.mjs');
  const publication = { id: 'pub-002', external_id: '18009999', title: 'Carousel maybe', published_at: '2026-10-10T10:00:00Z' };
  const target = makeInstagramTarget();
  const { client } = makeMockClient([
    { match: /^\d+\/insights$/u, throws: new InstagramGraphApiError('metric not available', { status: 400 }) },
    { match: /^\d+$/u, payload: { id: '18009999', permalink: 'https://instagram.com/x', like_count: 20, comments_count: 2 } },
  ]);

  const { metrics, raw_payload } = await fetchInstagramPublicationMetrics({ publication, target, graphClient: client });
  assert.equal(metrics.likes, 20, 'likes still captured from the /media fetch');
  assert.equal(metrics.comments, 2);
  assert.strictEqual(metrics.views, null, 'views null when insights failed');
  assert.ok(raw_payload.instagram_insights.__error, 'raw payload preserves the insights error for debugging');
});

test('fetchInstagramPublicationMetrics refuses on missing external_id or target', async () => {
  const target = makeInstagramTarget();
  const { client } = makeMockClient([]);
  await assert.rejects(
    () => fetchInstagramPublicationMetrics({ publication: { id: 'x' }, target, graphClient: client }),
    /external_id/u,
  );
  await assert.rejects(
    () => fetchInstagramPublicationMetrics({ publication: { id: 'x', external_id: '123' }, target: null, graphClient: client }),
    /publisher target/u,
  );
});

test('fetchInstagramPublicationMetrics: missing like_count field returns null, not NaN', async () => {
  // Reels / recent accounts sometimes have `like_count` omitted when
  // the user disabled the counter. Don't let that become NaN downstream.
  const publication = { id: 'pub-003', external_id: '18008', title: 'No counter', published_at: '2026-10-18T00:00:00Z' };
  const target = makeInstagramTarget();
  const { client } = makeMockClient([
    { match: /^\d+\/insights$/u, payload: { data: [{ name: 'views', values: [{ value: 500 }] }] } },
    { match: /^\d+$/u, payload: { id: '18008', permalink: 'https://instagram.com/reel/x' /* no like_count / comments_count */ } },
  ]);
  const { metrics } = await fetchInstagramPublicationMetrics({ publication, target, graphClient: client });
  assert.strictEqual(metrics.likes, null);
  assert.strictEqual(metrics.comments, null);
  assert.equal(metrics.views, 500);
});
