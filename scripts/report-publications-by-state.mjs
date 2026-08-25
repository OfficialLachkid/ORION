#!/usr/bin/env node
// Diagnostic: dump publication counts by workflow state + related-video
// apply_status for one channel. Useful for answering "why doesn't the
// backfill see any published rows for channel X" without touching Supabase
// or opening a psql shell.
//
// Usage:
//   node scripts/report-publications-by-state.mjs --channel trivamon-youtube
//   node scripts/report-publications-by-state.mjs --channel trivamon-youtube --limit 5 --show-samples

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../services/product-video-agent/src/publication-store.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../services/product-video-agent/src/publication-channels.mjs';

function getArg(flag, fallback = '') {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : (process.argv[i + 1] || fallback);
}

function normalizeWorkflowState(publication = {}) {
  if (publication.metadata?.workflow_state) {
    return String(publication.metadata.workflow_state).trim().toLowerCase();
  }
  return String(publication.status || '').trim().toLowerCase();
}

async function main() {
  const channelSelector = getArg('--channel', 'poke-quizz-youtube');
  const showSamples = process.argv.includes('--show-samples');
  const sampleLimit = Number(getArg('--limit', '5'));

  const runtimeConfig = loadRuntimeConfig();
  const channelsPath = getArg('--channels', 'services/product-video-agent/publication-channels.example.json');
  const profiles = await loadPublicationChannelProfiles(channelsPath);
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);

  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });

  const byWorkflowState = new Map();
  const byRawStatus = new Map();
  const publishedByApplyStatus = new Map();
  const publishedSamples = [];

  for (const pub of publications) {
    const ws = normalizeWorkflowState(pub) || '(empty)';
    byWorkflowState.set(ws, (byWorkflowState.get(ws) || 0) + 1);
    const rawStatus = String(pub.status || '').trim().toLowerCase() || '(empty)';
    byRawStatus.set(rawStatus, (byRawStatus.get(rawStatus) || 0) + 1);
    if (ws === 'published') {
      const apStatus = String(pub?.metadata?.related_video?.apply_status || '').trim().toLowerCase() || '(none)';
      publishedByApplyStatus.set(apStatus, (publishedByApplyStatus.get(apStatus) || 0) + 1);
      if (publishedSamples.length < sampleLimit) {
        publishedSamples.push({
          publication_id: pub.id,
          external_id: pub.external_id || '',
          title: (pub.title || '').slice(0, 60),
          status: pub.status,
          workflow_state: pub.metadata?.workflow_state,
          related_video_apply_status: pub?.metadata?.related_video?.apply_status || '(none)',
          related_video_selection_status: pub?.metadata?.related_video?.selection_status || '(none)',
          related_video_target_external_id: pub?.metadata?.related_video?.target_external_id || '(none)',
        });
      }
    }
  }

  process.stdout.write(`\nChannel: ${channelSelector}\n`);
  process.stdout.write(`Total publications in video_publications: ${publications.length}\n\n`);
  process.stdout.write('By normalized workflow_state (what backfill sees):\n');
  for (const [k, v] of [...byWorkflowState.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${k.padEnd(30)} ${v}\n`);
  }
  process.stdout.write('\nBy raw status column (Supabase source of truth):\n');
  for (const [k, v] of [...byRawStatus.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${k.padEnd(30)} ${v}\n`);
  }
  if (byWorkflowState.get('published')) {
    process.stdout.write('\nOf published rows, by related_video.apply_status:\n');
    for (const [k, v] of [...publishedByApplyStatus.entries()].sort((a, b) => b[1] - a[1])) {
      process.stdout.write(`  ${k.padEnd(30)} ${v}\n`);
    }
  }
  if (showSamples && publishedSamples.length > 0) {
    process.stdout.write('\nSample published rows:\n');
    process.stdout.write(`${JSON.stringify(publishedSamples, null, 2)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`Report failed: ${error?.message || error}\n`);
  process.exit(1);
});
