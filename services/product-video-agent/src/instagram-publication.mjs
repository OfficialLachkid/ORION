export const INSTAGRAM_REEL_APPROVAL_VERSION = 1;
export const INSTAGRAM_MAX_CAPTION_LENGTH = 2200;

export class InstagramPublicationValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'InstagramPublicationValidationError';
    this.code = details.code || 'instagram_publication_validation_failed';
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/^@/u, '').toLowerCase();
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
    throw new InstagramPublicationValidationError(
      `Instagram approval no longer matches the ${label}. Approve the post again.`,
      { code: 'instagram_approval_stale', field: label },
    );
  }
}

export function buildInstagramCaption(publication = {}, target = {}) {
  const config = target.instagram || {};
  const explicitCaption = normalizeText(config.caption);
  if (explicitCaption) {
    return truncateText(explicitCaption, INSTAGRAM_MAX_CAPTION_LENGTH);
  }

  const hashtags = (Array.isArray(publication.hashtags) ? publication.hashtags : [])
    .map(normalizeHashtag)
    .filter(Boolean);
  const description = config.include_description === false
    ? ''
    : normalizeText(publication.description);
  return truncateText(
    [normalizeText(publication.title), description, hashtags.join(' ')]
      .filter(Boolean)
      .join('\n\n'),
    INSTAGRAM_MAX_CAPTION_LENGTH,
  );
}

export function resolveInstagramReelApproval({
  publication = {},
  target = {},
  renderPath = '',
  videoSizeBytes,
  videoSha256 = '',
}) {
  const approval = publication.metadata?.instagram_reel_approval;
  if (!approval || approval.approved !== true) {
    throw new InstagramPublicationValidationError(
      'Instagram upload blocked: this publication has no explicit shared review approval.',
      { code: 'instagram_approval_required' },
    );
  }
  if (Number(approval.version) !== INSTAGRAM_REEL_APPROVAL_VERSION) {
    throw new InstagramPublicationValidationError(
      'Instagram upload blocked: the approval version is missing or unsupported.',
      { code: 'instagram_approval_required', field: 'version' },
    );
  }
  if (!Number.isFinite(Date.parse(normalizeText(approval.approved_at)))) {
    throw new InstagramPublicationValidationError(
      'Instagram upload blocked: the approval timestamp is invalid.',
      { code: 'instagram_approval_required', field: 'approved_at' },
    );
  }

  const accountKey = normalizeText(target.accountKey || target.account_key);
  const instagramUserId = normalizeText(
    target.instagram?.user_id || target.instagram?.userId,
  );
  const expectedUsername = normalizeUsername(
    target.instagram?.expected_username || target.instagram?.expectedUsername,
  );
  requireMatchingValue(approval.publication_id, publication.id, 'publication');
  requireMatchingValue(approval.video_id, publication.video_id, 'video');
  requireMatchingValue(approval.account_key, accountKey, 'Instagram account');
  requireMatchingValue(approval.instagram_user_id, instagramUserId, 'Instagram user id');
  requireMatchingValue(approval.creator_username, expectedUsername, 'Instagram username');
  requireMatchingValue(approval.render_path, renderPath, 'render path');
  if (Number(approval.video_size_bytes) !== Number(videoSizeBytes)) {
    throw new InstagramPublicationValidationError(
      'Instagram approval no longer matches the rendered video size. Approve the post again.',
      { code: 'instagram_approval_stale', field: 'video_size_bytes' },
    );
  }
  if (
    !/^[a-f0-9]{64}$/u.test(normalizeText(videoSha256))
    || normalizeText(approval.video_sha256) !== normalizeText(videoSha256)
  ) {
    throw new InstagramPublicationValidationError(
      'Instagram approval no longer matches the rendered video content. Approve the post again.',
      { code: 'instagram_approval_stale', field: 'video_sha256' },
    );
  }
  if (typeof approval.caption !== 'string' || typeof approval.share_to_feed !== 'boolean') {
    throw new InstagramPublicationValidationError(
      'Instagram approval requires the exact caption and Share to Feed choice.',
      { code: 'instagram_approval_required' },
    );
  }

  return {
    accountKey,
    instagramUserId,
    creatorUsername: expectedUsername,
    caption: truncateText(approval.caption, INSTAGRAM_MAX_CAPTION_LENGTH),
    shareToFeed: approval.share_to_feed,
    accessTokenEnv: normalizeText(
      target.instagram?.access_token_env || target.instagram?.accessTokenEnv,
    ),
    approvedAt: normalizeText(approval.approved_at),
  };
}
