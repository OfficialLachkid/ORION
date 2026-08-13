import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChannelVideoAnalyticsDigest,
  buildVideoAnalyticsOverviewDigest,
  buildVideoAnalyticsThreadName,
  resolveVideoAnalyticsCapturePlan,
} from '../src/video-analytics.mjs';

const channelProfile = {
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  account_key: 'poke-quizz-youtube',
  platform: 'youtube_shorts',
  timezone: 'Europe/Amsterdam',
};

test('resolveVideoAnalyticsCapturePlan applies age-based cadence windows', () => {
  const publications = [
    {
      id: 'pub-fresh',
      published_at: '2026-08-12T08:00:00.000Z',
    },
    {
      id: 'pub-mid',
      published_at: '2026-08-05T08:00:00.000Z',
    },
    {
      id: 'pub-old',
      published_at: '2026-07-20T08:00:00.000Z',
    },
  ];
  const latestSnapshotsByPublicationId = new Map([
    ['pub-mid', { publication_id: 'pub-mid', captured_at: '2026-08-11T12:30:00.000Z' }],
    ['pub-old', { publication_id: 'pub-old', captured_at: '2026-08-04T08:00:00.000Z' }],
  ]);

  const plan = resolveVideoAnalyticsCapturePlan({
    publications,
    latestSnapshotsByPublicationId,
    capturedAt: '2026-08-12T10:00:00.000Z',
  });

  assert.equal(plan[0].cadence_hours, 4);
  assert.equal(plan[0].due, true);
  assert.equal(plan[1].cadence_hours, 24);
  assert.equal(plan[1].due, false);
  assert.equal(plan[2].cadence_hours, 168);
  assert.equal(plan[2].due, true);
});

test('buildChannelVideoAnalyticsDigest summarizes the latest snapshots inside the rolling window', () => {
  const publications = [
    {
      id: 'pub-1',
      status: 'published',
      title: 'Water Bug #shorts',
      published_at: '2026-08-08T08:00:00.000Z',
      metadata: { type_pair: ['water', 'bug'], render_path: '/tmp/water-bug.mp4' },
    },
    {
      id: 'pub-2',
      status: 'published',
      title: 'Electric Grass #shorts',
      published_at: '2026-08-09T08:00:00.000Z',
      metadata: { type_pair: ['electric', 'grass'], render_path: '/tmp/electric-grass.mp4' },
    },
    {
      id: 'pub-3',
      status: 'published',
      title: 'Ghost Ground #shorts',
      published_at: '2026-08-10T08:00:00.000Z',
      metadata: { type_pair: ['ghost', 'ground'], render_path: '/tmp/ghost-ground.mp4' },
    },
    {
      id: 'pub-0',
      status: 'published',
      title: 'Legacy Water #shorts',
      published_at: '2026-07-20T08:00:00.000Z',
      metadata: { type_pair: ['water'], render_path: '/tmp/legacy-water.mp4' },
    },
  ];
  const latestSnapshotsByPublicationId = new Map([
    ['pub-1', { publication_id: 'pub-1', captured_at: '2026-08-10T09:00:00.000Z', metrics: { views: 1000, likes: 25, comments: 3, shares: 1, avg_view_duration_sec: 14, avg_view_percentage: 58, subs_gained: 2, subs_lost: 0 } }],
    ['pub-2', { publication_id: 'pub-2', captured_at: '2026-08-10T09:00:00.000Z', metrics: { views: 5000, likes: 80, comments: 8, shares: 5, avg_view_duration_sec: 18, avg_view_percentage: 65, subs_gained: 5, subs_lost: 1 } }],
    ['pub-3', { publication_id: 'pub-3', captured_at: '2026-08-10T09:00:00.000Z', metrics: { views: 20000, likes: 300, comments: 22, shares: 15, avg_view_duration_sec: 26, avg_view_percentage: 79, subs_gained: 18, subs_lost: 2 } }],
    ['pub-0', { publication_id: 'pub-0', captured_at: '2026-08-10T09:00:00.000Z', metrics: { views: 700, likes: 10, comments: 1, shares: 0, avg_view_duration_sec: 12, avg_view_percentage: 52, subs_gained: 1, subs_lost: 0 } }],
  ]);

  const digest = buildChannelVideoAnalyticsDigest({
    channelProfile,
    publications,
    latestSnapshotsByPublicationId,
    asOf: '2026-08-12T09:00:00.000Z',
    windowDays: 7,
  });
  const overview = buildVideoAnalyticsOverviewDigest({
    channelDigests: [digest],
    asOf: '2026-08-12T09:00:00.000Z',
    windowDays: 7,
  });

  assert.equal(digest.new_videos_count, 3);
  assert.equal(digest.crossed_10k_views_count, 1);
  assert.equal(digest.median_views, 5000);
  assert.equal(digest.total_views, 26000);
  assert.equal(digest.all_time_publications_count, 4);
  assert.equal(digest.all_time_views, 26700);
  assert.equal(digest.best_performer.publication_id, 'pub-3');
  assert.equal(digest.worst_performer.publication_id, 'pub-1');
  assert.equal(digest.thread_key, 'poke-quizz-poke-quizz-youtube');
  assert.equal(buildVideoAnalyticsThreadName(channelProfile), 'Poke Quizz - Analytics');
  assert.equal(overview.total_new_videos_count, 3);
  assert.equal(overview.total_views, 26000);
  assert.equal(overview.total_all_time_views, 26700);
});
