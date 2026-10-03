#!/usr/bin/env node
// scripts/reconcile-review-threads.mjs
//
// Standalone / on-demand entrypoint for the review-thread reconcile
// pass. The same logic runs nightly inside night-shift via
// `reconcilePokeQuizzReviewThreads` in pokemon-maintenance.mjs — this
// script is for the one-shot manual case: investigating a specific
// orphan, or forcing a sweep between nightly runs.
//
// Usage:
//   node scripts/reconcile-review-threads.mjs                     # all channels, live
//   node scripts/reconcile-review-threads.mjs --dry-run           # report-only
//   node scripts/reconcile-review-threads.mjs --channel KEY       # one channel
//   node scripts/reconcile-review-threads.mjs --publication-id ID [--publication-id ID]
//                                                                 # restrict to specific publication ids

import { reconcilePokeQuizzReviewThreads } from './lib/night-shift/pokemon-maintenance.mjs';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';

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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('reconcile-review-threads.mjs — see file header for usage');
    return;
  }
  const config = loadRuntimeConfig();

  // Scope-by-publication-id: fetch the full channel set, filter inside
  // the reconcile. Dry-run: short-circuit the YouTube delete and store
  // update via injected no-op dependencies.
  const dependencies = {};
  if (args.channelKeys.length > 0) dependencies.channelKeys = args.channelKeys;
  if (args.publicationIds.length > 0) {
    const idSet = new Set(args.publicationIds);
    const { SupabasePublicationStore } = await import('../services/product-video-agent/src/publication-store.mjs');
    const realStore = new SupabasePublicationStore({
      supabaseUrl: config.env.SUPABASE_URL,
      apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
    });
    dependencies.publicationStore = {
      ...realStore,
      fetchPublicationsByChannel: realStore.fetchPublicationsByChannel.bind(realStore),
      async updatePublication(id, patch) { return realStore.updatePublication(id, patch); },
    };
    const originalFetch = dependencies.publicationStore.fetchPublicationsByChannel;
    dependencies.publicationStore.fetchPublicationsByChannel = async (params) => {
      const rows = await originalFetch(params);
      return rows.filter((row) => idSet.has(row.id));
    };
  }
  if (args.dryRun) {
    const inspection = { skipped: true, note: 'dry-run' };
    dependencies.deleteYoutubeVideo = async ({ externalId }) => ({ externalId, deletedAt: new Date().toISOString(), dryRun: true });
    dependencies.loadYoutubeClientCredentials = async () => ({});
    dependencies.deleteRenderFile = async () => inspection;
    const realStore = dependencies.publicationStore;
    dependencies.publicationStore = {
      fetchPublicationsByChannel: (params) => (realStore
        ? realStore.fetchPublicationsByChannel(params)
        : (async () => {
          const { SupabasePublicationStore } = await import('../services/product-video-agent/src/publication-store.mjs');
          return new SupabasePublicationStore({
            supabaseUrl: config.env.SUPABASE_URL,
            apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
          }).fetchPublicationsByChannel(params);
        })()),
      async updatePublication(id, patch) { return { id, ...patch, dryRun: true }; },
    };
  }

  const summary = await reconcilePokeQuizzReviewThreads(config, new Date().toISOString(), dependencies);
  console.log(JSON.stringify({ dryRun: args.dryRun, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
