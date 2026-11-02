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
import {
  adaptBubbleSurvivalTemplateToLandscape,
  bubbleShowdownSubjectKey,
  buildBubbleShowdownLongFormPlan,
  filterUnusedBubbleShowdownSubjects,
  resolveBubbleShowdownDurationConfig,
  selectBubbleShowdownArenaShapeOrder,
  selectBubbleShowdownCategoryOrder,
  shouldAppendBubbleShowdownRound,
} from '../src/domains/pokemon/long-form/bubble-showdown/planner.mjs';
import { assembleBubbleShowdownLongFormVideo } from '../src/domains/pokemon/long-form/bubble-showdown/renderer.mjs';
import {
  selectMixedChallengeIntroPokeballs,
  selectMixedChallengeRoundTransitions,
} from '../src/domains/pokemon/long-form/mixed-challenge/planner.mjs';
import { selectRevealChallengeMusicSchedule } from '../src/domains/pokemon/long-form/reveal-challenge/planner.mjs';
import { resolveBubbleSurvivalCategoryPool } from '../src/domains/pokemon/templates/bubble-survival/category-resolver.mjs';
import { planPokemonBubbleSurvival } from '../src/domains/pokemon/templates/bubble-survival/planner.mjs';
import {
  buildPokeQuizzRenderPlan,
  renderPokeQuizzVideo,
} from '../src/domains/pokemon/templates/bubble-survival/renderer.mjs';
import { scanPokeQuizzAssetInventory } from '../src/poke-quizz-asset-inventory.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';
import { probeMediaDurationSeconds } from '../src/media-duration.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../src/publication-channels.mjs';
import { resolveBaseProductVideoChannelConfigPath } from '../src/product-video-template-routing.mjs';
import { resolveManagedPokeQuizzPreviewOutputPath } from '../src/poke-quizz-preview-storage.mjs';
import { ensurePreferredPokeQuizzCatalogJsonPath } from '../src/poke-quizz-review-paths.mjs';
import { resolvePokeQuizzVoiceRuntime } from '../src/poke-quizz-voice-runtime.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';
import { reviewPokeQuizzPublication } from './poke-quizz/review-publication.mjs';

const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/long/bubble-showdown.v1.json';
const DEFAULT_SHORT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/bubble-survival.v1.json';
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

async function buildMusicCatalog(paths, probeDuration) {
  const uniquePaths = [...new Set((Array.isArray(paths) ? paths : []).map(String).filter(Boolean))];
  const catalog = await Promise.all(uniquePaths.map(async (path) => ({
    path,
    duration_seconds: await probeDuration({ mediaPath: path }),
  })));
  return catalog.filter((entry) => Number(entry.duration_seconds) > 1);
}

function buildRoundSummary(plan, renderResult, roundPlanPath) {
  return {
    round_number: Number(plan?.presentation?.round_number || 0),
    template_key: 'bubble-survival',
    source_template_id: String(plan?.template_id || ''),
    seed: String(plan?.seed || ''),
    category: String(plan?.selection?.category || ''),
    category_label: String(plan?.selection?.category_label || ''),
    arena_shape: String(plan?.simulation?.config?.arena_shape || 'circle'),
    duration_seconds: Number(renderResult?.duration_seconds || 0),
    selected_subjects: plan?.selection?.selected_subjects || [],
    winner: plan?.winner || null,
    segment_path: String(renderResult?.output_path || ''),
    plan_path: roundPlanPath,
  };
}

function chooseRowsForRound({ rows, usedSubjectKeys, category, pokemonCount }) {
  const unusedRows = filterUnusedBubbleShowdownSubjects(rows, usedSubjectKeys, pokemonCount);
  return resolveBubbleSurvivalCategoryPool(unusedRows, category).length >= pokemonCount
    ? unusedRows
    : rows;
}

