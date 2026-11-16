import test from 'node:test';
import assert from 'node:assert/strict';

import {
  listEnabledFacebookAnalyticsTargets,
  parseFacebookAnalyticsSweepArgs,
} from '../scripts/analytics/run-facebook-analytics-sweep.mjs';

test('Facebook analytics arguments stay bounded by default and support focused canaries', () => {
  const defaults = parseFacebookAnalyticsSweepArgs([]);
  assert.equal(defaults.limit, 100);
  assert.equal(defaults.sinceDays, 14);
  assert.equal(defaults.force, false);

  const focused = parseFacebookAnalyticsSweepArgs([
    '--limit', '2', '--since-days', '7', '--account-key', 'dexguess-facebook', '--force',
  ]);
  assert.equal(focused.limit, 2);
  assert.equal(focused.sinceDays, 7);
  assert.equal(focused.accountKey, 'dexguess-facebook');
  assert.equal(focused.force, true);
});

test('Facebook analytics targets are dynamically discovered and deduplicated', () => {
  const facebookTarget = {
    platform: 'facebook_reels', account_key: 'dexguess-facebook', enabled: true,
  };
  const profiles = [
    { metadata: { publisher: { targets: [facebookTarget] } } },
    { metadata: { publisher: { targets: [facebookTarget, {
      platform: 'instagram_reels', account_key: 'dexguess-instagram', enabled: true,
    }] } } },
  ];
  const targets = listEnabledFacebookAnalyticsTargets(profiles);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].platform, 'facebook_reels');
  assert.equal(targets[0].accountKey, 'dexguess-facebook');
  assert.equal(targets[0].deliveryProvider, 'facebook_graph');
});
