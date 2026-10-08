import {
  EMBED_COLORS,
  buildNoticeDiscordPayload,
} from '../../discord-bot/src/message-formatting.mjs';
import { sendDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';

const LIFECYCLE_RESOLUTIONS = new Set(['removed', 'made_private', 'kept', 'not_found']);

function normalizeText(value) {
  return String(value || '').trim();
}

function lifecycleMetadata(publication = {}) {
  return publication.metadata && typeof publication.metadata === 'object'
    ? publication.metadata
    : {};
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
