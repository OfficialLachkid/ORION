import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchYoutubeAnalyticsSummary,
  fetchYoutubePublicationMetrics,
} from '../src/analytics/youtube-adapter.mjs';

test('fetchYoutubeAnalyticsSummary uses the sweep capture timestamp to bound reports.query', async () => {
  let requestedUrl = '';
  const summary = await fetchYoutubeAnalyticsSummary({
    externalId: 'yt-abc123',
    accessToken: 'token-123',
    publication: {
      published_at: '2026-08-01T12:00:00.000Z',
    },
    capturedAt: '2026-08-05T06:30:00.000Z',
    fetchImpl: async (url, options) => {
      requestedUrl = String(url);
      assert.equal(options.headers.Authorization, 'Bearer token-123');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            columnHeaders: [
              { name: 'views' },
              { name: 'estimatedMinutesWatched' },
            ],
            rows: [
              [4200, 1337],
            ],
          });
        },
      };
    },
  });

  const parsedUrl = new URL(requestedUrl);
  assert.equal(parsedUrl.origin + parsedUrl.pathname, 'https://youtubeanalytics.googleapis.com/v2/reports');
  assert.equal(parsedUrl.searchParams.get('startDate'), '2026-08-01');
  assert.equal(parsedUrl.searchParams.get('endDate'), '2026-08-05');
  assert.equal(summary.metricsByName.views, 4200);
  assert.equal(summary.metricsByName.estimatedMinutesWatched, 1337);
  assert.equal(summary.fetchLagHours, 90.5);
});

test('fetchYoutubePublicationMetrics merges videos.list statistics with analytics metrics', async () => {
  const result = await fetchYoutubePublicationMetrics({
    publication: {
      external_id: 'yt-xyz789',
      title: 'Fallback title',
      published_at: '2026-08-09T08:00:00.000Z',
    },
    accessToken: 'token-456',
    statistics: {
      statistics: {
        viewCount: '8123',
        likeCount: '301',
        commentCount: '17',
      },
      snippet: {
        title: 'Water Ghost #shorts',
      },
    },
    capturedAt: '2026-08-10T09:00:00.000Z',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          columnHeaders: [
            { name: 'views' },
            { name: 'likes' },
            { name: 'comments' },
            { name: 'shares' },
            { name: 'estimatedMinutesWatched' },
            { name: 'averageViewDuration' },
            { name: 'averageViewPercentage' },
            { name: 'subscribersGained' },
            { name: 'subscribersLost' },
          ],
          rows: [
            [8000, 290, 16, 9, 512, 21.5, 73.2, 6, 1],
          ],
        });
      },
    }),
  });

  assert.equal(result.metrics.external_id, 'yt-xyz789');
  assert.equal(result.metrics.public_url, 'https://youtube.com/shorts/yt-xyz789');
  assert.equal(result.metrics.views, 8123);
  assert.equal(result.metrics.likes, 301);
  assert.equal(result.metrics.comments, 17);
  assert.equal(result.metrics.shares, 9);
  assert.equal(result.metrics.watch_time_minutes, 512);
  assert.equal(result.metrics.avg_view_duration_sec, 21.5);
  assert.equal(result.metrics.avg_view_percentage, 73.2);
  assert.equal(result.metrics.subs_gained, 6);
  assert.equal(result.metrics.subs_lost, 1);
  assert.equal(result.metrics.video_title, 'Water Ghost #shorts');
  assert.deepEqual(result.raw_payload.youtube_videos_item?.statistics, {
    viewCount: '8123',
    likeCount: '301',
    commentCount: '17',
  });
});

test('fetchYoutubePublicationMetrics enriches metrics with viewer geography + traffic source breakdowns', async () => {
  // fetchImpl serves three responses: summary, geo (dimensions=country),
  // and traffic (dimensions=insightTrafficSourceType). Route by URL so
  // the parallel Promise.all doesn't depend on call order.
  const responseFor = (urlString) => {
    const url = new URL(urlString);
    const dims = url.searchParams.get('dimensions') || '';
    if (dims === 'country') {
      return {
        columnHeaders: [{ name: 'country' }, { name: 'views' }],
        rows: [['US', 5000], ['NL', 1200], ['DE', 800]],
      };
    }
    if (dims === 'insightTrafficSourceType') {
      return {
        columnHeaders: [{ name: 'insightTrafficSourceType' }, { name: 'views' }],
        rows: [['YT_CHANNEL', 4200], ['RELATED_VIDEO', 2100], ['EXT_URL', 700]],
      };
    }
    // summary
    return {
      columnHeaders: [{ name: 'views' }, { name: 'likes' }, { name: 'comments' }],
      rows: [[7000, 250, 12]],
    };
  };
  const result = await fetchYoutubePublicationMetrics({
    publication: { external_id: 'yt-geo1', published_at: '2026-09-14T08:00:00.000Z' },
    accessToken: 'token-enriched',
    statistics: { statistics: { viewCount: '7000', likeCount: '250', commentCount: '12' } },
    capturedAt: '2026-09-21T09:00:00.000Z',
    fetchImpl: async (url) => ({
      ok: true, status: 200,
      async text() { return JSON.stringify(responseFor(String(url))); },
    }),
  });

  assert.deepEqual(result.metrics.viewer_countries, [
    { key: 'US', views: 5000 },
    { key: 'NL', views: 1200 },
    { key: 'DE', views: 800 },
  ]);
  assert.deepEqual(result.metrics.traffic_sources, [
    { key: 'YT_CHANNEL', views: 4200 },
    { key: 'RELATED_VIDEO', views: 2100 },
    { key: 'EXT_URL', views: 700 },
  ]);
  assert.ok(result.raw_payload.youtube_analytics_geo, 'geo raw payload must be attached');
  assert.ok(result.raw_payload.youtube_analytics_traffic, 'traffic raw payload must be attached');
});

test('fetchYoutubePublicationMetrics survives a failed geo/traffic enrichment (best-effort)', async () => {
  const result = await fetchYoutubePublicationMetrics({
    publication: { external_id: 'yt-fail1', published_at: '2026-09-14T08:00:00.000Z' },
    accessToken: 'token-fail',
    statistics: { statistics: { viewCount: '500', likeCount: '10', commentCount: '1' } },
    capturedAt: '2026-09-21T09:00:00.000Z',
    fetchImpl: async (url) => {
      const dims = new URL(String(url)).searchParams.get('dimensions') || '';
      // summary succeeds, both dimensioned queries 500 out
      if (dims === '') {
        return {
          ok: true, status: 200,
          async text() {
            return JSON.stringify({
              columnHeaders: [{ name: 'views' }, { name: 'likes' }, { name: 'comments' }],
              rows: [[500, 10, 1]],
            });
          },
        };
      }
      return { ok: false, status: 500, async text() { return 'internalError'; } };
    },
  });

  // Summary metrics must still land
  assert.equal(result.metrics.views, 500);
  // Enrichment fields default to empty arrays instead of throwing
  assert.deepEqual(result.metrics.viewer_countries, []);
  assert.deepEqual(result.metrics.traffic_sources, []);
});
