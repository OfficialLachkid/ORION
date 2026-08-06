import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHED_LOCAL_REF,
  WATCHED_UPSTREAM_REF,
  computeGitSyncState,
  findPendingMacSyncRequest,
  refreshPendingMacSyncTask,
} from '../mac-sync-watch.mjs';

function stubGit(responses) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      for (const rule of responses) {
        if (rule.match(args)) {
          if (rule.throw) throw new Error(rule.throw);
          return rule.stdout ?? '';
        }
      }
      return '';
    },
  };
}

test('computeGitSyncState always compares local main to origin/main, ignoring the current branch', () => {
  // Simulates: operator is on a feature branch, main is 3 commits behind
  // origin/main. Watcher must detect the drift regardless of current branch.
  const stub = stubGit([
    { match: (args) => args[0] === 'branch' && args[1] === '--show-current', stdout: 'feat/some-branch' },
    { match: (args) => args[0] === 'status', stdout: '' },
    { match: (args) => args[0] === 'rev-parse' && args[1] === '--verify', stdout: 'abc123' },
    { match: (args) => args[0] === 'rev-list', stdout: '0\t3' },
  ]);

  const state = computeGitSyncState({ runGit: stub.run });

  assert.equal(state.currentBranch, 'feat/some-branch');
  assert.equal(state.upstreamRef, 'origin/main');
  assert.equal(state.behindCount, 3);
  assert.equal(state.aheadCount, 0);
  // Regression guard: the rev-list call must reference the shared refs, not HEAD or @{u}.
  const revListArgs = stub.calls.find((args) => args[0] === 'rev-list');
  assert.ok(revListArgs, 'rev-list command should have been invoked');
  const rangeArg = revListArgs.find((arg) => typeof arg === 'string' && arg.includes('...'));
  assert.equal(rangeArg, `${WATCHED_LOCAL_REF}...${WATCHED_UPSTREAM_REF}`);
});

test('computeGitSyncState reports up-to-date cleanly when local main == origin/main', () => {
  const stub = stubGit([
    { match: (args) => args[0] === 'branch', stdout: 'main' },
    { match: (args) => args[0] === 'status', stdout: '' },
    { match: (args) => args[0] === 'rev-parse', stdout: 'abc123' },
    { match: (args) => args[0] === 'rev-list', stdout: '0\t0' },
  ]);

  const state = computeGitSyncState({ runGit: stub.run });

  assert.equal(state.behindCount, 0);
  assert.equal(state.aheadCount, 0);
  assert.equal(state.upstreamRef, 'origin/main');
});

test('computeGitSyncState gracefully handles a repo without local main', () => {
  // Fresh clone or corrupted repo — no refs/heads/main. Rather than crash
  // the scheduled fetch, we return upstreamRef='' which classifyMacSyncState
  // maps to blocked_no_upstream so it doesn't spam #approvals.
  const stub = stubGit([
    { match: (args) => args[0] === 'branch', stdout: 'main' },
    { match: (args) => args[0] === 'status', stdout: '' },
    { match: (args) => args[0] === 'rev-parse', throw: 'unknown revision' },
  ]);

  const state = computeGitSyncState({ runGit: stub.run });

  assert.equal(state.upstreamRef, '');
  assert.equal(state.behindCount, 0);
  assert.equal(state.aheadCount, 0);
  // rev-list must NOT be invoked when there's no local main to compare against.
  assert.equal(stub.calls.some((args) => args[0] === 'rev-list'), false);
});

test('computeGitSyncState carries worktree status through even when on a feature branch', () => {
  const stub = stubGit([
    { match: (args) => args[0] === 'branch', stdout: 'feat/foo' },
    { match: (args) => args[0] === 'status', stdout: ' M src/some-file.mjs\n' },
    { match: (args) => args[0] === 'rev-parse', stdout: 'abc' },
    { match: (args) => args[0] === 'rev-list', stdout: '0\t2' },
  ]);

  const state = computeGitSyncState({ runGit: stub.run });

  assert.equal(state.isClean, false);
  assert.equal(state.isEffectivelyClean, false);
  assert.equal(state.behindCount, 2);
});

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
