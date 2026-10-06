import { createStableId } from './ids.mjs';

export const YOUTUBE_SHORTS_PLATFORM = 'youtube_shorts';
export const TIKTOK_VIDEO_PLATFORM = 'tiktok_video';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  const text = normalizeText(value).toLowerCase().replace(/[-\s]+/gu, '_');
  if (text === 'youtube' || text === 'youtube_short' || text === YOUTUBE_SHORTS_PLATFORM) {
    return YOUTUBE_SHORTS_PLATFORM;
  }
  if (text === 'tiktok' || text === 'tiktok_video' || text === 'tiktok_videos') {
    return TIKTOK_VIDEO_PLATFORM;
  }
  return text;
}

function normalizeScheduleMode(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === 'immediate') return 'immediate';
  return 'orion';
}

function normalizeVisibility(value, platform) {
  const text = normalizeText(value).toLowerCase();
  if (text) return text;
  return platform === TIKTOK_VIDEO_PLATFORM ? 'private' : '';
}

function resolveConfiguredTargets(channelProfile = {}) {
  const metadata = channelProfile.metadata || {};
  const publisher = metadata.publisher && typeof metadata.publisher === 'object'
    ? metadata.publisher
    : metadata.social_publisher && typeof metadata.social_publisher === 'object'
      ? metadata.social_publisher
      : {};
  return Array.isArray(publisher.targets) ? publisher.targets : [];
}

export function normalizePlatformPublicationTarget(target = {}, channelProfile = {}, index = 0) {
  const platform = normalizePlatform(target.platform);
  if (!platform) {
    return null;
  }

  const accountKey = normalizeText(target.account_key || target.accountKey);
  if (!accountKey) {
    return null;
  }

  return {
    id: normalizeText(target.id) || `${platform}-${accountKey}-${index}`,
    platform,
    accountKey,
    enabled: target.enabled === true,
    scheduleMode: normalizeScheduleMode(target.schedule_mode || target.scheduleMode),
    visibility: normalizeVisibility(target.visibility, platform),
    metadata: target.metadata && typeof target.metadata === 'object'
      ? { ...target.metadata }
      : {},
    tiktok: target.tiktok && typeof target.tiktok === 'object'
      ? { ...target.tiktok }
      : {},
    sourceAccountKey: normalizeText(channelProfile.account_key),
  };
}

export function listConfiguredPlatformPublicationTargets(channelProfile = {}) {
  return resolveConfiguredTargets(channelProfile)
    .map((target, index) => normalizePlatformPublicationTarget(target, channelProfile, index))
    .filter(Boolean);
}

export function listEnabledAdditionalPublicationTargets(channelProfile = {}) {
  const sourcePlatform = normalizePlatform(channelProfile.platform);
  const sourceAccountKey = normalizeText(channelProfile.account_key);
  return listConfiguredPlatformPublicationTargets(channelProfile)
    .filter((target) => (
      target.enabled
      && (
        target.platform !== sourcePlatform
        || target.accountKey !== sourceAccountKey
      )
    ));
}

function resolvePublicationRenderPath(sourcePublication = {}, videoRow = {}) {
  return normalizeText(
    sourcePublication.metadata?.render_path
      || videoRow.render?.output_path
      || '',
  );
}

function buildTargetPublicationId(sourcePublication = {}, target = {}) {
  return createStableId('publication-target', {
    sourcePublicationId: sourcePublication.id || '',
    videoId: sourcePublication.video_id || '',
    platform: target.platform,
    accountKey: target.accountKey,
  });
}

function serializeTargetForMetadata(target = {}) {
  return {
    id: target.id || '',
    platform: target.platform || '',
    account_key: target.accountKey || '',
    schedule_mode: target.scheduleMode || 'orion',
    visibility: target.visibility || '',
    tiktok: target.tiktok || {},
    metadata: target.metadata || {},
  };
}

