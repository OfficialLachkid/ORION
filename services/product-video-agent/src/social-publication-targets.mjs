import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStableId } from './ids.mjs';
import {
  TIKTOK_DIRECT_POST_APPROVAL_VERSION,
} from './tiktok-publication.mjs';
import { INSTAGRAM_REEL_APPROVAL_VERSION } from './instagram-publication.mjs';
import { hashFileSha256 } from './tiktok-publication-executor.mjs';

export const YOUTUBE_SHORTS_PLATFORM = 'youtube_shorts';
export const TIKTOK_VIDEO_PLATFORM = 'tiktok_video';
export const INSTAGRAM_REEL_PLATFORM = 'instagram_reels';
export const TIKTOK_DIRECT_DELIVERY_PROVIDER = 'tiktok_direct';
export const BUFFER_DELIVERY_PROVIDER = 'buffer';
export const INSTAGRAM_GRAPH_DELIVERY_PROVIDER = 'instagram_graph';
const SOURCE_CANCELLED_STATES = new Set(['deleted', 'revision_requested', 'withdrawn']);
const CHILD_PENDING_STATES = new Set(['queued', 'scheduled']);
const CHILD_DELIVERY_STARTED_STATES = new Set(['publishing', 'published']);

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
  if (text === 'instagram' || text === 'instagram_reel' || text === INSTAGRAM_REEL_PLATFORM) {
    return INSTAGRAM_REEL_PLATFORM;
  }
  return text;
}

function normalizeScheduleMode(value) {
  const text = normalizeText(value).toLowerCase();
  if (text === 'immediate') return 'immediate';
  return 'orion';
}

function normalizeDeliveryProvider(value, platform) {
  const text = normalizeText(value).toLowerCase().replace(/[-\s]+/gu, '_');
  if (platform === INSTAGRAM_REEL_PLATFORM) {
    return text || INSTAGRAM_GRAPH_DELIVERY_PROVIDER;
  }
  if (platform !== TIKTOK_VIDEO_PLATFORM) return text;
  if (text === BUFFER_DELIVERY_PROVIDER) return BUFFER_DELIVERY_PROVIDER;
  return TIKTOK_DIRECT_DELIVERY_PROVIDER;
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
    deliveryProvider: normalizeDeliveryProvider(
      target.delivery_provider || target.deliveryProvider,
      platform,
    ),
    visibility: normalizeVisibility(target.visibility, platform),
    metadata: target.metadata && typeof target.metadata === 'object'
      ? { ...target.metadata }
      : {},
    tiktok: target.tiktok && typeof target.tiktok === 'object'
      ? { ...target.tiktok }
      : {},
    buffer: target.buffer && typeof target.buffer === 'object'
      ? { ...target.buffer }
      : {},
    instagram: target.instagram && typeof target.instagram === 'object'
      ? { ...target.instagram }
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
    delivery_provider: target.deliveryProvider || '',
    visibility: target.visibility || '',
    tiktok: target.tiktok || {},
    buffer: target.buffer || {},
    instagram: target.instagram || {},
    metadata: target.metadata || {},
  };
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function requireTikTokApprovalIdentity(target = {}, reviewedSettings = {}) {
  const creatorUsername = normalizeText(
    reviewedSettings.creatorUsername
      || target.buffer?.expected_username
      || target.buffer?.expectedUsername
      || target.tiktok?.expected_username
      || target.tiktok?.expectedUsername,
  ).replace(/^@/u, '').toLowerCase();
  if (!creatorUsername) {
    throw new Error(`TikTok target ${target.accountKey || ''} requires tiktok.expected_username.`);
  }
  return creatorUsername;
}

