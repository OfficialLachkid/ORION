import {
  buildPokeQuizzPublicationMessagePayload,
  buildPokeQuizzPublicationReviewTask,
  isActionableReviewPublication,
} from './poke-quizz-publication-review.mjs';
import { resolvePokeQuizzReviewTaskPaths } from './poke-quizz-review-paths.mjs';
import { resolvePublicationReviewThreadId } from './publication-channels.mjs';
import {
  deleteDiscordChannelMessage,
  editDiscordChannelMessage,
  sendDiscordChannelMessage,
} from '../../../scripts/lib/discord-post.mjs';

const DEFAULT_PUBLISH_QUEUE_THREAD_ID = '1537491255192453160';

function normalizeWorkflowState(publication = {}) {
  return String(publication?.metadata?.workflow_state || publication?.status || '')
    .trim()
    .toLowerCase();
}

function mergePublicationMetadata(publication, patch = {}) {
  return {
    ...(publication?.metadata || {}),
    ...patch,
  };
}

function mergePublicationPatch(publication, patch = {}) {
  return {
    ...publication,
    ...patch,
    metadata: mergePublicationMetadata(publication, patch?.metadata || {}),
  };
}

export function resolvePublishQueueThreadId(runtimeConfig) {
  return String(
    runtimeConfig?.channelIds?.publishQueueAllChannels
      || runtimeConfig?.env?.DISCORD_PUBLISH_QUEUE_ALL_CHANNELS_THREAD_ID
      || DEFAULT_PUBLISH_QUEUE_THREAD_ID,
  ).trim();
}

function resolveHomeReviewThreadId(runtimeConfig, publication, channelProfile, currentThreadId, queueThreadId) {
  const storedHomeThreadId = String(publication?.metadata?.review_home_thread_id || '').trim();
  if (storedHomeThreadId) {
    return storedHomeThreadId;
  }

  const configuredReviewThreadId = String(
    resolvePublicationReviewThreadId(runtimeConfig, channelProfile) || '',
  ).trim();
  if (configuredReviewThreadId) {
    return configuredReviewThreadId;
  }

  if (currentThreadId && currentThreadId !== queueThreadId) {
    return currentThreadId;
  }

  return '';
}

export async function buildPublicationReviewTaskAndPayload({
  publication,
  videoRow,
  channelProfile,
  channelSelector,
  reviewPresentation = null,
  generationDurationMinutes = null,
  submittedAt = '',
}) {
  const currentReviewThreadId = String(publication?.metadata?.review_thread_id || '').trim();
  const reviewPaths = await resolvePokeQuizzReviewTaskPaths(publication);
  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video: videoRow,
    channelProfile,
    reviewThreadId: currentReviewThreadId,
    planPath: reviewPaths.planPath,
    renderPath: publication?.metadata?.render_path || videoRow?.render?.output_path || '',
    catalogJsonPath: reviewPaths.catalogJsonPath,
    templatePath: reviewPaths.templatePath,
    configPath: reviewPaths.configPath,
    channelSelector,
    reviewPresentation,
    generationDurationMinutes,
    submittedAt: submittedAt || publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
  });
  const payload = buildPokeQuizzPublicationMessagePayload(reviewTask);
  if (!isActionableReviewPublication(publication)) {
    payload.components = [];
  }
  return { reviewTask, payload };
}

