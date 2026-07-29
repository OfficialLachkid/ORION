import { projectRoot } from '../../lib/runtime-config.mjs';
import { defaultCommandRunner, runChecked } from './git-workflow.mjs';

const PASSING_CHECK_BUCKETS = new Set(['pass', 'skipping']);
const MERGE_METHOD_FLAGS = {
  merge: '--merge',
  rebase: '--rebase',
  squash: '--squash',
};

function parseJson(stdout, label) {
  try {
    return JSON.parse(String(stdout || '').trim());
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

async function readPullRequest(commandRunner, request, config) {
  const result = await runChecked(commandRunner, 'gh', [
    'pr',
    'view',
    String(request.pullRequestNumber),
    '--repo',
    request.repository,
    '--json',
    'number,url,title,state,isDraft,mergeable,mergeStateStatus,headRefName,headRefOid,baseRefName',
  ], { cwd: config?.developerAgent?.repositoryRoot || projectRoot, env: config.env });
  return parseJson(result.stdout, 'GitHub PR inspection');
}

async function readChecks(commandRunner, request, config, options = {}) {
  const attempts = Math.max(1, Number(options.checkAttempts || 6));
  const retryDelayMs = Math.max(0, Number(options.checkRetryDelayMs ?? 5000));
  const sleep = options.sleep || ((delayMs) => new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs)));
  let result = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await commandRunner('gh', [
      'pr',
      'checks',
      String(request.pullRequestNumber),
      '--repo',
      request.repository,
      '--json',
      'bucket,name,state,workflow',
    ], { cwd: config?.developerAgent?.repositoryRoot || projectRoot, env: config.env });

    if ((result.code ?? 0) !== 8 || attempt === attempts) {
      break;
    }
    await sleep(retryDelayMs);
  }

  if ((result?.code ?? 0) === 8) {
    throw new Error(`Pull request checks are still pending after ${attempts} verification attempt(s).`);
  }
  if ((result?.code ?? 0) !== 0) {
    throw new Error(`Could not verify pull request checks: ${result.stderr || result.stdout || 'unknown error'}`);
  }

  const checks = parseJson(result.stdout, 'GitHub PR checks');
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error('Pull request has no observable CI checks; refusing to merge.');
  }

  const failingChecks = checks.filter((check) => !PASSING_CHECK_BUCKETS.has(String(check?.bucket || '').toLowerCase()));
  if (failingChecks.length > 0) {
    throw new Error(`Pull request checks are not green: ${failingChecks.map((check) => check.name || 'unknown').join(', ')}.`);
  }

  const runtimeValidationPassed = checks.some((check) => {
    const name = `${check?.workflow || ''} ${check?.name || ''}`.toLowerCase();
    return String(check?.bucket || '').toLowerCase() === 'pass'
      && (name.includes('ruflo runtime validation') || name.includes('runtime validation'));
  });
  if (!runtimeValidationPassed) {
    throw new Error('Ruflo Runtime Validation is not present as a passing check.');
  }

  return checks;
}

function validatePullRequest(pr, request, config) {
  const configuredBaseBranch = config?.developerAgent?.baseBranch || 'main';
  const sourceBranchPrefix = config?.developerAgent?.sourceBranchPrefix || 'agent/';
  if (pr.state !== 'OPEN') {
    throw new Error(`Pull request #${request.pullRequestNumber} is ${String(pr.state || 'unknown').toLowerCase()}.`);
  }
  if (pr.baseRefName !== configuredBaseBranch || pr.baseRefName !== request.targetBranch) {
    throw new Error(`Pull request target changed from ${request.targetBranch} to ${pr.baseRefName || 'unknown'}.`);
  }
  if (pr.headRefName !== request.sourceBranch || !pr.headRefName.startsWith(sourceBranchPrefix)) {
    throw new Error(`Pull request source changed from ${request.sourceBranch} to ${pr.headRefName || 'unknown'}.`);
  }
  if (!String(pr.headRefOid || '').toLowerCase().startsWith(String(request.expectedHeadSha || '').toLowerCase())) {
    throw new Error('Pull request head changed after CI approval was requested. Wait for CI to pass on the new head.');
  }
  if (pr.mergeable === 'CONFLICTING') {
    throw new Error('Pull request has merge conflicts.');
  }
  if (pr.mergeable !== 'MERGEABLE') {
    throw new Error(`Pull request mergeability is ${String(pr.mergeable || 'unknown').toLowerCase()}; retry after GitHub resolves it.`);
  }
}

export async function executeApprovedPullRequestMerge(task, config, options = {}) {
  if (task?.approval_required !== true || task?.approval_state !== 'approved') {
    throw new Error('Explicit operator approval is required before merging a pull request.');
  }
  if (config?.developerAgent?.mergeOnApproval === false) {
    throw new Error('Discord-approved pull request merging is disabled.');
  }

  const request = task.github_merge_request || {};
  if (!request.repository || !request.pullRequestNumber || !request.expectedHeadSha) {
    throw new Error('Merge task is missing repository, pull request, or tested-head metadata.');
  }

  const commandRunner = options.commandRunner || defaultCommandRunner;
  const commandOptions = {
    cwd: config?.developerAgent?.repositoryRoot || projectRoot,
    env: config.env,
  };
  const localRepository = await runChecked(commandRunner, 'gh', [
    'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
  ], commandOptions);
  if (localRepository.stdout.trim() !== request.repository) {
    throw new Error(`Merge task repository ${request.repository} does not match ${localRepository.stdout.trim() || 'unknown'}.`);
  }

  const before = await readPullRequest(commandRunner, request, config);
  validatePullRequest(before, request, config);
  const checks = await readChecks(commandRunner, request, config, options);

  if (before.isDraft) {
    await runChecked(commandRunner, 'gh', [
      'pr', 'ready', String(request.pullRequestNumber), '--repo', request.repository,
    ], commandOptions);
  }

  const mergeMethod = String(config?.developerAgent?.mergeMethod || 'squash').toLowerCase();
  const mergeMethodFlag = MERGE_METHOD_FLAGS[mergeMethod];
  if (!mergeMethodFlag) {
    throw new Error(`Unsupported developer-agent merge method: ${mergeMethod}.`);
  }

  await runChecked(commandRunner, 'gh', [
    'pr',
    'merge',
    String(request.pullRequestNumber),
    '--repo',
    request.repository,
    mergeMethodFlag,
    '--delete-branch',
    '--match-head-commit',
    before.headRefOid,
  ], commandOptions);

  const after = await readPullRequest(commandRunner, request, config);
  const merged = after.state === 'MERGED';
  return {
    report: {
      state: merged ? 'merged' : 'merge_queued',
      severity: merged ? 'healthy' : 'warning',
      summary: merged
        ? `Merged PR #${request.pullRequestNumber} into ${request.targetBranch}.`
        : `PR #${request.pullRequestNumber} was approved and submitted to GitHub's merge queue.`,
      details: [
        `Validated ${checks.length} CI check(s).`,
        `Matched tested head ${before.headRefOid.slice(0, 7)}.`,
        `Merge method: ${mergeMethod}.`,
      ],
      nextSteps: merged ? ['The Mac sync watcher can now detect the new main commit.'] : ['Wait for GitHub merge-queue completion.'],
      pullRequestUrl: after.url || before.url || request.pullRequestUrl || '',
      pullRequestNumber: request.pullRequestNumber,
      branch: request.sourceBranch,
      baseBranch: request.targetBranch,
      commitSha: before.headRefOid,
      mergeMethod,
      merged,
      mergeQueued: !merged,
    },
  };
}
