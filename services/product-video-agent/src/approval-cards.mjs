import { OutputManifestSchema } from './schemas.mjs';
import { buildApprovalButtons } from '../../discord-bot/src/approval-buttons.mjs';
import { buildOutboundEventDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';

function findSubject(manifest, approval) {
  if (approval.stage === 'script') {
    return manifest.script_variants.find((item) => item.script_variant_id === approval.subject_id)
      || manifest.script_jobs.find((item) => item.script_job_id === approval.subject_id);
  }
  if (approval.stage === 'asset') {
    return manifest.assets.find((item) => item.asset_id === approval.subject_id);
  }
  return manifest.render_jobs.find((item) => item.render_job_id === approval.subject_id);
}

function stageSummary(approval, subject, product) {
  if (approval.stage === 'script') {
    return `Review ${subject?.angle?.replaceAll('_', ' ') || 'planned'} script for ${product.canonical_name}.`;
  }
  if (approval.stage === 'asset') {
    return `Review ${subject?.media_type || 'media'} rights for ${product.canonical_name}.`;
  }
  return `Review local ${subject?.template_id || 'vertical'} render plan for ${product.canonical_name}.`;
}

function buildMetadata(manifest, approval) {
  const product = manifest.products.find((item) => item.product_id === approval.product_id);
  const subject = findSubject(manifest, approval);
  const scriptVariantMissing = approval.stage === 'script' && !subject?.spoken_text;
  const blockingReasons = [
    ...approval.blocking_reasons,
    ...(scriptVariantMissing ? ['script_variant_missing'] : []),
  ];
  return {
    taskId: approval.task_id,
    summary: stageSummary(approval, subject, product),
    targetAgent: 'product-video-agent',
    domain: 'content',
    priority: 'normal',
    submittedBy: approval.requested_by,
    approvalReason: `${approval.stage}_approval: explicit operator decision required`,
    approvalBlocked: approval.state === 'blocked' || scriptVariantMissing,
    approvalResolved: ['approved', 'rejected'].includes(approval.state),
    productVideoStage: approval.stage,
    productName: product.canonical_name,
    subjectId: approval.subject_id,
    approvalState: approval.state,
    blockingReasons,
    scriptAngle: approval.stage === 'script' ? subject?.angle || '' : '',
    scriptDurationSeconds: approval.stage === 'script' ? subject?.target_duration_seconds || 0 : 0,
    scriptPreview: approval.stage === 'script' ? subject?.spoken_text || '' : '',
    affiliateDisclosure: approval.stage === 'script' ? subject?.affiliate_disclosure || '' : '',
    assetMediaType: approval.stage === 'asset' ? subject?.media_type || '' : '',
    assetSourceProvider: approval.stage === 'asset' ? subject?.source_provider || '' : '',
    assetRightsStatus: approval.stage === 'asset' ? subject?.rights_status || '' : '',
    assetRightsBasis: approval.stage === 'asset' ? subject?.rights_basis || '' : '',
    assetRightsEvidence: approval.stage === 'asset' ? subject?.rights_evidence || '' : '',
    assetUsageScope: approval.stage === 'asset' ? subject?.usage_scope || '' : '',
    renderTemplate: approval.stage === 'render' ? subject?.template_id || '' : '',
    renderTargets: approval.stage === 'render' ? subject?.platform_targets || [] : [],
    renderBlockers: approval.stage === 'render' ? subject?.blockers || [] : [],
    renderPurpose: approval.stage === 'render' ? subject?.render_purpose || '' : '',
    publicationEligible: approval.stage === 'render' ? subject?.publication_eligible : false,
  };
}

export function buildProductVideoApprovalCards(manifestInput) {
  const manifest = OutputManifestSchema.parse(manifestInput);
  return manifest.workflow_approvals.map((approval) => {
    const metadata = buildMetadata(manifest, approval);
    const event = {
      channelKey: 'orionReview',
      type: 'approval_request',
      body: `Approval needed for ${approval.task_id}: ${metadata.summary}`,
      metadata,
    };
    const payload = buildOutboundEventDiscordPayload(event);
    payload.components = buildApprovalButtons(approval.task_id, {
      approveDisabled: metadata.approvalBlocked || metadata.approvalResolved,
      rejectDisabled: metadata.approvalResolved,
    });
    return { approval, event, payload };
  });
}
