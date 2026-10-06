// Night-shift review-thread reconciliation phase
//
// Walks every poke channel with a configured review thread and
// confirms each `preview_uploaded` publication's `review_message_id`
// still resolves on Discord. A 404 means the reviewer deleted the
// message outside the workflow — the row stays stuck in the queue
// forever and the YouTube unlisted preview keeps running. Delete the
// preview + render and flip the row to withdrawn before that gap
// grows.
//
// Lives in its own module so pokemon-maintenance.mjs stays under the
// 700-line script-size guardrail. All side effects are injectable so
// the function is trivial to unit-test; production wires up the real
// Supabase store, Discord bot, and YouTube Data API via night-shift's
// existing runtime config.

import { rm } from 'node:fs/promises';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles as loadPublicationChannelProfilesImpl,
  resolvePublicationReviewThreadId,
} from '../../../services/product-video-agent/src/publication-channels.mjs';
import { isManagedPokeQuizzPreviewPath } from '../../../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import {
  deleteYoutubeVideo as deleteYoutubeVideoImpl,
  loadYoutubeClientCredentials as loadYoutubeClientCredentialsImpl,
} from '../../../services/product-video-agent/src/youtube-publication-executor.mjs';
import {
  fetchReviewMessagePresence,
  reconcileReviewMessages,
  withdrawOrphanedPublication,
} from '../../../services/product-video-agent/src/review-thread-reconciliation.mjs';
import { loadRuntimeConfig, projectRoot } from '../../../services/lib/runtime-config.mjs';

const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

async function defaultDeleteRenderFile(filePath) {
  if (!isManagedPokeQuizzPreviewPath(filePath)) {
    return { deleted: false, error: '', skipped: true };
  }
  try {
    await rm(filePath);
    return { deleted: true, error: '', skipped: false, deletedAt: new Date().toISOString() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: false, error: '', skipped: true };
    return { deleted: false, error: error.message || String(error), skipped: false };
  }
}

export async function reconcilePokeQuizzReviewThreads(
  config = null,
  asOf = new Date().toISOString(),
  dependencies = {},
) {
  const runtimeConfig = config || loadRuntimeConfig();
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfilesImpl;
  const profiles = await loadProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const channelKeys = Array.isArray(dependencies.channelKeys) && dependencies.channelKeys.length > 0
    ? dependencies.channelKeys
    : null;
  const eligibleProfiles = (channelKeys
    ? channelKeys.map((key) => findPublicationChannelProfile(profiles, key)).filter(Boolean)
    : profiles
  ).filter((profile) => Boolean(resolvePublicationReviewThreadId(runtimeConfig, profile)));

  const summary = {
    status: 'skipped',
    attemptedChannels: 0,
    processedChannels: 0,
    failedChannels: 0,
    candidates: 0,
    present: 0,
    missing: 0,
    errors: 0,
    withdrawnPublicationIds: [],
    unresolvedPublicationIds: [],
    channels: [],
    channelErrors: [],
    asOf,
  };
  if (eligibleProfiles.length === 0) {
    return summary;
  }
  summary.status = 'completed';
  summary.attemptedChannels = eligibleProfiles.length;

  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const checkMessagePresence = dependencies.checkMessagePresence || (({ threadId, messageId }) => fetchReviewMessagePresence({
    threadId,
    messageId,
    botToken: runtimeConfig?.env?.DISCORD_BOT_TOKEN,
  }));
  const deleteYoutube = dependencies.deleteYoutubeVideo || deleteYoutubeVideoImpl;
  const loadYoutubeClient = dependencies.loadYoutubeClientCredentials || loadYoutubeClientCredentialsImpl;
  const deleteRenderFile = dependencies.deleteRenderFile || defaultDeleteRenderFile;

  for (const channelProfile of eligibleProfiles) {
    const channelKey = channelProfile.account_key;
    const reviewThreadId = resolvePublicationReviewThreadId(runtimeConfig, channelProfile);
    try {
      const refreshToken = runtimeConfig?.env?.[channelProfile.youtube?.oauth_refresh_token_env] || '';
      const youtubeConfigured = Boolean(refreshToken) && Boolean(channelProfile.youtube?.oauth_client_secret_path);
      let youtubeClientConfig = null;
      async function ensureYoutubeClientConfig() {
        if (!youtubeConfigured) throw new Error('YouTube OAuth not configured for this channel');
        if (!youtubeClientConfig) {
          youtubeClientConfig = await loadYoutubeClient(channelProfile.youtube.oauth_client_secret_path, projectRoot);
        }
        return youtubeClientConfig;
      }

      const publications = await store.fetchPublicationsByChannel({
        platform: channelProfile.platform,
        accountKey: channelProfile.account_key,
      });
      const result = await reconcileReviewMessages({
        publications,
        reviewThreadId,
        checkMessagePresence,
        withdrawPublication: ({ publication }) => withdrawOrphanedPublication({
          publication,
          reviewThreadId,
          store,
          deleteYoutubeVideo: async ({ externalId }) => {
            const clientConfig = await ensureYoutubeClientConfig();
            return deleteYoutube({ externalId, clientConfig, refreshToken });
          },
          deleteRenderFile,
        }),
      });

      summary.processedChannels += 1;
      summary.candidates += result.candidates;
      summary.present += result.present;
      summary.missing += result.missing;
      summary.errors += result.errors;
      summary.withdrawnPublicationIds.push(...result.withdrawn.map((entry) => entry.publicationId).filter(Boolean));
      summary.unresolvedPublicationIds.push(...result.unresolved.map((entry) => entry.publicationId).filter(Boolean));
      summary.channels.push({
        channelKey,
        reviewThreadId,
        candidates: result.candidates,
        present: result.present,
        missing: result.missing,
        errors: result.errors,
        withdrawn: result.withdrawn,
      });
    } catch (error) {
      summary.failedChannels += 1;
      summary.channelErrors.push({ channelKey, error: error.message || String(error) });
      summary.channels.push({ channelKey, reviewThreadId, error: error.message || String(error) });
    }
  }
  if (summary.failedChannels > 0 && summary.processedChannels === 0) {
    summary.status = 'failed';
  }
  return summary;
}
