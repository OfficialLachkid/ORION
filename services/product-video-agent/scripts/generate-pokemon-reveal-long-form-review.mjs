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
  adaptPokemonShortTemplateToLandscape,
} from '../src/domains/pokemon/long-form/landscape-template-adapter.mjs';
import { buildLandscapeBackgroundCatalog } from '../src/domains/pokemon/long-form/media-catalog.mjs';
import {
  selectMixedChallengeIntroPokeballs,
  selectMixedChallengeRoundTransitions,
} from '../src/domains/pokemon/long-form/mixed-challenge/planner.mjs';
import {
  assignRevealChallengeBackgrounds,
  buildRevealChallengePlan,
  filterUnusedRevealSubjects,
  resolveRevealChallengeDurationConfig,
  revealSubjectKey,
  selectNextRevealTemplateSpec,
  selectRevealChallengeMusicSchedule,
  shouldAppendRevealSection,
} from '../src/domains/pokemon/long-form/reveal-challenge/planner.mjs';
import { listRevealChallengeTemplateSpecs } from '../src/domains/pokemon/long-form/reveal-challenge/registry.mjs';
import { assembleRevealChallengeVideo } from '../src/domains/pokemon/long-form/reveal-challenge/renderer.mjs';
import { renderSmoothLandscapeBackground } from '../src/domains/pokemon/long-form/smooth-background-renderer.mjs';
import { probeMediaDurationSeconds } from '../src/domains/pokemon/templates/dual-type-reveal/render/media-probe.mjs';
import { buildPokeQuizzRenderPlan, renderPokeQuizzVideo } from '../src/poke-quizz-renderer.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';
import { scanPokeQuizzAssetInventory } from '../src/poke-quizz-asset-inventory.mjs';
import { resolveManagedPokeQuizzPreviewOutputPath } from '../src/poke-quizz-preview-storage.mjs';
import { ensurePreferredPokeQuizzCatalogJsonPath } from '../src/poke-quizz-review-paths.mjs';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../src/publication-channels.mjs';
import { resolveBaseProductVideoChannelConfigPath } from '../src/product-video-template-routing.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';
import { resolvePokeQuizzVoiceRuntime } from '../src/poke-quizz-voice-runtime.mjs';
import { reviewPokeQuizzPublication } from './poke-quizz/review-publication.mjs';

const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/long/reveal-challenge.v1.json';
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

function withLandscapeBackground(plan, backgroundPath, sourceBackgroundPath, startSeconds = 0) {
  return {
    ...plan,
    content_format: 'long_form_section',
    content_surface: 'youtube_watch',
    presentation: {
      ...(plan?.presentation || {}),
      watermark_enabled: false,
    },
    publication_policy: {
      ...(plan?.publication_policy || {}),
      watermark_enabled: false,
    },
    assets: {
      ...(plan?.assets || {}),
      background: {
        ...(plan?.assets?.background || {}),
        source_path: sourceBackgroundPath,
        selected_path: backgroundPath,
        start_seconds: Number(startSeconds || 0),
      },
      audio: {
        ...(plan?.assets?.audio || {}),
        selected_battle_intro_music_path: null,
      },
    },
  };
}

function buildSectionSummary(entry, renderResult, segmentPath, planPath) {
  return {
    section_number: entry.section_index + 1,
    template_key: entry.spec.key,
    source_template_id: String(entry.plan?.template_id || ''),
    seed: String(entry.plan?.seed || ''),
    duration_seconds: Number(renderResult?.render_plan?.total_duration_seconds || 0),
    round_count: Array.isArray(entry.plan?.rounds) ? entry.plan.rounds.length : 0,
    reveal_methods: entry.plan?.selection?.reveal_methods || [],
    selected_subjects: entry.plan?.selection?.selected_subjects || [],
    background_group: entry.background_group,
    background_source_path: entry.background_source_path,
    background_render_path: entry.background_render_path,
    background_start_seconds: entry.background_start_seconds,
    segment_path: segmentPath,
    plan_path: planPath,
    previews_directory: String(entry.plan?.assets?.outputs?.previews_directory || ''),
  };
}

async function buildMusicCatalog(paths, ffmpegExecutable) {
  const entries = await Promise.all([...new Set(paths)].map(async (path) => ({
    path,
    duration_seconds: await probeMediaDurationSeconds({
      ffmpegExecutable,
      mediaPath: path,
      cwd: projectRoot,
    }),
  })));
  return entries.filter((entry) => Number(entry.duration_seconds) > 1);
}

