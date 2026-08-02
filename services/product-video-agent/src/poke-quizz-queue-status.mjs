import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { buildNoticeDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';
import {
  editDiscordChannelMessage,
  sendDiscordChannelMessage,
} from '../../../scripts/lib/discord-post.mjs';
import { listCommittedScheduledPublications } from './publication-queue.mjs';

const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';
const POKE_QUIZZ_QUEUE_STATUS_STATE_PATH = resolve(
  projectRoot,
  'data/runtime/product-video-agent/poke-quizz/queue-status-message.json',
);
const POKE_QUIZZ_QUEUE_STATUS_COLORS = Object.freeze({
  healthy: 0x57F287,
  lowReview: 0xFEE75C,
  idle: 0x99AAB5,
});
const POKE_QUIZZ_REVIEW_TARGET_COUNT = 10;

function workflowState(publication = {}) {
  if (publication.metadata?.workflow_state) {
    return String(publication.metadata.workflow_state).trim().toLowerCase();
  }
  if (publication.status === 'published') return 'published';
  if (publication.status === 'deleted') return 'deleted';
  if (publication.status === 'failed') return 'failed';
  if (publication.status === 'blocked') return 'blocked';
  if (publication.preview_url) return 'preview_uploaded';
  return 'preview_upload_pending';
}

function buildYoutubeChannelUrl(channelProfile = {}) {
  const channelId = String(channelProfile?.youtube?.channel_id || '').trim();
  return channelId ? `https://www.youtube.com/channel/${channelId}` : '';
}

function formatMarkdownLink(label, url) {
  const text = String(label || '').trim();
  const href = String(url || '').trim();
  if (!text) {
    return href;
  }
  if (!href) {
    return text;
  }
  return `[${text}](${href})`;
}

function formatScheduledForLabel(value, timeZone = 'UTC') {
  const iso = String(value || '').trim();
  if (!iso) {
    return 'Not scheduled';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)} ${timeZone}`;
}

function buildReviewThreadMention(reviewThreadId) {
  const normalized = String(reviewThreadId || '').trim();
  return normalized ? `<#${normalized}>` : 'the review queue';
}

async function readQueueStatusState() {
  try {
    return JSON.parse(await readFile(POKE_QUIZZ_QUEUE_STATUS_STATE_PATH, 'utf8'));
  } catch {
    return { channels: {} };
  }
}