async function addTikTokDirectPostApproval({
  row,
  target,
  approval,
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  if (row.platform !== TIKTOK_VIDEO_PLATFORM || !approval?.approvedAt) {
    return row;
  }

  const reviewedSettings = approval.tiktokDirectPost;
  if (!reviewedSettings || normalizeText(reviewedSettings.accountKey) !== row.account_key) {
    throw new Error(
      `TikTok target ${row.account_key} was not included in the shared publication review.`,
    );
  }

  const renderPath = resolve(projectRoot, normalizeText(row.metadata?.render_path));
  const fileStats = await statImpl(renderPath);
  const videoSha256 = await hashFileImpl(renderPath);
  return {
    ...row,
    metadata: {
      ...(row.metadata || {}),
      tiktok_direct_post_approval: {
        version: TIKTOK_DIRECT_POST_APPROVAL_VERSION,
        approved: true,
        approved_at: approval.approvedAt,
        approved_by: normalizeText(approval.approvedBy),
        approved_by_id: normalizeText(approval.approvedById),
        source_review_task_id: normalizeText(approval.reviewTaskId),
        publication_id: row.id,
        video_id: row.video_id,
        account_key: row.account_key,
        delivery_provider: target.delivery_provider
          || target.deliveryProvider
          || TIKTOK_DIRECT_DELIVERY_PROVIDER,
        buffer_organization_id: normalizeText(
          target.buffer?.organization_id || target.buffer?.organizationId,
        ),
        buffer_channel_id: normalizeText(target.buffer?.channel_id || target.buffer?.channelId),
        creator_username: requireTikTokApprovalIdentity(target, reviewedSettings),
        render_path: renderPath,
        video_size_bytes: Number(fileStats.size),
        video_sha256: videoSha256,
        caption: String(reviewedSettings.caption ?? ''),
        privacy_level: normalizeText(reviewedSettings.privacyLevel),
        allow_comment: reviewedSettings.allowComment === true,
        allow_duet: reviewedSettings.allowDuet === true,
        allow_stitch: reviewedSettings.allowStitch === true,
        brand_content_toggle: reviewedSettings.brandContentToggle === true,
        brand_organic_toggle: reviewedSettings.brandOrganicToggle === true,
        is_aigc: reviewedSettings.isAigc === true,
        video_cover_timestamp_ms: Number(reviewedSettings.videoCoverTimestampMs || 1000),
      },
    },
  };
}

function requireInstagramApprovalIdentity(target = {}, reviewedSettings = {}) {
  const instagramUserId = normalizeText(
    reviewedSettings.instagramUserId
      || target.instagram?.user_id
      || target.instagram?.userId,
  );
  const creatorUsername = normalizeText(
    reviewedSettings.creatorUsername
      || target.instagram?.expected_username
      || target.instagram?.expectedUsername,
  ).replace(/^@/u, '').toLowerCase();
  if (!instagramUserId || !creatorUsername) {
    throw new Error(
      `Instagram target ${target.accountKey || target.account_key || ''} requires user_id and expected_username.`,
    );
  }
  return { instagramUserId, creatorUsername };
}

async function addInstagramReelApproval({
  row,
  target,
  approval,
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
}) {
  if (row.platform !== INSTAGRAM_REEL_PLATFORM || !approval?.approvedAt) {
    return row;
  }
  const reviewedSettings = (Array.isArray(approval.instagramReels)
    ? approval.instagramReels
    : []).find((item) => normalizeText(item?.accountKey) === row.account_key);
  if (!reviewedSettings) {
    throw new Error(
      `Instagram target ${row.account_key} was not included in the shared publication review.`,
    );
  }
  const identity = requireInstagramApprovalIdentity(target, reviewedSettings);
  const renderPath = resolve(projectRoot, normalizeText(row.metadata?.render_path));
  const fileStats = await statImpl(renderPath);
  const videoSha256 = await hashFileImpl(renderPath);
  return {
    ...row,
    metadata: {
      ...(row.metadata || {}),
      instagram_reel_approval: {
        version: INSTAGRAM_REEL_APPROVAL_VERSION,
        approved: true,
        approved_at: approval.approvedAt,
        approved_by: normalizeText(approval.approvedBy),
        approved_by_id: normalizeText(approval.approvedById),
        source_review_task_id: normalizeText(approval.reviewTaskId),
        publication_id: row.id,
        video_id: row.video_id,
        account_key: row.account_key,
        delivery_provider: target.delivery_provider
          || target.deliveryProvider
          || INSTAGRAM_GRAPH_DELIVERY_PROVIDER,
        instagram_user_id: identity.instagramUserId,
        creator_username: identity.creatorUsername,
        render_path: renderPath,
        video_size_bytes: Number(fileStats.size),
        video_sha256: videoSha256,
        caption: String(reviewedSettings.caption ?? ''),
        share_to_feed: reviewedSettings.shareToFeed === true,
      },
    },
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
  approval = null,
  projectRoot = process.cwd(),
  statImpl = stat,
  hashFileImpl = hashFileSha256,
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
  for (const candidate of rows) {
    const existing = typeof store.fetchPublicationById === 'function'
      ? await store.fetchPublicationById(candidate.id)
      : null;
    if (existing) {
      results.push({
        platform: existing.platform || candidate.platform,
        account_key: existing.account_key || candidate.account_key,
        publication_id: existing.id || candidate.id,
        workflow_state: existing?.metadata?.workflow_state || existing.status || '',
        scheduled_for: existing.scheduled_for || '',
        preserved: true,
      });
      continue;
    }

    let row = await addTikTokDirectPostApproval({
      row: candidate,
      target: candidate.metadata.publisher_target,
      approval,
      projectRoot,
      statImpl,
      hashFileImpl,
    });
    row = await addInstagramReelApproval({
      row,
      target: candidate.metadata.publisher_target,
      approval,
      projectRoot,
      statImpl,
      hashFileImpl,
    });
    const stored = await store.upsertPublication(row);
    results.push({
      platform: row.platform,
      account_key: row.account_key,
      publication_id: stored?.id || row.id,
      workflow_state: stored?.metadata?.workflow_state || row.metadata.workflow_state,
      scheduled_for: stored?.scheduled_for || row.scheduled_for || '',
      preserved: false,
    });
  }
  return results;
}

function buildSourceLifecyclePatch(childPublication = {}, sourcePublication = {}, asOf = '') {
  const childState = normalizeWorkflowState(childPublication);
  const sourceState = normalizeWorkflowState(sourcePublication);
  const sourceScheduledFor = normalizeText(sourcePublication.scheduled_for);
  const childScheduledFor = normalizeText(childPublication.scheduled_for);
  const hasExternalId = Boolean(normalizeText(childPublication.external_id));
  const lifecycleMetadata = {
    ...(childPublication.metadata || {}),
    source_workflow_state: sourceState,
    source_scheduled_for: sourceScheduledFor,
    source_lifecycle_checked_at: asOf,
  };

  if (SOURCE_CANCELLED_STATES.has(sourceState)) {
    const targetState = sourceState === 'deleted' ? 'deleted' : 'withdrawn';
    if (!hasExternalId && (childState === targetState || childState === 'deleted')) {
      return null;
    }
    if (hasExternalId || CHILD_DELIVERY_STARTED_STATES.has(childState)) {
      const reason = `source_${sourceState}_after_delivery_started`;
      if (
        childPublication.metadata?.source_lifecycle_action_required === false
        && normalizeText(childPublication.metadata?.source_lifecycle_resolved_at)
      ) {
        return null;
      }
      if (
        childPublication.metadata?.source_lifecycle_action_required === true
        && childPublication.metadata?.source_lifecycle_reason === reason
      ) {
        return null;
      }
      return {
        patch: {
          metadata: {
            ...lifecycleMetadata,
            source_lifecycle_action_required: true,
            source_lifecycle_reason: reason,
            source_lifecycle_alert_status: 'pending',
            source_lifecycle_alert_requested_at: asOf,
          },
        },
        action: 'source_lifecycle_manual_action_required',
      };
    }
    return {
      patch: {
        status: targetState,
        scheduled_for: null,
        metadata: {
          ...lifecycleMetadata,
          workflow_state: targetState,
          source_lifecycle_action_required: false,
          source_lifecycle_reason: `source_${sourceState}_before_delivery`,
          source_lifecycle_applied_at: asOf,
        },
      },
      action: `source_lifecycle_${targetState}`,
    };
  }

  if (
    CHILD_PENDING_STATES.has(childState)
    && !hasExternalId
    && sourceScheduledFor
    && sourceScheduledFor !== childScheduledFor
  ) {
    return {
      patch: {
        status: 'scheduled',
        scheduled_for: sourceScheduledFor,
        metadata: {
          ...lifecycleMetadata,
          workflow_state: 'scheduled',
          source_lifecycle_action_required: false,
          source_lifecycle_reason: 'source_schedule_changed',
          source_lifecycle_applied_at: asOf,
        },
      },
      action: 'source_schedule_synchronized',
    };
  }

  return null;
}

export async function reconcileAdditionalPlatformPublicationLifecycles({
  store,
  publications = [],
  asOf = new Date().toISOString(),
  dryRun = false,
}) {
  if (!store?.fetchPublicationById || !store?.updatePublication) {
    throw new Error('Platform lifecycle reconciliation requires publication fetch and update support.');
  }
  const sourceCache = new Map();
  const reconciledPublications = [];
  const results = [];

  for (const publication of publications) {
    const sourcePublicationId = normalizeText(publication.metadata?.source_publication_id);
    if (!sourcePublicationId) {
      reconciledPublications.push(publication);
      continue;
    }
    if (!sourceCache.has(sourcePublicationId)) {
      sourceCache.set(sourcePublicationId, await store.fetchPublicationById(sourcePublicationId));
    }
    const sourcePublication = sourceCache.get(sourcePublicationId);
    if (!sourcePublication) {
      reconciledPublications.push(publication);
      continue;
    }
    const lifecycle = buildSourceLifecyclePatch(publication, sourcePublication, asOf);
    if (!lifecycle) {
      reconciledPublications.push(publication);
      continue;
    }
    const updatedPublication = dryRun
      ? {
        ...publication,
        ...lifecycle.patch,
        metadata: lifecycle.patch.metadata || publication.metadata || {},
      }
      : await store.updatePublication(publication.id, lifecycle.patch) || publication;
    reconciledPublications.push(updatedPublication);
    results.push({
      publication_id: publication.id,
      platform: publication.platform || '',
      account_key: publication.account_key || '',
      action: dryRun ? `${lifecycle.action}_due` : lifecycle.action,
      workflow_state: normalizeWorkflowState(updatedPublication),
      source_publication_id: sourcePublicationId,
      source_workflow_state: normalizeWorkflowState(sourcePublication),
      scheduled_for: updatedPublication.scheduled_for || '',
    });
  }

  return { publications: reconciledPublications, results };
}
