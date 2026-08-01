#!/usr/bin/env node

import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../scripts/lib/supabase-bridge-api.mjs';
import { buildPublicationQueuePlan } from '../src/publication-queue.mjs';
import { loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import { runLocalProcess } from '../src/process-runner.mjs';
import {
  buildYoutubePreviewUploadPlan,
  buildYoutubeScheduleUpdatePlan,
} from '../src/youtube-publication.mjs';

export async function loadQueuedPublications(runtimeEnv, options = {}) {
  const fetchJsonImpl = options.fetchJson || fetchJson;
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/video_publications', supabaseUrl);
  url.searchParams.set('select', '*');
  url.searchParams.set('order', 'created_at.asc');
  return fetchJsonImpl(url.toString(), {
    method: 'GET',
    headers: createHeaders(apiKey),
  });
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
}, options = {}) {
  const runProcess = options.runProcess || runLocalProcess;
  const executable = options.executable || process.execPath;
  const scriptPath = options.scriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/execute-youtube-publication.mjs');
  const args = [
    scriptPath,
    '--channel',
    channelSelector,
    '--channels',
    channelsPath,
    '--as-of',
    asOf,
  ];
  if (scheduleApproved) {
    args.push('--schedule-approved');
  }

  const result = await runProcess({
    executable,
    args,
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
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const loadPublications = dependencies.loadQueuedPublications || loadQueuedPublications;
  const executePhase = dependencies.executePublicationPhase || executePublicationPhase;
  const profiles = await loadProfiles(channelsPath, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const publications = await loadPublications(runtimeConfig.env || {}, { fetchJson: dependencies.fetchJson || fetchJson });
  const queuePlan = buildPublicationQueuePlan({
    publications,
    channelProfiles: activeProfiles,
    asOf,
  });
  const youtubeApiPlan = buildYoutubeApiPlan(queuePlan, profiles, publications);
  const executionResults = [];

  if (!planOnly) {
    for (const profile of activeProfiles) {
      const previewUploadResults = await executePhase({
        channelSelector: profile.account_key,
        channelsPath,
        asOf,
        scheduleApproved: false,
      }, {
        runProcess: dependencies.runProcess,
        executable: dependencies.executable,
        scriptPath: dependencies.scriptPath,
      });
      const scheduleUpdateResults = await executePhase({
        channelSelector: profile.account_key,
        channelsPath,
        asOf,
        scheduleApproved: true,
      }, {
        runProcess: dependencies.runProcess,
        executable: dependencies.executable,
        scriptPath: dependencies.scriptPath,
      });
      executionResults.push({
        channel: {
          id: profile.id,
          name: profile.name,
          account_key: profile.account_key,
        },
        preview_upload_results: previewUploadResults,
        schedule_update_results: scheduleUpdateResults,
      });
      printInfo(
        `Processed ${profile.account_key}: ${previewUploadResults.length} preview upload(s), `
        + `${scheduleUpdateResults.length} schedule update(s).`
      );
    }
  }

  return {
    queue_plan: queuePlan,
    youtube_api_plan: youtubeApiPlan,
    execution_results: executionResults,
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
    ]);
    process.exit(0);
  }

  runVideoPublicationScheduler(options).then((result) => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
