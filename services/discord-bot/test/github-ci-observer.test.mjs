import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubCiObservation } from '../src/github-ci-observer.mjs';

const config = {
  channelIds: {
    ci: 'ci-channel',
    github: 'github-channel',
  },
};

test('parseGitHubCiObservation extracts pull request branches from the CI channel', () => {
  const observation = parseGitHubCiObservation({
    channel_id: 'ci-channel',
    webhook_id: 'webhook-1',
    embeds: [
      {
        title: 'GitHub CI SUCCESS - OfficialLachkid/ruflo',
        fields: [
          { name: 'Workflow', value: '`Ruflo Runtime Validation`' },
          { name: 'Job', value: '`Runtime Validation`' },
          { name: 'Status', value: '✅ `success`' },
          { name: 'Repository', value: '`OfficialLachkid/ruflo`' },
          { name: 'Source Branch', value: '`feature/developer-agent-github-flow`' },
          { name: 'Target Branch', value: '`main`' },
          { name: 'Event', value: '`pull_request`' },
          { name: 'Actor', value: '`lachkid`' },
          { name: 'Commit', value: '[`1138303`](https://github.com/OfficialLachkid/ruflo/commit/1138303abcdef1138303abcdef1138303abcdef1)' },
          { name: 'PR', value: '#42' },
          { name: 'Run', value: '#108' },
          { name: 'Details', value: 'https://github.com/OfficialLachkid/ruflo/actions/runs/123' },
        ],
      },
    ],
  }, config);

  assert.deepEqual(observation, {
    workflowName: 'Ruflo Runtime Validation',
    jobName: 'Runtime Validation',
    status: 'success',
    repository: 'OfficialLachkid/ruflo',
    refName: 'feature/developer-agent-github-flow',
    sourceBranch: 'feature/developer-agent-github-flow',
    targetBranch: 'main',
    eventName: 'pull_request',
    actor: 'lachkid',
    commit: '1138303abcdef1138303abcdef1138303abcdef1',
    detailsUrl: 'https://github.com/OfficialLachkid/ruflo/actions/runs/123',
    prNumber: 42,
    runNumber: 108,
    isRuntimeValidation: true,
    source: 'github_webhook',
  });
});

test('parseGitHubCiObservation falls back to the embed title status for bot messages', () => {
  const observation = parseGitHubCiObservation({
    channel_id: 'ci-channel',
    author: {
      bot: true,
    },
    embeds: [
      {
        title: 'GitHub CI FAILURE - OfficialLachkid/ruflo',
        fields: [
          { name: 'Workflow', value: '`Ruflo Runtime Validation`' },
          { name: 'Job', value: '`Runtime Validation`' },
        ],
      },
    ],
  }, config);

  assert.equal(observation?.status, 'failure');
  assert.equal(observation?.isRuntimeValidation, true);
  assert.equal(observation?.source, 'bot_message');
});

test('parseGitHubCiObservation ignores non-GitHub-channel messages', () => {
  const observation = parseGitHubCiObservation({
    channel_id: 'system-logs',
    webhook_id: 'webhook-1',
    embeds: [
      {
        fields: [
          { name: 'Workflow', value: '`Ruflo Runtime Validation`' },
        ],
      },
    ],
  }, config);

  assert.equal(observation, null);
});

test('parseGitHubCiObservation supports legacy Ref cards when CI uses the GitHub channel', () => {
  const observation = parseGitHubCiObservation({
    channel_id: 'github-channel',
    webhook_id: 'webhook-legacy',
    embeds: [{
      title: 'GitHub CI SUCCESS - OfficialLachkid/ruflo',
      fields: [
        { name: 'Workflow', value: '`Ruflo Runtime Validation`' },
        { name: 'Ref', value: '`development`' },
      ],
    }],
  }, {
    channelIds: {
      github: 'github-channel',
    },
  });

  assert.equal(observation?.refName, 'development');
  assert.equal(observation?.sourceBranch, '');
  assert.equal(observation?.targetBranch, '');
});
