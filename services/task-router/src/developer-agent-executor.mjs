import { executeDeveloperAgentWorkflow } from '../../developer-agent/src/workflow.mjs';

export function describeExplicitDeveloperAgentAction(task = {}) {
  if (task.runtime_action !== 'developer_agent_workflow' || !task.developer_request?.objective) {
    return null;
  }

  return {
    action: 'developer_agent_workflow',
    description: 'Create an issue and run the approved developer task in an isolated Git worktree.',
  };
}

export async function executeDeveloperAgentAction(task, config, options = {}) {
  const workflowRunner = options.workflowRunner || executeDeveloperAgentWorkflow;
  return workflowRunner(task, config, options);
}
