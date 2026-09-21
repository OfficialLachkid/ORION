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
    { id: 'a', account_key: 'poke-quizz-youtube', title: 'Top hit', published_at: '2026-09-15T00:00:00Z', metadata: { template_id: 'pokemon.cry-match.v1' }, external_id: 'aaa' },
    { id: 'b', account_key: 'poke-quizz-youtube', title: 'Mid', published_at: '2026-09-16T00:00:00Z', metadata: { template_id: 'pokemon.cry-match.v1' }, external_id: 'bbb' },
    { id: 'c', account_key: 'dexguess-youtube', title: 'Weak', published_at: '2026-09-17T00:00:00Z', metadata: { template_id: 'pokemon.dual-type-reveal.v1' }, external_id: 'ccc' },
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
});

test('buildAnalystPrompt embeds JSON data pack and optional prior summary', () => {
  const pack = { totals: { publications: 1 }, per_channel: {}, per_template: {}, top_videos: [], bottom_videos: [], window: { since: 'X', until: 'Y', days: 7 } };
  const withoutPrior = buildAnalystPrompt(pack, '');
  assert.ok(withoutPrior.includes('You are an analyst'));
  assert.ok(withoutPrior.includes('This week\'s data pack (JSON)'));
  assert.ok(!withoutPrior.includes('Previous week\'s summary'));
  assert.ok(withoutPrior.includes('does NOT open PRs') || withoutPrior.includes('not to act on it'));

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
