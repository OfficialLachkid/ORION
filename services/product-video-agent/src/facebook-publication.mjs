export const FACEBOOK_REEL_APPROVAL_VERSION = 1;
export const FACEBOOK_MAX_DESCRIPTION_LENGTH = 5_000;
export const FACEBOOK_REEL_PLATFORM = 'facebook_reels';
export const FACEBOOK_GRAPH_DELIVERY_PROVIDER = 'facebook_graph';

export class FacebookPublicationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'FacebookPublicationValidationError';
    this.code = details.code || 'facebook_publication_validation_failed';
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeHashtag(value) {
  const text = normalizeText(value).replace(/^#+/u, '');
  return text ? `#${text.replace(/\s+/gu, '')}` : '';
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  return text.length <= maxLength
    ? text
    : text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function requireMatchingValue(actual, expected, label) {
  if (normalizeText(actual) !== normalizeText(expected)) {
    throw new FacebookPublicationValidationError(
      `Facebook approval no longer matches the ${label}. Approve the post again.`,
      { code: 'facebook_approval_stale', field: label },
    );
  }
}

export function buildFacebookReelDescription(publication = {}, target = {}) {
  const config = target.facebook || {};
  const explicitDescription = normalizeText(config.description);
  if (explicitDescription) {
    return truncateText(explicitDescription, FACEBOOK_MAX_DESCRIPTION_LENGTH);
  }
  const hashtags = (Array.isArray(publication.hashtags) ? publication.hashtags : [])
    .map(normalizeHashtag)
    .filter(Boolean);
  return truncateText(
    [
      normalizeText(publication.title),
      config.include_description === false ? '' : normalizeText(publication.description),
      hashtags.join(' '),
    ].filter(Boolean).join('\n\n'),
    FACEBOOK_MAX_DESCRIPTION_LENGTH,
  );
}

export function resolveFacebookReelApproval({
  publication = {},
  target = {},
  renderPath = '',
  videoSizeBytes,
  videoSha256 = '',
}) {
  const approval = publication.metadata?.facebook_reel_approval;
  if (!approval || approval.approved !== true) {
    throw new FacebookPublicationValidationError(
      'Facebook upload blocked: this publication has no explicit shared review approval.',
      { code: 'facebook_approval_required' },
    );
  }
  if (Number(approval.version) !== FACEBOOK_REEL_APPROVAL_VERSION) {
    throw new FacebookPublicationValidationError(
      'Facebook upload blocked: the approval version is missing or unsupported.',
      { code: 'facebook_approval_required', field: 'version' },
    );
  }
  if (!Number.isFinite(Date.parse(normalizeText(approval.approved_at)))) {
    throw new FacebookPublicationValidationError(
      'Facebook upload blocked: the approval timestamp is invalid.',
      { code: 'facebook_approval_required', field: 'approved_at' },
    );
  }

  const accountKey = normalizeText(target.accountKey || target.account_key);
  const pageId = normalizeText(target.facebook?.page_id || target.facebook?.pageId);
  const expectedPageName = normalizeText(
    target.facebook?.expected_page_name || target.facebook?.expectedPageName,
  );
  requireMatchingValue(approval.publication_id, publication.id, 'publication');
  requireMatchingValue(approval.video_id, publication.video_id, 'video');
  requireMatchingValue(approval.account_key, accountKey, 'Facebook account');
  requireMatchingValue(approval.page_id, pageId, 'Facebook Page id');
  requireMatchingValue(approval.expected_page_name, expectedPageName, 'Facebook Page name');
  requireMatchingValue(approval.render_path, renderPath, 'render path');
  if (Number(approval.video_size_bytes) !== Number(videoSizeBytes)) {
    throw new FacebookPublicationValidationError(
      'Facebook approval no longer matches the rendered video size. Approve the post again.',
      { code: 'facebook_approval_stale', field: 'video_size_bytes' },
    );
  }
  if (
    !/^[a-f0-9]{64}$/u.test(normalizeText(videoSha256))
    || normalizeText(approval.video_sha256) !== normalizeText(videoSha256)
  ) {
    throw new FacebookPublicationValidationError(
      'Facebook approval no longer matches the rendered video content. Approve the post again.',
      { code: 'facebook_approval_stale', field: 'video_sha256' },
    );
  }
  if (typeof approval.description !== 'string') {
    throw new FacebookPublicationValidationError(
      'Facebook approval requires the exact Reel description.',
      { code: 'facebook_approval_required', field: 'description' },
    );
  }

  return {
    accountKey,
    pageId,
    expectedPageName,
    description: truncateText(approval.description, FACEBOOK_MAX_DESCRIPTION_LENGTH),
    accessTokenEnv: normalizeText(
      target.facebook?.access_token_env || target.facebook?.accessTokenEnv,
    ),
    approvedAt: normalizeText(approval.approved_at),
  };
}
