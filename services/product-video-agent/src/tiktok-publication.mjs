export const TIKTOK_VIDEO_INIT_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
export const TIKTOK_STATUS_FETCH_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
export const TIKTOK_DEFAULT_PRIVACY_LEVEL = 'SELF_ONLY';
export const TIKTOK_MAX_CAPTION_LENGTH = 2200;
export const TIKTOK_DEFAULT_CHUNK_SIZE_BYTES = 64 * 1024 * 1024;
export const TIKTOK_DIRECT_POST_APPROVAL_VERSION = 1;

export class TikTokDirectPostValidationError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'TikTokDirectPostValidationError';
    this.code = details.code || 'tiktok_direct_post_validation_failed';
    this.details = details;
  }
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeHashtag(value) {
  const text = normalizeText(value).replace(/^#+/u, '');
  if (!text) return '';
  return `#${text.replace(/\s+/gu, '')}`;
}

function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)).trimEnd();
}

function normalizeUsername(value) {
  return normalizeText(value).replace(/^@/u, '').toLowerCase();
}

function requireBoolean(object, key) {
  if (object?.[key] !== true && object?.[key] !== false) {
    throw new TikTokDirectPostValidationError(
      `TikTok Direct Post approval requires an explicit ${key} choice.`,
      { code: 'tiktok_consent_required', field: key },
    );
  }
  return object[key];
}

function requireMatchingValue(actual, expected, label) {
  if (normalizeText(actual) !== normalizeText(expected)) {
    throw new TikTokDirectPostValidationError(
      `TikTok Direct Post approval no longer matches the ${label}. Approve the post again.`,
      { code: 'tiktok_consent_stale', field: label },
    );
  }
}

export function buildTikTokCaption(publication = {}, target = {}) {
  const tiktokConfig = target.tiktok || {};
  const explicitCaption = normalizeText(tiktokConfig.caption);
  if (explicitCaption) {
    return truncateText(explicitCaption, TIKTOK_MAX_CAPTION_LENGTH);
  }

  const hashtags = (Array.isArray(publication.hashtags) ? publication.hashtags : [])
    .map(normalizeHashtag)
    .filter(Boolean);
  const title = normalizeText(publication.title);
  const description = normalizeText(
    tiktokConfig.include_description === true ? publication.description : '',
  );
  return truncateText(
    [title, description, hashtags.join(' ')].filter(Boolean).join('\n\n'),
    TIKTOK_MAX_CAPTION_LENGTH,
  );
}

export function resolveTikTokChunking(videoSizeBytes, target = {}) {
  const configuredChunkSize = Number(target.tiktok?.chunk_size_bytes || target.tiktok?.chunkSizeBytes || 0);
  const chunkSize = Number.isFinite(configuredChunkSize) && configuredChunkSize > 0
    ? Math.min(Math.floor(configuredChunkSize), TIKTOK_DEFAULT_CHUNK_SIZE_BYTES)
    : Math.min(Number(videoSizeBytes), TIKTOK_DEFAULT_CHUNK_SIZE_BYTES);
  const normalizedVideoSize = Number(videoSizeBytes);
  if (!Number.isFinite(normalizedVideoSize) || normalizedVideoSize <= 0) {
    throw new Error(`Invalid TikTok video size: ${videoSizeBytes}`);
  }
  const normalizedChunkSize = Math.max(1, Math.min(chunkSize, normalizedVideoSize));
  return {
    chunkSizeBytes: normalizedChunkSize,
    totalChunkCount: Math.ceil(normalizedVideoSize / normalizedChunkSize),
  };
}

