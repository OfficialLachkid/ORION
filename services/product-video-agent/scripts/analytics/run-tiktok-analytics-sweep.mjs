#!/usr/bin/env node
// run-tiktok-analytics-sweep.mjs
//
// Fetch per-post engagement for TikTok publications posted via Buffer
// and write snapshots to `video_analytics` so the weekly review picks
// them up alongside YouTube and Instagram.
//
// Scope filter: `platform=tiktok_video` (NOT the bare `tiktok` enum —
// that one is the direct TikTok OAuth path which isn't approved yet,
// zero publications; operator confirmed 2026-10-18).
//
// **Buffer insights:read scope**: as of 2026-10-19 the ORION Buffer
// token lacks `insights:read`, so `post.metrics` returns
// INSUFFICIENT_SCOPE and the adapter writes a sparse snapshot
// (status + external_link only). On the FIRST row that hits this
// condition we print a loud banner so the operator can grant the
// scope in Buffer's dashboard; subsequent rows the same run stay
// quiet. Once the scope is granted the next sweep captures metrics
// automatically — no code change.
//
// Usage:
//   node services/product-video-agent/scripts/analytics/run-tiktok-analytics-sweep.mjs
//   node .../run-tiktok-analytics-sweep.mjs --limit 200 --since-days 14
//   node .../run-tiktok-analytics-sweep.mjs --account-key poke-quizz-tiktok

import { loadRuntimeConfig, projectRoot } from '../../../lib/runtime-config.mjs';
import { loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import { createBufferApiClient } from '../../src/buffer-publication-executor.mjs';
import {
  fetchTikTokPublicationMetrics,
  findBufferTikTokTargetAcrossProfiles,
} from '../../src/analytics/buffer-tiktok-adapter.mjs';

const DEFAULT_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const DEFAULT_LIMIT = 100;
const DEFAULT_SINCE_DAYS = 14;
const SLEEP_MS = 300;

function parseArgs(argv) {
  const args = { limit: DEFAULT_LIMIT, sinceDays: DEFAULT_SINCE_DAYS, accountKey: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--limit') { args.limit = Number(argv[i + 1] || DEFAULT_LIMIT); i += 1; }
    else if (a === '--since-days') { args.sinceDays = Number(argv[i + 1] || DEFAULT_SINCE_DAYS); i += 1; }
    else if (a === '--account-key') { args.accountKey = String(argv[i + 1] || ''); i += 1; }
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function supabaseFetch(config, path) {
  const url = String(config.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Supabase ${path} → ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(DEFAULT_CHANNELS_PATH, { projectRoot });
  const store = new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
  const bufferClient = createBufferApiClient(config.env);

  const sinceIso = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const scopeFilter = args.accountKey ? `&account_key=eq.${encodeURIComponent(args.accountKey)}` : '';
  const path = `video_publications?platform=eq.tiktok_video&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.desc&limit=${args.limit}${scopeFilter}`;
  const publications = await supabaseFetch(config, path);
  console.log(`[tiktok-analytics] window: ≥${sinceIso}  limit=${args.limit}  → ${publications.length} publications`);

  let captured = 0;
  let scopeMissingRowCount = 0;
  let bannerShown = false;
  let failed = 0;
  const failures = [];
  const asOf = new Date().toISOString();

  for (const [i, publication] of publications.entries()) {
    const target = findBufferTikTokTargetAcrossProfiles(profiles, publication.account_key);
    if (!target) {
      failed += 1;
      failures.push({ id: publication.id, reason: `no Buffer-TikTok target for account_key=${publication.account_key}` });
      continue;
    }
    try {
      const snapshot = await fetchTikTokPublicationMetrics({
        publication, bufferClient, capturedAt: asOf,
      });
      await store.upsertVideoAnalyticsSnapshot({
        publication_id: publication.id,
        captured_at: asOf,
        metrics: snapshot.metrics,
        raw_payload: snapshot.raw_payload,
      });
      captured += 1;
      if (snapshot.metrics.buffer_insights_scope_missing) {
        scopeMissingRowCount += 1;
        if (!bannerShown) {
          console.warn('');
          console.warn('========================================================================');
          console.warn('  Buffer API token is missing the `insights:read` scope.');
          console.warn('  TikTok rows are being written WITHOUT engagement metrics.');
          console.warn('  Grant the scope: https://publish.buffer.com → Settings → API Access');
          console.warn('  Once granted, re-run this sweep to backfill metrics.');
          console.warn('========================================================================');
          console.warn('');
          bannerShown = true;
        }
      }
      if ((i + 1) % 10 === 0 || i === publications.length - 1) {
        console.log(`  progress: captured=${captured} (scope_missing=${scopeMissingRowCount}) failed=${failed} (${i + 1}/${publications.length})`);
      }
    } catch (error) {
      failed += 1;
      failures.push({ id: publication.id, external_id: publication.external_id, reason: error.message || String(error) });
    }
    await sleep(SLEEP_MS);
  }

  console.log(JSON.stringify({
    captured,
    captured_with_metrics: captured - scopeMissingRowCount,
    captured_sparse_no_scope: scopeMissingRowCount,
    failed,
    total: publications.length,
    sinceIso,
    accountKey: args.accountKey || null,
    failures: failures.slice(0, 20),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
