#!/usr/bin/env node

import process from 'node:process';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  buildPokeQuizzPublicationReviewPayload,
  buildPokeQuizzPublicationReviewTask,
} from '../src/poke-quizz-publication-review.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';
import {
  loadPersistedPendingTasks,
  savePersistedPendingTasks,
} from '../../discord-bot/src/pending-task-store.mjs';
import { editDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';

function isActionableReview(publication) {
  const workflowState = String(publication?.metadata?.workflow_state || '').trim().toLowerCase();
  return workflowState === 'preview_uploaded' || workflowState === 'delete_failed';
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
    const { payload } = buildPokeQuizzPublicationReviewPayload(reviewTask);
    if (!isActionableReview(publication)) {
      payload.components = [];
    } else {
      refreshedTasks.push(reviewTask);
    }

    const result = await editDiscordChannelMessage(runtimeConfig, reviewThreadId, reviewMessageId, payload);
    printInfo(`Refreshed ${publication.id} -> ${reviewMessageId} (${result.posted ? 'ok' : result.reason || 'skipped'}).`);
  }

  const existingTasks = loadPersistedPendingTasks(runtimeConfig)
    .filter((task) => task?.automation_type !== 'poke_quizz_publication_review');
  savePersistedPendingTasks(runtimeConfig, [
    ...existingTasks,
    ...refreshedTasks,
  ]);
  printInfo(`Persisted ${refreshedTasks.length} pending Poke Quizz review task(s).`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
