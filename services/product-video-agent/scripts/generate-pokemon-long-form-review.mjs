#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { planUltimatePokemonQuiz } from '../src/domains/pokemon/long-form/ultimate-quiz/planner.mjs';
import { renderUltimatePokemonQuiz } from '../src/domains/pokemon/long-form/ultimate-quiz/renderer.mjs';
import { buildLandscapeBackgroundCatalog } from '../src/domains/pokemon/long-form/media-catalog.mjs';
import { scanPokeQuizzAssetInventory } from '../src/poke-quizz-asset-inventory.mjs';
import { resolveManagedPokeQuizzPreviewOutputPath } from '../src/poke-quizz-preview-storage.mjs';
import { ensurePreferredPokeQuizzCatalogJsonPath } from '../src/poke-quizz-review-paths.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../src/publication-channels.mjs';
import { resolveBaseProductVideoChannelConfigPath } from '../src/product-video-template-routing.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';
import { resolvePokeQuizzVoiceRuntime } from '../src/poke-quizz-voice-runtime.mjs';
import { reviewPokeQuizzPublication } from './poke-quizz/review-publication.mjs';

const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/long/ultimate-quiz.v1.json';
const DEFAULT_CONFIG_PATH = 'services/product-video-agent/config.example.json';
const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';

async function loadJson(filePath) {
  return JSON.parse(await readFile(resolve(projectRoot, filePath), 'utf8'));
}

async function loadOptionalJson(filePath) {
  try {
    await access(resolve(projectRoot, filePath));
    return loadJson(filePath);
  } catch {
    return null;
  }
}

async function writeJson(filePath, value) {
  const absolutePath = resolve(projectRoot, filePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return absolutePath;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

export async function generatePokemonLongFormReview(options = {}) {
  const channelSelector = getStringOption(options, 'channel', DEFAULT_CHANNEL_SELECTOR);
  const templatePath = getStringOption(options, 'template', DEFAULT_TEMPLATE_PATH);
  const configPath = getStringOption(options, 'config', DEFAULT_CONFIG_PATH);
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const channelConfigPath = getStringOption(
    options,
    'channel-config',
    resolveBaseProductVideoChannelConfigPath(channelSelector),
  );
  if (!channelConfigPath) throw new Error(`Unknown Pokemon channel: ${channelSelector}`);
  const seed = getStringOption(options, 'seed', new Date().toISOString());
  const catalogJsonPath = getStringOption(
    options,
    'catalog-json',
    await ensurePreferredPokeQuizzCatalogJsonPath(),
  );
  if (!catalogJsonPath) throw new Error('No localized Pokemon catalog JSON could be found.');

  const runtimeConfig = loadRuntimeConfig();
  const [template, config, pokedexRows, profiles, inventory] = await Promise.all([
    loadJson(templatePath),
    loadJson(configPath),
    loadJson(catalogJsonPath),
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    scanPokeQuizzAssetInventory(),
  ]);
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const reviewThreadId = getStringOption(
    options,
    'thread-id',
    resolvePublicationReviewThreadId(runtimeConfig, channelProfile),
  );
  if (!reviewThreadId) {
    throw new Error(`No Discord review thread is configured for ${channelSelector}.`);
  }
  const ffmpegExecutable = resolveFfmpegExecutable(config.render || config);
  const backgroundCandidates = inventory.pixel_backgrounds.length > 0
    ? inventory.pixel_backgrounds
    : inventory.backgrounds;
  printInfo(`Inspecting ${backgroundCandidates.length} background(s) for landscape eligibility.`);
  const landscapeCatalog = await buildLandscapeBackgroundCatalog({
    filePaths: backgroundCandidates,
    ffmpegExecutable,
    cwd: projectRoot,
    minimumWidth: Number(template?.assets?.minimum_background_width || 1280),
    minimumHeight: Number(template?.assets?.minimum_background_height || 720),
    minimumAspectRatio: Number(template?.assets?.minimum_background_aspect_ratio || 1.4),
  });
  printInfo(`Found ${landscapeCatalog.eligible.length} eligible landscape background(s).`);

  const statePath = getStringOption(
    options,
    'state',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-ultimate-quiz.state.json`,
  );
  const selectionState = await loadOptionalJson(statePath);
  const plan = await planUltimatePokemonQuiz({
    template,
    pokedexRows,
    seed,
    channelProfile,
    inventory,
    landscapeBackgrounds: landscapeCatalog.eligible,
    selectionState,
  });
  const planPath = getStringOption(
    options,
    'plan-output',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-${slugify(seed)}.plan.json`,
  );
  await writeJson(planPath, plan);
  await writeJson(statePath, plan.selection_state);

  const defaultOutput = `${plan.assets.outputs.previews_directory}/${slugify(seed)}.mp4`;
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(
    getStringOption(options, 'output', defaultOutput),
  );
  const kokoro = resolvePokeQuizzVoiceRuntime({
    config,
    template,
    plan,
    projectRoot,
    voiceProfileId: getStringOption(options, 'voice-profile-id', ''),
    voicePython: getStringOption(options, 'voice-python', ''),
    voiceScript: getStringOption(options, 'voice-script', ''),
    voiceCacheDir: getStringOption(options, 'voice-cache-dir', ''),
  });
  printInfo(`Rendering ${plan.timing.total_duration_seconds}s Ultimate Pokemon Quiz.`);
  printInfo(`Output: ${resolvedOutput.outputPath}`);
  const startedAt = Date.now();
  const renderResult = await renderUltimatePokemonQuiz({
    plan,
    template,
    outputPath: resolvedOutput.outputPath,
    projectRoot,
    ffmpegExecutable,
    kokoro,
    runtimeRoot: resolve(projectRoot, 'data/runtime/product-video-agent/pokemon-long-form/render'),
  });
  const generationDurationMinutes = (Date.now() - startedAt) / 60_000;
  printInfo(`Rendered long-form preview to ${renderResult.output_path}`);

  const reviewResult = await reviewPokeQuizzPublication({
    planPath,
    reviewThreadId,
    renderPath: renderResult.output_path,
    catalogJsonPath,
    channelsPath,
    channelConfigPath,
    configPath,
    templatePath,
    channelSelector,
    genreLabel: 'Long-form Ultimate Quiz',
    submittedAt: new Date().toISOString(),
    title: getStringOption(options, 'title', plan.publication.title),
    description: getStringOption(options, 'description', plan.publication.description),
    hashtags: plan.publication.hashtags,
    localModel: false,
    generationDurationMinutes,
  });
  return {
    ...reviewResult,
    plan_path: planPath,
    state_path: statePath,
    output_path: renderResult.output_path,
    duration_seconds: plan.timing.total_duration_seconds,
    content_surface: plan.content_surface,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/generate-pokemon-long-form-review.mjs [options]',
      '',
      'Options:',
      '  --channel <selector>       Pokemon channel. Default: poke-quizz-youtube',
      '  --thread-id <id>           Optional Discord review thread override.',
      '  --seed <text>              Deterministic episode seed. Default: current timestamp.',
      '  --catalog-json <path>      Localized Pokedex JSON override.',
      '  --template <path>          Long-form template JSON override.',
      '  --plan-output <path>       Episode plan JSON output.',
      '  --state <path>             Per-channel long-form selection state.',
      '  --output <path>            Rendered MP4 output.',
      '  --title <text>             Publication title override.',
      '  --description <text>       Publication description override.',
    ]);
    return;
  }
  const result = await generatePokemonLongFormReview(options);
  printInfo(`Posted long-form review ${result.task_id} to Discord thread ${result.thread_id}.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
