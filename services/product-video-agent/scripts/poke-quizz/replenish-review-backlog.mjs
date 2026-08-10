#!/usr/bin/env node

import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../../src/publication-channels.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
  syncPokeQuizzQueueStatusMessage,
} from '../../src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  resolveVideoTemplateRuntime,
} from '../../src/video-template-context.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

const DEFAULT_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function parseNonNegativeInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function buildReplenishSeed(submittedAt, iteration) {
  const timestamp = String(submittedAt || new Date().toISOString()).replace(/[^0-9]/gu, '').slice(0, 14);
  return `poke-quizz-replenish-${timestamp}-${String(iteration).padStart(2, '0')}`;
}

function parseLastJsonObject(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    const candidate = text.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning backward until the trailing JSON object is found.
    }
  }

  return null;
}

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

function sleep(ms) {
  const delayMs = Number(ms);
  if (!Number.isFinite(delayMs) || delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, delayMs);
  });
}

async function fetchQueueStatus(store, channelProfile, asOf = new Date().toISOString()) {
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
  return computePokeQuizzQueueStatus(publications, channelProfile, asOf);
}

async function waitForReviewCountAdvance({
  store,
  channelProfile,
  previousReviewReadyCount,
  delayMs,
  attempts = 5,
}) {
  let latestQueueStatus = await fetchQueueStatus(store, channelProfile);
  if (latestQueueStatus.reviewReadyCount > previousReviewReadyCount) {
    return latestQueueStatus;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);
    latestQueueStatus = await fetchQueueStatus(store, channelProfile);
    if (latestQueueStatus.reviewReadyCount > previousReviewReadyCount) {
      return latestQueueStatus;
    }
  }

  return latestQueueStatus;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/replenish-poke-quizz-review-backlog.mjs [options]',
      '',
      'Options:',
      `  --target <n>              Review-ready target count. Default: ${POKE_QUIZZ_REVIEW_TARGET_COUNT}`,
      '  --max-generate <n>        Hard cap on new previews this run. Default: target gap',
      '  --delay-ms <n>            Delay between generations / status rechecks. Default: 5000',
      `  --channel-config <path>   Channel/program/style config. Default: ${DEFAULT_VIDEO_CHANNEL_CONFIG_PATH}`,
      `  --channel <id>            Channel id or account_key. Default: ${DEFAULT_CHANNEL_SELECTOR}`,
      `  --channels <path>         Channel registry JSON. Default: ${DEFAULT_CHANNELS_PATH}`,
      '  --thread-id <id>          Override the Discord review thread id.',
      '  --catalog-json <path>     Override the localized Poke Quizz catalog JSON path.',
      '  --dry-run                 Print what would be generated without rendering.',
      '  --as-of <ISO>             Base timestamp used for the final queue-status sync. Default: now.',
    ]);
    return;
  }

  const channelConfigPath = getStringOption(options, 'channel-config', DEFAULT_VIDEO_CHANNEL_CONFIG_PATH);
  const templateRuntime = await resolveVideoTemplateRuntime({
    projectRoot,
    channelConfigPath,
    channelSelector: getStringOption(options, 'channel', ''),
  });
  const channelSelector = templateRuntime.channelSelector;
  const runtimeConfig = loadRuntimeConfig();
  const channelsPath = getStringOption(options, 'channels', DEFAULT_CHANNELS_PATH);
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const reviewThreadId = getStringOption(
    options,
    'thread-id',
    resolvePublicationReviewThreadId(runtimeConfig, channelProfile),
  );
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const targetReviewReadyCount = parsePositiveInteger(
    getStringOption(options, 'target', ''),
    POKE_QUIZZ_REVIEW_TARGET_COUNT,
  );
  const delayMs = parseNonNegativeInteger(getStringOption(options, 'delay-ms', ''), 5000);
  const dryRun = getBooleanOption(options, 'dry-run', false);

  if (!reviewThreadId) {
    throw new Error(`No review thread id is configured for ${channelProfile.account_key}. Provide --thread-id or set metadata.review_thread_id.`);
  }

  const catalogJsonPath = getStringOption(options, 'catalog-json', '')
    || await ensurePreferredPokeQuizzCatalogJsonPath();
  if (!catalogJsonPath) {
    throw new Error('No localized Poke Quizz catalog JSON could be found.');
  }

  const store = createPublicationStore(runtimeConfig);
  const generationScriptPath = resolve(
    projectRoot,
    'services/product-video-agent/scripts/poke-quizz/generate-review.mjs',
  );

  const initialQueueStatus = await fetchQueueStatus(store, channelProfile, new Date().toISOString());
  const gapToTarget = Math.max(0, targetReviewReadyCount - initialQueueStatus.reviewReadyCount);
  const maxGenerate = parsePositiveInteger(getStringOption(options, 'max-generate', ''), gapToTarget || 1);
  const generatedItems = [];
  const errors = [];

  if (dryRun || gapToTarget === 0) {
    const result = {
      status: gapToTarget === 0 ? 'already_satisfied' : 'dry_run',
      initialReviewReadyCount: initialQueueStatus.reviewReadyCount,
      finalReviewReadyCount: initialQueueStatus.reviewReadyCount,
      targetReviewReadyCount,
      plannedGenerations: Math.min(gapToTarget, maxGenerate),
      generated: 0,
      generatedItems,
      errors,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  let reviewReadyCount = initialQueueStatus.reviewReadyCount;
  let consecutiveFailures = 0;
  while (
    reviewReadyCount < targetReviewReadyCount
    && generatedItems.length < maxGenerate
    && consecutiveFailures < 3
  ) {
    const submittedAt = new Date().toISOString();
    const seed = buildReplenishSeed(submittedAt, generatedItems.length + 1);
    printInfo(
      `Generating preview ${generatedItems.length + 1}/${Math.min(gapToTarget, maxGenerate)} with seed ${seed}.`,
    );
    const child = spawnSync(process.execPath, [
      generationScriptPath,
      '--thread-id',
      reviewThreadId,
      '--catalog-json',
      catalogJsonPath,
      '--channel-config',
      channelConfigPath,
      '--channel',
      channelSelector,
      '--as-of',
      submittedAt,
      '--seed',
      seed,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 40 * 60 * 1000,
    });

    const payload = parseLastJsonObject(child.stdout);
    if (child.error || child.status !== 0 || !payload?.publication_id) {
      consecutiveFailures += 1;
      errors.push({
        seed,
        error: child.error?.message || String(child.stderr || '').trim() || 'Poke Quizz replenish generation failed.',
      });
      continue;
    }

    consecutiveFailures = 0;
    generatedItems.push({
      seed,
      publicationId: payload.publication_id,
      previewUrl: payload.preview_url || '',
      messageId: payload.message_id || '',
      taskId: payload.task_id || '',
    });

    const queueStatusAfterGeneration = await waitForReviewCountAdvance({
      store,
      channelProfile,
      previousReviewReadyCount: reviewReadyCount,
      delayMs,
    });
    reviewReadyCount = queueStatusAfterGeneration.reviewReadyCount;
  }

  const finalQueueStatus = await fetchQueueStatus(store, channelProfile, new Date().toISOString());
  await syncPokeQuizzQueueStatusMessage({
    runtimeConfig,
    store,
    channelProfile,
    channelSelector,
    asOf,
    presentation: templateRuntime.queueStatusPresentation,
  });

  const result = {
    status: errors.length > 0 && generatedItems.length === 0
      ? 'failed'
      : finalQueueStatus.reviewReadyCount >= targetReviewReadyCount
        ? 'completed'
        : 'partial',
    initialReviewReadyCount: initialQueueStatus.reviewReadyCount,
    finalReviewReadyCount: finalQueueStatus.reviewReadyCount,
    targetReviewReadyCount,
    plannedGenerations: Math.min(gapToTarget, maxGenerate),
    generated: generatedItems.length,
    generatedItems,
    errors,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
