import {
  EMBED_COLORS,
  buildNoticeDiscordPayload,
} from '../../discord-bot/src/message-formatting.mjs';
import { sendDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';
import { stableHash } from './ids.mjs';

const LIFECYCLE_RESOLUTIONS = new Set(['removed', 'made_private', 'kept', 'not_found']);

function normalizeText(value) {
  return String(value || '').trim();
}

function lifecycleMetadata(publication = {}) {
  return publication.metadata && typeof publication.metadata === 'object'
    ? publication.metadata
    : {};
}

function platformLabel(platform = '') {
  const normalized = normalizeText(platform).toLowerCase();
  if (normalized === 'youtube' || normalized === 'youtube_shorts') return 'YouTube';
  if (normalized === 'tiktok' || normalized === 'tiktok_video') return 'TikTok';
  if (normalized === 'instagram' || normalized === 'instagram_reels') return 'Instagram';
  return normalizeText(platform) || 'Social platform';
}

function publicationAccount(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  const username = normalizeText(
    metadata.instagram_reel_approval?.creator_username
      || metadata.tiktok_direct_post_approval?.creator_username
      || metadata.publisher_target?.instagram?.expected_username
      || metadata.publisher_target?.tiktok?.expected_username,
  ).replace(/^@/u, '');
  return username ? `@${username}` : normalizeText(publication.account_key) || 'Unknown';
}

export function buildPublicationFailureAlertMetadata(publication = {}, failure = {}) {
  const metadata = lifecycleMetadata(publication);
  const action = normalizeText(failure.action || 'publication_failed');
  const reason = normalizeText(failure.reason || 'publication_delivery_failed');
  const error = normalizeText(failure.error || metadata.publish_attempt_error || reason);
  const workflowState = normalizeText(
    failure.workflowState || failure.workflow_state || metadata.workflow_state || publication.status,
  );
  const fingerprint = stableHash({
    publicationId: publication.id || '',
    platform: publication.platform || '',
    accountKey: publication.account_key || '',
    externalId: publication.external_id || '',
    workflowState,
    action,
    reason,
    error,
  }, 24);
  const alreadySent = metadata.publication_failure_alert_fingerprint === fingerprint
    && metadata.publication_failure_alert_status === 'sent';
  return {
    ...metadata,
    publication_failure_alert_required: !alreadySent,
    publication_failure_alert_status: alreadySent ? 'sent' : 'pending',
    publication_failure_alert_fingerprint: fingerprint,
    publication_failure_alert_action: action,
    publication_failure_alert_reason: reason,
    publication_failure_alert_error: error,
    publication_failure_alert_workflow_state: workflowState,
    publication_failure_alert_detected_at: normalizeText(failure.asOf || failure.as_of)
      || new Date().toISOString(),
  };
}

function isPendingPublicationFailureAlert(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  return metadata.publication_failure_alert_required === true
    && metadata.publication_failure_alert_status !== 'sent'
    && Boolean(normalizeText(metadata.publication_failure_alert_fingerprint));
}

export function buildPublicationFailureAlertPayload(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  const platform = platformLabel(publication.platform);
  const publicUrl = normalizeText(publication.public_url);
  const fields = [
    { name: 'Platform', value: platform, inline: true },
    { name: 'Account', value: publicationAccount(publication), inline: true },
    {
      name: 'State',
      value: normalizeText(metadata.publication_failure_alert_workflow_state)
        || normalizeText(metadata.workflow_state)
        || normalizeText(publication.status)
        || 'unknown',
      inline: true,
    },
    ...(publication.title
      ? [{ name: 'Video', value: normalizeText(publication.title), inline: false }]
      : []),
    ...(publication.scheduled_for
      ? [{ name: 'Scheduled for', value: normalizeText(publication.scheduled_for), inline: false }]
      : []),
    {
      name: 'Reason',
      value: normalizeText(metadata.publication_failure_alert_reason) || 'publication_delivery_failed',
      inline: false,
    },
    ...(metadata.publication_failure_alert_error
      ? [{ name: 'Error', value: normalizeText(metadata.publication_failure_alert_error), inline: false }]
      : []),
    { name: 'Publication', value: normalizeText(publication.id) || 'Unknown', inline: false },
    ...(metadata.source_publication_id
      ? [{ name: 'Source publication', value: normalizeText(metadata.source_publication_id), inline: false }]
      : []),
    ...(publication.external_id
      ? [{ name: 'Remote ID', value: normalizeText(publication.external_id), inline: false }]
      : []),
    ...(publicUrl
      ? [{ name: 'Post', value: `[Open post](${publicUrl})`, inline: false }]
      : []),
  ];
  return buildNoticeDiscordPayload({
    title: `${platform} publication needs attention`,
    description: 'ORION could not complete one approved destination. Other platform deliveries continue independently.',
    color: EMBED_COLORS.alert,
    fields,
    footerText: 'O.R.I.O.N. multi-platform publication alert',
    allowedMentions: { parse: [] },
  });
}

export async function deliverPublicationFailureAlerts({
  store,
  publications = [],
  runtimeConfig = {},
  asOf = new Date().toISOString(),
  dryRun = false,
  sendDiscordMessage = sendDiscordChannelMessage,
}) {
  if (!store?.updatePublication) {
    throw new Error('Publication failure alert delivery requires publication update support.');
  }
  const alertsChannelId = normalizeText(runtimeConfig?.channelIds?.alerts);
  const updatedPublications = [];
  const results = [];

  for (const publication of publications) {
    if (!isPendingPublicationFailureAlert(publication)) {
      updatedPublications.push(publication);
      continue;
    }
    const metadata = lifecycleMetadata(publication);
    if (dryRun) {
      updatedPublications.push(publication);
      results.push(alertResult(publication, 'publication_failure_alert_due', {
        reason: alertsChannelId ? 'delivery_failure_pending' : 'alerts_channel_missing',
      }));
      continue;
    }

    let delivery;
    try {
      delivery = alertsChannelId
        ? await sendDiscordMessage(
          runtimeConfig,
          alertsChannelId,
          buildPublicationFailureAlertPayload(publication),
          { explicit: true },
        )
        : { posted: false, reason: 'alerts_channel_missing' };
    } catch (error) {
      delivery = {
        posted: false,
        reason: 'discord_exception',
        error: error.message || String(error),
      };
    }

    const posted = delivery?.posted === true;
    const alertError = posted
      ? ''
      : normalizeText(delivery?.error || delivery?.reason || 'discord_delivery_failed');
    const updated = await store.updatePublication(publication.id, {
      metadata: {
        ...metadata,
        publication_failure_alert_required: !posted,
        publication_failure_alert_status: posted ? 'sent' : 'pending',
        publication_failure_alert_last_attempt_at: asOf,
        publication_failure_alert_delivery_error: alertError,
        ...(posted
          ? {
            publication_failure_alerted_at: asOf,
            publication_failure_alert_channel_id: delivery.channelId || alertsChannelId,
            publication_failure_alert_message_id: delivery.messageId || '',
          }
          : {}),
      },
    }) || publication;
    updatedPublications.push(updated);
    results.push(alertResult(updated, posted
      ? 'publication_failure_alert_sent'
      : 'publication_failure_alert_pending', {
      reason: posted ? 'delivery_failure_reported' : alertError,
      message_id: delivery?.messageId || '',
    }));
  }

  return { publications: updatedPublications, results };
}

export async function persistAndDeliverPublicationFailureAlert({
  store,
  publication,
  patch = {},
  failure = {},
  runtimeConfig = {},
  asOf = new Date().toISOString(),
  dryRun = false,
  sendDiscordMessage = sendDiscordChannelMessage,
}) {
  if (!store?.updatePublication) {
    throw new Error('Publication failure recording requires publication update support.');
  }
  const candidate = {
    ...publication,
    ...patch,
    metadata: buildPublicationFailureAlertMetadata({
      ...publication,
      ...patch,
      metadata: {
        ...(publication?.metadata || {}),
        ...(patch.metadata || {}),
      },
    }, {
      ...failure,
      asOf: failure.asOf || failure.as_of || asOf,
    }),
  };
  const stored = dryRun
    ? candidate
    : await store.updatePublication(publication.id, {
      ...patch,
      metadata: candidate.metadata,
    }) || candidate;
  const delivered = await deliverPublicationFailureAlerts({
    store,
    publications: [stored],
    runtimeConfig,
    asOf,
    dryRun,
    sendDiscordMessage,
  });
  return {
    publication: delivered.publications[0] || stored,
    results: delivered.results,
  };
}

function isPendingLifecycleAlert(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  return metadata.source_lifecycle_action_required === true
    && !['sent', 'resolved'].includes(normalizeText(metadata.source_lifecycle_alert_status));
}

function manualActionDescription(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  const publicUrl = normalizeText(publication.public_url || metadata.tiktok_public_url);
  return [
    'The shared source publication was cancelled after TikTok delivery had already started.',
    'ORION cannot safely claim that the remote post was removed.',
    publicUrl
      ? 'Open the TikTok post, remove it or make it private if required, then record the outcome with the lifecycle-resolution command.'
      : 'Open the target TikTok account, remove the matching post or make it private if required, then record the outcome with the lifecycle-resolution command.',
  ].join(' ');
}

export function buildSocialPublicationLifecycleAlertPayload(publication = {}) {
  const metadata = lifecycleMetadata(publication);
  const publicUrl = normalizeText(publication.public_url || metadata.tiktok_public_url);
  const creatorUsername = normalizeText(
    metadata.tiktok_direct_post_approval?.creator_username
      || metadata.publisher_target?.tiktok?.expected_username,
  ).replace(/^@/u, '');
  const fields = [
    { name: 'Destination', value: 'TikTok', inline: true },
    { name: 'Account', value: creatorUsername ? `@${creatorUsername}` : publication.account_key || 'Unknown', inline: true },
    { name: 'TikTok state', value: metadata.workflow_state || publication.status || 'unknown', inline: true },
    { name: 'Source state', value: metadata.source_workflow_state || 'unknown', inline: true },
    { name: 'Reason', value: metadata.source_lifecycle_reason || 'source_cancelled_after_delivery_started', inline: false },
    { name: 'Source publication', value: metadata.source_publication_id || 'Unknown', inline: false },
    { name: 'TikTok publication', value: publication.id || 'Unknown', inline: false },
    ...(publication.external_id
      ? [{ name: 'TikTok publish ID', value: publication.external_id, inline: false }]
      : []),
    ...(publicUrl
      ? [{ name: 'Post', value: `[Open TikTok post](${publicUrl})`, inline: false }]
      : []),
  ];
  return buildNoticeDiscordPayload({
    title: 'TikTok manual removal check required',
    description: manualActionDescription(publication),
    color: EMBED_COLORS.alert,
    fields,
    footerText: 'O.R.I.O.N. multi-platform publication lifecycle',
    allowedMentions: { parse: [] },
  });
}

function alertResult(publication, action, extra = {}) {
  const metadata = lifecycleMetadata(publication);
  return {
    publication_id: publication.id || '',
    platform: publication.platform || '',
    account_key: publication.account_key || '',
    action,
    source_publication_id: metadata.source_publication_id || '',
    review_thread_id: metadata.source_review_thread_id || '',
    ...extra,
  };
}

export async function deliverSocialPublicationLifecycleAlerts({
  store,
  publications = [],
  runtimeConfig = {},
  asOf = new Date().toISOString(),
  dryRun = false,
  sendDiscordMessage = sendDiscordChannelMessage,
}) {
  if (!store?.updatePublication) {
    throw new Error('Lifecycle alert delivery requires publication update support.');
  }
  const updatedPublications = [];
  const results = [];

  for (const publication of publications) {
    if (!isPendingLifecycleAlert(publication)) {
      updatedPublications.push(publication);
      continue;
    }
    const metadata = lifecycleMetadata(publication);
    const reviewThreadId = normalizeText(metadata.source_review_thread_id);
    if (dryRun) {
      updatedPublications.push(publication);
      results.push(alertResult(publication, 'source_lifecycle_alert_due', {
        reason: reviewThreadId ? 'manual_action_pending' : 'review_thread_missing',
      }));
      continue;
    }

    let delivery;
    try {
      delivery = reviewThreadId
        ? await sendDiscordMessage(
          runtimeConfig,
          reviewThreadId,
          buildSocialPublicationLifecycleAlertPayload(publication),
          { explicit: true },
        )
        : { posted: false, reason: 'no_review_thread_id' };
    } catch (error) {
      delivery = {
        posted: false,
        reason: 'discord_exception',
        error: error.message || String(error),
      };
    }

    const alertStatus = delivery?.posted === true ? 'sent' : 'pending';
    const alertError = delivery?.posted === true
      ? ''
      : normalizeText(delivery?.error || delivery?.reason || 'discord_delivery_failed');
    const updated = await store.updatePublication(publication.id, {
      metadata: {
        ...metadata,
        source_lifecycle_alert_status: alertStatus,
        source_lifecycle_alert_last_attempt_at: asOf,
        source_lifecycle_alert_error: alertError,
        ...(delivery?.posted === true
          ? {
            source_lifecycle_alerted_at: asOf,
            source_lifecycle_alert_channel_id: delivery.channelId || reviewThreadId,
            source_lifecycle_alert_message_id: delivery.messageId || '',
          }
          : {}),
      },
    }) || publication;
    updatedPublications.push(updated);
    results.push(alertResult(updated, delivery?.posted === true
      ? 'source_lifecycle_alert_sent'
      : 'source_lifecycle_alert_pending', {
      reason: delivery?.posted === true ? 'manual_action_required' : alertError,
      message_id: delivery?.messageId || '',
    }));
  }

  return { publications: updatedPublications, results };
}

export async function resolveSocialPublicationLifecycleAction({
  store,
  publicationId,
  resolution,
  note = '',
  resolvedBy = '',
  asOf = new Date().toISOString(),
}) {
  const normalizedPublicationId = normalizeText(publicationId);
  const normalizedResolution = normalizeText(resolution).toLowerCase();
  if (!normalizedPublicationId) {
    throw new Error('Lifecycle resolution requires a publication id.');
  }
  if (!LIFECYCLE_RESOLUTIONS.has(normalizedResolution)) {
    throw new Error(`Lifecycle resolution must be one of: ${[...LIFECYCLE_RESOLUTIONS].join(', ')}.`);
  }
  if (!store?.fetchPublicationById || !store?.updatePublication) {
    throw new Error('Lifecycle resolution requires publication fetch and update support.');
  }
  const publication = await store.fetchPublicationById(normalizedPublicationId);
  if (!publication) {
    throw new Error(`Publication ${normalizedPublicationId} was not found.`);
  }
  const metadata = lifecycleMetadata(publication);
  if (metadata.source_lifecycle_action_required !== true) {
    throw new Error(`Publication ${normalizedPublicationId} has no unresolved lifecycle action.`);
  }
  const updated = await store.updatePublication(normalizedPublicationId, {
    metadata: {
      ...metadata,
      source_lifecycle_action_required: false,
      source_lifecycle_alert_status: 'resolved',
      source_lifecycle_resolution: normalizedResolution,
      source_lifecycle_resolved_reason: normalizeText(metadata.source_lifecycle_reason),
      source_lifecycle_resolution_note: normalizeText(note),
      source_lifecycle_resolved_by: normalizeText(resolvedBy),
      source_lifecycle_resolved_at: asOf,
    },
  }) || publication;
  return {
    publication_id: normalizedPublicationId,
    action: 'source_lifecycle_manual_action_resolved',
    resolution: normalizedResolution,
    resolved_at: updated.metadata?.source_lifecycle_resolved_at || asOf,
  };
}
