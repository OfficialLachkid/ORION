function normalize(value) {
  return String(value || '').trim();
}

function normalizeCommit(value) {
  const matches = [...normalize(value).matchAll(/\b([0-9a-f]{7,40})\b/giu)]
    .map((match) => match[1].toLowerCase())
    .sort((left, right) => right.length - left.length);
  return matches[0] || '';
}

function buildPullRequestUrl(repository, pullRequestNumber) {
  return `https://github.com/${repository}/pull/${pullRequestNumber}`;
}

export function isEligibleDeveloperMergeObservation(observation, config) {
  const baseBranch = normalize(config?.developerAgent?.baseBranch || 'main');
  const sourceBranchPrefix = normalize(config?.developerAgent?.sourceBranchPrefix || 'agent/');
  const sourceBranch = normalize(observation?.sourceBranch);
  const targetBranch = normalize(observation?.targetBranch);
  const commit = normalizeCommit(observation?.commit);

  return config?.developerAgent?.mergeOnApproval !== false
    && observation?.isRuntimeValidation === true
    && normalize(observation?.status).toLowerCase() === 'success'
    && normalize(observation?.eventName) === 'pull_request'
    && normalize(observation?.repository).length > 0
    && Number(observation?.prNumber || 0) > 0
    && sourceBranch.startsWith(sourceBranchPrefix)
    && targetBranch === baseBranch
    && commit.length >= 7;
}

export function buildDeveloperMergeApprovalTask(observation, config, now = new Date()) {
  if (!isEligibleDeveloperMergeObservation(observation, config)) {
    return null;
  }

  const repository = normalize(observation.repository);
  const pullRequestNumber = Number(observation.prNumber);
  const expectedHeadSha = normalizeCommit(observation.commit);
  const sourceBranch = normalize(observation.sourceBranch);
  const targetBranch = normalize(observation.targetBranch);
  const taskId = `TASK-PR-MERGE-${pullRequestNumber}-${expectedHeadSha.slice(0, 12).toUpperCase()}`;
  const pullRequestUrl = buildPullRequestUrl(repository, pullRequestNumber);
  const summary = `Merge PR #${pullRequestNumber}: ${sourceBranch} -> ${targetBranch}`;

  return {
    task_id: taskId,
    source_type: 'github_ci_success',
    source_channel: 'ci',
    submitted_by: 'O.R.I.O.N. CI gate',
    submitted_at: now.toISOString(),
    summary,
    full_text: summary,
    target_agent: 'developer-agent',
    domain: 'developer',
    priority: 'normal',
    approval_required: true,
    approval_state: 'pending',
    approval_reason: `Runtime Validation passed for commit ${expectedHeadSha}. Approval marks the draft ready and merges only if the same head and all live checks still pass.`,
    status: 'awaiting_approval',
    runtime_action: 'github_merge_pull_request',
    automation_type: 'developer_agent_pr_merge',
    github_merge_request: {
      repository,
      pullRequestNumber,
      pullRequestUrl,
      sourceBranch,
      targetBranch,
      expectedHeadSha,
      ciRunUrl: normalize(observation.detailsUrl),
      ciRunNumber: Number(observation.runNumber || 0),
      workflowName: normalize(observation.workflowName),
    },
  };
}

export function buildDeveloperMergeApprovalEvents(task) {
  const request = task.github_merge_request || {};
  const commonMetadata = {
    taskId: task.task_id,
    summary: task.summary,
    targetAgent: task.target_agent,
    domain: task.domain,
    priority: task.priority,
    submittedBy: task.submitted_by,
    pullRequestNumber: request.pullRequestNumber || 0,
    pullRequestUrl: request.pullRequestUrl || '',
    sourceBranch: request.sourceBranch || '',
    targetBranch: request.targetBranch || '',
    expectedHeadSha: request.expectedHeadSha || '',
    ciRunUrl: request.ciRunUrl || '',
  };

  return [
    {
      channelKey: 'taskQueue',
      type: 'task_queue_update',
      body: `${task.task_id} is awaiting final merge approval.`,
      metadata: {
        ...commonMetadata,
        status: task.status,
      },
    },
    {
      channelKey: 'pullRequests',
      type: 'approval_request',
      body: `Approval needed for ${task.task_id}: ${task.summary}`,
      metadata: {
        ...commonMetadata,
        approvalReason: task.approval_reason,
        responsePattern: ['approve TASK-PR-MERGE-...', 'reject TASK-PR-MERGE-... because <reason>'],
      },
    },
  ];
}
