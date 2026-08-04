import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLeadNightShiftDigest,
  buildPokemonNightShiftDigest,
} from '../lib/night-shift/digest.mjs';

test('lead night shift digest summarizes approval and maintenance counts', () => {
  const digest = buildLeadNightShiftDigest(
    [
      { approvalTaskId: 'task-1' },
      { status: 'qualified_no_email' },
      { error: 'timeout' },
    ],
    12,
    4,
    {
      followedUp: 2,
      outreachChannel: '<#123>',
      replyResult: {
        available: true,
        replies: 1,
        bounces: 0,
        autoReplies: 1,
        checked: 5,
      },
    },
  );

  assert.match(digest, /Night shift processed \*\*3\*\* lead\(s\)/u);
  assert.match(digest, /\*\*1\*\* new draft\(s\) awaiting approval in <#123>/u);
  assert.match(digest, /Drafted \*\*2\*\* follow-up\(s\)/u);
  assert.match(digest, /Backlog: \*\*12\*\*/u);
});

test('pokemon night shift digest combines maintenance, fallback, replenish, and refresh lines', () => {
  const digest = buildPokemonNightShiftDigest({
    videoQueueMaintenance: {
      processedChannels: 1,
      scheduled: 2,
      published: 1,
      withdrawn: 1,
      returnedToApproval: 0,
      deleted: 0,
      changedSchedule: 1,
      statusLookupFailures: 0,
      failedChannels: 0,
    },
    previewFallback: {
      preferredAvailable: true,
      strandedCount: 0,
      moved: ['a.mp4'],
      deduped: [],
      skipped: [],
    },
    reviewBacklogReplenishment: {
      generated: 3,
      finalReviewReadyCount: 10,
      targetReviewReadyCount: 10,
      errors: ['transient render failure'],
    },
    reviewMessageRefresh: {
      refreshed: 7,
      failed: 2,
      retried: 2,
      failures: [
        { reason: 'discord_api_404' },
        { reason: 'rate_limit_retry_exhausted' },
      ],
    },
  });

  assert.match(digest, /Video queue maintenance: \*\*2\*\* scheduled item\(s\) checked, \*\*1\*\* marked live, \*\*1\*\* withdrawn, \*\*1\*\* schedule\(s\) corrected\./u);
  assert.match(digest, /Preview fallback storage: moved \*\*1\*\* back to SSD\./u);
  assert.match(digest, /Review backlog replenish: generated \*\*3\*\* preview\(s\), review queue now holds \*\*10\/10\*\* ready for approval, with \*\*1\*\* failed attempt\(s\)\./u);
  assert.match(digest, /Review card refresh updated \*\*7\*\* card\(s\); \*\*1\*\* stored review card\(s\) are missing in Discord, \*\*1\*\* still need another pass\./u);
});
