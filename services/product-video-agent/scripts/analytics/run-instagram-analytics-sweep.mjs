#!/usr/bin/env node
// run-instagram-analytics-sweep.mjs
//
// Fetch per-media insights for Instagram Reels publications and write
// them to the shared `video_analytics` table so the weekly review can
// pick them up alongside YouTube. Minimal — no digest posting, no
// retry orchestration, no state file (yet). Intended for:
//
//   1. Manual on-demand runs: `node .../run-instagram-analytics-sweep.mjs`
//   2. A future LaunchAgent that just invokes this directly on a cron.
//
// The YouTube sweep (run-video-analytics-sweep.mjs) has 1000+ lines of
// digest + retry + state logic that we deliberately did NOT port here;
// if Instagram analytics prove useful we can promote this to the
// richer harness in a follow-up.
//
// Scope filter: only publications with `platform=instagram_reels` and
// `status=published`. Only the most recent N by default (default 100)
// since Instagram Graph has rate limits and we re-run frequently.
//
// Usage:
//   node services/product-video-agent/scripts/analytics/run-instagram-analytics-sweep.mjs
//   node .../run-instagram-analytics-sweep.mjs --limit 200
//   node .../run-instagram-analytics-sweep.mjs --since-days 7
//   node .../run-instagram-analytics-sweep.mjs --account-key poke-quizzz-instagram

import { loadRuntimeConfig, projectRoot } from '../../../lib/runtime-config.mjs';
import { loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  fetchInstagramPublicationMetrics,
  findInstagramTargetAcrossProfiles,
} from '../../src/analytics/instagram-adapter.mjs';

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

  const sinceIso = new Date(Date.now() - args.sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const scopeFilter = args.accountKey
    ? `&account_key=eq.${encodeURIComponent(args.accountKey)}`
    : '';
  const path = `video_publications?platform=eq.instagram_reels&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.desc&limit=${args.limit}${scopeFilter}`;
  const publications = await supabaseFetch(config, path);
  console.log(`[instagram-analytics] window: ≥${sinceIso}  limit=${args.limit}  → ${publications.length} publications`);

  let captured = 0;
  let failed = 0;
  const failures = [];
  const asOf = new Date().toISOString();

  for (const [i, publication] of publications.entries()) {
    const target = findInstagramTargetAcrossProfiles(profiles, publication.account_key);
    if (!target) {
      failed += 1;
      failures.push({ id: publication.id, reason: `no publisher target for account_key=${publication.account_key}` });
      continue;
    }
    try {
      const snapshot = await fetchInstagramPublicationMetrics({
        publication,
        target,
        runtimeEnv: config.env,
        capturedAt: asOf,
      });
      await store.upsertVideoAnalyticsSnapshot({
        publication_id: publication.id,
        captured_at: asOf,
        metrics: snapshot.metrics,
        raw_payload: snapshot.raw_payload,
      });
      captured += 1;
      if ((i + 1) % 10 === 0 || i === publications.length - 1) {
        console.log(`  progress: captured=${captured}  failed=${failed}  (${i + 1}/${publications.length})`);
      }
    } catch (error) {
      failed += 1;
      failures.push({ id: publication.id, external_id: publication.external_id, reason: error.message || String(error) });
    }
    await sleep(SLEEP_MS);
  }

  console.log(JSON.stringify({
    captured,
    failed,
    total: publications.length,
    sinceIso,
    accountKey: args.accountKey || null,
    failures: failures.slice(0, 20),
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