export function resolveTikTokDirectPostApproval({
  publication = {},
  target = {},
  renderPath = '',
  videoSizeBytes,
  videoSha256 = '',
}) {
  const approval = publication.metadata?.tiktok_direct_post_approval;
  if (!approval || approval.approved !== true) {
    throw new TikTokDirectPostValidationError(
      'TikTok upload blocked: this publication has no explicit Direct Post approval.',
      { code: 'tiktok_consent_required' },
    );
  }
  if (Number(approval.version) !== TIKTOK_DIRECT_POST_APPROVAL_VERSION) {
    throw new TikTokDirectPostValidationError(
      'TikTok upload blocked: the Direct Post approval version is missing or unsupported.',
      { code: 'tiktok_consent_required', field: 'version' },
    );
  }
  if (!Number.isFinite(Date.parse(normalizeText(approval.approved_at)))) {
    throw new TikTokDirectPostValidationError(
      'TikTok upload blocked: the Direct Post approval timestamp is invalid.',
      { code: 'tiktok_consent_required', field: 'approved_at' },
    );
  }

  const accountKey = normalizeText(target.accountKey || target.account_key);
  requireMatchingValue(approval.publication_id, publication.id, 'publication');
  requireMatchingValue(approval.video_id, publication.video_id, 'video');
  requireMatchingValue(approval.account_key, accountKey, 'TikTok account');
  requireMatchingValue(approval.render_path, renderPath, 'render path');
  if (Number(approval.video_size_bytes) !== Number(videoSizeBytes)) {
    throw new TikTokDirectPostValidationError(
      'TikTok Direct Post approval no longer matches the rendered video size. Approve the post again.',
      { code: 'tiktok_consent_stale', field: 'video_size_bytes' },
    );
  }
  if (!/^[a-f0-9]{64}$/u.test(normalizeText(videoSha256))
    || normalizeText(approval.video_sha256) !== normalizeText(videoSha256)) {
    throw new TikTokDirectPostValidationError(
      'TikTok Direct Post approval no longer matches the rendered video content. Approve the post again.',
      { code: 'tiktok_consent_stale', field: 'video_sha256' },
    );
  }

  if (typeof approval.caption !== 'string') {
    throw new TikTokDirectPostValidationError(
      'TikTok Direct Post approval requires the exact reviewed caption.',
      { code: 'tiktok_consent_required', field: 'caption' },
    );
  }
  const privacyLevel = normalizeText(approval.privacy_level);
  const creatorUsername = normalizeUsername(approval.creator_username);
  if (!privacyLevel || !creatorUsername) {
    throw new TikTokDirectPostValidationError(
      'TikTok Direct Post approval requires a privacy level and creator username.',
      { code: 'tiktok_consent_required' },
    );
  }

  return {
    caption: truncateText(approval.caption, TIKTOK_MAX_CAPTION_LENGTH),
    privacyLevel,
    creatorUsername,
    allowComment: requireBoolean(approval, 'allow_comment'),
    allowDuet: requireBoolean(approval, 'allow_duet'),
    allowStitch: requireBoolean(approval, 'allow_stitch'),
    brandContentToggle: requireBoolean(approval, 'brand_content_toggle'),
    brandOrganicToggle: requireBoolean(approval, 'brand_organic_toggle'),
    isAigc: requireBoolean(approval, 'is_aigc'),
    videoCoverTimestampMs: Number(approval.video_cover_timestamp_ms || 1000),
    approvedAt: normalizeText(approval.approved_at),
  };
}

