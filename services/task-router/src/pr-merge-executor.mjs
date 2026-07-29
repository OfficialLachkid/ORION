import { executeApprovedPullRequestMerge } from '../../developer-agent/src/pr-merge.mjs';

export function describeExplicitPullRequestMergeAction(task = {}) {
  if (task.runtime_action !== 'github_merge_pull_request' || !task.github_merge_request?.pullRequestNumber) {
    return null;
  }

  return {
    action: 'github_merge_pull_request',
    description: 'Revalidate and merge the CI-green pull request after explicit operator approval.',
  };
}

export async function executePullRequestMergeAction(task, config, options = {}) {
  const workflowRunner = options.workflowRunner || executeApprovedPullRequestMerge;
  return workflowRunner(task, config, {
    commandRunner: options.commandRunner,
  });
}
