import test from 'node:test';
import assert from 'node:assert/strict';
import { executeApprovedPullRequestMerge } from '../src/pr-merge.mjs';

const repository = 'OfficialLachkid/ruflo';
const fullHeadSha = '1234567890abcdef1234567890abcdef12345678';

function buildTask(overrides = {}) {
  return {
    task_id: 'TASK-PR-MERGE-42-1234567890AB',
    approval_required: true,
    approval_state: 'approved',
    github_merge_request: {
      repository,
      pullRequestNumber: 42,
      pullRequestUrl: `https://github.com/${repository}/pull/42`,
      sourceBranch: 'agent/task-42-fix-runtime',
      targetBranch: 'main',
      expectedHeadSha: fullHeadSha,
    },
    ...overrides,
  };
}

function buildConfig() {
  return {
    env: {},
    developerAgent: {
      enabled: true,
      mergeOnApproval: true,
      mergeMethod: 'squash',
      sourceBranchPrefix: 'agent/',
      baseBranch: 'main',
      repositoryRoot: process.cwd(),
    },
  };
}

function pullRequest(state = 'OPEN', overrides = {}) {
  return {
    number: 42,
    url: `https://github.com/${repository}/pull/42`,
    title: 'fix(agent): repair runtime',
    state,
    isDraft: state === 'OPEN',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    headRefName: 'agent/task-42-fix-runtime',
    headRefOid: fullHeadSha,
    baseRefName: 'main',
    ...overrides,
  };
}

test('executeApprovedPullRequestMerge marks a draft ready and merges the tested head', async () => {
  const calls = [];
  let viewCount = 0;
  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'repo') {
      return { code: 0, stdout: `${repository}\n`, stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      viewCount += 1;
      return {
        code: 0,
        stdout: JSON.stringify(viewCount === 1 ? pullRequest() : pullRequest('MERGED', { isDraft: false })),
        stderr: '',
      };
    }
    if (args[0] === 'pr' && args[1] === 'checks') {
      return {
        code: 0,
        stdout: JSON.stringify([
          { bucket: 'pass', name: 'Runtime Validation', state: 'SUCCESS', workflow: 'Ruflo Runtime Validation' },
          { bucket: 'skipping', name: 'Optional check', state: 'SKIPPED', workflow: 'Other' },
        ]),
        stderr: '',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await executeApprovedPullRequestMerge(buildTask(), buildConfig(), { commandRunner });

  assert.equal(result.report.state, 'merged');
  assert.equal(result.report.merged, true);
  assert.equal(calls.some(({ args }) => args[0] === 'pr' && args[1] === 'ready'), true);
  const mergeCall = calls.find(({ args }) => args[0] === 'pr' && args[1] === 'merge');
  assert.ok(mergeCall);
  assert.equal(mergeCall.args.includes('--squash'), true);
  assert.equal(mergeCall.args.includes('--delete-branch'), true);
  assert.equal(mergeCall.args.at(-1), fullHeadSha);
});

test('executeApprovedPullRequestMerge refuses a PR whose head changed after CI', async () => {
  const calls = [];
  const commandRunner = async (command, args) => {
    calls.push({ command, args });
    if (args[0] === 'repo') {
      return { code: 0, stdout: `${repository}\n`, stderr: '' };
    }
    return {
      code: 0,
      stdout: JSON.stringify(pullRequest('OPEN', { headRefOid: 'abcdefabcdefabcdefabcdefabcdefabcdefabcd' })),
      stderr: '',
    };
  };

  await assert.rejects(
    executeApprovedPullRequestMerge(buildTask(), buildConfig(), { commandRunner }),
    /head changed after CI approval/u
  );
  assert.equal(calls.some(({ args }) => args.includes('merge')), false);
});

test('executeApprovedPullRequestMerge refuses failed live checks', async () => {
  const commandRunner = async (_command, args) => {
    if (args[0] === 'repo') {
      return { code: 0, stdout: `${repository}\n`, stderr: '' };
    }
    if (args[1] === 'view') {
      return { code: 0, stdout: JSON.stringify(pullRequest()), stderr: '' };
    }
    return {
      code: 0,
      stdout: JSON.stringify([{ bucket: 'fail', name: 'Runtime Validation', state: 'FAILURE' }]),
      stderr: '',
    };
  };

  await assert.rejects(
    executeApprovedPullRequestMerge(buildTask(), buildConfig(), { commandRunner }),
    /checks are not green/u
  );
});

test('executeApprovedPullRequestMerge waits briefly for pending CI notification checks', async () => {
  let checkCalls = 0;
  let viewCount = 0;
  const commandRunner = async (_command, args) => {
    if (args[0] === 'repo') {
      return { code: 0, stdout: `${repository}\n`, stderr: '' };
    }
    if (args[1] === 'view') {
      viewCount += 1;
      return {
        code: 0,
        stdout: JSON.stringify(viewCount === 1 ? pullRequest() : pullRequest('MERGED', { isDraft: false })),
        stderr: '',
      };
    }
    if (args[1] === 'checks') {
      checkCalls += 1;
      if (checkCalls === 1) {
        return { code: 8, stdout: '', stderr: 'checks pending' };
      }
      return {
        code: 0,
        stdout: JSON.stringify([
          { bucket: 'pass', name: 'Runtime Validation', state: 'SUCCESS', workflow: 'Ruflo Runtime Validation' },
        ]),
        stderr: '',
      };
    }
    return { code: 0, stdout: '', stderr: '' };
  };

  const result = await executeApprovedPullRequestMerge(buildTask(), buildConfig(), {
    commandRunner,
    checkAttempts: 2,
    checkRetryDelayMs: 0,
    sleep: async () => {},
  });

  assert.equal(result.report.state, 'merged');
  assert.equal(checkCalls, 2);
});

test('executeApprovedPullRequestMerge requires explicit approval before running commands', async () => {
  let calls = 0;
  await assert.rejects(
    executeApprovedPullRequestMerge(buildTask({ approval_state: 'pending' }), buildConfig(), {
      commandRunner: async () => {
        calls += 1;
        return { code: 0, stdout: '', stderr: '' };
      },
    }),
    /Explicit operator approval/u
  );
  assert.equal(calls, 0);
});
