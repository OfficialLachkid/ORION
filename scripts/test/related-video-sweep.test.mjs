import assert from 'node:assert/strict';
import test from 'node:test';

import { runNightShiftRelatedVideoRefresh } from '../lib/night-shift/related-video-sweep.mjs';

test('night-shift related-video recovery passes the bounded default limit', () => {
  let invokedArgs = [];
  const result = runNightShiftRelatedVideoRefresh({
    profile: {
      account_key: 'trivamon-youtube',
      metadata: { related_video: { enabled: true } },
    },
    asOf: '2026-11-24T02:00:00.000Z',
    runNodeScript: (_script, args) => {
      invokedArgs = args;
      return { status: 0, stdout: '[]\n', stderr: '' };
    },
  });

  const limitIndex = invokedArgs.indexOf('--limit');
  assert.deepEqual(invokedArgs.slice(limitIndex, limitIndex + 2), ['--limit', '10']);
  assert.equal(result.status, 'completed');
});