export function buildAdditionalPlatformPublicationRow({
  sourcePublication,
  videoRow,
  sourceChannelProfile,
  target,
  scheduledFor = '',
  asOf = new Date().toISOString(),
}) {
  if (!sourcePublication?.id || !sourcePublication?.video_id) {
    throw new Error('Cannot create a platform publication target without a source publication and video id.');
  }
  if (!target?.platform || !target?.accountKey) {
    throw new Error('Cannot create a platform publication target without platform and account key.');
  }

  const normalizedScheduledFor = normalizeText(scheduledFor);
  const workflowState = normalizedScheduledFor ? 'scheduled' : 'queued';
  const renderPath = resolvePublicationRenderPath(sourcePublication, videoRow);
  const sourceMetadata = sourcePublication.metadata || {};
  return {
    id: buildTargetPublicationId(sourcePublication, target),
    video_id: sourcePublication.video_id,
    platform: target.platform,
    account_key: target.accountKey,
    status: workflowState,
    visibility: target.visibility || 'private',
    title: sourcePublication.title || videoRow.title || '',
    description: sourcePublication.description || '',
    hashtags: Array.isArray(sourcePublication.hashtags) ? [...sourcePublication.hashtags] : [],
    disclosure: sourcePublication.disclosure || '',
    preview_url: null,
    public_url: null,
    external_id: null,
    scheduled_for: normalizedScheduledFor || null,
    uploaded_at: null,
    published_at: null,
    metadata: {
      workflow_state: workflowState,
      platform_publication_kind: 'additional_target',
      source_publication_id: sourcePublication.id,
      source_video_id: sourcePublication.video_id,
      source_platform: sourcePublication.platform || sourceChannelProfile?.platform || '',
      source_account_key: sourcePublication.account_key || sourceChannelProfile?.account_key || '',
      source_external_id: sourcePublication.external_id || '',
      source_preview_url: sourcePublication.preview_url || '',
      source_public_url: sourcePublication.public_url || '',
      source_scheduled_for: normalizedScheduledFor,
      source_review_task_id: sourceMetadata.review_task_id || '',
      source_review_thread_id: sourceMetadata.review_thread_id || '',
      source_review_message_id: sourceMetadata.review_message_id || '',
      template_id: sourceMetadata.template_id || videoRow.render?.template_id || '',
      type_pair: sourceMetadata.type_pair || videoRow.render?.type_pair || [],
      seed: sourceMetadata.seed || videoRow.render?.seed || '',
      render_path: renderPath,
      publisher_target: serializeTargetForMetadata(target),
      created_from_source_at: asOf,
    },
  };
}

export function buildAdditionalPlatformPublicationRows({
  sourcePublication,
  videoRow,
  sourceChannelProfile,
  scheduledFor = '',
  asOf = new Date().toISOString(),
}) {
  return listEnabledAdditionalPublicationTargets(sourceChannelProfile)
    .map((target) => buildAdditionalPlatformPublicationRow({
      sourcePublication,
      videoRow,
      sourceChannelProfile,
      target,
      scheduledFor,
      asOf,
    }));
}

export async function upsertAdditionalPlatformPublicationTargets({
  store,
  sourcePublication,
  videoRow,
  sourceChannelProfile,
  scheduledFor = '',
  asOf = new Date().toISOString(),
}) {
  const rows = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor,
    asOf,
  });
  if (rows.length === 0) {
    return [];
  }
  if (!store?.upsertPublication) {
    throw new Error('Platform target publication fan-out requires a publication store with upsertPublication().');
  }

  const results = [];
  for (const row of rows) {
    const stored = await store.upsertPublication(row);
    results.push({
      platform: row.platform,
      account_key: row.account_key,
      publication_id: stored?.id || row.id,
      workflow_state: stored?.metadata?.workflow_state || row.metadata.workflow_state,
      scheduled_for: stored?.scheduled_for || row.scheduled_for || '',
    });
  }
  return results;
}
