import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function truncate(value, maxLength) {
  const normalized = normalizeWhitespace(value);
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, Math.max(1, maxLength - 3))}...`;
}

export function defaultCommandRunner(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code: code ?? 0, stdout, stderr }));
  });
}

export async function runChecked(commandRunner, command, args, options = {}) {
  const result = await commandRunner(command, args, options);
  if ((result.code ?? 0) !== 0) {
    const details = truncate(result.stderr || result.stdout || 'No command output.', 500);
    throw new Error(`${command} ${args.join(' ')} failed (${result.code ?? 1}): ${details}`);
  }
  return result;
}

export function slugify(value, fallback = 'developer-task') {
  const slug = normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48);
  return slug || fallback;
}

export function buildDeveloperBranch(task) {
  const taskId = String(task.task_id || 'task').toLowerCase().replace(/[^a-z0-9-]/gu, '');
  return `agent/${taskId}-${slugify(task.developer_request?.objective || task.summary)}`;
}

export function buildConventionalSubject(task) {
  const objective = normalizeWhitespace(task.developer_request?.objective || task.summary || 'complete developer task');
  const type = /\b(fix|bug|broken|error|failure|regression)\b/iu.test(objective) ? 'fix' : 'feat';
  return `${type}(agent): ${truncate(objective, 54)}`;
}

export function parseGitHubNumber(url) {
  const match = /\/(?:issues|pull)\/(\d+)(?:\?.*)?$/u.exec(String(url || '').trim());
  return match ? Number.parseInt(match[1], 10) : 0;
}

function requireGitHubResultUrl(output, kind) {
  const url = String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .findLast((line) => /^https:\/\/github\.com\//u.test(line));
  const number = parseGitHubNumber(url);
  if (!url || !number || (kind === 'issue' && !url.includes('/issues/')) || (kind === 'pull' && !url.includes('/pull/'))) {
    throw new Error(`GitHub CLI did not return a valid ${kind} URL.`);
  }
  return { url, number };
}

export function buildIssueBody(task) {
  const attachments = Array.isArray(task.image_attachments) ? task.image_attachments : [];
  return [
    '## Objective',
    '',
    task.developer_request?.objective || task.full_text || task.summary || '',
    '',
    '## Source',
    '',
    `- O.R.I.O.N. task: \`${task.task_id}\``,
    `- Requested by: ${task.submitted_by || 'unknown'}`,
    `- Discord channel: ${task.source_channel || 'commands'}`,
    `- Priority: ${task.priority || 'normal'}`,
    '',
    '## Constraints',
    '',
    '- Work in an isolated Git worktree created from current `origin/main`.',
    '- Do not commit secrets or local environment files.',
    '- Use Conventional Commits.',
    '- Keep scripts under the 500-700 line guardrail.',
    '- Open a draft PR; merge requires a separate CI-green Discord approval.',
    '',
    '## Attachments',
    '',
    ...(attachments.length > 0
      ? attachments.map((item) => `- ${item.filename || 'attachment'}: ${item.url || item.proxyUrl || 'no URL'}`)
      : ['- None']),
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] Requested behavior is implemented.',
    '- [ ] Relevant automated tests pass.',
    '- [ ] CI evidence is included in the draft PR.',
    '- [ ] Explicit final merge approval is received in Discord.',
    '',
  ].join('\n');
}

export function buildPullRequestBody(task, result) {
  const files = Array.isArray(result.files) ? result.files : [];
  return [
    '## Summary',
    '',
    `- Implements #${result.issueNumber}: ${task.developer_request?.objective || task.summary}`,
    '- Produced by the approval-gated O.R.I.O.N. developer-agent workflow.',
    '',
    '## Changed Paths',
    '',
    ...(files.length > 0 ? files.map((file) => `- \`${file}\``) : ['- No changed paths reported.']),
    '',
    '## Validation',
    '',
    '- `git diff --check`',
    '- `npm run test:discord-spine`',
    '- Changed-secret scan',
    '- Conventional commit check',
    '- Script-size guardrail',
    '',
    '## Runtime And Approval Impact',
    '',
    '- Work was performed in an isolated worktree.',
    '- This PR is intentionally opened as a draft.',
    '- Green CI creates a commit-specific Discord approval; only that approval can trigger the guarded merge.',
    '',
    '## Risks And Rollback',
    '',
    '- Review the changed paths and CI output before promoting the PR.',
    '- Close the PR or revert its commit if the implementation is rejected.',
    '',
    `Closes #${result.issueNumber}`,
    '',
  ].join('\n');
}

export async function createIssue(commandRunner, context) {
  const bodyPath = join(context.stateDir, 'issue-body.md');
  writeFileSync(bodyPath, buildIssueBody(context.task), 'utf8');
  const title = `[Agent Work] ${truncate(context.task.developer_request.objective, 72)}`;
  const result = await runChecked(commandRunner, 'gh', [
    'issue', 'create', '--repo', context.repository, '--title', title, '--body-file', bodyPath,
  ], { cwd: context.repositoryRoot, env: context.env });
  const issue = requireGitHubResultUrl(result.stdout, 'issue');
  return { issueUrl: issue.url, issueNumber: issue.number };
}