export function validateTikTokCreatorCapabilities({
  postSettings,
  creatorInfo = {},
  target = {},
  videoDurationSeconds,
}) {
  const actualUsername = normalizeUsername(creatorInfo.creator_username);
  const expectedUsername = normalizeUsername(
    target.tiktok?.expected_username
      || target.tiktok?.expectedUsername
      || postSettings.creatorUsername,
  );
  if (!actualUsername || actualUsername !== postSettings.creatorUsername || actualUsername !== expectedUsername) {
    throw new TikTokDirectPostValidationError(
      `TikTok creator mismatch: connected @${actualUsername || 'unknown'}, expected @${expectedUsername || 'unknown'}.`,
      { code: 'tiktok_creator_mismatch', actualUsername, expectedUsername },
    );
  }

  const privacyOptions = Array.isArray(creatorInfo.privacy_level_options)
    ? creatorInfo.privacy_level_options.map(normalizeText).filter(Boolean)
    : [];
  if (!privacyOptions.includes(postSettings.privacyLevel)) {
    throw new TikTokDirectPostValidationError(
      `TikTok privacy level ${postSettings.privacyLevel} is not currently available for @${actualUsername}.`,
      { code: 'tiktok_privacy_unavailable', privacyOptions },
    );
  }

  const environment = normalizeText(target.tiktok?.environment || 'sandbox').toLowerCase();
  const auditStatus = normalizeText(target.tiktok?.direct_post_audit || 'unaudited').toLowerCase();
  if ((environment === 'sandbox' || auditStatus !== 'approved') && postSettings.privacyLevel !== 'SELF_ONLY') {
    throw new TikTokDirectPostValidationError(
      'TikTok Sandbox and unaudited Direct Post clients are restricted to SELF_ONLY privacy.',
      { code: 'tiktok_private_only' },
    );
  }

  const interactionChecks = [
    ['allowComment', 'comment_disabled', 'comments'],
    ['allowDuet', 'duet_disabled', 'duet'],
    ['allowStitch', 'stitch_disabled', 'stitch'],
  ];
  for (const [settingKey, creatorKey, label] of interactionChecks) {
    if (postSettings[settingKey] && creatorInfo[creatorKey] === true) {
      throw new TikTokDirectPostValidationError(
        `TikTok ${label} is currently unavailable for @${actualUsername}.`,
        { code: 'tiktok_interaction_unavailable', interaction: label },
      );
    }
  }

  const duration = Number(videoDurationSeconds);
  const maxDuration = Number(creatorInfo.max_video_post_duration_sec);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new TikTokDirectPostValidationError(
      'TikTok upload blocked because the rendered video duration could not be verified.',
      { code: 'tiktok_duration_unverified' },
    );
  }
  if (!Number.isFinite(maxDuration) || maxDuration <= 0) {
    throw new TikTokDirectPostValidationError(
      'TikTok upload blocked because the creator duration limit was not returned.',
      { code: 'tiktok_creator_capabilities_incomplete' },
    );
  }
  if (duration > maxDuration) {
    throw new TikTokDirectPostValidationError(
      `TikTok video duration ${duration}s exceeds the creator limit of ${maxDuration}s.`,
      { code: 'tiktok_duration_exceeded', duration, maxDuration },
    );
  }

  return {
    creatorUsername: actualUsername,
    creatorNickname: normalizeText(creatorInfo.creator_nickname),
    privacyOptions,
    videoDurationSeconds: duration,
    maxVideoPostDurationSeconds: maxDuration,
  };
}

export function buildTikTokDirectPostInitRequest({
  postSettings,
  target = {},
  videoSizeBytes,
}) {
  const { chunkSizeBytes, totalChunkCount } = resolveTikTokChunking(videoSizeBytes, target);
  return {
    endpoint: TIKTOK_VIDEO_INIT_ENDPOINT,
    body: {
      post_info: {
        title: postSettings.caption,
        privacy_level: postSettings.privacyLevel,
        disable_duet: !postSettings.allowDuet,
        disable_comment: !postSettings.allowComment,
        disable_stitch: !postSettings.allowStitch,
        video_cover_timestamp_ms: postSettings.videoCoverTimestampMs,
        brand_content_toggle: postSettings.brandContentToggle,
        brand_organic_toggle: postSettings.brandOrganicToggle,
        is_aigc: postSettings.isAigc,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: Number(videoSizeBytes),
        chunk_size: chunkSizeBytes,
        total_chunk_count: totalChunkCount,
      },
    },
  };
}

export function buildTikTokStatusFetchRequest(publishId) {
  const normalizedPublishId = normalizeText(publishId);
  if (!normalizedPublishId) {
    throw new Error('TikTok status fetch requires a publish id.');
  }
  return {
    endpoint: TIKTOK_STATUS_FETCH_ENDPOINT,
    body: {
      publish_id: normalizedPublishId,
    },
  };
}
