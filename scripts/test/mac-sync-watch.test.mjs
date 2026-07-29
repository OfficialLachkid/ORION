import test from 'node:test';
import assert from 'node:assert/strict';
import { findPendingMacSyncRequest, refreshPendingMacSyncTask } from '../mac-sync-watch.mjs';

test('findPendingMacSyncRequest returns the persisted mac sync watch task', () => {
  const task = findPendingMacSyncRequest([
    { task_id: 'TASK-OTHER', automation_type: 'daily_summary' },
    { task_id: 'TASK-SYNC', automation_type: 'mac_sync_watch', summary: 'old summary' },
  ]);

  assert.equal(task?.task_id, 'TASK-SYNC');
});

test('refreshPendingMacSyncTask updates summary and behind counts while preserving message refs', () => {
  const refreshed = refreshPendingMacSyncTask({
    task_id: 'TASK-SYNC',
    automation_type: 'mac_sync_watch',
    summary: 'Mac is behind origin/main by 1 commit. Approve to run the safe sync workflow.',
    approval_reason: 'Scheduled detect-only check found the Mac safely behind origin/main by 1 commit.',
    sync_watch_state: {
      branch: 'main',
      upstream: 'origin/main',
      aheadCount: 0,
      behindCount: 1,
    },
    message_refs: {
      approval: {
        channelId: '123',
        messageId: '456',
      },
    },
  }, {
    currentBranch: 'main',
    upstreamRef: 'origin/main',
    aheadCount: 0,
    behindCount: 3,
  });

  assert.match(refreshed.summary, /3 commits/u);
  assert.match(refreshed.approval_reason, /3 commits/u);
  assert.equal(refreshed.sync_watch_state.behindCount, 3);
  assert.equal(refreshed.message_refs.approval.messageId, '456');
  assert.ok(refreshed.updated_at);
});
