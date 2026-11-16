import test from 'node:test';
import assert from 'node:assert/strict';

import { runSocialAnalyticsSweeps } from '../scripts/analytics/run-social-analytics-sweeps.mjs';

test('shared sweep runs Instagram and Facebook with one bounded argument set', async () => {
  const calls = [];
  const result = await runSocialAnalyticsSweeps(['--limit', '3', '--since-days', '7'], {
    runInstagramAnalyticsSweep: async (args) => {
      calls.push({ platform: 'instagram', args });
      return { retry_recommended: false, captured_count: 2 };
    },
    runFacebookAnalyticsSweep: async (args) => {
      calls.push({ platform: 'facebook', args });
      return { retry_recommended: false, captured_count: 1 };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args.limit, 3);
  assert.equal(calls[1].args.sinceDays, 7);
  assert.equal(result.retry_recommended, false);
  assert.equal(result.platforms.facebook_reels.captured_count, 1);
});
