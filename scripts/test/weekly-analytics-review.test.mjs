import test from 'node:test';
import assert from 'node:assert/strict';
import { __testables } from '../run-weekly-analytics-review.mjs';
import { buildWeeklyAnalyticsReviewPlistContent, PLIST_LABEL } from '../install-weekly-analytics-review-schedule.mjs';

const { buildDataPack, buildAnalystPrompt, summarizeChannel, templateSlugFromMetadata } = __testables;

test('templateSlugFromMetadata strips pokemon prefix and v-suffix', () => {
  assert.equal(templateSlugFromMetadata({ template_id: 'pokemon.cry-match.v1' }), 'cry-match');
  assert.equal(templateSlugFromMetadata({ template_id: 'pokemon.dual-type-reveal.v2' }), 'dual-type-reveal');
  assert.equal(templateSlugFromMetadata({}), 'unknown');
  assert.equal(templateSlugFromMetadata(null), 'unknown');
});

test('summarizeChannel computes per-video + like-rate aggregates', () => {
  const pubs = [
    { id: 'p1' },
    { id: 'p2' },
    { id: 'p3' },
  ];
  const analytics = new Map([
    ['p1', { metrics: { views: 1000, likes: 20, comments: 5 } }],
    ['p2', { metrics: { views: 2000, likes: 40, comments: 10 } }],
    ['p3', { metrics: { views: 3000, likes: 60, comments: 15 } }],
  ]);
  const summary = summarizeChannel(pubs, analytics);
  assert.equal(summary.videos_published, 3);
  assert.equal(summary.videos_with_analytics, 3);
  assert.equal(summary.total_views, 6000);
  assert.equal(summary.total_likes, 120);
  assert.equal(summary.views_per_video, 2000);
  assert.equal(summary.median_views, 2000);
  assert.equal(summary.like_rate_pct, 2);
});

test('summarizeChannel handles pubs without analytics coverage', () => {
  const pubs = [{ id: 'p1' }, { id: 'p2' }];
  const analytics = new Map([['p1', { metrics: { views: 500, likes: 10 } }]]);
  const summary = summarizeChannel(pubs, analytics);
  assert.equal(summary.videos_published, 2);
  assert.equal(summary.videos_with_analytics, 1);
  assert.equal(summary.total_views, 500);
});