export async function generatePokemonRevealLongFormReview(options = {}) {
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

  const revealSpecs = listRevealChallengeTemplateSpecs();
  const runtimeConfig = loadRuntimeConfig();
  const [template, config, pokedexRows, profiles, inventory, sourceTemplates] = await Promise.all([
    loadJson(templatePath),
    loadJson(configPath),
    loadJson(catalogJsonPath),
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    scanPokeQuizzAssetInventory(),
    Promise.all(revealSpecs.map(async (spec) => ({
      spec,
      template: await loadJson(spec.path),
    }))),
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
  const backgroundCatalog = await buildLandscapeBackgroundCatalog({
    filePaths: backgroundCandidates,
    ffmpegExecutable,
    cwd: projectRoot,
    minimumWidth: Number(template?.assets?.minimum_background_width || 1280),
    minimumHeight: Number(template?.assets?.minimum_background_height || 720),
    minimumAspectRatio: Number(template?.assets?.minimum_background_aspect_ratio || 1.4),
  });
  if (backgroundCatalog.eligible.length === 0) {
    throw new Error('No eligible landscape Pokemon backgrounds were found.');
  }
  printInfo(`Found ${backgroundCatalog.eligible.length} eligible landscape background(s).`);

  const statePath = getStringOption(
    options,
    'state',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-reveal-challenge.state.json`,
  );
  const selectionState = await loadOptionalJson(statePath) || { templates: {} };
  const nextSelectionState = {
    ...selectionState,
    templates: { ...(selectionState.templates || {}) },
  };
  const runtimeRoot = resolve(
    projectRoot,
    'data/runtime/product-video-agent/pokemon-long-form/reveal-challenge',
    slugify(seed),
  );
  const segmentRoot = resolve(runtimeRoot, 'segments');
  const backgroundRoot = resolve(runtimeRoot, 'backgrounds');
  const planRoot = resolve(runtimeRoot, 'plans');
  const sourceTemplateByKey = new Map(
    sourceTemplates.map((entry) => [entry.spec.key, entry.template]),
  );
  const duration = resolveRevealChallengeDurationConfig(template);
  const usedSubjectKeys = new Set();
  const usageCounts = {};
  const plannedEntries = [];
  let currentDuration = duration.intro_seconds + duration.outro_seconds;
  let previousTemplateKey = String(selectionState.last_template_key || '');

  while (plannedEntries.length < 24 && currentDuration < duration.target_seconds) {
    const spec = selectNextRevealTemplateSpec({
      specs: revealSpecs,
      template,
      seed,
      sectionIndex: plannedEntries.length,
      previousTemplateKey,
      usageCounts,
    });
    const sourceTemplate = sourceTemplateByKey.get(spec.key);
    const sectionTemplate = adaptPokemonShortTemplateToLandscape(sourceTemplate);
    sectionTemplate.layout.text.show_counter = true;
    if (plannedEntries.length > 0) {
      sectionTemplate.layout.rounds = {
        ...(sectionTemplate.layout.rounds || {}),
        show_first_reveal_immediately: true,
      };
    }
    const roundCount = Math.max(1, Number(sectionTemplate?.selection_rules?.round_count) || 1);
    const availableRows = template?.episode?.avoid_duplicate_subjects === false
      ? pokedexRows
      : filterUnusedRevealSubjects(pokedexRows, usedSubjectKeys, roundCount);
    const sectionIndex = plannedEntries.length;
    const sectionSeed = `${seed}:section:${sectionIndex + 1}:${spec.key}`;
    printInfo(`Planning reveal section ${sectionIndex + 1}: ${spec.key}.`);
    let plan = await planPokemonTypeChallenge({
      template: sectionTemplate,
      pokedexRows: availableRows,
      seed: sectionSeed,
      assetInventory: inventory,
      selectionState: nextSelectionState.templates[spec.key] || null,
      channelProfile,
    });
    if (sectionIndex > 0 && template?.episode?.repeat_hook_narration === false) {
      plan = { ...plan, narration: { ...(plan.narration || {}), lines: [] } };
    }
    plan = {
      ...plan,
      assets: {
        ...plan.assets,
        audio: {
          ...plan.assets.audio,
          selected_battle_intro_music_path: null,
        },
      },
    };
    const renderPlan = buildPokeQuizzRenderPlan({
      plan,
      template: sectionTemplate,
      outputPath: resolve(segmentRoot, `${String(sectionIndex + 1).padStart(2, '0')}-${spec.key}.mp4`),
    });
    const sectionDuration = Number(renderPlan.total_duration_seconds || 0);
    if (!shouldAppendRevealSection({
      currentDurationSeconds: currentDuration,
      nextSectionDurationSeconds: sectionDuration,
      template,
    })) {
      break;
    }
    plannedEntries.push({
      section_index: sectionIndex,
      spec,
      template: sectionTemplate,
      plan,
      duration_seconds: sectionDuration,
    });
    for (const subject of plan?.selection?.selected_subjects || []) {
      const key = revealSubjectKey(subject);
      if (key) usedSubjectKeys.add(key);
    }
    nextSelectionState.templates[spec.key] = plan.selection_state || {};
    usageCounts[spec.key] = Number(usageCounts[spec.key] || 0) + 1;
    previousTemplateKey = spec.key;
    currentDuration = Number((currentDuration + sectionDuration).toFixed(3));
  }
  if (currentDuration < duration.minimum_seconds || plannedEntries.length === 0) {
    throw new Error(`Reveal challenge duration ${currentDuration}s did not reach ${duration.minimum_seconds}s.`);
  }

  const entriesWithBackgrounds = assignRevealChallengeBackgrounds({
    sections: plannedEntries,
    backgrounds: backgroundCatalog.eligible,
    template,
    seed,
    previousBackgroundPath: selectionState.last_background_path,
  });
  const totalRoundCount = entriesWithBackgrounds.reduce(
    (sum, entry) => sum + (entry.plan?.rounds?.length || 0),
    0,
  );
  let globalRoundNumber = 1;
  entriesWithBackgrounds.forEach((entry) => {
    entry.plan.rounds = entry.plan.rounds.map((round) => ({
      ...round,
      round_label: `${globalRoundNumber++}/${totalRoundCount}`,
    }));
  });

  const sectionPaths = [];
  const sectionSummaries = [];
  const generationStartedAt = Date.now();
  const backgroundGroups = new Map();
  for (const entry of entriesWithBackgrounds) {
    const group = backgroundGroups.get(entry.background_group) || [];
    group.push(entry);
    backgroundGroups.set(entry.background_group, group);
  }
  for (const [groupNumber, group] of backgroundGroups) {
    const backgroundPath = resolve(
      backgroundRoot,
      `group-${String(groupNumber).padStart(2, '0')}.mp4`,
    );
    const groupDuration = group.reduce(
      (sum, entry) => sum + Number(entry.duration_seconds || 0),
      0,
    );
    printInfo(`Rendering continuous background ${groupNumber}/${backgroundGroups.size}.`);
    await renderSmoothLandscapeBackground({
      sourcePath: group[0].background_source_path,
      outputPath: backgroundPath,
      durationSeconds: Number((groupDuration + 1).toFixed(3)),
      template,
      sectionIndex: groupNumber - 1,
      ffmpegExecutable,
      projectRoot,
    });
    let startSeconds = 0;
    for (const entry of group) {
      entry.background_render_path = backgroundPath;
      entry.background_start_seconds = Number(startSeconds.toFixed(3));
      startSeconds += Number(entry.duration_seconds || 0);
    }
  }
  for (const entry of entriesWithBackgrounds) {
    const sectionNumber = entry.section_index + 1;
    const segmentPath = resolve(
      segmentRoot,
      `${String(sectionNumber).padStart(2, '0')}-${entry.spec.key}.mp4`,
    );
    entry.plan = withLandscapeBackground(
      entry.plan,
      entry.background_render_path,
      entry.background_source_path,
      entry.background_start_seconds,
    );
    const sectionPlanPath = await writeJson(
      resolve(planRoot, `${String(sectionNumber).padStart(2, '0')}-${entry.spec.key}.plan.json`),
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
    printInfo(`Rendering reveal section ${sectionNumber}/${entriesWithBackgrounds.length}: ${entry.spec.key}.`);
    const renderResult = await renderPokeQuizzVideo({
      plan: entry.plan,
      template: entry.template,
      outputPath: segmentPath,
      projectRoot,
      ffmpegExecutable,
      kokoro,
      runtimeRoot: resolve(runtimeRoot, 'render', `${sectionNumber}-${entry.spec.key}`),
      channelProfile,
    });
    sectionPaths.push(renderResult.output_path);
    sectionSummaries.push(buildSectionSummary(
      entry,
      renderResult,
      renderResult.output_path,
      sectionPlanPath,
    ));
  }

  const plannedTotalDuration = Number((
    duration.intro_seconds
    + sectionSummaries.reduce((sum, section) => sum + section.duration_seconds, 0)
    + duration.outro_seconds
  ).toFixed(3));
  const musicCatalog = await buildMusicCatalog(inventory.music || [], ffmpegExecutable);
  const musicSchedule = selectRevealChallengeMusicSchedule({
    tracks: musicCatalog,
    totalDurationSeconds: plannedTotalDuration,
    crossfadeSeconds: template?.audio?.music_crossfade_seconds,
    endingFadeSeconds: template?.audio?.music_ending_fade_seconds,
    seed,
    previousTrackPath: selectionState.last_music_path,
  });
  const pokeballs = selectMixedChallengeIntroPokeballs(
    inventory.pokeball_sprites,
    seed,
    Math.max(1, Math.min(entriesWithBackgrounds.length, inventory.pokeball_sprites.length)),
  );
  const transitions = selectMixedChallengeRoundTransitions(
    [],
    seed,
    entriesWithBackgrounds.length,
    '',
    template?.layout?.round_transition,
  ).map((transition, index) => ({
    ...transition,
    path: pokeballs[index % Math.max(1, pokeballs.length)]?.path || null,
    direction_multiplier: pokeballs[index % Math.max(1, pokeballs.length)]?.direction_multiplier
      || transition.direction_multiplier,
  }));
  nextSelectionState.last_template_key = previousTemplateKey;
  nextSelectionState.last_background_path = entriesWithBackgrounds.at(-1)?.background_source_path || null;
  nextSelectionState.last_music_path = musicSchedule.at(-1)?.path || null;

  const plan = buildRevealChallengePlan({
    template,
    seed,
    channelProfile,
    sections: sectionSummaries,
    musicSchedule,
    selectionState: nextSelectionState,
  });
  const planPath = getStringOption(
    options,
    'plan-output',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-${slugify(seed)}-reveal-challenge.plan.json`,
  );
  await writeJson(planPath, plan);
  await writeJson(statePath, nextSelectionState);

  const defaultOutput = `${buildPokeQuizzPreviewDirectory(template)}/${slugify(seed)}-reveal-challenge-long-form.mp4`;
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(
    getStringOption(options, 'output', defaultOutput),
  );
  printInfo(`Assembling ${sectionPaths.length} reveal sections (${plan.timing.total_duration_seconds}s).`);
  printInfo(`Output: ${resolvedOutput.outputPath}`);
  const renderResult = await assembleRevealChallengeVideo({
    sectionPaths,
    sections: plan.sections,
    musicSchedule,
    transitions,
    outputPath: resolvedOutput.outputPath,
    template,
    ffmpegExecutable,
    projectRoot,
    runtimeRoot: resolve(runtimeRoot, 'assembly'),
  });
  const generationDurationMinutes = (Date.now() - generationStartedAt) / 60_000;
  printInfo(`Rendered reveal-only long-form preview to ${renderResult.output_path}`);

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
    genreLabel: 'Long-form Pokemon Reveal Challenge',
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
    section_template_keys: plan.selection.template_keys,
    reveal_methods: plan.selection.reveal_methods,
    content_surface: plan.content_surface,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/generate-pokemon-reveal-long-form-review.mjs [options]',
      '',
      'Builds a 6-10 minute native 16:9 Pokemon reveal challenge from the shared',
      'Progressive Reveal and Pixelated Reveal Short planners and renderers.',
      '',
      'Options:',
      '  --channel <selector>       Pokemon channel. Default: poke-quizz-youtube',
      '  --thread-id <id>           Optional Discord review thread override.',
      '  --seed <text>              Deterministic episode seed. Default: current timestamp.',
      '  --catalog-json <path>      Localized Pokedex JSON override.',
      '  --template <path>          Reveal challenge template JSON override.',
      '  --plan-output <path>       Episode plan JSON output.',
      '  --state <path>             Per-channel reveal challenge selection state.',
      '  --output <path>            Rendered MP4 output.',
      '  --title <text>             Publication title override.',
      '  --description <text>       Publication description override.',
    ]);
    return;
  }
  const result = await generatePokemonRevealLongFormReview(options);
  printInfo(`Posted reveal challenge review ${result.task_id} to Discord thread ${result.thread_id}.`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
