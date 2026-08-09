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

function parseLimit(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

function createPublicationStore(runtimeConfig) {
  return new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
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

  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const store = createPublicationStore(runtimeConfig);
  const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
  if (!refreshToken) {
    throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
  }
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
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
  for (const publication of targetPublications) {
    const updatedPublication = await store.updatePublication(publication.id, {
      status: 'approved',
      scheduled_for: null,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'preview_approved',
        schedule_reconciled_at: asOf,
        schedule_reconciled_reason: 'manual_reslot_requested',
      },
    });
    const resolvedPublication = updatedPublication || buildReopenedPublication(publication, asOf);
    reopenedById.set(publication.id, resolvedPublication);
    reopenedResults.push({
      publication_id: publication.id,
      title: publication.title,
      old_scheduled_for: publication.scheduled_for,
      workflow_state: resolvedPublication?.metadata?.workflow_state || 'preview_approved',
    });
  }

  const scheduleUpdateResults = [];
  for (const item of plannedQueue) {
    const publication = reopenedById.get(item.id) || item;
    if (!publication?.external_id) {
      throw new Error(`Cannot reslot ${publication?.id || '(unknown)'} without an existing YouTube external_id.`);
    }
    const scheduled = await scheduleYoutubePublication({
      publication,
      scheduledFor: item.scheduled_for,
      clientConfig,
      refreshToken,
    });
    const updatedPublication = await store.updatePublication(publication.id, {
      status: 'scheduled',
      visibility: 'private',
      scheduled_for: scheduled.scheduledFor,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
        schedule_reconciled_at: asOf,
        schedule_reconciled_reason: 'manual_reslot_applied',
      },
    });
    scheduleUpdateResults.push({
      publication_id: publication.id,
      title: publication.title,
      action: 'schedule_update',
      scheduled_for: scheduled.scheduledFor,
      workflow_state: updatedPublication?.metadata?.workflow_state || 'scheduled',
    });
  }

  const reviewRefreshResult = await refreshReviewMessages({
    channelSelector,
    channelsPath,
  });
  await syncPokeQuizzQueueStatusMessage({
    runtimeConfig,
    store,
    channelProfile,
    channelSelector,
    asOf,
  });

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
    ]);
    process.exit(0);
  }

  const result = await reslotScheduledPublications(options);
  printInfo(`Prepared ${result.reslot_candidate_count} scheduled publication(s) for reslotting on ${result.channel}.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
