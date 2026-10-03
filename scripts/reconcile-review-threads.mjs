#!/usr/bin/env node
// scripts/reconcile-review-threads.mjs
//
// Walks each poke-quizz channel's `preview_uploaded` publications and
// confirms each one's `metadata.review_message_id` still resolves on
// Discord. If a message 404s, the DB row is stuck — the reviewer went
// around the workflow (or the message was pruned). Delete the YouTube
// preview + local render and flip the row to `withdrawn` so the queue
// status card stops counting a ghost.
//
// Usage:
//   node scripts/reconcile-review-threads.mjs                 # all configured channels, live
//   node scripts/reconcile-review-threads.mjs --dry-run       # report-only, no side effects
//   node scripts/reconcile-review-threads.mjs --channel KEY   # one channel
//   node scripts/reconcile-review-threads.mjs --publication-id ID [--publication-id ID]
//                                                             # restrict to specific publication ids

import { rm } from 'node:fs/promises';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../services/product-video-agent/src/publication-channels.mjs';
import { SupabasePublicationStore } from '../services/product-video-agent/src/publication-store.mjs';
import { deleteYoutubeVideo, loadYoutubeClientCredentials } from '../services/product-video-agent/src/youtube-publication-executor.mjs';
import { isManagedPokeQuizzPreviewPath } from '../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import {
  fetchReviewMessagePresence,
  reconcileReviewMessages,
  withdrawOrphanedPublication,
} from '../services/product-video-agent/src/review-thread-reconciliation.mjs';

const DEFAULT_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

function parseArgs(argv) {
  const args = { dryRun: false, channelKeys: [], publicationIds: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--channel') { args.channelKeys.push(argv[i + 1] || ''); i += 1; }
    else if (arg === '--publication-id') { args.publicationIds.push(argv[i + 1] || ''); i += 1; }
    else if (arg === '--help') args.help = true;
  }
  return args;
}

async function deleteManagedPreviewFile(path) {
  if (!isManagedPokeQuizzPreviewPath(path)) {
    return { deleted: false, error: '', skipped: true };
  }
  try {
    await rm(path);
    return { deleted: true, error: '', skipped: false, deletedAt: new Date().toISOString() };
  } catch (error) {
    if (error?.code === 'ENOENT') return { deleted: false, error: '', skipped: true };
    return { deleted: false, error: error.message || String(error), skipped: false };
  }
}

async function reconcileOneChannel({ channelProfile, config, store, publicationIds, dryRun, logger }) {
  const reviewThreadId = resolvePublicationReviewThreadId(config, channelProfile);
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
  const scoped = publicationIds.length > 0
    ? publications.filter((p) => publicationIds.includes(p.id))
    : publications;

  const refreshToken = config?.env?.[channelProfile.youtube?.oauth_refresh_token_env] || '';
  const canDeleteYoutube = Boolean(refreshToken) && Boolean(channelProfile.youtube?.oauth_client_secret_path);
  let clientConfigPromise = null;
  async function youtubeClientConfig() {
    if (!clientConfigPromise) {
      clientConfigPromise = loadYoutubeClientCredentials(channelProfile.youtube.oauth_client_secret_path, projectRoot);
    }
    return clientConfigPromise;
  }

  async function deleteYoutubePreview({ externalId }) {
    if (dryRun) return { deletedAt: new Date().toISOString(), dryRun: true };
    if (!canDeleteYoutube) throw new Error('YouTube OAuth not configured for this channel');
    const clientConfig = await youtubeClientConfig();
    return deleteYoutubeVideo({ externalId, clientConfig, refreshToken });
  }

  const summary = await reconcileReviewMessages({
    publications: scoped,
    reviewThreadId,
    checkMessagePresence: ({ threadId, messageId }) => fetchReviewMessagePresence({
      threadId,
      messageId,
      botToken: config?.env?.DISCORD_BOT_TOKEN,
    }),
    withdrawPublication: async ({ publication }) => {
      if (dryRun) {
        return {
          publicationId: publication.id,
          dryRun: true,
          reviewMessageId: publication.metadata?.review_message_id || '',
          youtubeDelete: { attempted: false, deleted: false, note: 'dry-run' },
          renderDelete: { attempted: false, deleted: false, note: 'dry-run' },
        };
      }
      return withdrawOrphanedPublication({
        publication,
        reviewThreadId,
        store,
        deleteYoutubeVideo: deleteYoutubePreview,
        deleteRenderFile: deleteManagedPreviewFile,
      });
    },
    logger,
  });

  return { channelKey: channelProfile.account_key, reviewThreadId, scopedPublications: scoped.length, ...summary };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('reconcile-review-threads.mjs — see file header for usage');
    return;
  }
  const config = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(DEFAULT_CHANNELS_PATH, { projectRoot });
  const selectedProfiles = args.channelKeys.length > 0
    ? args.channelKeys.map((key) => findPublicationChannelProfile(profiles, key)).filter(Boolean)
    : profiles.filter((profile) => Boolean(resolvePublicationReviewThreadId(config, profile)));
  if (selectedProfiles.length === 0) {
    console.log(JSON.stringify({ ok: false, reason: 'no_channels_with_review_thread' }, null, 2));
    process.exitCode = 1;
    return;
  }
  const store = new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });

  const logger = {
    info: (msg, data) => console.log(`[info] ${msg}`, data || ''),
    warn: (msg, data) => console.warn(`[warn] ${msg}`, data || ''),
  };

  const results = [];
  for (const profile of selectedProfiles) {
    try {
      const report = await reconcileOneChannel({
        channelProfile: profile,
        config,
        store,
        publicationIds: args.publicationIds,
        dryRun: args.dryRun,
        logger,
      });
      results.push(report);
    } catch (error) {
      results.push({ channelKey: profile.account_key, error: error.message || String(error) });
    }
  }
  console.log(JSON.stringify({ dryRun: args.dryRun, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
