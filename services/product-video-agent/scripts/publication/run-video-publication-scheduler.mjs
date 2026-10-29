#!/usr/bin/env node

import process from 'node:process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../../scripts/lib/supabase-bridge-api.mjs';
import { buildPublicationQueuePlan } from '../../src/publication-queue.mjs';
import { loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import {
  ACTIVE_RUNTIME_EXCLUDED_STATUSES,
  ACTIVE_RUNTIME_PUBLICATION_SELECT,
  isReconciliationStatus,
  RECONCILIATION_RUNTIME_PUBLICATION_SELECT,
  RECONCILIATION_RUNTIME_STATUSES,
} from '../../src/publication-runtime-snapshot.mjs';
import { runLocalProcess } from '../../src/process-runner.mjs';
import {
  buildYoutubePreviewUploadPlan,
  buildYoutubeScheduleUpdatePlan,
} from '../../src/youtube-publication.mjs';

const QUEUE_PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'title',
  'description',
  'hashtags',
  'preview_url',
  'external_id',
  'scheduled_for',
  'uploaded_at',
  'published_at',
  'created_at',
  'updated_at',
  'workflow_state:metadata->>workflow_state',
].join(',');

const TERMINAL_PUBLICATION_STATUSES = 'published,withdrawn,deleted,failed,blocked';
const DEFAULT_RUNTIME_CACHE_PATH = 'data/runtime/product-video-agent/publication-runtime-cache.json';
const RUNTIME_CACHE_VERSION = 1;
const RUNTIME_CACHE_FULL_REFRESH_MS = 24 * 60 * 60 * 1000;
const RUNTIME_CACHE_OVERLAP_MS = 5 * 60 * 1000;
function toTimestamp(value = '') {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

async function loadRuntimePublicationCache(cachePath) {
  if (!cachePath) return null;
  try {
    const parsed = JSON.parse(await readFile(cachePath, 'utf8'));
    if (parsed?.version !== RUNTIME_CACHE_VERSION || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

async function saveRuntimePublicationCache(cachePath, cache) {
  if (!cachePath) return;
  await mkdir(dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, cachePath);
}
export async function loadQueuedPublications(runtimeEnv, options = {}) {
  const fetchJsonImpl = options.fetchJson || fetchJson;
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/video_publications', supabaseUrl);
  url.searchParams.set('select', QUEUE_PUBLICATION_SELECT);
  url.searchParams.set('status', `not.in.(${TERMINAL_PUBLICATION_STATUSES})`);
  url.searchParams.set('order', 'created_at.asc');
  return fetchJsonImpl(url.toString(), {
    method: 'GET',
    headers: createHeaders(apiKey),
  });
}

export async function loadRuntimePublications(runtimeEnv, options = {}) {
  const fetchJsonImpl = options.fetchJson || fetchJson;
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const profiles = Array.isArray(options.channelProfiles) ? options.channelProfiles : [];
  const asOf = String(options.asOf || new Date().toISOString());
  const asOfTimestamp = toTimestamp(asOf) ?? Date.now();
  const cachePath = options.cachePath === ''
    ? ''
    : resolve(projectRoot, options.cachePath || DEFAULT_RUNTIME_CACHE_PATH);
  const platforms = [...new Set(profiles.map((profile) => String(profile?.platform || '').trim()).filter(Boolean))];
  const accountKeys = [...new Set(profiles.map((profile) => String(profile?.account_key || '').trim()).filter(Boolean))];
  const cacheScope = JSON.stringify({
    platforms: [...platforms].sort(),
    account_keys: [...accountKeys].sort(),
  });
  const pageSize = 1000;
  const loadPages = async ({ select, status = '', updatedAfter = '' }) => {
    const baseUrl = new URL('/rest/v1/video_publications', supabaseUrl);
    baseUrl.searchParams.set('select', select);
    if (status) baseUrl.searchParams.set('status', status);
    if (updatedAfter) baseUrl.searchParams.set('updated_at', `gte.${updatedAfter}`);
    if (platforms.length > 0) {
      baseUrl.searchParams.set('platform', `in.(${platforms.join(',')})`);
    }
    if (accountKeys.length > 0) {
      baseUrl.searchParams.set('account_key', `in.(${accountKeys.join(',')})`);
    }
    baseUrl.searchParams.set('order', 'created_at.asc');

    const rows = [];
    for (let offset = 0; ; offset += pageSize) {
      const pageUrl = new URL(baseUrl);
      pageUrl.searchParams.set('limit', String(pageSize));
      pageUrl.searchParams.set('offset', String(offset));
      const page = await fetchJsonImpl(pageUrl.toString(), {
        method: 'GET',
        headers: createHeaders(apiKey),
      });
      rows.push(...page);
      if (page.length < pageSize) break;
    }
    return rows;
  };

  const cached = await loadRuntimePublicationCache(cachePath);
  const lastFullRefreshTimestamp = toTimestamp(cached?.refreshed_at);
  const needsFullRefresh = !cached
    || cached.scope !== cacheScope
    || lastFullRefreshTimestamp === null
    || asOfTimestamp - lastFullRefreshTimestamp >= RUNTIME_CACHE_FULL_REFRESH_MS;
  const syncedThroughTimestamp = toTimestamp(cached?.synced_through);
  const incrementalUpdatedAfter = !needsFullRefresh && syncedThroughTimestamp !== null
    ? new Date(Math.max(0, syncedThroughTimestamp - RUNTIME_CACHE_OVERLAP_MS)).toISOString()
    : '';

  const [activePublications, fetchedReconciliationRows] = await Promise.all([
    loadPages({
      select: ACTIVE_RUNTIME_PUBLICATION_SELECT,
      status: `not.in.(${ACTIVE_RUNTIME_EXCLUDED_STATUSES})`,
    }),
    loadPages({
      select: RECONCILIATION_RUNTIME_PUBLICATION_SELECT,
      status: needsFullRefresh ? `in.(${RECONCILIATION_RUNTIME_STATUSES})` : '',
      updatedAfter: incrementalUpdatedAfter,
    }),
  ]);

  const reconciliationById = new Map(
    (needsFullRefresh ? [] : cached.rows)
      .filter((row) => row?.id && isReconciliationStatus(row.status))
      .map((row) => [row.id, row]),
  );
  for (const row of fetchedReconciliationRows) {
    if (!row?.id) continue;
    if (isReconciliationStatus(row.status)) {
      reconciliationById.set(row.id, row);
    } else {
      reconciliationById.delete(row.id);
    }
  }
  const reconciliationPublications = [...reconciliationById.values()];
  try {
    await saveRuntimePublicationCache(cachePath, {
      version: RUNTIME_CACHE_VERSION,
      scope: cacheScope,
      refreshed_at: needsFullRefresh ? asOf : cached.refreshed_at,
      synced_through: asOf,
      rows: reconciliationPublications,
    });
  } catch (error) {
    printWarn(`Could not save the rebuildable publication runtime cache: ${error.message}`);
  }

  const publicationsById = new Map(
    reconciliationPublications.filter((row) => row?.id).map((row) => [row.id, row]),
  );
  for (const row of activePublications) {
    if (row?.id) publicationsById.set(row.id, row);
  }
  return [...publicationsById.values()];
}

export async function createPublicationSnapshot(publications = []) {
  const directory = await mkdtemp(join(tmpdir(), 'orion-publications-'));
  const path = join(directory, 'snapshot.json');
  await writeFile(path, JSON.stringify(publications), { encoding: 'utf8', mode: 0o600 });
  return {
    path,
    async cleanup() {
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function parseTrailingJsonArray(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return [];
  }

  for (let index = text.lastIndexOf('['); index >= 0; index = text.lastIndexOf('[', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Scan backward until the trailing JSON array is found.
    }
  }

  throw new Error('Could not parse publication execution JSON output.');
}

async function executePublicationPhase({
  channelSelector,
  channelsPath,
  asOf,
  scheduleApproved = false,
  reconcileOnly = false,
  publicationSnapshotPath = '',
}, options = {}) {
  const runProcess = options.runProcess || runLocalProcess;
  const executable = options.executable || process.execPath;
  const scriptPath = options.scriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/publication/execute-youtube-publication.mjs');
  const args = [
    scriptPath,
    '--channel',
    channelSelector,
    '--channels',
    channelsPath,
    '--as-of',
    asOf,
  ];
  if (reconcileOnly) {
    args.push('--reconcile-only');
  } else if (scheduleApproved) {
    args.push('--schedule-approved');
  }
  if (publicationSnapshotPath) {
    args.push('--publications-snapshot', publicationSnapshotPath);
  }

  const result = await runProcess({
    executable,
    args,
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });
  return parseTrailingJsonArray(result.stdout);
}

async function executeSocialPublicationPhase({
  asOf,
}, options = {}) {
  const runProcess = options.runProcess || runLocalProcess;
  const executable = options.executable || process.execPath;
  const scriptPath = options.scriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/publication/social/execute-due-publications.mjs');
  const result = await runProcess({
    executable,
    args: [
      scriptPath,
      '--as-of',
      asOf,
    ],
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });
  return parseTrailingJsonArray(result.stdout);
}

function buildYoutubeApiPlan(queuePlan, profiles, publications) {
  return queuePlan.channels.map((channelQueue) => {
    const profile = profiles.find((item) => item.id === channelQueue.channel.id);
    const previewRequests = channelQueue.preview_upload_queue
      .map((queueItem) => {
        const publication = publications.find((item) => item.id === queueItem.publication_id);
        if (!publication || !profile) return null;
        return {
          publication_id: publication.id,
          request: buildYoutubePreviewUploadPlan(publication, profile),
        };
      })
      .filter(Boolean);
    const scheduleRequests = channelQueue.scheduled_publish_queue
      .filter((queueItem) => queueItem.schedule_update_required === true)
      .map((queueItem) => {
        const publication = publications.find((item) => item.id === queueItem.publication_id);
        if (!publication || !profile || !publication.external_id) return null;
        return {
          publication_id: publication.id,
          request: buildYoutubeScheduleUpdatePlan(publication, queueItem.scheduled_for),
        };
      })
      .filter(Boolean);
    return {
      channel: channelQueue.channel,
      preview_upload_requests: previewRequests,
      schedule_update_requests: scheduleRequests,
    };
  });
}

export async function runVideoPublicationScheduler(options = {}, dependencies = {}) {
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const planOnly = getBooleanOption(options, 'plan-only', false);
  const reconcileOnly = getBooleanOption(options, 'reconcile-only', false);
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const loadPublications = dependencies.loadRuntimePublications
    || dependencies.loadQueuedPublications
    || loadRuntimePublications;
  const executePhase = dependencies.executePublicationPhase || executePublicationPhase;
  const executeSocialPhase = dependencies.executeSocialPublicationPhase || executeSocialPublicationPhase;
  const profiles = await loadProfiles(channelsPath, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const publications = await loadPublications(runtimeConfig.env || {}, {
    fetchJson: dependencies.fetchJson || fetchJson,
    channelProfiles: activeProfiles,
    asOf,
    ...(dependencies.runtimeCachePath === undefined
      ? {}
      : { cachePath: dependencies.runtimeCachePath }),
  });
  const queuePlan = buildPublicationQueuePlan({
    publications,
    channelProfiles: activeProfiles,
    asOf,
  });
  const youtubeApiPlan = buildYoutubeApiPlan(queuePlan, profiles, publications);
  const executionResults = planOnly ? [] : activeProfiles.map((profile) => ({
    channel: {
      id: profile.id,
      name: profile.name,
      account_key: profile.account_key,
    },
    preview_upload_results: [],
    schedule_update_results: [],
    preview_upload_error: null,
    schedule_update_error: null,
  }));
  const executionErrors = [];
  let socialPublicationResults = [];

  if (!planOnly) {
    const prepareSnapshot = dependencies.createPublicationSnapshot || createPublicationSnapshot;
    const publicationSnapshot = await prepareSnapshot(publications);
    const phaseOptions = {
      runProcess: dependencies.runProcess,
      executable: dependencies.executable,
      scriptPath: dependencies.scriptPath,
    };
    try {
      // Reconcile every channel before a missing or invalid preview can affect uploads.
      for (let index = 0; index < activeProfiles.length; index += 1) {
        const profile = activeProfiles[index];
        const result = executionResults[index];
        try {
          result.schedule_update_results = await executePhase({
            channelSelector: profile.account_key,
            channelsPath,
            asOf,
            scheduleApproved: !reconcileOnly,
            reconcileOnly,
            publicationSnapshotPath: publicationSnapshot.path,
          }, phaseOptions);
        } catch (error) {
          result.schedule_update_error = String(error?.message || error);
          executionErrors.push({
            channel: profile.account_key,
            phase: reconcileOnly ? 'reconciliation' : 'schedule_reconciliation',
            error: result.schedule_update_error,
          });
        }
      }

      if (!reconcileOnly) {
        for (let index = 0; index < activeProfiles.length; index += 1) {
          const profile = activeProfiles[index];
          const result = executionResults[index];
          try {
            result.preview_upload_results = await executePhase({
              channelSelector: profile.account_key,
              channelsPath,
              asOf,
              scheduleApproved: false,
              reconcileOnly: false,
              publicationSnapshotPath: publicationSnapshot.path,
            }, phaseOptions);
          } catch (error) {
            result.preview_upload_error = String(error?.message || error);
            executionErrors.push({
              channel: profile.account_key,
              phase: 'preview_upload',
              error: result.preview_upload_error,
            });
          }
        }
      }

      for (const result of executionResults) {
        printInfo(
          `Processed ${result.channel.account_key}: ${result.preview_upload_results.length} preview upload(s), `
          + `${result.schedule_update_results.length} schedule/reconciliation update(s).`
        );
      }
      try {
        socialPublicationResults = await executeSocialPhase({
          asOf,
        }, {
          runProcess: dependencies.runProcess,
          executable: dependencies.executable,
          scriptPath: dependencies.socialScriptPath,
        });
        printInfo(`Processed ${socialPublicationResults.length} social publication task(s).`);
      } catch (error) {
        executionErrors.push({
          channel: 'social',
          phase: 'social_publication',
          error: String(error?.message || error),
        });
      }
    } finally {
      await publicationSnapshot.cleanup();
    }
  }

  return {
    queue_plan: queuePlan,
    youtube_api_plan: youtubeApiPlan,
    execution_results: executionResults,
    social_publication_results: socialPublicationResults,
    execution_errors: executionErrors,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/run-video-publication-scheduler.mjs [options]',
      '',
      'Options:',
      '  --channels <path>   Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --as-of <ISO>       Deterministic timestamp for queue planning.',
      '  --plan-only         Build the queue plan without executing uploads or schedule updates.',
      '  --reconcile-only    Reconcile YouTube/comments and refresh queue cards; skip preview uploads.',
    ]);
    process.exit(0);
  }

  runVideoPublicationScheduler(options).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.execution_errors.length > 0) {
      process.exitCode = 1;
    }
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
