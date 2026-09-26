export const TIKTOK_VIDEO_INIT_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/video/init/';
export const TIKTOK_STATUS_FETCH_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/status/fetch/';
export const TIKTOK_DEFAULT_PRIVACY_LEVEL = 'SELF_ONLY';
export const TIKTOK_MAX_CAPTION_LENGTH = 2200;
export const TIKTOK_DEFAULT_CHUNK_SIZE_BYTES = 64 * 1024 * 1024;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === true || value === false) return value;
  return defaultValue;
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

export function buildTikTokDirectPostInitRequest({
  publication,
  target = {},
  videoSizeBytes,
}) {
  const { chunkSizeBytes, totalChunkCount } = resolveTikTokChunking(videoSizeBytes, target);
  const tiktokConfig = target.tiktok || {};
  return {
    endpoint: TIKTOK_VIDEO_INIT_ENDPOINT,
    body: {
      post_info: {
        title: buildTikTokCaption(publication, target),
        privacy_level: normalizeText(tiktokConfig.privacy_level || tiktokConfig.privacyLevel)
          || TIKTOK_DEFAULT_PRIVACY_LEVEL,
        disable_duet: !normalizeBoolean(tiktokConfig.duet_enabled ?? tiktokConfig.duetEnabled, false),
        disable_comment: !normalizeBoolean(tiktokConfig.comments_enabled ?? tiktokConfig.commentsEnabled, true),
        disable_stitch: !normalizeBoolean(tiktokConfig.stitch_enabled ?? tiktokConfig.stitchEnabled, false),
        video_cover_timestamp_ms: Number(tiktokConfig.video_cover_timestamp_ms || 1000),
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
