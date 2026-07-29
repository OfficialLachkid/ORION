import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeveloperMergeApprovalEvents,
  buildDeveloperMergeApprovalTask,
  isEligibleDeveloperMergeObservation,
} from '../src/pr-merge-approval.mjs';

const config = {
  developerAgent: {
    baseBranch: 'main',
    sourceBranchPrefix: 'agent/',
    mergeOnApproval: true,
  },
};

const successfulObservation = {
  isRuntimeValidation: true,
  status: 'success',
  eventName: 'pull_request',
  repository: 'OfficialLachkid/ruflo',
  prNumber: 42,
  sourceBranch: 'agent/task-42-fix-runtime',
  targetBranch: 'main',
  commit: '1234567890abcdef1234567890abcdef12345678',
  detailsUrl: 'https://github.com/OfficialLachkid/ruflo/actions/runs/123',
  runNumber: 108,
  workflowName: 'Ruflo Runtime Validation',
};

test('buildDeveloperMergeApprovalTask creates a deterministic final-merge approval', () => {
  const task = buildDeveloperMergeApprovalTask(
    successfulObservation,
    config,
    new Date('2026-07-21T12:00:00.000Z')
  );

  assert.equal(task.task_id, 'TASK-PR-MERGE-42-1234567890AB');
  assert.equal(task.runtime_action, 'github_merge_pull_request');
  assert.equal(task.approval_state, 'pending');
  assert.equal(task.github_merge_request.expectedHeadSha, successfulObservation.commit);
  assert.equal(task.github_merge_request.pullRequestUrl, 'https://github.com/OfficialLachkid/ruflo/pull/42');

  const events = buildDeveloperMergeApprovalEvents(task);
  assert.equal(events.length, 2);
  assert.equal(events[1].channelKey, 'pullRequests');
  assert.equal(events[1].metadata.sourceBranch, 'agent/task-42-fix-runtime');
  assert.equal(events[1].metadata.targetBranch, 'main');
});

test('developer merge approval only accepts successful agent PR validation for the configured base', () => {
  assert.equal(isEligibleDeveloperMergeObservation(successfulObservation, config), true);

  for (const change of [
    { status: 'running' },
    { status: 'failure' },
    { sourceBranch: 'feature/manual-change' },
    { targetBranch: 'development' },
    { eventName: 'push' },
    { commit: '' },
  ]) {
    assert.equal(
      isEligibleDeveloperMergeObservation({ ...successfulObservation, ...change }, config),
      false
    );
  }
});

test('developer merge approval can be disabled explicitly', () => {
  assert.equal(isEligibleDeveloperMergeObservation(successfulObservation, {
    developerAgent: {
      ...config.developerAgent,
      mergeOnApproval: false,
    },
  }), false);
});
