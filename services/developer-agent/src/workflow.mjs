import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { executeClaudeTask } from '../../claude-runner/src/runner.mjs';
import {
  buildDeveloperBranch,
  createDraftPullRequest,
  createIssue,
  defaultCommandRunner,
  prepareWorktree,
  runChecked,
  validateCommitAndPublish,
} from './git-workflow.mjs';

const LOCK_STALE_MS = 6 * 60 * 60 * 1000;

function ensureDirectory(path) {
  mkdirSync(path, { recursive: true });
}

function resolveWorkflowConfig(config) {
  const runtimeRoot = config?.runtimePaths?.tmpDir || resolve(projectRoot, 'data', 'runtime', 'tmp');
  const configured = config?.developerAgent || {};
  return {
    enabled: configured.enabled !== false,
    repositoryRoot: configured.repositoryRoot || projectRoot,
    worktreesRoot: configured.worktreesRoot || resolve(runtimeRoot, 'developer-worktrees'),
    stateRoot: configured.stateRoot || resolve(runtimeRoot, 'developer-agent'),
    remote: configured.remote || 'origin',
    baseBranch: configured.baseBranch || 'main',
  };
}

function resolveWorkflowPaths(taskId, workflowConfig) {
  const safeTaskId = String(taskId || 'task').replace(/[^A-Za-z0-9-]/gu, '-');
  const stateDir = join(workflowConfig.stateRoot, 'tasks', safeTaskId);
  return {
    stateDir,
    statePath: join(stateDir, 'state.json'),
    lockPath: join(stateDir, 'workflow.lock'),
    worktreePath: join(workflowConfig.worktreesRoot, safeTaskId),
  };
}

function readState(statePath) {
  if (!existsSync(statePath)) {
    return null;
  }
  return JSON.parse(readFileSync(statePath, 'utf8'));
}

function writeState(statePath, state) {
  const nextState = {
    ...state,
    updatedAtUtc: new Date().toISOString(),
  };
  const temporaryPath = `${statePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  renameSync(temporaryPath, statePath);
  return nextState;
}

function acquireLock(lockPath) {
  if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
    unlinkSync(lockPath);
  }
  const descriptor = openSync(lockPath, 'wx');
  writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, startedAtUtc: new Date().toISOString() })}\n`);
  return () => {
    closeSync(descriptor);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  };
}

function buildBlockedReport(task, state, error) {
  return {
    report: {
      state: 'blocked',
      severity: 'blocked',
      blocked: true,
      summary: `Developer workflow blocked: ${error.message}`,
      details: [error.message],
      nextSteps: ['Resolve the reported blocker, then retry the same developer task.'],
      issueUrl: state?.issueUrl || '',
      issueNumber: state?.issueNumber || 0,
      branch: state?.branch || '',
      baseBranch: state?.baseBranch || 'main',
      worktreePath: state?.worktreePath || '',
      targetAgent: task.target_agent || 'developer-agent',
    },
  };
}

function buildClaudeTask(task, state) {
  return {
    ...task,
    full_text: [
      task.developer_request?.objective || task.full_text || task.summary,
      '',
      `GitHub issue: ${state.issueUrl}`,
      `Isolated branch: ${state.branch}`,
      'Work only in the current isolated worktree.',
      'Do not commit, push, create another issue/PR, or merge. The deterministic workflow owns those actions.',
      'Run relevant tests and return every changed file in FILES.',
    ].join('\n'),
  };
}

function buildClaudeConfig(config, worktreePath) {
  const safetyPrompt = [
    config?.claude?.appendSystemPrompt || '',
    'Developer-agent mode: edit only the current isolated worktree. Do not commit, push, open PRs, or merge.',
  ].filter(Boolean).join('\n');
  return {
    ...config,
    claude: {
      ...config.claude,
      workingDirectory: worktreePath,
      appendSystemPrompt: safetyPrompt,
    },
  };
}

async function initializeState(task, config, commandRunner, workflowConfig, paths) {
  const repositoryResult = await runChecked(commandRunner, 'gh', [
    'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner',
  ], { cwd: workflowConfig.repositoryRoot, env: config.env });
  const repository = repositoryResult.stdout.trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error('GitHub CLI did not return a valid repository name.');
  }
  const state = writeState(paths.statePath, {
    schemaVersion: 1,
    taskId: task.task_id,
    status: 'preparing',
    repository,
    baseBranch: workflowConfig.baseBranch,
    remote: workflowConfig.remote,
    branch: buildDeveloperBranch(task),
    worktreePath: paths.worktreePath,
    issueUrl: '',
    issueNumber: 0,
    pullRequestUrl: '',
    pullRequestNumber: 0,
    createdAtUtc: new Date().toISOString(),
  });
  return state;
}

