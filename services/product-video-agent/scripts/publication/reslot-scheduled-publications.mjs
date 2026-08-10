#!/usr/bin/env node

import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import {
  assignScheduleSlots,
  listCommittedScheduledPublications,
} from '../../src/publication-queue.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import { syncPokeQuizzQueueStatusMessage } from '../../src/poke-quizz-queue-status.mjs';
import { runLocalProcess } from '../../src/process-runner.mjs';
import {
  loadYoutubeClientCredentials,
  scheduleYoutubePublication,
} from '../../src/youtube-publication-executor.mjs';

const DEFAULT_SUPABASE_TIMEOUT_MS = 30_000;
const DEFAULT_YOUTUBE_TIMEOUT_MS = 45_000;
const DEFAULT_REVIEW_REFRESH_TIMEOUT_MS = 300_000;
const DEFAULT_QUEUE_SYNC_TIMEOUT_MS = 60_000;

function parseLimit(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function logReslotProgress(message) {
  printInfo(`[reslot] ${message}`);
}

function createTimeoutFetch(fetchImpl, timeoutMs, label) {
  const effectiveFetch = fetchImpl || globalThis.fetch;
  return async (url, options = {}) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await effectiveFetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`${label} timed out after ${timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function withOperationTimeout(operation, timeoutMs, label) {
  let timeout = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeoutPromise,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function parseTrailingJsonValue(stdout, guard) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  for (let index = text.lastIndexOf('['); index >= 0; index = text.lastIndexOf('[', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (guard(parsed)) {
        return parsed;
      }
    } catch {
      // Continue scanning backward until the trailing JSON value is found.
    }
  }

  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (guard(parsed)) {
        return parsed;
      }
    } catch {
      // Continue scanning backward until the trailing JSON value is found.
    }
  }

  throw new Error('Could not parse the trailing JSON value from maintenance output.');
}

function createPublicationStore(runtimeConfig, options = {}) {
  return new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    fetchImpl: options.fetchImpl || globalThis.fetch,
  });
}

function buildReopenedPublication(publication, asOf) {
  return {
    ...publication,
    status: 'approved',
    scheduled_for: null,
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: 'preview_approved',
      schedule_reconciled_at: asOf,
      schedule_reconciled_reason: 'manual_reslot_requested',
    },
  };
}

function parseTrailingJsonArray(stdout) {
  return parseTrailingJsonValue(stdout, (value) => Array.isArray(value)) || [];
}

function parseTrailingJsonObject(stdout) {
  return parseTrailingJsonValue(stdout, (value) => Boolean(value) && !Array.isArray(value) && typeof value === 'object') || {};
}

async function refreshReviewMessages({
  channelSelector,
  channelsPath,
  delayMs = 300,
  maxRetries = 3,
}) {
  const args = [
    resolve(projectRoot, 'services/product-video-agent/scripts/poke-quizz/refresh-review-messages.mjs'),
    '--channel',
    channelSelector,
    '--channels',
    channelsPath,
    '--delay-ms',
    String(delayMs),
    '--max-retries',
    String(maxRetries),
  ];

  const result = await runLocalProcess({
    executable: process.execPath,
    args,
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });
  return parseTrailingJsonObject(result.stdout);
}

export async function reslotScheduledPublications(options = {}) {
  const runtimeConfig = loadRuntimeConfig();
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const channelSelector = getStringOption(options, 'channel', 'poke-quizz-youtube');
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const limit = parseLimit(getStringOption(options, 'limit', ''));
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const supabaseTimeoutMs = parsePositiveInteger(
    getStringOption(options, 'supabase-timeout-ms', ''),
    DEFAULT_SUPABASE_TIMEOUT_MS,
  );
  const youtubeTimeoutMs = parsePositiveInteger(
    getStringOption(options, 'youtube-timeout-ms', ''),
    DEFAULT_YOUTUBE_TIMEOUT_MS,
  );
  const reviewRefreshTimeoutMs = parsePositiveInteger(
    getStringOption(options, 'review-refresh-timeout-ms', ''),
    DEFAULT_REVIEW_REFRESH_TIMEOUT_MS,
  );
  const queueSyncTimeoutMs = parsePositiveInteger(
    getStringOption(options, 'queue-sync-timeout-ms', ''),
    DEFAULT_QUEUE_SYNC_TIMEOUT_MS,
  );
  const supabaseFetch = createTimeoutFetch(globalThis.fetch, supabaseTimeoutMs, 'Supabase request');
  const youtubeFetch = createTimeoutFetch(globalThis.fetch, youtubeTimeoutMs, 'YouTube request');

  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const store = createPublicationStore(runtimeConfig, { fetchImpl: supabaseFetch });
  const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
  if (!refreshToken) {
    throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
  }
  logReslotProgress(`Fetching scheduled publications for ${channelProfile.account_key}.`);
  const publications = await withOperationTimeout(() => store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  }), supabaseTimeoutMs + 5_000, `Publication fetch for ${channelProfile.account_key}`);
  const clientConfig = await loadYoutubeClientCredentials(
    channelProfile.youtube.oauth_client_secret_path,
    projectRoot,
  );
  const asOfMs = new Date(asOf).getTime();
  const futureCommitted = listCommittedScheduledPublications(publications, channelProfile, asOf)
    .filter((publication) => new Date(publication.scheduled_for).getTime() > asOfMs);
  const targetPublications = limit ? futureCommitted.slice(0, limit) : futureCommitted;
  const reopenedPublications = targetPublications.map((publication) => buildReopenedPublication(publication, asOf));
  const plannedQueue = assignScheduleSlots(reopenedPublications, channelProfile, asOf, []);

  if (dryRun) {
    return {
      as_of: asOf,
      channel: channelProfile.account_key,
      reslot_candidate_count: targetPublications.length,
      candidates: targetPublications.map((publication) => ({
        publication_id: publication.id,
        title: publication.title,
        old_scheduled_for: publication.scheduled_for,
      })),
      planned_schedule: plannedQueue.map((publication) => ({
        publication_id: publication.id,
        title: publication.title,
        new_scheduled_for: publication.scheduled_for,
      })),
      schedule_update_results: [],
    };
  }

  const reopenedResults = [];
  const reopenedById = new Map();
  for (const [index, publication] of targetPublications.entries()) {
    logReslotProgress(`Reopening ${index + 1}/${targetPublications.length}: ${publication.id} (${publication.title}).`);
    const updatedPublication = await withOperationTimeout(() => store.updatePublication(publication.id, {
      status: 'approved',
      scheduled_for: null,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'preview_approved',
        schedule_reconciled_at: asOf,
        schedule_reconciled_reason: 'manual_reslot_requested',
      },
    }), supabaseTimeoutMs + 5_000, `Reopen ${publication.id}`);
    const resolvedPublication = updatedPublication || buildReopenedPublication(publication, asOf);
    reopenedById.set(publication.id, resolvedPublication);
    reopenedResults.push({
      publication_id: publication.id,
      title: publication.title,
      old_scheduled_for: publication.scheduled_for,
      workflow_state: resolvedPublication?.metadata?.workflow_state || 'preview_approved',
    });
    logReslotProgress(`Reopened ${publication.id}.`);
  }

  const scheduleUpdateResults = [];
  for (const [index, item] of plannedQueue.entries()) {
    const publication = reopenedById.get(item.id) || item;
    if (!publication?.external_id) {
      throw new Error(`Cannot reslot ${publication?.id || '(unknown)'} without an existing YouTube external_id.`);
    }
    logReslotProgress(`Scheduling ${index + 1}/${plannedQueue.length}: ${publication.id} -> ${item.scheduled_for}.`);
    const scheduled = await withOperationTimeout(() => scheduleYoutubePublication({
      publication,
      scheduledFor: item.scheduled_for,
      clientConfig,
      refreshToken,
      fetchImpl: youtubeFetch,
    }), youtubeTimeoutMs + 5_000, `Schedule update ${publication.id}`);
    const updatedPublication = await withOperationTimeout(() => store.updatePublication(publication.id, {
      status: 'scheduled',
      visibility: 'private',
      scheduled_for: scheduled.scheduledFor,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
        schedule_reconciled_at: asOf,
        schedule_reconciled_reason: 'manual_reslot_applied',
      },
    }), supabaseTimeoutMs + 5_000, `Schedule persist ${publication.id}`);
    scheduleUpdateResults.push({
      publication_id: publication.id,
      title: publication.title,
      action: 'schedule_update',
      scheduled_for: scheduled.scheduledFor,
      workflow_state: updatedPublication?.metadata?.workflow_state || 'scheduled',
    });
    logReslotProgress(`Scheduled ${publication.id} for ${scheduled.scheduledFor}.`);
  }

  logReslotProgress(`Refreshing review messages for ${channelProfile.account_key}.`);
  const reviewRefreshResult = await withOperationTimeout(() => refreshReviewMessages({
    channelSelector,
    channelsPath,
  }), reviewRefreshTimeoutMs, `Review refresh for ${channelProfile.account_key}`);
  logReslotProgress(`Syncing queue status for ${channelProfile.account_key}.`);
  await withOperationTimeout(() => syncPokeQuizzQueueStatusMessage({
    runtimeConfig,
    store,
    channelProfile,
    channelSelector,
    asOf,
  }), queueSyncTimeoutMs, `Queue sync for ${channelProfile.account_key}`);
  logReslotProgress(`Completed reslot for ${channelProfile.account_key}.`);

  return {
    as_of: asOf,
    channel: channelProfile.account_key,
    reslot_candidate_count: targetPublications.length,
    candidates: reopenedResults,
    planned_schedule: plannedQueue.map((publication) => ({
      publication_id: publication.id,
      title: publication.title,
      new_scheduled_for: publication.scheduled_for,
    })),
    schedule_update_results: scheduleUpdateResults,
    review_refresh: reviewRefreshResult,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/publication/reslot-scheduled-publications.mjs [options]',
      '',
      'Options:',
      '  --channel <id>       Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>    Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --as-of <ISO>        Deterministic reslot timestamp. Default: now.',
      '  --limit <n>          Optional row limit for partial maintenance runs.',
      '  --dry-run            Print the reslot plan without mutating Supabase or YouTube.',
      `  --supabase-timeout-ms <n>   Supabase request timeout. Default: ${DEFAULT_SUPABASE_TIMEOUT_MS}`,
      `  --youtube-timeout-ms <n>    YouTube request timeout. Default: ${DEFAULT_YOUTUBE_TIMEOUT_MS}`,
      `  --review-refresh-timeout-ms <n> Review refresh timeout. Default: ${DEFAULT_REVIEW_REFRESH_TIMEOUT_MS}`,
      `  --queue-sync-timeout-ms <n> Queue status sync timeout. Default: ${DEFAULT_QUEUE_SYNC_TIMEOUT_MS}`,
    ]);
    process.exit(0);
  }

  const result = await reslotScheduledPublications(options);
  printInfo(`Prepared ${result.reslot_candidate_count} scheduled publication(s) for reslotting on ${result.channel}.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
