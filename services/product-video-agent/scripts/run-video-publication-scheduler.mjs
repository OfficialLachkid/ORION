#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { createHeaders, fetchJson, getRuntimeApiKey } from '../../../scripts/lib/supabase-bridge-api.mjs';
import { buildPublicationQueuePlan } from '../src/publication-queue.mjs';
import { loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import {
  buildYoutubePreviewUploadPlan,
  buildYoutubeScheduleUpdatePlan,
} from '../src/youtube-publication.mjs';

async function loadQueuedPublications(runtimeEnv) {
  const supabaseUrl = runtimeEnv.SUPABASE_URL || '';
  const apiKey = getRuntimeApiKey(runtimeEnv);
  if (!supabaseUrl || !apiKey) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/video_publications', supabaseUrl);
  url.searchParams.set('select', '*');
  url.searchParams.set('order', 'created_at.asc');
  return fetchJson(url.toString(), {
    method: 'GET',
    headers: createHeaders(apiKey),
  });
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
    ]);
    process.exit(0);
  }

  const runtimeConfig = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(
    getStringOption(options, 'channels', 'services/product-video-agent/publication-channels.example.json'),
    { projectRoot },
  );
  const publications = await loadQueuedPublications(runtimeConfig.env || {});
  const queuePlan = buildPublicationQueuePlan({
    publications,
    channelProfiles: profiles.filter((profile) => profile.status === 'active'),
    asOf: getStringOption(options, 'as-of', new Date().toISOString()),
  });

  const youtubeApiPlan = queuePlan.channels.map((channelQueue) => {
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

  process.stdout.write(`${JSON.stringify({
    queue_plan: queuePlan,
    youtube_api_plan: youtubeApiPlan,
  }, null, 2)}\n`);
}