async function ensurePrepared(task, config, commandRunner, workflowConfig, paths, currentState) {
  let state = currentState || await initializeState(task, config, commandRunner, workflowConfig, paths);
  const context = {
    ...workflowConfig,
    ...state,
    task,
    stateDir: paths.stateDir,
    env: config.env,
  };

  if (!state.issueUrl) {
    const issue = await createIssue(commandRunner, context);
    state = writeState(paths.statePath, { ...state, ...issue, status: 'issue_created' });
  }

  if (!existsSync(state.worktreePath)) {
    await prepareWorktree(commandRunner, { ...context, ...state });
    state = writeState(paths.statePath, { ...state, status: 'worktree_ready' });
  }
  return state;
}

export async function executeDeveloperAgentWorkflow(task, config, options = {}) {
  const workflowConfig = resolveWorkflowConfig(config);
  const paths = resolveWorkflowPaths(task.task_id, workflowConfig);
  ensureDirectory(paths.stateDir);
  ensureDirectory(workflowConfig.worktreesRoot);
  let state = readState(paths.statePath);

  if (!workflowConfig.enabled) {
    return buildBlockedReport(task, state, new Error('Developer-agent workflow is disabled.'));
  }
  if (task.approval_required !== true || task.approval_state !== 'approved') {
    return buildBlockedReport(task, state, new Error('Explicit operator approval is required before Claude or GitHub writes run.'));
  }
  if (state?.status === 'published' && state.pullRequestUrl) {
    return { report: { ...state.report, state: 'completed', severity: 'healthy' } };
  }

  let releaseLock;
  try {
    releaseLock = acquireLock(paths.lockPath);
    const commandRunner = options.commandRunner || defaultCommandRunner;
    const claudeTaskRunner = options.claudeTaskRunner || executeClaudeTask;
    await runChecked(commandRunner, 'gh', ['auth', 'status', '--hostname', 'github.com'], {
      cwd: workflowConfig.repositoryRoot,
      env: config.env,
    });
    state = await ensurePrepared(task, config, commandRunner, workflowConfig, paths, state);
    state = writeState(paths.statePath, { ...state, status: 'claude_running' });

    const claudeResult = await claudeTaskRunner(
      buildClaudeTask(task, state),
      buildClaudeConfig(config, state.worktreePath),
      { commandRunner: options.claudeCommandRunner }
    );
    const claudeReport = claudeResult?.report || {};
    if (claudeReport.state !== 'completed') {
      state = writeState(paths.statePath, {
        ...state,
        status: claudeReport.state || 'blocked',
        claudeSessionId: claudeReport.claudeSessionId || '',
      });
      return {
        report: {
          ...claudeReport,
          summary: `Developer workflow ${state.status}: ${claudeReport.summary || 'Claude did not complete the implementation.'}`,
          issueUrl: state.issueUrl,
          issueNumber: state.issueNumber,
          branch: state.branch,
          baseBranch: state.baseBranch,
          worktreePath: state.worktreePath,
        },
      };
    }

    state = writeState(paths.statePath, { ...state, status: 'validating' });
    const context = {
      ...workflowConfig,
      ...state,
      task,
      stateDir: paths.stateDir,
      env: config.env,
    };
    const publishResult = await validateCommitAndPublish(commandRunner, context);
    const prResult = await createDraftPullRequest(commandRunner, context, {
      ...publishResult,
      issueNumber: state.issueNumber,
    });
    const report = {
      state: 'completed',
      severity: 'healthy',
      summary: `Opened draft PR #${prResult.pullRequestNumber} from ${state.branch} into ${state.baseBranch}.`,
      details: [`Issue #${state.issueNumber}`, `Commit ${publishResult.commitSha.slice(0, 7)}`],
      nextSteps: ['Review GitHub Actions in #ci, then approve promotion or request changes.'],
      files: publishResult.files,
      issueUrl: state.issueUrl,
      issueNumber: state.issueNumber,
      pullRequestUrl: prResult.pullRequestUrl,
      pullRequestNumber: prResult.pullRequestNumber,
      branch: state.branch,
      baseBranch: state.baseBranch,
      commitSha: publishResult.commitSha,
      targetAgent: task.target_agent || 'developer-agent',
    };
    state = writeState(paths.statePath, {
      ...state,
      ...prResult,
      commitSha: publishResult.commitSha,
      status: 'published',
      report,
    });
    await commandRunner('git', ['worktree', 'remove', state.worktreePath], {
      cwd: workflowConfig.repositoryRoot,
      env: config.env,
    });
    return { report };
  } catch (error) {
    if (state) {
      state = writeState(paths.statePath, { ...state, status: 'blocked', error: error.message });
    }
    return buildBlockedReport(task, state, error);
  } finally {
    releaseLock?.();
  }
}
