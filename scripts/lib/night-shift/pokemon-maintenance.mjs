import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../../../services/product-video-agent/src/publication-channels.mjs';
import { reconcilePokeQuizzPreviewFallbackStorage } from '../../../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
  syncPokeQuizzQueueStatusMessage,
} from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';
import {
  collectChildError,
  parseLastJsonObject,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

export const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
export const REVIEW_READY_TARGET_COUNT = POKE_QUIZZ_REVIEW_TARGET_COUNT;

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

function summarizeVideoQueueMaintenance(profiles, runs) {
  const summary = {
    attemptedChannels: profiles.length,
    processedChannels: 0,
    failedChannels: 0,
    scheduled: 0,
    published: 0,
    returnedToApproval: 0,
    deleted: 0,
    changedSchedule: 0,
    statusLookupFailures: 0,
    errors: [],
    channels: runs,
  };

  for (const run of runs) {
    if (run.status === 'failed') {
      summary.failedChannels += 1;
      summary.errors.push(`${run.accountKey}: ${run.error || 'unknown queue maintenance error'}`);
      continue;
    }

    summary.processedChannels += 1;
    for (const result of run.results) {
      const action = String(result?.action || '');
      const workflowState = String(result?.workflow_state || '');
      const reason = String(result?.reason || '');
      if (action === 'schedule_update' || workflowState === 'scheduled') {
        summary.scheduled += 1;
      }
      if (workflowState === 'published') {
        summary.published += 1;
      }
      if (workflowState === 'deleted') {
        summary.deleted += 1;
      }
      if (workflowState === 'preview_approved') {
        summary.returnedToApproval += 1;
      }
      if (reason === 'youtube_publish_time_changed') {
        summary.changedSchedule += 1;
      }
      if (reason === 'status_lookup_failed') {
        summary.statusLookupFailures += 1;
      }
    }
  }

  return summary;
}

export async function reconcilePreviewFallbackStorage() {
  return reconcilePokeQuizzPreviewFallbackStorage();
}

export async function runVideoQueueMaintenance(asOf = new Date().toISOString()) {
  const profiles = await loadPublicationChannelProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const results = [];

  for (const profile of activeProfiles) {
    const child = runProjectNodeScript(
      'services/product-video-agent/scripts/execute-youtube-publication.mjs',
      [
        '--channel',
        profile.account_key,
        '--channels',
        DEFAULT_PUBLICATION_CHANNELS_PATH,
        '--schedule-approved',
        '--as-of',
        asOf,
      ],
      {
        timeoutMs: 20 * 60 * 1000,
      },
    );
    results.push({
      channelId: profile.id,
      accountKey: profile.account_key,
      channelName: profile.name,
      status: collectChildError(child) ? 'failed' : 'completed',
      exitCode: child.status ?? 0,
      error: collectChildError(child),
      results: parseTrailingJsonArray(child.stdout),
    });
  }

  return summarizeVideoQueueMaintenance(activeProfiles, results);
}

export async function replenishPokeQuizzReviewBacklog(config, asOf = new Date().toISOString()) {
  const reviewThreadId = String(config.channelIds.pokeQuizzReview || '').trim();
  if (!reviewThreadId) {
    return {
      status: 'skipped',
      generated: 0,
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
      errors: ['Missing pokeQuizzReview channel/thread id.'],
    };
  }

  const catalogJsonPath = await ensurePreferredPokeQuizzCatalogJsonPath();
  if (!catalogJsonPath) {
    return {
      status: 'failed',
      generated: 0,
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
      errors: ['No localized Poke Quizz catalog JSON could be found.'],
    };
  }

  const profiles = await loadPublicationChannelProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, 'poke-quizz-youtube');
  const store = createPublicationStore(config);

  const fetchQueueStatus = async () => {
    const publications = await store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    });
    return computePokeQuizzQueueStatus(publications, channelProfile, asOf);
  };

  const initialQueueStatus = await fetchQueueStatus();
  const generated = [];
  const errors = [];
  let reviewReadyCount = initialQueueStatus.reviewReadyCount;
  let consecutiveFailures = 0;

  while (reviewReadyCount < POKE_QUIZZ_REVIEW_TARGET_COUNT && consecutiveFailures < 3) {
    const child = runProjectNodeScript(
      'services/product-video-agent/scripts/generate-poke-quizz-review.mjs',
      [
        '--thread-id',
        reviewThreadId,
        '--catalog-json',
        catalogJsonPath,
        '--channel',
        'poke-quizz-youtube',
        '--as-of',
        new Date().toISOString(),
      ],
      {
        timeoutMs: 40 * 60 * 1000,
      },
    );
    const payload = parseLastJsonObject(child.stdout);
    if (child.error || child.status !== 0 || !payload?.publication_id) {
      consecutiveFailures += 1;
      errors.push(
        child.error?.message
          || String(child.stderr || '').trim()
          || 'Poke Quizz review replenishment generation failed.',
      );
      continue;
    }

    consecutiveFailures = 0;
    generated.push({
      publicationId: payload.publication_id,
      previewUrl: payload.preview_url || '',
      messageId: payload.message_id || '',
    });
    reviewReadyCount = (await fetchQueueStatus()).reviewReadyCount;
  }

  const finalQueueStatus = await fetchQueueStatus();
  await syncPokeQuizzQueueStatusMessage({
    runtimeConfig: config,
    store,
    channelProfile,
    channelSelector: 'poke-quizz-youtube',
    asOf,
  });

  return {
    status: errors.length > 0 && generated.length === 0 ? 'failed' : generated.length > 0 ? 'completed' : 'skipped',
    generated: generated.length,
    generatedItems: generated,
    initialReviewReadyCount: initialQueueStatus.reviewReadyCount,
    finalReviewReadyCount: finalQueueStatus.reviewReadyCount,
    targetReviewReadyCount: POKE_QUIZZ_REVIEW_TARGET_COUNT,
    errors,
  };
}

export async function refreshPokeQuizzReviewMessages() {
  const child = runProjectNodeScript(
    'services/product-video-agent/scripts/refresh-poke-quizz-review-messages.mjs',
    [
      '--channel',
      'poke-quizz-youtube',
      '--delay-ms',
      '1200',
      '--max-retries',
      '3',
    ],
    {
      timeoutMs: 20 * 60 * 1000,
    },
  );
  const summary = parseLastJsonObject(child.stdout) || {};
  return {
    status: collectChildError(child) ? 'failed' : 'completed',
    exitCode: child.status ?? 0,
    error: collectChildError(child),
    ...summary,
  };
}