export async function prepareWorktree(commandRunner, context) {
  await runChecked(commandRunner, 'git', ['fetch', context.remote, context.baseBranch], {
    cwd: context.repositoryRoot,
    env: context.env,
  });
  const branchExists = await commandRunner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${context.branch}`], {
    cwd: context.repositoryRoot,
    env: context.env,
  });
  const args = branchExists.code === 0
    ? ['worktree', 'add', context.worktreePath, context.branch]
    : ['worktree', 'add', '-b', context.branch, context.worktreePath, `${context.remote}/${context.baseBranch}`];
  await runChecked(commandRunner, 'git', args, { cwd: context.repositoryRoot, env: context.env });
}

async function runValidation(commandRunner, context) {
  await runChecked(commandRunner, 'git', ['diff', '--check'], { cwd: context.worktreePath, env: context.env });
  await runChecked(commandRunner, 'npm', ['run', 'test:discord-spine'], { cwd: context.worktreePath, env: context.env });
}

async function runCommitGuards(commandRunner, context) {
  const rangeArgs = ['--base', `${context.remote}/${context.baseBranch}`, '--head', 'HEAD'];
  await runChecked(commandRunner, process.execPath, ['scripts/ci/scan-changed-secrets.mjs', ...rangeArgs], {
    cwd: context.worktreePath,
    env: context.env,
  });
  await runChecked(commandRunner, process.execPath, ['scripts/ci/check-conventional-commits.mjs', ...rangeArgs], {
    cwd: context.worktreePath,
    env: context.env,
  });
  await runChecked(commandRunner, process.execPath, ['scripts/ci/check-script-size-guardrail.mjs', ...rangeArgs], {
    cwd: context.worktreePath,
    env: context.env,
  });
}

export async function validateCommitAndPublish(commandRunner, context) {
  const status = await runChecked(commandRunner, 'git', ['status', '--porcelain'], {
    cwd: context.worktreePath,
    env: context.env,
  });
  if (!status.stdout.trim()) {
    throw new Error('Claude completed without producing repository changes.');
  }

  await runValidation(commandRunner, context);
  await runChecked(commandRunner, 'git', ['add', '-A'], { cwd: context.worktreePath, env: context.env });
  const filesResult = await runChecked(commandRunner, 'git', ['diff', '--cached', '--name-only'], {
    cwd: context.worktreePath,
    env: context.env,
  });
  const files = filesResult.stdout.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
  const commitSubject = buildConventionalSubject(context.task);
  await runChecked(commandRunner, 'git', ['commit', '-m', commitSubject], {
    cwd: context.worktreePath,
    env: context.env,
  });

  await runChecked(commandRunner, 'git', ['fetch', context.remote, context.baseBranch], {
    cwd: context.worktreePath,
    env: context.env,
  });
  const behindResult = await runChecked(commandRunner, 'git', [
    'rev-list', '--count', `HEAD..${context.remote}/${context.baseBranch}`,
  ], { cwd: context.worktreePath, env: context.env });
  const behindCount = Number.parseInt(behindResult.stdout.trim(), 10) || 0;
  if (behindCount > 0) {
    const rebase = await commandRunner('git', ['rebase', `${context.remote}/${context.baseBranch}`], {
      cwd: context.worktreePath,
      env: context.env,
    });
    if ((rebase.code ?? 0) !== 0) {
      await commandRunner('git', ['rebase', '--abort'], { cwd: context.worktreePath, env: context.env });
      throw new Error('origin/main advanced and the isolated developer branch could not be rebased cleanly.');
    }
    await runValidation(commandRunner, context);
  }

  await runCommitGuards(commandRunner, context);
  await runChecked(commandRunner, 'git', ['push', '-u', context.remote, context.branch], {
    cwd: context.worktreePath,
    env: context.env,
  });
  const commit = await runChecked(commandRunner, 'git', ['rev-parse', 'HEAD'], {
    cwd: context.worktreePath,
    env: context.env,
  });
  return { files, commitSha: commit.stdout.trim(), commitSubject };
}

export async function createDraftPullRequest(commandRunner, context, result) {
  const bodyPath = join(context.stateDir, 'pull-request-body.md');
  writeFileSync(bodyPath, buildPullRequestBody(context.task, result), 'utf8');
  const response = await runChecked(commandRunner, 'gh', [
    'pr', 'create', '--repo', context.repository, '--draft', '--base', context.baseBranch,
    '--head', context.branch, '--title', result.commitSubject, '--body-file', bodyPath,
  ], { cwd: context.worktreePath, env: context.env });
  const pullRequest = requireGitHubResultUrl(response.stdout, 'pull');
  return { pullRequestUrl: pullRequest.url, pullRequestNumber: pullRequest.number };
}
