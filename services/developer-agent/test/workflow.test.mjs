import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { executeDeveloperAgentWorkflow } from '../src/workflow.mjs';

function buildTask(overrides = {}) {
  return {
    task_id: 'TASK-DEVELOPER-001',
    summary: 'Developer task: fix the queue ordering bug',
    full_text: 'developer task: fix the queue ordering bug',
    developer_request: { objective: 'fix the queue ordering bug', baseBranch: 'main' },
    domain: 'developer',
    target_agent: 'developer-agent',
    priority: 'normal',
    submitted_by: 'operator',
    source_channel: 'commands',
    approval_required: true,
    approval_state: 'approved',
    ...overrides,
  };
}

function buildConfig(root) {
  return {
    env: {},
    runtimePaths: { tmpDir: join(root, 'runtime') },
    claude: { enabled: true, workingDirectory: root, appendSystemPrompt: '' },
    developerAgent: {
      enabled: true,
      repositoryRoot: root,
      worktreesRoot: join(root, 'worktrees'),
      stateRoot: join(root, 'state'),
      remote: 'origin',
      baseBranch: 'main',
    },
  };
}

test('executeDeveloperAgentWorkflow creates issue, isolated branch, commit, and draft PR', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-developer-agent-'));
  const calls = [];
  let claudeWorkingDirectory = '';
  const commandRunner = async (command, args, options = {}) => {
    calls.push({ command, args, cwd: options.cwd });
    if (command === 'gh' && args[0] === 'repo') {
      return { code: 0, stdout: 'OfficialLachkid/ruflo\n', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'issue') {
      return { code: 0, stdout: 'https://github.com/OfficialLachkid/ruflo/issues/12\n', stderr: '' };
    }
    if (command === 'gh' && args[0] === 'pr') {
      return { code: 0, stdout: 'https://github.com/OfficialLachkid/ruflo/pull/13\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'show-ref') {
      return { code: 1, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'worktree' && args[1] === 'add') {
      mkdirSync(args[4], { recursive: true });
      return { code: 0, stdout: '', stderr: '' };
    }
    if (command === 'git' && args[0] === 'status') {
      return { code: 0, stdout: ' M services/example.mjs\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'diff' && args.includes('--cached')) {
      return { code: 0, stdout: 'services/example.mjs\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'rev-list') {
      return { code: 0, stdout: '0\n', stderr: '' };
    }
    if (command === 'git' && args[0] === 'rev-parse') {
      return { code: 0, stdout: 'abcdef1234567890\n', stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  const claudeTaskRunner = async (task, config) => {
    claudeWorkingDirectory = config.claude.workingDirectory;
    assert.match(task.full_text, /Do not commit, push/u);
    return { report: { state: 'completed', summary: 'Fixed.', files: ['services/example.mjs'] } };
  };

  const result = await executeDeveloperAgentWorkflow(buildTask(), buildConfig(root), {
    commandRunner,
    claudeTaskRunner,
  });

  assert.equal(result.report.state, 'completed');
  assert.equal(result.report.issueNumber, 12);
  assert.equal(result.report.pullRequestNumber, 13);
  assert.equal(result.report.baseBranch, 'main');
  assert.match(result.report.branch, /^agent\/task-developer-001-/u);
  assert.equal(claudeWorkingDirectory.includes('worktrees'), true);
  assert.equal(calls.some((call) => call.command === 'git' && call.args[0] === 'push'), true);
  assert.equal(calls.some((call) => call.command === 'gh' && call.args[0] === 'pr'), true);
});

test('executeDeveloperAgentWorkflow refuses unapproved Claude and GitHub writes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-developer-agent-unapproved-'));
  let commandCount = 0;
  const result = await executeDeveloperAgentWorkflow(
    buildTask({ approval_state: 'pending' }),
    buildConfig(root),
    { commandRunner: async () => { commandCount += 1; return { code: 0, stdout: '', stderr: '' }; } }
  );

  assert.equal(result.report.state, 'blocked');
  assert.match(result.report.summary, /approval is required/iu);
  assert.equal(commandCount, 0);
});
