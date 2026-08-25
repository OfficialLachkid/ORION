import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildPokeQuizzPublicationMessagePayload,
  buildPokeQuizzPublicationReviewTask,
  isActionableReviewPublication,
} from './poke-quizz-publication-review.mjs';
import { resolvePokeQuizzReviewTaskPaths } from './poke-quizz-review-paths.mjs';
import { resolvePublicationReviewThreadId } from './publication-channels.mjs';
import { resolveStoredPokeQuizzReviewPaths } from './poke-quizz-review-paths.mjs';
import {
  DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  resolveVideoTemplateRuntime,
} from './video-template-context.mjs';
import {
  deleteDiscordChannelMessage,
  editDiscordChannelMessage,
  sendDiscordChannelMessage,
} from '../../../scripts/lib/discord-post.mjs';
import { projectRoot } from '../../lib/runtime-config.mjs';

const CHANNEL_CONFIGS_DIRECTORY = resolve(
  projectRoot,
  'services',
  'product-video-agent',
  'config',
  'channels',
);
const runtimeCache = new Map();
const channelConfigDiscoveryCache = new Map();

function normalizeWorkflowState(publication = {}) {
  return String(publication?.metadata?.workflow_state || publication?.status || '')
    .trim()
    .toLowerCase();
}

function normalizeComparablePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').toLowerCase();
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
      || '',
  ).trim();
}

async function resolveVideoTemplateRuntimeCached({
  channelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  channelSelector = '',
} = {}) {
  const normalizedChannelConfigPath = String(channelConfigPath || '').trim();
  if (!normalizedChannelConfigPath) {
    return null;
  }
  const cacheKey = `${normalizeComparablePath(normalizedChannelConfigPath)}::${String(channelSelector || '').trim().toLowerCase()}`;
  if (!runtimeCache.has(cacheKey)) {
    runtimeCache.set(cacheKey, (
      resolveVideoTemplateRuntime({
        projectRoot,
        channelConfigPath: normalizedChannelConfigPath,
        channelSelector,
      }).catch(() => null)
    ));
  }
  return runtimeCache.get(cacheKey);
}

async function discoverChannelConfigPathsForSelector(channelSelector = '') {
  const normalizedChannelSelector = String(channelSelector || '').trim().toLowerCase();
  if (!normalizedChannelSelector) {
    return [];
  }
  if (!channelConfigDiscoveryCache.has(normalizedChannelSelector)) {
    channelConfigDiscoveryCache.set(normalizedChannelSelector, (async () => {
      const entries = await readdir(CHANNEL_CONFIGS_DIRECTORY, { withFileTypes: true });
      const matches = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) {
          continue;
        }
        const absolutePath = resolve(CHANNEL_CONFIGS_DIRECTORY, entry.name);
        let rawConfig = null;
        try {
          rawConfig = JSON.parse(await readFile(absolutePath, 'utf8'));
        } catch {
          continue;
        }
        const rawSelector = String(rawConfig?.publication_channel_selector || '').trim().toLowerCase();
        if (rawSelector === normalizedChannelSelector) {
          matches.push(`services/product-video-agent/config/channels/${entry.name}`);
        }
      }
      return matches.sort((left, right) => left.localeCompare(right));
    })());
  }
  return channelConfigDiscoveryCache.get(normalizedChannelSelector);
}