test('buildDataPack groups by channel + template and produces top/bottom slices', () => {
  const publications = [
    { id: 'a', account_key: 'poke-quizz-youtube', title: 'Top hit', published_at: '2026-09-15T06:00:00Z', metadata: { template_id: 'pokemon.cry-match.v1' }, external_id: 'aaa' },
    { id: 'b', account_key: 'poke-quizz-youtube', title: 'Mid', published_at: '2026-09-16T10:00:00Z', metadata: { template_id: 'pokemon.cry-match.v1' }, external_id: 'bbb' },
    { id: 'c', account_key: 'dexguess-youtube', title: 'Weak', published_at: '2026-09-17T12:00:00Z', metadata: { template_id: 'pokemon.dual-type-reveal.v1' }, external_id: 'ccc' },
  ];
  const analytics = new Map([
    ['a', { metrics: { views: 10000, likes: 100 } }],
    ['b', { metrics: { views: 1000, likes: 20 } }],
    ['c', { metrics: { views: 50, likes: 1 } }],
  ]);
  const pack = buildDataPack({ publications, analyticsByPub: analytics, sinceIso: '2026-09-14T00:00:00Z', untilIso: '2026-09-21T00:00:00Z' });

  assert.equal(pack.window.days, 7);
  assert.equal(pack.totals.publications, 3);
  assert.equal(pack.totals.total_views, 11050);
  assert.ok(pack.per_channel['poke-quizz-youtube']);
  assert.equal(pack.per_channel['poke-quizz-youtube'].total_views, 11000);
  assert.ok(pack.per_channel['dexguess-youtube']);
  assert.equal(pack.per_template['cry-match'].videos_published, 2);
  assert.equal(pack.per_template['dual-type-reveal'].videos_published, 1);
  assert.equal(pack.top_videos[0].views, 10000);
  assert.equal(pack.bottom_videos[0].views, 50);

  // Scheduling signal — publish-hour rollup is what the analyst reasons over
  assert.ok(pack.publish_hour_rollup);
  assert.ok(pack.publish_hour_rollup.network_wide[6], 'hour 6 slot (08 CEST) must appear network-wide');
  assert.equal(pack.publish_hour_rollup.network_wide[6].videos, 1);
  assert.equal(pack.publish_hour_rollup.network_wide[6].avg_views, 10000);
  assert.equal(pack.publish_hour_rollup.network_wide[10].videos, 1);
  assert.equal(pack.publish_hour_rollup.network_wide[12].videos, 1);
  // Per-channel rollup keeps channels separate
  assert.equal(pack.publish_hour_rollup.per_channel['poke-quizz-youtube'][6].videos, 1);
  assert.equal(pack.publish_hour_rollup.per_channel['dexguess-youtube'][12].videos, 1);

  // Viewer geography + traffic blocks always emitted, with a coverage
  // hint so the prompt can say "no data yet" when both are empty.
  assert.ok(pack.viewer_geography);
  assert.equal(pack.viewer_geography.videos_with_data, 0);
  assert.equal(pack.viewer_geography.videos_total, 3);
  assert.deepEqual(pack.viewer_geography.network_wide_top_countries, []);
  assert.ok(pack.traffic_sources_split);
  assert.equal(pack.traffic_sources_split.videos_with_data, 0);

  // Instrumentation gaps still surfaced; geo + traffic sources are now
  // "coming from adapter but no data yet this week" entries instead of
  // "not collected" — the retention + hourly gaps still stand.
  assert.ok(Array.isArray(pack.instrumentation_gaps));
  assert.ok(pack.instrumentation_gaps.some((g) => /retention/iu.test(g)));
  assert.ok(pack.instrumentation_gaps.some((g) => /hourly view/iu.test(g)));
});

test('buildDataPack aggregates viewer_countries and traffic_sources when metrics carry them', () => {
  const publications = [
    { id: 'a', account_key: 'poke-quizz-youtube', title: 'A', published_at: '2026-09-15T06:00:00Z', metadata: {}, external_id: 'aaa' },
    { id: 'b', account_key: 'poke-quizz-youtube', title: 'B', published_at: '2026-09-16T10:00:00Z', metadata: {}, external_id: 'bbb' },
    { id: 'c', account_key: 'dexguess-youtube', title: 'C', published_at: '2026-09-17T12:00:00Z', metadata: {}, external_id: 'ccc' },
  ];
  const analytics = new Map([
    ['a', { metrics: {
      views: 1000, likes: 10,
      viewer_countries: [{ key: 'US', views: 700 }, { key: 'NL', views: 300 }],
      traffic_sources: [{ key: 'YT_CHANNEL', views: 600 }, { key: 'RELATED_VIDEO', views: 400 }],
    } }],
    ['b', { metrics: {
      views: 500, likes: 5,
      viewer_countries: [{ key: 'US', views: 250 }, { key: 'DE', views: 250 }],
      traffic_sources: [{ key: 'YT_CHANNEL', views: 500 }],
    } }],
    ['c', { metrics: {
      views: 200, likes: 2,
      viewer_countries: [{ key: 'US', views: 200 }],
      traffic_sources: [{ key: 'EXT_URL', views: 200 }],
    } }],
  ]);
  const pack = buildDataPack({ publications, analyticsByPub: analytics, sinceIso: 'X', untilIso: 'Y' });

  // Coverage counter picks up populated rows
  assert.equal(pack.viewer_geography.videos_with_data, 3);
  assert.equal(pack.traffic_sources_split.videos_with_data, 3);

  // Network-wide aggregation sorts by total views descending
  assert.equal(pack.viewer_geography.network_wide_top_countries[0].key, 'US');
  assert.equal(pack.viewer_geography.network_wide_top_countries[0].views, 1150); // 700+250+200

  // Per-channel geo preserved
  assert.ok(pack.viewer_geography.per_channel_top_countries['poke-quizz-youtube']);
  assert.equal(pack.viewer_geography.per_channel_top_countries['poke-quizz-youtube'][0].key, 'US');
  assert.equal(pack.viewer_geography.per_channel_top_countries['poke-quizz-youtube'][0].views, 950); // 700+250

  // Traffic-source aggregation
  assert.equal(pack.traffic_sources_split.network_wide[0].key, 'YT_CHANNEL');
  assert.equal(pack.traffic_sources_split.network_wide[0].views, 1100); // 600+500

  // Gaps list no longer flags geo/traffic as "no data yet" now that coverage > 0
  assert.equal(pack.instrumentation_gaps.some((g) => /viewer geography/iu.test(g)), false);
  assert.equal(pack.instrumentation_gaps.some((g) => /traffic sources/iu.test(g)), false);
});

