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
