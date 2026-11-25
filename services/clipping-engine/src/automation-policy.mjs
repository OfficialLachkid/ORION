const AUTOMATED_MODES = new Set(['authorized_api', 'authorized_browser', 'public_feed']);
const AUTOMATION_AUTHORIZATIONS = new Set([
  'written_permission',
  'published_api',
  'published_feed',
]);

function normalizeApproval(approval) {
  return {
    approved: approval?.approved === true,
    revision: String(approval?.revision || '').trim(),
    approvedAt: String(approval?.approved_at || approval?.approvedAt || '').trim(),
  };
}

function permissionIsCurrent(evidence, asOf) {
  if (!evidence) return false;
  const verifiedAt = Date.parse(evidence.verified_at || '');
  if (!Number.isFinite(verifiedAt) || verifiedAt > asOf.getTime()) return false;
  if (!evidence.expires_at) return true;
  const expiresAt = Date.parse(evidence.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > asOf.getTime();
}

export function evaluateMarketplaceAutomation({
  marketplace,
  action,
  approval,
  expectedRevision,
  asOf = new Date(),
} = {}) {
  if (!['discovery', 'submission'].includes(action)) {
    throw new Error(`Unsupported marketplace action: ${action}`);
  }
  const capability = marketplace?.[action];
  if (!capability) {
    return { allowed: false, reason: 'capability_missing' };
  }
  if (capability.mode === 'prohibited' || capability.authorization === 'prohibited_by_terms') {
    return { allowed: false, reason: 'prohibited_by_terms' };
  }
  if (!AUTOMATED_MODES.has(capability.mode)) {
    return { allowed: false, reason: 'manual_only' };
  }
  if (!AUTOMATION_AUTHORIZATIONS.has(capability.authorization)) {
    return { allowed: false, reason: 'automation_authorization_unproven' };
  }
  if (!permissionIsCurrent(capability.permission_evidence, asOf)) {
    return { allowed: false, reason: 'permission_evidence_missing_or_expired' };
  }

  const normalizedApproval = normalizeApproval(approval);
  if (!normalizedApproval.approved || !normalizedApproval.approvedAt) {
    return { allowed: false, reason: 'discord_approval_required' };
  }
  const approvalAt = Date.parse(normalizedApproval.approvedAt);
  if (!Number.isFinite(approvalAt) || approvalAt > asOf.getTime()) {
    return { allowed: false, reason: 'approval_timestamp_invalid' };
  }
  if (!expectedRevision || normalizedApproval.revision !== expectedRevision) {
    return { allowed: false, reason: 'approval_revision_mismatch' };
  }

  return {
    allowed: true,
    reason: 'authorized',
    mode: capability.mode,
    permissionSource: capability.permission_evidence.source_url,
  };
}

export function buildManualMarketplaceTask({ marketplace, action, campaignId, canonicalUrl }) {
  if (!marketplace?.key || !['discovery', 'submission'].includes(action)) {
    throw new Error('Marketplace key and supported action are required.');
  }
  return {
    schema_version: '1.0',
    marketplace_key: marketplace.key,
    action,
    campaign_id: String(campaignId || '').trim(),
    canonical_url: String(canonicalUrl || '').trim(),
    status: 'manual_action_required',
  };
}