test('buildAnalystPrompt embeds JSON data pack + prior summary + scheduling + bold-number instruction', () => {
  const pack = { totals: { publications: 1 }, per_channel: {}, per_template: {}, top_videos: [], bottom_videos: [], window: { since: 'X', until: 'Y', days: 7 } };
  const withoutPrior = buildAnalystPrompt(pack, '');
  assert.ok(withoutPrior.includes('You are an analyst'));
  assert.ok(withoutPrior.includes('This week\'s data pack (JSON)'));
  assert.ok(!withoutPrior.includes('Previous week\'s summary'));
  assert.ok(withoutPrior.includes('does NOT open PRs') || withoutPrior.includes('not to act on it'));
  // Bold-numbers formatting rule must be present
  assert.ok(withoutPrior.includes('double-asterisks') || withoutPrior.includes('**'), 'prompt must instruct bolding numbers');
  // Scheduling section must be present with reference to publish_hour_rollup and per-channel semantics
  assert.ok(withoutPrior.includes('Scheduling signal'), 'prompt must include a scheduling section');
  assert.ok(withoutPrior.includes('publish_hour_rollup'), 'prompt must reference the publish-hour data field');
  assert.ok(withoutPrior.includes('instrumentation_gaps'), 'prompt must ask analyst to acknowledge missing signals');
  assert.ok(withoutPrior.includes('08:00, 12:00, 14:00'), 'prompt must state the current 3x/day schedule for context');
  // Geo + traffic-source section landed with the adapter enrichment
  assert.ok(withoutPrior.includes('Audience mix'), 'prompt must include the geo + traffic section');
  assert.ok(withoutPrior.includes('viewer_geography'), 'prompt must reference the viewer_geography field');
  assert.ok(withoutPrior.includes('traffic_sources_split'), 'prompt must reference the traffic_sources_split field');

  const withPrior = buildAnalystPrompt(pack, 'Last week I said X and Y happened.');
  assert.ok(withPrior.includes('Previous week\'s summary'));
  assert.ok(withPrior.includes('Last week I said X and Y happened.'));
});

test('install-schedule plist points at run-weekly-analytics-review.mjs on the chosen weekday+time', () => {
  const plist = buildWeeklyAnalyticsReviewPlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: '/repo/scripts/run-weekly-analytics-review.mjs',
    workingDirectory: '/repo',
    stdoutPath: '/tmp/out.log',
    stderrPath: '/tmp/err.log',
    weekday: 0,
    hour: 8,
    minute: 0,
  });
  assert.ok(plist.includes(`<string>${PLIST_LABEL}</string>`));
  assert.ok(plist.includes('<string>/repo/scripts/run-weekly-analytics-review.mjs</string>'));
  assert.ok(plist.includes('<key>Weekday</key>\n    <integer>0</integer>'));
  assert.ok(plist.includes('<key>Hour</key>\n    <integer>8</integer>'));
  assert.ok(plist.includes('/tmp/err.log'));
});