export async function generatePokemonBubbleShowdownLongFormReview(options = {}) {
  const channelSelector = getStringOption(options, 'channel', DEFAULT_CHANNEL_SELECTOR);
  const templatePath = getStringOption(options, 'template', DEFAULT_TEMPLATE_PATH);
  const shortTemplatePath = getStringOption(options, 'short-template', DEFAULT_SHORT_TEMPLATE_PATH);
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
  const [template, shortTemplate, config, pokedexRows, profiles, inventory] = await Promise.all([
    loadJson(templatePath),
    loadJson(shortTemplatePath),
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
  if (!reviewThreadId) throw new Error(`No Discord review thread is configured for ${channelSelector}.`);

  const ffmpegExecutable = resolveFfmpegExecutable(config.render || config);
  const durationConfig = resolveBubbleShowdownDurationConfig(template);
  const statePath = getStringOption(
    options,
    'state',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-bubble-showdown.state.json`,
  );
  const selectionState = await loadOptionalJson(statePath) || {};
  const categoryOrder = selectBubbleShowdownCategoryOrder({
    poolVariants: shortTemplate?.selection_rules?.pool_variants,
    seed,
    maximumRounds: durationConfig.maximum_rounds,
    previousCategory: selectionState.last_category,
  });
  const arenaShapeOrder = selectBubbleShowdownArenaShapeOrder({
    shapes: template?.round_layout?.arena_shape_pool,
    seed,
    maximumRounds: durationConfig.maximum_rounds,
    previousShape: selectionState.last_arena_shape,
  });
  const runtimeRoot = resolve(
    projectRoot,
    'data/runtime/product-video-agent/pokemon-long-form/bubble-showdown',
    slugify(seed),
  );
  const segmentRoot = resolve(runtimeRoot, 'segments');
  const planRoot = resolve(runtimeRoot, 'plans');
  const usedSubjectKeys = new Set();
  const durationCache = new Map();
  const probeDuration = async ({ mediaPath }) => {
    const path = String(mediaPath || '');
    if (!durationCache.has(path)) {
      durationCache.set(path, probeMediaDurationSeconds({
        ffmpegExecutable,
        mediaPath: path,
        cwd: projectRoot,
      }));
    }
    return durationCache.get(path);
  };
  const plannedRounds = [];
  let currentDuration = durationConfig.intro_seconds + durationConfig.outro_seconds;
  for (const category of categoryOrder) {
    const roundIndex = plannedRounds.length;
    const pokemonCount = Number(shortTemplate?.selection_rules?.pokemon_count || 9);
    const availableRows = template?.episode?.avoid_duplicate_subjects === false
      ? pokedexRows
      : chooseRowsForRound({ rows: pokedexRows, usedSubjectKeys, category, pokemonCount });
    const roundTemplate = adaptBubbleSurvivalTemplateToLandscape({
      shortTemplate,
      longTemplate: template,
      category,
      arenaShape: arenaShapeOrder[roundIndex],
    });
    printInfo(
      `Planning Bubble Showdown round ${roundIndex + 1}: ${category} in ${arenaShapeOrder[roundIndex]}.`,
    );
    const plan = await planPokemonBubbleSurvival({
      template: roundTemplate,
      pokedexRows: availableRows,
      seed: `${seed}:round:${roundIndex + 1}:${category}`,
      assetInventory: inventory,
      probeDuration,
      ffmpegExecutable,
      projectRoot,
    });
    const roundDuration = buildPokeQuizzRenderPlan({ plan }).duration_seconds;
    if (!shouldAppendBubbleShowdownRound({
      currentDurationSeconds: currentDuration,
      nextRoundDurationSeconds: roundDuration,
      currentRoundCount: roundIndex,
      template,
    })) break;
    plannedRounds.push({ plan, template: roundTemplate, duration_seconds: roundDuration });
    for (const subject of plan.selection.selected_subjects) {
      const key = bubbleShowdownSubjectKey(subject);
      if (key) usedSubjectKeys.add(key);
    }
    currentDuration = Number((currentDuration + roundDuration).toFixed(3));
  }
  if (plannedRounds.length < durationConfig.minimum_rounds || currentDuration < durationConfig.minimum_seconds) {
    throw new Error(
      `Bubble Showdown planned ${plannedRounds.length} rounds and ${currentDuration}s; at least ${durationConfig.minimum_rounds} rounds and ${durationConfig.minimum_seconds}s are required.`,
    );
  }

  const generationStartedAt = Date.now();
  const sectionPaths = [];
  const roundSummaries = [];
  for (let index = 0; index < plannedRounds.length; index += 1) {
    const entry = plannedRounds[index];
    const roundNumber = index + 1;
    entry.plan = {
      ...entry.plan,
      content_format: 'long_form_section',
      content_surface: 'youtube_watch',
      presentation: {
        ...(entry.plan.presentation || {}),
        round_number: roundNumber,
        round_total: plannedRounds.length,
        round_label: `ROUND ${roundNumber} / ${plannedRounds.length}`,
        category_label: entry.plan.selection.category_label,
        watermark_enabled: false,
      },
      publication_policy: { watermark_enabled: false },
    };
    const segmentPath = resolve(segmentRoot, `${String(roundNumber).padStart(2, '0')}-${entry.plan.selection.category}.mp4`);
    const roundPlanPath = await writeJson(
      resolve(planRoot, `${String(roundNumber).padStart(2, '0')}-${entry.plan.selection.category}.plan.json`),
      entry.plan,
    );
    const kokoro = resolvePokeQuizzVoiceRuntime({
      config,
      template: entry.template,
      plan: entry.plan,
      projectRoot,
      voiceProfileId: getStringOption(options, 'voice-profile-id', ''),
      voicePython: getStringOption(options, 'voice-python', ''),
      voiceScript: getStringOption(options, 'voice-script', ''),
      voiceCacheDir: getStringOption(options, 'voice-cache-dir', ''),
    });
    printInfo(`Rendering Bubble Showdown round ${roundNumber}/${plannedRounds.length}.`);
    const renderResult = await renderPokeQuizzVideo({
      plan: entry.plan,
      template: entry.template,
      outputPath: segmentPath,
      projectRoot,
      ffmpegExecutable,
      kokoro,
      runtimeRoot: resolve(runtimeRoot, 'render', String(roundNumber)),
      channelProfile,
    });
    sectionPaths.push(renderResult.output_path);
    roundSummaries.push(buildRoundSummary(entry.plan, renderResult, roundPlanPath));
  }

  const plannedTotalDuration = Number((
    durationConfig.intro_seconds
    + roundSummaries.reduce((sum, round) => sum + round.duration_seconds, 0)
    + durationConfig.outro_seconds
  ).toFixed(3));
  const musicCatalog = await buildMusicCatalog(inventory.music, probeDuration);
  const musicSchedule = selectRevealChallengeMusicSchedule({
    tracks: musicCatalog,
    totalDurationSeconds: plannedTotalDuration,
    crossfadeSeconds: template?.audio?.music_crossfade_seconds,
    endingFadeSeconds: template?.audio?.music_ending_fade_seconds,
    seed,
    previousTrackPath: selectionState.last_music_path,
  });
  if (musicSchedule.length === 0) throw new Error('Bubble Showdown long-form requires at least one readable T7 music track.');
  const pokeballs = selectMixedChallengeIntroPokeballs(
    inventory.pokeball_sprites,
    seed,
    Math.max(1, Math.min(roundSummaries.length, inventory.pokeball_sprites.length)),
  );
  const transitions = selectMixedChallengeRoundTransitions(
    [],
    seed,
    roundSummaries.length,
    '',
    template?.layout?.round_transition,
  ).map((transition, index) => ({
    ...transition,
    path: pokeballs[index % Math.max(1, pokeballs.length)]?.path || null,
    direction_multiplier: pokeballs[index % Math.max(1, pokeballs.length)]?.direction_multiplier
      || transition.direction_multiplier,
  }));
  const nextSelectionState = {
    last_category: roundSummaries.at(-1)?.category || null,
    last_arena_shape: roundSummaries.at(-1)?.arena_shape || null,
    last_music_path: musicSchedule.at(-1)?.path || null,
    recent_subject_ids: [...usedSubjectKeys],
  };
  const plan = buildBubbleShowdownLongFormPlan({
    template,
    seed,
    channelProfile,
    rounds: roundSummaries,
    musicSchedule,
    selectionState: nextSelectionState,
  });
  const planPath = getStringOption(
    options,
    'plan-output',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-${slugify(seed)}-bubble-showdown.plan.json`,
  );
  await writeJson(planPath, plan);
  await writeJson(statePath, nextSelectionState);

  const defaultOutput = `${buildPokeQuizzPreviewDirectory(template)}/${slugify(seed)}-bubble-showdown-long-form.mp4`;
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(
    getStringOption(options, 'output', defaultOutput),
  );
  printInfo(`Assembling ${roundSummaries.length} Bubble Showdown rounds (${plan.timing.total_duration_seconds}s).`);
  printInfo(`Output: ${resolvedOutput.outputPath}`);
  const renderResult = await assembleBubbleShowdownLongFormVideo({
    sectionPaths,
    sections: roundSummaries,
    musicSchedule,
    transitions,
    outputPath: resolvedOutput.outputPath,
    template,
    ffmpegExecutable,
    projectRoot,
    runtimeRoot: resolve(runtimeRoot, 'assembly'),
  });
  const generationDurationMinutes = (Date.now() - generationStartedAt) / 60_000;
  const submittedAt = getStringOption(options, 'as-of', new Date().toISOString());
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
    genreLabel: 'Long-form Bubble Showdown',
    submittedAt,
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
    round_count: plan.selection.round_count,
    categories: plan.selection.categories,
    content_surface: plan.content_surface,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/generate-pokemon-bubble-showdown-long-form-review.mjs [options]',
      '',
      'Builds a native 16:9, multi-round Bubble Showdown and posts it through the',
      'existing Pokemon publication review pipeline.',
      '',
      'Options:',
      '  --channel <selector>       Pokemon channel. Default: poke-quizz-youtube',
      '  --thread-id <id>           Optional Discord review thread override.',
      '  --seed <text>              Deterministic episode seed. Default: current timestamp.',
      '  --catalog-json <path>      Localized Pokedex JSON override.',
      '  --template <path>          Long-form Bubble Showdown template JSON override.',
      '  --short-template <path>    Shared short-form Bubble Showdown template override.',
      '  --plan-output <path>       Episode plan JSON output.',
      '  --state <path>             Per-channel Bubble Showdown selection state.',
      '  --output <path>            Rendered MP4 output.',
      '  --title <text>             Publication title override.',
      '  --description <text>       Publication description override.',
    ]);
    return;
  }
  const result = await generatePokemonBubbleShowdownLongFormReview(options);
  printInfo(`Posted Bubble Showdown review ${result.task_id} to Discord thread ${result.thread_id}.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