export async function syncPublicationReviewMessage({
  runtimeConfig,
  store = null,
  publication,
  videoRow,
  channelProfile,
  channelSelector,
  reviewPresentation = null,
  generationDurationMinutes = null,
  editDiscordChannelMessageImpl = editDiscordChannelMessage,
  sendDiscordChannelMessageImpl = sendDiscordChannelMessage,
  deleteDiscordChannelMessageImpl = deleteDiscordChannelMessage,
}) {
  const currentThreadId = String(publication?.metadata?.review_thread_id || '').trim();
  const currentMessageId = String(publication?.metadata?.review_message_id || '').trim();
  if (!currentThreadId || !currentMessageId || !videoRow) {
    return {
      publication,
      updated: false,
      moved: false,
      routeAction: 'skipped',
      reason: 'missing_review_message',
      reviewTask: null,
      payload: null,
    };
  }

  const { reviewTask, payload } = await buildPublicationReviewTaskAndPayload({
    publication,
    videoRow,
    channelProfile,
    channelSelector,
    reviewPresentation,
    generationDurationMinutes,
  });

  const editResult = await editDiscordChannelMessageImpl(
    runtimeConfig,
    currentThreadId,
    currentMessageId,
    payload,
  );
  if (!editResult?.posted) {
    return {
      publication,
      updated: false,
      moved: false,
      routeAction: 'update_failed',
      reason: editResult?.reason || 'discord_edit_failed',
      error: editResult?.error || '',
      reviewTask,
      payload,
    };
  }

  const queueThreadId = resolvePublishQueueThreadId(runtimeConfig);
  const homeThreadId = resolveHomeReviewThreadId(
    runtimeConfig,
    publication,
    channelProfile,
    currentThreadId,
    queueThreadId,
  );
  const workflowState = normalizeWorkflowState(publication);
  const shouldRouteToQueue = workflowState === 'scheduled'
    && Boolean(queueThreadId)
    && currentThreadId !== queueThreadId;
  const shouldRouteBackToReview = isActionableReviewPublication(publication)
    && Boolean(homeThreadId)
    && Boolean(queueThreadId)
    && currentThreadId === queueThreadId
    && homeThreadId !== currentThreadId;

  const targetThreadId = shouldRouteToQueue
    ? queueThreadId
    : shouldRouteBackToReview
      ? homeThreadId
      : '';
  if (!targetThreadId) {
    return {
      publication,
      updated: true,
      moved: false,
      routeAction: 'stayed',
      reviewTask,
      payload,
    };
  }

  const posted = await sendDiscordChannelMessageImpl(runtimeConfig, targetThreadId, payload);
  if (!posted?.posted || !posted?.messageId) {
    return {
      publication,
      updated: true,
      moved: false,
      routeAction: shouldRouteToQueue ? 'queue_post_failed' : 'review_return_failed',
      reason: posted?.reason || 'discord_post_failed',
      error: posted?.error || '',
      reviewTask,
      payload,
    };
  }

  const movedAt = new Date().toISOString();
  const metadataPatch = shouldRouteToQueue
    ? {
      review_home_thread_id: homeThreadId || currentThreadId,
      review_thread_id: targetThreadId,
      review_message_id: posted.messageId,
      publish_queue_thread_id: targetThreadId,
      publish_queue_message_id: posted.messageId,
      publish_queue_moved_at: movedAt,
    }
    : {
      review_home_thread_id: homeThreadId,
      review_thread_id: targetThreadId,
      review_message_id: posted.messageId,
      publish_queue_thread_id: queueThreadId,
      publish_queue_message_id: '',
      publish_queue_returned_at: movedAt,
    };

  let nextPublication = mergePublicationPatch(publication, {
    metadata: metadataPatch,
  });
  if (store?.updatePublication && publication?.id) {
    nextPublication = await store.updatePublication(publication.id, {
      metadata: mergePublicationMetadata(publication, metadataPatch),
    }) || nextPublication;
  }

  const deleteResult = await deleteDiscordChannelMessageImpl(
    runtimeConfig,
    currentThreadId,
    currentMessageId,
  );
  const finalReview = await buildPublicationReviewTaskAndPayload({
    publication: nextPublication,
    videoRow,
    channelProfile,
    channelSelector,
    reviewPresentation,
    generationDurationMinutes,
  });

  return {
    publication: nextPublication,
    updated: true,
    moved: true,
    routeAction: shouldRouteToQueue ? 'to_publish_queue' : 'back_to_review',
    threadId: targetThreadId,
    messageId: posted.messageId,
    deleteResult,
    reviewTask: finalReview.reviewTask,
    payload: finalReview.payload,
  };
}
