#!/usr/bin/env node

import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  assignScheduleSlots,
  selectPreviewUploadCandidates,
  selectScheduleCandidates,
} from '../src/publication-queue.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import {
  buildPokeQuizzPublicationReviewPayload,
  buildPokeQuizzPublicationReviewTask,
} from '../src/poke-quizz-publication-review.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';
import {
  loadYoutubeClientCredentials,
  scheduleYoutubePublication,
  uploadYoutubePreviewVideo,
} from '../src/youtube-publication-executor.mjs';
import { editDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';

function withLimit(items, limit) {
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
    return items;
  }
  return items.slice(0, normalizedLimit);
}

async function updatePublicationReviewMessage({
  runtimeConfig,
  publication,
  videoRow,
  channelProfile,
  channelSelector,
}) {
  const reviewThreadId = String(publication?.metadata?.review_thread_id || '').trim();
  const reviewMessageId = String(publication?.metadata?.review_message_id || '').trim();
  if (!reviewThreadId || !reviewMessageId || !videoRow) {
    return null;
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
    generationDurationMinutes: null,
    submittedAt: publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
  });
  const { payload } = buildPokeQuizzPublicationReviewPayload(reviewTask);
  payload.components = [];
  return editDiscordChannelMessage(runtimeConfig, reviewThreadId, reviewMessageId, payload);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/execute-youtube-publication.mjs [options]',
      '',
      'Options:',
      '  --channel <id>             Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>          Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --publication-id <id>      Limit execution to one publication id.',
      '  --limit <n>                Maximum publications to process in this run.',
      '  --schedule-approved        Apply schedule updates instead of preview uploads.',
      '  --dry-run                  Print the planned work without calling YouTube.',
      '  --as-of <ISO>              Deterministic schedule planning timestamp. Default: now.',
    ]);
    return;
  }

  const previewUploadMode = !getBooleanOption(options, 'schedule-approved', false);
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const channelSelector = getStringOption(options, 'channel', 'poke-quizz-youtube');
  const publicationId = getStringOption(options, 'publication-id', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());

  const runtimeConfig = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
  if (!refreshToken) {
    throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
  }

  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });
  const [clientConfig, publications] = await Promise.all([
    loadYoutubeClientCredentials(channelProfile.youtube.oauth_client_secret_path, projectRoot),
    store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    }),
  ]);

  const scopedPublications = publicationId
    ? publications.filter((publication) => publication.id === publicationId)
    : publications;
  const candidates = previewUploadMode
    ? selectPreviewUploadCandidates(scopedPublications, channelProfile)
    : assignScheduleSlots(selectScheduleCandidates(scopedPublications, channelProfile), channelProfile, asOf);
  const workItems = withLimit(candidates, getStringOption(options, 'limit', ''));

  if (workItems.length === 0) {
    printWarn(`No ${previewUploadMode ? 'preview upload' : 'schedule'} candidates were found for ${channelProfile.account_key}.`);
    process.stdout.write('[]\n');
    return;
  }

  const results = [];
  for (const item of workItems) {
    const publication = previewUploadMode
      ? item
      : scopedPublications.find((row) => row.id === item.id) || item;
    if (!publication) continue;
    const videoRow = publication.video_id
      ? await store.fetchVideoById(publication.video_id)
      : null;

    if (previewUploadMode) {
      if (!videoRow) {
        throw new Error(`Video row not found for publication ${publication.id}.`);
      }

      if (dryRun) {
        results.push({
          publication_id: publication.id,
          action: 'preview_upload',
          render_path: publication.metadata?.render_path || videoRow.render?.output_path || null,
          title: publication.title,
        });
        continue;
      }

      const uploaded = await uploadYoutubePreviewVideo({
        publication,
        videoRow,
        channelProfile,
        clientConfig,
        refreshToken,
      });
      const updatedPublication = await store.updatePublication(publication.id, {
        external_id: uploaded.externalId,
        preview_url: uploaded.previewUrl,
        visibility: channelProfile.workflow.preview_visibility,
        uploaded_at: uploaded.uploadedAt,
        metadata: {
          ...(publication.metadata || {}),
          workflow_state: 'preview_uploaded',
          render_path: uploaded.renderPath,
          youtube_preview_upload: {
            completed_at: uploaded.uploadedAt,
            response_id: uploaded.externalId,
          },
        },
      });
      results.push({
        publication_id: publication.id,
        action: 'preview_upload',
        external_id: uploaded.externalId,
        preview_url: uploaded.previewUrl,
        uploaded_at: uploaded.uploadedAt,
        workflow_state: updatedPublication?.metadata?.workflow_state || 'preview_uploaded',
      });
      printInfo(`Uploaded preview ${publication.id} to ${uploaded.previewUrl}`);
      continue;
    }

    if (dryRun) {
      results.push({
        publication_id: publication.id,
        action: 'schedule_update',
        scheduled_for: item.scheduled_for,
        external_id: publication.external_id,
      });
      continue;
    }

    const scheduled = await scheduleYoutubePublication({
      publication,
      scheduledFor: item.scheduled_for,
      clientConfig,
      refreshToken,
    });
    const updatedPublication = await store.updatePublication(publication.id, {
      status: 'scheduled',
      visibility: 'private',
      scheduled_for: scheduled.scheduledFor,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
      },
    });
    await updatePublicationReviewMessage({
      runtimeConfig,
      publication: updatedPublication || {
        ...publication,
        status: 'scheduled',
        scheduled_for: scheduled.scheduledFor,
        metadata: {
          ...(publication.metadata || {}),
          workflow_state: 'scheduled',
        },
      },
      videoRow,
      channelProfile,
      channelSelector,
    });
    results.push({
      publication_id: publication.id,
      action: 'schedule_update',
      external_id: publication.external_id,
      scheduled_for: scheduled.scheduledFor,
      workflow_state: updatedPublication?.metadata?.workflow_state || 'scheduled',
    });
    printInfo(`Scheduled publication ${publication.id} for ${scheduled.scheduledFor}`);
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
