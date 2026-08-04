#!/usr/bin/env node

import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  buildPokeQuizzPublicationMessagePayload,
  buildPokeQuizzPublicationReviewTask,
} from '../../src/poke-quizz-publication-review.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  loadPersistedPendingTasks,
  savePersistedPendingTasks,
} from '../../../discord-bot/src/pending-task-store.mjs';
import { editDiscordChannelMessage } from '../../../../scripts/lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printWarn,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

function isActionableReview(publication) {
  const workflowState = String(publication?.metadata?.workflow_state || '').trim().toLowerCase();
  return workflowState === 'preview_uploaded' || workflowState === 'delete_failed';
}

function sleep(ms) {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseIntegerOption(options, key, fallbackValue) {
  const raw = getStringOption(options, key, String(fallbackValue));
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function parseDiscordRetryAfterMs(result) {
  if (result?.reason !== 'discord_api_429') {
    return 0;
  }
  try {
    const parsed = JSON.parse(String(result.error || '{}'));
    const retryAfter = Number(parsed.retry_after);
    if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
      return 0;
    }
    return Math.ceil(retryAfter * 1000);
  } catch {
    return 0;
  }
}

async function editReviewMessageWithRetry({
  runtimeConfig,
  reviewThreadId,
  reviewMessageId,
  payload,
  delayMs,
  maxRetries,
}) {
  let retries = 0;
  while (true) {
    const result = await editDiscordChannelMessage(
      runtimeConfig,
      reviewThreadId,
      reviewMessageId,
      payload,
    );
    if (result.posted || result.reason !== 'discord_api_429' || retries >= maxRetries) {
      return {
        ...result,
        retries,
      };
    }

    retries += 1;
    await sleep(Math.max(delayMs, parseDiscordRetryAfterMs(result)));
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/refresh-poke-quizz-review-messages.mjs [options]',
      '',
      'Options:',
      '  --channel <id>       Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>    Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --pending-only       Refresh only preview_uploaded cards that still await approval.',
      '  --delay-ms <n>       Wait this many milliseconds between Discord edits. Default: 1200.',
      '  --max-retries <n>    Retry Discord 429 responses this many times. Default: 3.',
    ]);
    return;
  }

  const channelSelector = getStringOption(options, 'channel', DEFAULT_CHANNEL_SELECTOR);
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const pendingOnly = getBooleanOption(options, 'pending-only', false);
  const delayMs = Math.max(0, parseIntegerOption(options, 'delay-ms', 1200));
  const maxRetries = Math.max(0, parseIntegerOption(options, 'max-retries', 3));
  const runtimeConfig = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });

  const refreshedTasks = [];
  const failures = [];
  let refreshedCount = 0;
  let retriedEdits = 0;
  let inspectedCount = 0;
  for (const publication of publications) {
    const reviewThreadId = String(publication?.metadata?.review_thread_id || '').trim();
    const reviewMessageId = String(publication?.metadata?.review_message_id || '').trim();
    if (!reviewThreadId || !reviewMessageId) {
      continue;
    }
    if (pendingOnly && !isActionableReview(publication)) {
      continue;
    }

    const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;
    if (!videoRow) {
      continue;
    }

    inspectedCount += 1;

    const reviewTask = buildPokeQuizzPublicationReviewTask({
      publication,
      video: videoRow,
      channelProfile,
      reviewThreadId,
      planPath: '',
      renderPath: publication?.metadata?.render_path || videoRow?.render?.output_path || '',
      catalogJsonPath: '',
      channelSelector,
      submittedAt: publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
    });
    const payload = buildPokeQuizzPublicationMessagePayload(reviewTask);
    if (!isActionableReview(publication)) {
      payload.components = [];
    } else {
      refreshedTasks.push(reviewTask);
    }

    const result = await editReviewMessageWithRetry({
      runtimeConfig,
      reviewThreadId,
      reviewMessageId,
      payload,
      delayMs,
      maxRetries,
    });
    retriedEdits += result.retries || 0;
    if (result.posted) {
      refreshedCount += 1;
      printInfo(`Refreshed ${publication.id} -> ${reviewMessageId} (ok${result.retries ? ` after ${result.retries} retry/retries` : ''}).`);
    } else {
      failures.push({
        publicationId: publication.id,
        messageId: reviewMessageId,
        reason: result.reason || 'skipped',
      });
      printWarn(`Refresh failed for ${publication.id} -> ${reviewMessageId} (${result.reason || 'skipped'}).`);
    }

    await sleep(delayMs);
  }

  const existingTasks = loadPersistedPendingTasks(runtimeConfig)
    .filter((task) => task?.automation_type !== 'poke_quizz_publication_review');
  savePersistedPendingTasks(runtimeConfig, [
    ...existingTasks,
    ...refreshedTasks,
  ]);
  printInfo(`Persisted ${refreshedTasks.length} pending Poke Quizz review task(s).`);
  process.stdout.write(`${JSON.stringify({
    channel: channelSelector,
    inspected: inspectedCount,
    refreshed: refreshedCount,
    actionable: refreshedTasks.length,
    retried: retriedEdits,
    failed: failures.length,
    failures,
  }, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
