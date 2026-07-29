import { createStableId, stableHash } from './ids.mjs';
import { WorkflowApprovalSchema } from './schemas.mjs';

function createTaskId(stage, subjectId) {
  return `TASK-ORION-${stage.toUpperCase()}-${stableHash({ stage, subjectId }, 12).toUpperCase()}`;
}

function createApproval({ productId, stage, subjectId, state, blockers, config, runAt, decision = {} }) {
  return WorkflowApprovalSchema.parse({
    approval_id: createStableId('workflow-approval', { stage, subjectId }),
    product_id: productId,
    stage,
    subject_id: subjectId,
    task_id: createTaskId(stage, subjectId),
    state,
    blocking_reasons: blockers,
    requested_at: runAt,
    decided_at: decision.decidedAt || null,
    requested_by: config.operator,
    decided_by: decision.decidedBy || null,
    decision_reason: decision.reason || '',
  });
}

function assetApprovalState(asset) {
  const blockers = [];
  const internalTest = asset.usage_scope === 'internal_editor_test';
  if (!internalTest && asset.rights_status !== 'verified') {
    blockers.push(`rights_status=${asset.rights_status}`);
  }
  if (!internalTest && !asset.rights_evidence) {
    blockers.push('rights_evidence_missing');
  }
  if (internalTest && ![
    'manual_upload',
    'permitted_browser',
    'fixture',
  ].includes(asset.retrieval_method)) {
    blockers.push(`retrieval_method=${asset.retrieval_method}`);
  }
  if (internalTest && (!asset.local_path || !asset.content_sha256)) {
    blockers.push('internal_test_local_file_and_hash_required');
  }
  if (asset.approval_status === 'rejected') {
    blockers.push('asset_usage_rejected');
  }

  if (blockers.length > 0) {
    return { state: 'blocked', blockers };
  }
  if (asset.approval_status === 'approved') {
    return { state: 'approved', blockers: [] };
  }
  return { state: 'pending', blockers: [] };
}

export function buildWorkflowApprovals({ product, scriptJobs, assets, renderJobs, config, runAt }) {
  const scriptApprovals = scriptJobs.map((job) => createApproval({
    productId: product.product_id,
    stage: 'script',
    subjectId: job.script_job_id,
    state: 'pending',
    blockers: [],
    config,
    runAt,
  }));
  const assetApprovals = assets.map((asset) => {
    const { state, blockers } = assetApprovalState(asset);
    return createApproval({
      productId: product.product_id,
      stage: 'asset',
      subjectId: asset.asset_id,
      state,
      blockers,
      config,
      runAt,
      decision: state === 'approved' ? {
        decidedAt: runAt,
        decidedBy: asset.usage_scope === 'internal_editor_test'
          ? config.operator
          : 'fixture-rights-owner',
        reason: asset.usage_scope === 'internal_editor_test'
          ? 'Explicitly approved for local internal editor testing only; publication remains prohibited.'
          : asset.rights_evidence,
      } : {},
    });
  });
  const renderApprovals = renderJobs.map((job) => createApproval({
    productId: product.product_id,
    stage: 'render',
    subjectId: job.render_job_id,
    state: 'blocked',
    blockers: job.blockers,
    config,
    runAt,
  }));

  return [...scriptApprovals, ...assetApprovals, ...renderApprovals];
}

export function attachScriptVariantsToApprovals(approvals, scriptJobs, scriptVariants) {
  const variantByJobId = new Map(scriptJobs.map((job, index) => [
    job.script_job_id,
    scriptVariants[index],
  ]));

  return approvals.map((approval) => {
    if (approval.stage !== 'script') {
      return approval;
    }
    const variant = variantByJobId.get(approval.subject_id);
    if (!variant) {
      return approval;
    }
    return createApproval({
      productId: approval.product_id,
      stage: approval.stage,
      subjectId: variant.script_variant_id,
      state: 'pending',
      blockers: [],
      config: { operator: approval.requested_by },
      runAt: approval.requested_at,
    });
  });
}