async function writeQueueStatusState(payload) {
  await mkdir(dirname(POKE_QUIZZ_QUEUE_STATUS_STATE_PATH), { recursive: true });
  await writeFile(
    POKE_QUIZZ_QUEUE_STATUS_STATE_PATH,
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
}

export function resolvePreferredPokeQuizzCatalogJsonPath() {
  const candidates = [
    'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
    'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
    'data/runtime/product-video-agent/pokedex/gen1-gen6-localized.json',
  ];

  return candidates.find((relativePath) => existsSync(resolve(projectRoot, relativePath))) || '';
}

async function mergeLocalizedCatalogs(sourcePaths = [], outputPath = '') {
  const absoluteSourcePaths = sourcePaths.map((relativePath) => resolve(projectRoot, relativePath));
  const payloads = await Promise.all(
    absoluteSourcePaths.map((filePath) => readFile(filePath, 'utf8').then(JSON.parse)),
  );
  const byId = new Map();
  for (const rows of payloads) {
    for (const row of rows) {
      byId.set(row.id, row);
    }
  }
  const mergedRows = [...byId.values()].sort((left, right) => {
    const dexDelta = Number(left.national_dex_number || 0) - Number(right.national_dex_number || 0);
    if (dexDelta !== 0) {
      return dexDelta;
    }
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  const absoluteOutputPath = resolve(projectRoot, outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(mergedRows, null, 2)}\n`, 'utf8');
  return outputPath;
}

export async function ensurePreferredPokeQuizzCatalogJsonPath() {
  const existing = resolvePreferredPokeQuizzCatalogJsonPath();
  if (existing === 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json') {
    return existing;
  }

  const buildPlans = [
    {
      output: 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
      sources: [
        'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
        'data/runtime/product-video-agent/pokedex/gen8-localized.json',
        'data/runtime/product-video-agent/pokedex/gen9-localized.json',
      ],
    },
    {
      output: 'data/runtime/product-video-agent/pokedex/gen1-gen8-localized.json',
      sources: [
        'data/runtime/product-video-agent/pokedex/gen1-gen7-localized.json',
        'data/runtime/product-video-agent/pokedex/gen8-localized.json',
      ],
    },
  ];

  for (const plan of buildPlans) {
    if (existsSync(resolve(projectRoot, plan.output))) {
      return plan.output;
    }
    const canBuild = plan.sources.every((relativePath) => existsSync(resolve(projectRoot, relativePath)));
    if (!canBuild) {
      continue;
    }
    return mergeLocalizedCatalogs(plan.sources, plan.output);
  }

  return existing;
}

export function computePokeQuizzQueueStatus(publications, channelProfile, asOf = new Date().toISOString()) {
  const scheduledQueue = listCommittedScheduledPublications(publications, channelProfile, asOf);
  const reviewReadyCount = publications.filter((publication) => workflowState(publication) === 'preview_uploaded').length;
  return {
    reviewReadyCount,
    publishQueueCount: scheduledQueue.length,
    nextScheduledFor: scheduledQueue[0]?.scheduled_for || '',
  };
}

export function buildPokeQuizzQueueStatusPayload({
  channelProfile,
  queueStatus,
  reviewThreadId = '',
  reviewTargetCount = POKE_QUIZZ_REVIEW_TARGET_COUNT,
}) {
  const channelLabel = formatMarkdownLink(
    String(channelProfile?.name || '').trim(),
    buildYoutubeChannelUrl(channelProfile),
  );
  const queueCount = Number(queueStatus?.publishQueueCount || 0);
  const reviewReadyCount = Number(queueStatus?.reviewReadyCount || 0);
  const nextScheduledLabel = formatScheduledForLabel(
    queueStatus?.nextScheduledFor || '',
    channelProfile?.timezone || 'UTC',
  );
  const color = reviewReadyCount < reviewTargetCount
    ? POKE_QUIZZ_QUEUE_STATUS_COLORS.lowReview
    : queueCount > 0
      ? POKE_QUIZZ_QUEUE_STATUS_COLORS.healthy
      : POKE_QUIZZ_QUEUE_STATUS_COLORS.idle;

  return buildNoticeDiscordPayload({
    title: 'Poke Quizz Queue Status',
    description: [
      `${channelLabel || 'Poke Quizz'} has **${queueCount}** video(s) in publish queue.`,
      `Next video will be published **${nextScheduledLabel}**.`,
      `${buildReviewThreadMention(reviewThreadId)} currently has **${reviewReadyCount}/${reviewTargetCount}** review-ready preview(s).`,
    ].join('\n'),
    color,
    footerText: 'ORION video queue status',
  });
}

export async function syncPokeQuizzQueueStatusMessage({
  runtimeConfig,
  store,
  channelProfile,
  channelSelector = DEFAULT_CHANNEL_SELECTOR,
  asOf = new Date().toISOString(),
  reviewTargetCount = POKE_QUIZZ_REVIEW_TARGET_COUNT,
} = {}) {
  const channelId = String(runtimeConfig?.channelIds?.pokemon || '').trim();
  const reviewThreadId = String(runtimeConfig?.channelIds?.pokeQuizzReview || '').trim();
  if (!channelId || !store || !channelProfile) {
    return {
      posted: false,
      reason: !channelId ? 'no_channel_id' : !store ? 'no_store' : 'no_channel_profile',
      queueStatus: null,
    };
  }

  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
  const queueStatus = computePokeQuizzQueueStatus(publications, channelProfile, asOf);
  const payload = buildPokeQuizzQueueStatusPayload({
    channelProfile,
    queueStatus,
    reviewThreadId,
    reviewTargetCount,
  });

  const state = await readQueueStatusState();
  const channelState = state.channels?.[channelSelector] || {};
  let result = null;
  const knownMessageId = String(channelState.messageId || '').trim();

  if (knownMessageId) {
    result = await editDiscordChannelMessage(runtimeConfig, channelId, knownMessageId, payload);
  }

  if (!knownMessageId || result?.reason === 'discord_api_404') {
    result = await sendDiscordChannelMessage(runtimeConfig, channelId, payload);
  }

  if (result?.posted && result.messageId) {
    await writeQueueStatusState({
      ...state,
      channels: {
        ...(state.channels || {}),
        [channelSelector]: {
          channelId,
          messageId: result.messageId,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  }

  return {
    ...result,
    queueStatus,
  };
}

export {
  DEFAULT_CHANNEL_SELECTOR,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
};
