#!/usr/bin/env node

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadRuntimeConfig, projectRoot } from '../../../lib/runtime-config.mjs';
import { fetchInstagramPublicationMetrics } from '../../src/analytics/instagram-adapter.mjs';
import { runSocialAnalyticsSweep } from '../../src/analytics/social-analytics-engine.mjs';
import { loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import { listEnabledAdditionalPublicationTargets } from '../../src/social-publication-targets.mjs';

const DEFAULT_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const DEFAULT_STATE_PATH = 'data/runtime/product-video-agent/social-analytics-state.json';
const DEFAULT_LIMIT = 100;
const DEFAULT_SINCE_DAYS = 14;

export function parseInstagramAnalyticsSweepArgs(argv = []) {
  const args = {
    limit: DEFAULT_LIMIT,
    sinceDays: DEFAULT_SINCE_DAYS,
    accountKey: '',
    statePath: resolve(projectRoot, DEFAULT_STATE_PATH),
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--limit') {
      args.limit = Number(argv[index + 1] || DEFAULT_LIMIT);
      index += 1;
    } else if (value === '--since-days') {
      args.sinceDays = Number(argv[index + 1] || DEFAULT_SINCE_DAYS);
      index += 1;
    } else if (value === '--account-key') {
      args.accountKey = String(argv[index + 1] || '').trim();
      index += 1;
    } else if (value === '--state-path') {
      args.statePath = resolve(String(argv[index + 1] || DEFAULT_STATE_PATH));
      index += 1;
    } else if (value === '--force') {
      args.force = true;
    }
  }
  return args;
}

export function listEnabledInstagramAnalyticsTargets(profiles = []) {
  const byAccountKey = new Map();
  for (const profile of profiles) {
    for (const target of listEnabledAdditionalPublicationTargets(profile)) {
      if (target.platform === 'instagram_reels') {
        byAccountKey.set(target.accountKey, target);
      }
    }
  }
  return [...byAccountKey.values()];
}

export async function runInstagramAnalyticsSweep(argsInput = {}, dependencies = {}) {
  const args = {
    limit: DEFAULT_LIMIT,
    sinceDays: DEFAULT_SINCE_DAYS,
    accountKey: '',
    statePath: resolve(projectRoot, DEFAULT_STATE_PATH),
    force: false,
    ...argsInput,
  };
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const profiles = dependencies.profiles || await loadProfiles(DEFAULT_CHANNELS_PATH, { projectRoot });
  const store = dependencies.store || new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    egressLedgerDir: runtimeConfig.runtimePaths?.supabaseEgressLedgerDir,
    telemetryService: 'social_analytics_instagram',
  });
  const targets = listEnabledInstagramAnalyticsTargets(profiles);

  return runSocialAnalyticsSweep({
    platform: 'instagram_reels',
    targets,
    store,
    statePath: args.statePath,
    accountKey: args.accountKey,
    limitPerAccount: args.limit,
    sinceDays: args.sinceDays,
    force: args.force,
    sleepMs: dependencies.sleepMs,
    retrySleep: dependencies.retrySleep,
    sleep: dependencies.sleep,
    capturedAt: dependencies.capturedAt,
    captureMetrics: ({ publication, target, capturedAt }) => (
      (dependencies.fetchInstagramPublicationMetrics || fetchInstagramPublicationMetrics)({
        publication,
        target,
        runtimeEnv: runtimeConfig.env,
        capturedAt,
        fetchImpl: dependencies.fetchImpl,
      })
    ),
    onRetry: ({ attempt, delayMs, error }) => {
      dependencies.logger?.warn?.(
        `[instagram-analytics] retry ${attempt} in ${delayMs}ms: ${error?.message || error}`,
      );
    },
    onProgress: ({ processed, due, captured, failed }) => {
      dependencies.logger?.log?.(
        `[instagram-analytics] ${processed}/${due} captured=${captured} failed=${failed}`,
      );
    },
  });
}

async function main() {
  const result = await runInstagramAnalyticsSweep(
    parseInstagramAnalyticsSweepArgs(process.argv.slice(2)),
    { logger: console },
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.retry_recommended) {
    process.exitCode = 1;
  }
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
