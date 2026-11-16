import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FACEBOOK_REEL_ANALYTICS_METRICS,
  fetchFacebookPublicationMetrics,
  resolveFacebookTarget,
} from '../../src/analytics/facebook-adapter.mjs';
import { FacebookGraphApiError } from '../../src/facebook-publication-executor.mjs';

function target() {
  return {
    platform: 'facebook_reels',
    account_key: 'poke-quizz-facebook',
    facebook: { page_id: '123', access_token_env: 'FACEBOOK_TOKEN' },
  };
}

test('resolveFacebookTarget finds only the matching Facebook account', () => {
  const expected = target();
  const profile = { metadata: { publisher: { targets: [
    { platform: 'instagram_reels', account_key: 'poke-quizz-instagram' },
    expected,
  ] } } };
  assert.equal(resolveFacebookTarget(profile, 'poke-quizz-facebook'), expected);
  assert.equal(resolveFacebookTarget(profile, 'poke-quizz-instagram'), null);
});

test('fetchFacebookPublicationMetrics normalizes Reel insights into the shared contract', async () => {
  const calls = [];
  const graphClient = {
    async fetchReel(videoId) {
      calls.push({ method: 'fetchReel', videoId });
      return {
        permalink: 'https://facebook.example/reel/vid-1',
        payload: { id: videoId, permalink_url: 'https://facebook.example/reel/vid-1' },
      };
    },
    async request(pathname, options) {
      calls.push({ method: 'request', pathname, query: options?.query });
      return { data: [
        { name: 'fb_reels_total_plays', values: [{ value: 1200 }] },
        { name: 'post_impressions_unique', values: [{ value: 900 }] },
        { name: 'post_video_avg_time_watched', values: [{ value: 8500 }] },
        { name: 'post_video_view_time', values: [{ value: 120000 }] },
        { name: 'post_video_followers', values: [{ value: 4 }] },
        { name: 'post_video_likes_by_reaction_type', values: [{ value: { like: 20, love: 3 } }] },
        { name: 'post_video_social_actions', values: [{ value: { comments: 5, shares: 7 } }] },
      ] };
    },
  };

  const result = await fetchFacebookPublicationMetrics({
    publication: {
      id: 'pub-1', external_id: 'vid-1', title: 'A Reel', published_at: '2026-11-15T10:00:00Z',
    },
    target: target(),
    graphClient,
    capturedAt: '2026-11-16T10:00:00Z',
  });

  assert.equal(calls[1].pathname, 'vid-1/video_insights');
  assert.equal(calls[1].query.period, 'lifetime');
  assert.equal(calls[1].query.metric, FACEBOOK_REEL_ANALYTICS_METRICS.join(','));
  assert.deepEqual(result.metrics, {
    platform: 'facebook_reels',
    external_id: 'vid-1',
    public_url: 'https://facebook.example/reel/vid-1',
    views: 1200,
    unique_viewers: 900,
    avg_view_duration_sec: 8.5,
    avg_view_percentage: null,
    watch_time_minutes: 2,
    impressions: null,
    ctr_percentage: null,
    likes: 23,
    comments: 5,
    shares: 7,
    saves: null,
    total_interactions: 12,
    subs_gained: 4,
    subs_lost: null,
    retention_curve: null,
    viewer_countries: [],
    traffic_sources: [],
    fetch_lag_hours: null,
    captured_at: '2026-11-16T10:00:00Z',
    published_at: '2026-11-15T10:00:00Z',
    video_title: 'A Reel',
  });
});

test('fetchFacebookPublicationMetrics refuses missing publication identity or target', async () => {
  await assert.rejects(
    () => fetchFacebookPublicationMetrics({ publication: {}, target: target(), graphClient: {} }),
    /external_id/u,
  );
  await assert.rejects(
    () => fetchFacebookPublicationMetrics({ publication: { external_id: 'x' }, target: null, graphClient: {} }),
    /publisher target/u,
  );
});

test('an unsupported Facebook insight is isolated without losing supported metrics', async () => {
  const graphClient = {
    async fetchReel() { return { permalink: 'https://facebook.example/reel/x', payload: {} }; },
    async request(pathname, options) {
      const metrics = String(options?.query?.metric || '').split(',');
      if (metrics.includes('unsupported_metric')) {
        throw new FacebookGraphApiError('Unsupported metric', { status: 400 });
      }
      return { data: metrics.map((name) => ({
        name,
        values: [{ value: name === 'fb_reels_total_plays' ? 321 : 0 }],
      })) };
    },
  };
  const { metrics, raw_payload: raw } = await fetchFacebookPublicationMetrics({
    publication: { external_id: 'vid-x' },
    target: target(),
    graphClient,
    insightsMetrics: ['fb_reels_total_plays', 'unsupported_metric'],
  });
  assert.equal(metrics.views, 321);
  assert.match(raw.facebook_video_insights.__metric_errors.unsupported_metric, /Unsupported metric/u);
});
