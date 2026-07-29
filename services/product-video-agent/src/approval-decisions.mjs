import { OutputManifestSchema, WorkflowApprovalSchema } from './schemas.mjs';

function updateSubjectState(manifest, approval, decision) {
  const approved = decision.decision === 'approve';
  if (approval.stage === 'script') {
    return {
      ...manifest,
      script_variants: manifest.script_variants.map((variant) => (
        variant.script_variant_id === approval.subject_id
          ? {
              ...variant,
              status: approved ? 'approved' : 'rejected',
              approval_status: approved ? 'approved' : 'rejected',
            }
          : variant
      )),
    };
  }
  if (approval.stage === 'asset') {
    return {
      ...manifest,
      assets: manifest.assets.map((asset) => (
        asset.asset_id === approval.subject_id
          ? { ...asset, approval_status: approved ? 'approved' : 'rejected' }
          : asset
      )),
    };
  }
  return manifest;
}

export function applyWorkflowApprovalDecision(manifestInput, decision) {
  const manifest = OutputManifestSchema.parse(manifestInput);
  const approval = manifest.workflow_approvals.find((item) => item.task_id === decision.taskId);
  if (!approval) {
    throw new Error(`Workflow approval ${decision.taskId} was not found.`);
  }
  if (['approved', 'rejected'].includes(approval.state)) {
    throw new Error(`Workflow approval ${decision.taskId} is already ${approval.state}.`);
  }
  if (approval.state === 'blocked' && decision.decision === 'approve') {
    throw new Error(`Workflow approval ${decision.taskId} is blocked and cannot be approved.`);
  }
  if (!['approve', 'reject'].includes(decision.decision)) {
    throw new Error('Workflow decision must be approve or reject.');
  }
  if (!String(decision.actor || '').trim()) {
    throw new Error('Workflow decision requires an operator identity.');
  }
  if (decision.decision === 'reject' && !String(decision.reason || '').trim()) {
    throw new Error('Workflow rejection requires a reason.');
  }

  const resolvedApproval = WorkflowApprovalSchema.parse({
    ...approval,
    state: decision.decision === 'approve' ? 'approved' : 'rejected',
    blocking_reasons: [],
    decided_at: decision.decidedAt,
    decided_by: decision.actor,
    decision_reason: decision.reason || '',
  });
  const subjectUpdated = updateSubjectState(manifest, approval, decision);
  return OutputManifestSchema.parse({
    ...subjectUpdated,
    workflow_approvals: manifest.workflow_approvals.map((item) => (
      item.approval_id === approval.approval_id ? resolvedApproval : item
    )),
  });
}