export async function resolvePublicationReviewTemplateRuntime({
  publication,
  channelSelector = '',
  fallbackChannelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
} = {}) {
  const storedReviewChannelConfigPath = String(
    publication?.metadata?.review_channel_config_path
      || publication?.metadata?.channel_config_path
      || '',
  ).trim();
  const storedReviewPaths = resolveStoredPokeQuizzReviewPaths(publication);
  const desiredTemplateId = String(publication?.metadata?.template_id || '').trim();
  const desiredTemplatePath = normalizeComparablePath(storedReviewPaths.templatePath);
  const desiredConfigPath = normalizeComparablePath(storedReviewPaths.configPath);
  const candidateChannelConfigPaths = new Set();

  if (storedReviewChannelConfigPath) {
    candidateChannelConfigPaths.add(storedReviewChannelConfigPath);
  }
  if (fallbackChannelConfigPath) {
    candidateChannelConfigPaths.add(fallbackChannelConfigPath);
    const fallbackRuntime = await resolveVideoTemplateRuntimeCached({
      channelConfigPath: fallbackChannelConfigPath,
      channelSelector,
    });
    if (fallbackRuntime?.channelConfigPath) {
      candidateChannelConfigPaths.add(fallbackRuntime.channelConfigPath);
    }
    for (const mixPath of fallbackRuntime?.channelConfig?.night_shift?.review_backlog?.mix_channel_config_paths || []) {
      const normalizedMixPath = String(mixPath || '').trim();
      if (normalizedMixPath) {
        candidateChannelConfigPaths.add(normalizedMixPath);
      }
    }
  }
  for (const discoveredPath of await discoverChannelConfigPathsForSelector(channelSelector)) {
    candidateChannelConfigPaths.add(discoveredPath);
  }

  const candidateRuntimes = (await Promise.all(
    [...candidateChannelConfigPaths]
      .map((channelConfigPath) => String(channelConfigPath || '').trim())
      .filter(Boolean)
      .map((channelConfigPath) => resolveVideoTemplateRuntimeCached({
        channelConfigPath,
        channelSelector,
      })),
  )).filter((runtime) => Boolean(runtime));

  if (candidateRuntimes.length === 0) {
    return null;
  }

  const storedReviewChannelConfigComparable = normalizeComparablePath(storedReviewChannelConfigPath);
  const rankedCandidates = candidateRuntimes
    .map((runtime) => {
      let score = 0;
      if (storedReviewChannelConfigComparable && normalizeComparablePath(runtime.channelConfigPath) === storedReviewChannelConfigComparable) {
        score += 1000;
      }
      if (desiredTemplateId && runtime.templateId === desiredTemplateId) {
        score += 100;
      }
      if (desiredTemplatePath && normalizeComparablePath(runtime.templatePath) === desiredTemplatePath) {
        score += 50;
      }
      if (desiredConfigPath && normalizeComparablePath(runtime.configPath) === desiredConfigPath) {
        score += 10;
      }
      return {
        runtime,
        score,
      };
    })
    .sort((left, right) => right.score - left.score);

  return rankedCandidates[0]?.runtime || candidateRuntimes[0] || null;
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
  channelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  reviewPresentation = null,
  generationDurationMinutes = null,
  submittedAt = '',
}) {
  const currentReviewThreadId = String(publication?.metadata?.review_thread_id || '').trim();
  const reviewPaths = await resolvePokeQuizzReviewTaskPaths(publication);
  const resolvedTemplateRuntime = reviewPresentation
    ? null
    : await resolvePublicationReviewTemplateRuntime({
      publication,
      channelSelector,
      fallbackChannelConfigPath: channelConfigPath,
    });
  const effectiveReviewPresentation = reviewPresentation || resolvedTemplateRuntime?.reviewPresentation || null;
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
    reviewPresentation: effectiveReviewPresentation,
    generationDurationMinutes,
    submittedAt: submittedAt || publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
  });
  const payload = buildPokeQuizzPublicationMessagePayload(reviewTask);
  if (!isActionableReviewPublication(publication)) {
    payload.components = [];
  }
  return {
    reviewTask,
    payload,
    templateRuntime: resolvedTemplateRuntime,
  };
}

export async function syncPublicationReviewMessage({
  runtimeConfig,
  store = null,
  publication,
  videoRow,
  channelProfile,
  channelSelector,
  channelConfigPath = DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
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
    channelConfigPath,
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
    channelConfigPath,
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
