#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { generatePokeQuizzPublicationMetadata } from '../src/local-publication-metadata.mjs';
import {
  createPokeQuizzPublicationRegistration,
  mergeRegisteredPublicationRow,
} from '../src/poke-quizz-publication-registration.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_TEMPLATE_PATH,
  buildPokeQuizzPublicationReviewPayload,
  buildPokeQuizzPublicationReviewTask,
} from '../src/poke-quizz-publication-review.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';
import {
  loadYoutubeClientCredentials,
  uploadYoutubePreviewVideo,
} from '../src/youtube-publication-executor.mjs';
import {
  loadPersistedPendingTasks,
  savePersistedPendingTasks,
} from '../../discord-bot/src/pending-task-store.mjs';
import { sendDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';

function parseHashtags(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
}

function mergePublicationMetadata(publication, patch = {}) {
  return {
    ...(publication?.metadata || {}),
    ...patch,
  };
}

async function registerPublication({
  plan,
  channelProfile,
  renderPath,
  metadata,
  registeredAt,
  store,
}) {
  const registration = await createPokeQuizzPublicationRegistration({
    plan,
    channelProfile,
    renderPath,
    metadata,
    registeredAt,
  });
  const existingPublication = await store.fetchPublicationById(registration.publicationRow.id);
  const mergedPublication = mergeRegisteredPublicationRow(existingPublication, registration.publicationRow);

  await store.upsertChannelProfile(channelProfile);
  const savedVideo = await store.upsertVideo(registration.videoRow);
  const savedPublication = await store.upsertPublication(mergedPublication);

  return {
    video: savedVideo || registration.videoRow,
    publication: savedPublication || mergedPublication,
  };
}

async function ensurePreviewUploaded({
  publication,
  video,
  channelProfile,
  runtimeConfig,
  store,
}) {
  if (publication.preview_url && publication.external_id) {
    return {
      publication,
      previewUrl: publication.preview_url,
      externalId: publication.external_id,
      uploadedAt: publication.uploaded_at || '',
    };
  }

  const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
  if (!refreshToken) {
    throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
  }

  const clientConfig = await loadYoutubeClientCredentials(
    channelProfile.youtube.oauth_client_secret_path,
    projectRoot,
  );
  const uploaded = await uploadYoutubePreviewVideo({
    publication,
    videoRow: video,
    channelProfile,
    clientConfig,
    refreshToken,
  });
  const updatedPublication = await store.updatePublication(publication.id, {
    external_id: uploaded.externalId,
    preview_url: uploaded.previewUrl,
    visibility: channelProfile.workflow.preview_visibility,
    uploaded_at: uploaded.uploadedAt,
    metadata: mergePublicationMetadata(publication, {
      workflow_state: 'preview_uploaded',
      render_path: uploaded.renderPath,
      youtube_preview_upload: {
        completed_at: uploaded.uploadedAt,
        response_id: uploaded.externalId,
      },
    }),
  });

  return {
    publication: updatedPublication || {
      ...publication,
      external_id: uploaded.externalId,
      preview_url: uploaded.previewUrl,
      uploaded_at: uploaded.uploadedAt,
      metadata: mergePublicationMetadata(publication, {
        workflow_state: 'preview_uploaded',
        render_path: uploaded.renderPath,
      }),
    },
    previewUrl: uploaded.previewUrl,
    externalId: uploaded.externalId,
    uploadedAt: uploaded.uploadedAt,
  };
}

function replaceExistingReviewTasks(runtimeConfig, nextTask) {
  const existingTasks = loadPersistedPendingTasks(runtimeConfig);
  const filtered = existingTasks.filter((task) => {
    if (task?.automation_type !== 'poke_quizz_publication_review') {
      return true;
    }

    const publicationId = task?.poke_quizz_publication_review?.publicationId || '';
    return publicationId !== nextTask.poke_quizz_publication_review.publicationId;
  });
  filtered.push(nextTask);
  savePersistedPendingTasks(runtimeConfig, filtered);
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/review-poke-quizz-publication.mjs [options]',
      '',
      'Options:',
      '  --plan <path>              Required Poke Quizz plan JSON path.',
      '  --thread-id <id>           Required Discord thread id for the review post.',
      '  --render <path>            Optional rendered MP4 path. Default: derived from the plan output convention.',
      '  --publication-id <id>      Reuse an existing publication row instead of registering a new one.',
      '  --catalog-json <path>      Catalog JSON used for feedback-driven revisions.',
      '  --channel <id>             Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>          Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --config <path>            Product-video config JSON. Default: services/product-video-agent/config.example.json',
      '  --template <path>          Template JSON. Default: services/product-video-agent/pokemon-type-challenge-v1.template.json',
      '  --title <text>             Override generated title.',
      '  --description <text>       Override generated description.',
      '  --hashtags <a,b,c>         Override generated hashtags.',
      '  --no-local-model           Skip local Ollama metadata generation and use the deterministic fallback.',
      '  --as-of <ISO>              Registration timestamp. Default: now.',
    ]);
    return;
  }

  const planPath = getStringOption(options, 'plan', '');
  const reviewThreadId = getStringOption(options, 'thread-id', '');
  if (!planPath) {
    throw new Error('The --plan option is required.');
  }
  if (!reviewThreadId) {
    throw new Error('The --thread-id option is required.');
  }

  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const configPath = getStringOption(options, 'config', DEFAULT_CONFIG_PATH);
  const templatePath = getStringOption(options, 'template', DEFAULT_TEMPLATE_PATH);
  const channelSelector = getStringOption(options, 'channel', DEFAULT_CHANNEL_SELECTOR);
  const publicationId = getStringOption(options, 'publication-id', '');
  const catalogJsonPath = getStringOption(options, 'catalog-json', '');
  const submittedAt = getStringOption(options, 'as-of', new Date().toISOString());
  const [plan, profiles, config] = await Promise.all([
    loadJson(planPath),
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    loadPipelineConfig(configPath, projectRoot),
  ]);

  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const runtimeConfig = loadRuntimeConfig();
  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });

  let publication = null;
  let video = null;

  if (publicationId) {
    publication = await store.fetchPublicationById(publicationId);
    if (!publication) {
      throw new Error(`Publication ${publicationId} was not found.`);
    }
    video = await store.fetchVideoById(publication.video_id);
    if (!video) {
      throw new Error(`Video row ${publication.video_id} was not found for publication ${publicationId}.`);
    }
  } else {
    let metadata = getBooleanOption(options, 'local-model', true)
      ? await generatePokeQuizzPublicationMetadata({
        plan,
        config,
        channelProfile,
      })
      : null;

    if (getStringOption(options, 'title', '')) {
      metadata = {
        ...(metadata || {}),
        title: getStringOption(options, 'title', ''),
      };
    }
    if (getStringOption(options, 'description', '')) {
      metadata = {
        ...(metadata || {}),
        description: getStringOption(options, 'description', ''),
      };
    }
    if (getStringOption(options, 'hashtags', '')) {
      metadata = {
        ...(metadata || {}),
        hashtags: parseHashtags(getStringOption(options, 'hashtags', '')),
      };
    }

    if (!metadata?.title || !metadata?.description || !Array.isArray(metadata?.hashtags) || metadata.hashtags.length === 0) {
      throw new Error('Publication metadata could not be resolved. Provide explicit title/description/hashtags or enable the local model fallback.');
    }

    if (metadata.generation_error) {
      printWarn(`Local metadata generation fell back to the deterministic template: ${metadata.generation_error}`);
    }

    const registered = await registerPublication({
      plan,
      channelProfile,
      renderPath: getStringOption(options, 'render', ''),
      metadata,
      registeredAt: submittedAt,
      store,
    });
    publication = registered.publication;
    video = registered.video;
  }

  const ensuredPreview = await ensurePreviewUploaded({
    publication,
    video,
    channelProfile,
    runtimeConfig,
    store,
  });
  publication = ensuredPreview.publication;

  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video,
    reviewThreadId,
    planPath,
    renderPath: getStringOption(options, 'render', '') || publication.metadata?.render_path || video.render?.output_path || '',
    catalogJsonPath,
    templatePath,
    configPath,
    channelSelector,
    submittedAt,
  });
  replaceExistingReviewTasks(runtimeConfig, reviewTask);

  const { payload } = buildPokeQuizzPublicationReviewPayload(reviewTask);
  const posted = await sendDiscordChannelMessage(runtimeConfig, reviewThreadId, payload);
  if (!posted.posted) {
    throw new Error(`Could not post the Poke Quizz review card: ${posted.reason}${posted.error ? ` (${posted.error})` : ''}`);
  }

  const updatedPublication = await store.updatePublication(publication.id, {
    metadata: mergePublicationMetadata(publication, {
      review_task_id: reviewTask.task_id,
      review_thread_id: reviewThreadId,
      review_message_id: posted.messageId || '',
      review_requested_at: submittedAt,
    }),
  });

  printInfo(`Posted Poke Quizz review ${reviewTask.task_id} to Discord thread ${reviewThreadId}.`);
  process.stdout.write(`${JSON.stringify({
    publication_id: updatedPublication?.id || publication.id,
    video_id: updatedPublication?.video_id || publication.video_id,
    task_id: reviewTask.task_id,
    message_id: posted.messageId || '',
    thread_id: reviewThreadId,
    preview_url: publication.preview_url || ensuredPreview.previewUrl,
    render_path: publication.metadata?.render_path || video.render?.output_path || '',
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
