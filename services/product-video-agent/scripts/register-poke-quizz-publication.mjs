#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { loadPipelineConfig } from '../src/config.mjs';
import { generatePokeQuizzPublicationMetadata } from '../src/local-publication-metadata.mjs';
import {
  createPokeQuizzPublicationRegistration,
  mergeRegisteredPublicationRow,
} from '../src/poke-quizz-publication-registration.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../src/publication-store.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';

function parseHashtags(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

async function loadJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/register-poke-quizz-publication.mjs [options]',
      '',
      'Options:',
      '  --plan <path>              Required Poke Quizz plan JSON path.',
      '  --render <path>            Optional rendered MP4 path. Default: derived from the plan output convention.',
      '  --channel <id>             Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>          Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --config <path>            Product-video config JSON. Default: services/product-video-agent/config.example.json',
      '  --title <text>             Override generated title.',
      '  --description <text>       Override generated description.',
      '  --hashtags <a,b,c>         Override generated hashtags.',
      '  --no-local-model           Skip local Ollama metadata generation and use the deterministic fallback.',
      '  --as-of <ISO>              Registration timestamp. Default: now.',
    ]);
    return;
  }

  const planPath = getStringOption(options, 'plan', '');
  if (!planPath) {
    throw new Error('The --plan option is required.');
  }

  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const configPath = getStringOption(
    options,
    'config',
    'services/product-video-agent/config.example.json',
  );
  const channelSelector = getStringOption(options, 'channel', 'poke-quizz-youtube');
  const registeredAt = getStringOption(options, 'as-of', new Date().toISOString());
  const [plan, profiles, config] = await Promise.all([
    loadJson(planPath),
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    loadPipelineConfig(configPath, projectRoot),
  ]);
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const runtimeConfig = loadRuntimeConfig();
  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });

  let metadata = getBooleanOption(options, 'local-model', true)
    ? await generatePokeQuizzPublicationMetadata({
      plan,
      config,
      channelProfile,
    })
    : null;

  if (getStringOption(options, 'title', '')) {
    metadata = {
      ...(metadata || {}),
      title: getStringOption(options, 'title', ''),
    };
  }
  if (getStringOption(options, 'description', '')) {
    metadata = {
      ...(metadata || {}),
      description: getStringOption(options, 'description', ''),
    };
  }
  if (getStringOption(options, 'hashtags', '')) {
    metadata = {
      ...(metadata || {}),
      hashtags: parseHashtags(getStringOption(options, 'hashtags', '')),
    };
  }

  if (!metadata?.title || !metadata?.description || !Array.isArray(metadata?.hashtags) || metadata.hashtags.length === 0) {
    throw new Error('Publication metadata could not be resolved. Provide explicit title/description/hashtags or enable the local model fallback.');
  }

  if (metadata.generation_error) {
    printWarn(`Local metadata generation fell back to the deterministic template: ${metadata.generation_error}`);
  }

  const registration = await createPokeQuizzPublicationRegistration({
    plan,
    channelProfile,
    renderPath: getStringOption(options, 'render', ''),
    metadata,
    registeredAt,
  });
  const existingPublication = await store.fetchPublicationById(registration.publicationRow.id);
  const mergedPublication = mergeRegisteredPublicationRow(existingPublication, registration.publicationRow);

  await store.upsertChannelProfile(channelProfile);
  await store.upsertVideo(registration.videoRow);
  const savedPublication = await store.upsertPublication(mergedPublication);

  printInfo(`Registered Poke Quizz publication ${savedPublication?.id || mergedPublication.id} for ${channelProfile.account_key}.`);
  process.stdout.write(`${JSON.stringify({
    video_id: registration.videoRow.id,
    publication_id: savedPublication?.id || mergedPublication.id,
    render_path: registration.videoRow.render.output_path,
    workflow_state: savedPublication?.metadata?.workflow_state || mergedPublication.metadata.workflow_state,
    title: mergedPublication.title,
    description: mergedPublication.description,
    hashtags: mergedPublication.hashtags,
    generation_provider: metadata.generation_provider,
    generation_model: metadata.model,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
