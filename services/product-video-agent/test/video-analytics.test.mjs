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
      video_id: 'video-1',
      status: 'published',
      external_id: 'yt-pub-1',
      title: 'Water Bug #shorts',
      published_at: '2026-08-08T08:00:00.000Z',
      metadata: {
        type_pair: ['water', 'bug'],
        background_path: '/tmp/beach-backgrounds/wave.png',
        render_path: '/tmp/water-bug.mp4',
        template_id: 'pokemon.find-the-shiny.v1',
      },
    },
    {
      id: 'pub-2',
      video_id: 'video-2',
      status: 'published',
      external_id: 'yt-pub-2',
      title: 'Electric Grass #shorts',
      published_at: '2026-08-09T08:00:00.000Z',
      metadata: {
        type_pair: ['electric', 'grass'],
        background_path: '/tmp/type-quiz-backgrounds/checkerboard.gif',
        render_path: '/tmp/electric-grass.mp4',
        template_id: 'pokemon.type-quiz.v1',
      },
    },
    {
      id: 'pub-3',
      video_id: 'video-3',
      status: 'published',
      external_id: 'yt-pub-3',
      title: 'Ghost Ground #shorts',
      published_at: '2026-08-10T08:00:00.000Z',
      metadata: {
        type_pair: ['ghost', 'ground'],
        background_path: '/tmp/fire-backgrounds/lava.png',
        render_path: '/tmp/ghost-ground.mp4',
        template_id: 'pokemon.dual-type-reveal.v1',
      },
    },
    {
      id: 'pub-0',
      video_id: 'video-0',
      status: 'published',
      external_id: 'yt-pub-0',
      title: 'Legacy Water #shorts',
      published_at: '2026-07-20T08:00:00.000Z',
      metadata: {
        type_pair: ['water'],
        background_path: '/tmp/water-backgrounds/river.png',
        render_path: '/tmp/legacy-water.mp4',
        template_id: 'pokemon.find-the-shiny.v1',
      },
    },
  ];
  const videoRowsById = new Map([
    ['video-0', { id: 'video-0', selected_script: { hook: 'Legacy water hook.' } }],
    ['video-1', { id: 'video-1', selected_script: { hook: 'Find the shiny water bug.' } }],
    ['video-2', { id: 'video-2', selected_script: { hook: 'Can you guess the typing?' } }],
    ['video-3', { id: 'video-3', selected_script: { hook: 'Which typing fits this monster?' } }],
  ]);
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
    videoRowsById,
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
  assert.equal(digest.best_performer.external_id, 'yt-pub-3');
  assert.equal(digest.best_performer.template_label, 'Dual Type Reveal');
  assert.equal(digest.worst_performer.publication_id, 'pub-1');
  assert.equal(digest.worst_performer.external_id, 'yt-pub-1');
  assert.equal(digest.recent_winners[0].publication_id, 'pub-3');
  assert.equal(digest.recent_losers[0].publication_id, 'pub-1');
  assert.equal(digest.recent_uploads[0].publication_id, 'pub-3');
  assert.equal(digest.publications[0].template_label, 'Find the Shiny');
  assert.equal(digest.publications[1].background_style, 'Type Quiz Backgrounds');
  assert.equal(digest.publications[2].hook, 'Which typing fits this monster?');
  assert.equal(digest.content_insights.templates.group_count, 3);
  assert.equal(digest.content_insights.type_pairs.group_count, 3);
  assert.equal(digest.content_insights.hooks.group_count, 3);
  assert.equal(digest.content_insights.background_styles.group_count, 3);
  assert.equal(digest.content_insights.templates.strongest[0].label, 'Dual Type Reveal');
  assert.equal(digest.thread_key, 'poke-quizz-poke-quizz-youtube');
  assert.equal(buildVideoAnalyticsThreadName(channelProfile), 'Poke Quizz - Analytics');
  assert.equal(overview.total_new_videos_count, 3);
  assert.equal(overview.total_views, 26000);
  assert.equal(overview.total_all_time_views, 26700);
});
