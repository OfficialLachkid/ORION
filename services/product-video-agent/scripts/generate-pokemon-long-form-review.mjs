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
  LANDSCAPE_POKEMON_TEMPLATE_SPECS,
} from '../src/domains/pokemon/long-form/landscape-template-adapter.mjs';
import {
  buildMixedChallengePlan,
  orderLandscapeTemplateSpecs,
  selectLandscapeBackground,
  selectMixedChallengeIntroMusic,
  selectMixedChallengeIntroPokeballs,
  selectMixedChallengeRoundTransitions,
} from '../src/domains/pokemon/long-form/mixed-challenge/planner.mjs';
import { assembleMixedChallengeVideo } from '../src/domains/pokemon/long-form/mixed-challenge/renderer.mjs';
import { buildLandscapeBackgroundCatalog } from '../src/domains/pokemon/long-form/media-catalog.mjs';
import { renderSmoothLandscapeBackground } from '../src/domains/pokemon/long-form/smooth-background-renderer.mjs';
import { probeMediaDurationSeconds } from '../src/domains/pokemon/templates/dual-type-reveal/render/media-probe.mjs';
import { buildPokeQuizzRenderPlan, renderPokeQuizzVideo } from '../src/poke-quizz-renderer.mjs';
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

const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/config/templates/pokemon/long/mixed-challenge.v1.json';
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

function resolveSectionState(selectionState, templateKey) {
  return selectionState?.sections?.[templateKey] || null;
}

function withLandscapeBackground(plan, backgroundPath, sourceBackgroundPath) {
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
      },
    },
  };
}

function buildSectionSummary({
  sectionIndex,
  templateKey,
  plan,
  renderResult,
  sourceBackground,
  renderedBackgroundPath,
  segmentPath,
  planPath,
}) {
  return {
    section_number: sectionIndex + 1,
    template_key: templateKey,
    source_template_id: String(plan?.template_id || ''),
    seed: String(plan?.seed || ''),
    duration_seconds: Number(renderResult?.render_plan?.total_duration_seconds || 0),
    selected_subjects: plan?.selection?.selected_subjects || [],
    background_source_path: sourceBackground?.path || '',
    background_render_path: renderedBackgroundPath,
    segment_path: segmentPath,
    plan_path: planPath,
    previews_directory: String(plan?.assets?.outputs?.previews_directory || ''),
    selected_music_path: String(plan?.assets?.audio?.selected_battle_intro_music_path || ''),
  };
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
  const [template, config, pokedexRows, profiles, inventory, baseTemplates] = await Promise.all([
    loadJson(templatePath),
    loadJson(configPath),
    loadJson(catalogJsonPath),
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    scanPokeQuizzAssetInventory(),
    Promise.all(LANDSCAPE_POKEMON_TEMPLATE_SPECS.map(async (spec) => ({
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
  const landscapeCatalog = await buildLandscapeBackgroundCatalog({
    filePaths: backgroundCandidates,
    ffmpegExecutable,
    cwd: projectRoot,
    minimumWidth: Number(template?.assets?.minimum_background_width || 1280),
    minimumHeight: Number(template?.assets?.minimum_background_height || 720),
    minimumAspectRatio: Number(template?.assets?.minimum_background_aspect_ratio || 1.4),
  });
  if (landscapeCatalog.eligible.length === 0) {
    throw new Error('No eligible landscape Pokemon backgrounds were found.');
  }
  printInfo(`Found ${landscapeCatalog.eligible.length} eligible landscape background(s).`);

  const statePath = getStringOption(
    options,
    'state',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-mixed-challenge.state.json`,
  );
  const selectionState = await loadOptionalJson(statePath) || { sections: {} };
  const runtimeRoot = resolve(
    projectRoot,
    'data/runtime/product-video-agent/pokemon-long-form/mixed-challenge',
    slugify(seed),
  );
  const segmentRoot = resolve(runtimeRoot, 'segments');
  const backgroundRoot = resolve(runtimeRoot, 'backgrounds');
  const planRoot = resolve(runtimeRoot, 'plans');
  const orderedSpecs = orderLandscapeTemplateSpecs(
    LANDSCAPE_POKEMON_TEMPLATE_SPECS,
    seed,
    template?.episode?.shuffle_sections !== false,
    template?.episode?.excluded_template_keys,
  );
  const baseTemplateByKey = new Map(baseTemplates.map((entry) => [entry.spec.key, entry.template]));
  const nextSelectionState = { ...selectionState, sections: {} };
  const sectionSummaries = [];
  const sectionPaths = [];
  const generationStartedAt = Date.now();

  for (let sectionIndex = 0; sectionIndex < orderedSpecs.length; sectionIndex += 1) {
    const spec = orderedSpecs[sectionIndex];
    const baseTemplate = baseTemplateByKey.get(spec.key);
    const sectionTemplate = adaptPokemonShortTemplateToLandscape(baseTemplate);
    const sectionSeed = `${seed}:section:${sectionIndex + 1}:${spec.key}`;
    const segmentPath = resolve(
      segmentRoot,
      `${String(sectionIndex + 1).padStart(2, '0')}-${spec.key}.mp4`,
    );
    const sectionPlanCandidatePath = resolve(
      planRoot,
      `${String(sectionIndex + 1).padStart(2, '0')}-${spec.key}.plan.json`,
    );
    const resumedPlan = await loadOptionalJson(sectionPlanCandidatePath);
    const resumedDuration = resumedPlan
      ? await probeMediaDurationSeconds({
          ffmpegExecutable,
          mediaPath: segmentPath,
          cwd: projectRoot,
        })
      : null;
    if (resumedPlan && Number(resumedDuration) > 1) {
      printInfo(`Reusing completed landscape section ${sectionIndex + 1}/${orderedSpecs.length}: ${spec.key}.`);
      sectionPaths.push(segmentPath);
      sectionSummaries.push(buildSectionSummary({
        sectionIndex,
        templateKey: spec.key,
        plan: resumedPlan,
        renderResult: { render_plan: { total_duration_seconds: resumedDuration } },
        sourceBackground: {
          path: resumedPlan?.assets?.background?.source_path || '',
        },
        renderedBackgroundPath: resumedPlan?.assets?.background?.selected_path || '',
        segmentPath,
        planPath: sectionPlanCandidatePath,
      }));
      nextSelectionState.sections[spec.key] = resumedPlan.selection_state || {};
      continue;
    }
    printInfo(`Planning landscape section ${sectionIndex + 1}/${orderedSpecs.length}: ${spec.key}.`);
    const plannedSection = await planPokemonTypeChallenge({
      template: sectionTemplate,
      pokedexRows,
      seed: sectionSeed,
      assetInventory: inventory,
      selectionState: resolveSectionState(selectionState, spec.key),
      channelProfile,
    });
    const sourceBackground = selectLandscapeBackground(
      landscapeCatalog.eligible,
      seed,
      sectionIndex,
    );
    const initialRenderPlan = buildPokeQuizzRenderPlan({
      plan: plannedSection,
      template: sectionTemplate,
      outputPath: segmentPath,
    });
    const backgroundDuration = Number((
      Math.max(1, Number(initialRenderPlan.total_duration_seconds || 1)) + 15
    ).toFixed(3));
    const backgroundPath = resolve(
      backgroundRoot,
      `${String(sectionIndex + 1).padStart(2, '0')}-${spec.key}.mp4`,
    );
    printInfo(`Rendering smooth background for ${spec.key} (${backgroundDuration}s).`);
    await renderSmoothLandscapeBackground({
      sourcePath: sourceBackground.path,
      outputPath: backgroundPath,
      durationSeconds: backgroundDuration,
      template,
      sectionIndex,
      ffmpegExecutable,
      projectRoot,
    });
    const plan = withLandscapeBackground(plannedSection, backgroundPath, sourceBackground.path);
    const sectionPlanPath = await writeJson(
      sectionPlanCandidatePath,
      plan,
    );
    const kokoro = resolvePokeQuizzVoiceRuntime({
      config,
      template: sectionTemplate,
      plan,
      projectRoot,
      voiceProfileId: getStringOption(options, 'voice-profile-id', ''),
      voicePython: getStringOption(options, 'voice-python', ''),
      voiceScript: getStringOption(options, 'voice-script', ''),
      voiceCacheDir: getStringOption(options, 'voice-cache-dir', ''),
    });
    printInfo(`Rendering native ${spec.key} section in 1920x1080.`);
    const renderResult = await renderPokeQuizzVideo({
      plan,
      template: sectionTemplate,
      outputPath: segmentPath,
      projectRoot,
      ffmpegExecutable,
      kokoro,
      runtimeRoot: resolve(runtimeRoot, 'render', spec.key),
      channelProfile,
    });
    sectionPaths.push(renderResult.output_path);
    sectionSummaries.push(buildSectionSummary({
      sectionIndex,
      templateKey: spec.key,
      plan,
      renderResult,
      sourceBackground,
      renderedBackgroundPath: backgroundPath,
      segmentPath: renderResult.output_path,
      planPath: sectionPlanPath,
    }));
    nextSelectionState.sections[spec.key] = plannedSection.selection_state || {};
  }

  const firstSectionMusicPath = sectionSummaries[0]?.selected_music_path || '';
  const introMusicPath = selectMixedChallengeIntroMusic(
    inventory.music,
    firstSectionMusicPath,
    seed,
  );
  const introPokeballs = selectMixedChallengeIntroPokeballs(
    inventory.pokeball_sprites,
    seed,
    template?.episode?.intro_pokeball_count,
  );
  const selectedRoundTransitions = selectMixedChallengeRoundTransitions(
    inventory.transitions,
    seed,
    sectionSummaries.length,
    selectionState?.last_round_transition_key,
    template?.layout?.round_transition,
  );
  const roundTransitions = selectedRoundTransitions.map((transition, index) => {
    if (transition.kind !== 'pokeball') return transition;
    const pokeball = introPokeballs[index % Math.max(1, introPokeballs.length)];
    return {
      ...transition,
      path: pokeball?.path || null,
      direction_multiplier: pokeball?.direction_multiplier || transition.direction_multiplier,
    };
  });
  const lastExternalTransition = [...roundTransitions]
    .reverse()
    .find((transition) => transition.kind === 'keyed_overlay');
  nextSelectionState.last_round_transition_key = lastExternalTransition?.key || null;
  const plan = buildMixedChallengePlan({
    template,
    seed,
    channelProfile,
    sections: sectionSummaries,
    selectionState: nextSelectionState,
    programAssets: {
      intro_music_path: introMusicPath,
      intro_pokeballs: introPokeballs,
      subscribe_reminder_path: inventory.overlay_presets?.subscribe_reminder || null,
      round_transitions: roundTransitions,
    },
  });
  const planPath = getStringOption(
    options,
    'plan-output',
    `data/runtime/product-video-agent/pokemon-long-form/${slugify(channelSelector)}-${slugify(seed)}.plan.json`,
  );
  await writeJson(planPath, plan);
  await writeJson(statePath, nextSelectionState);

  const defaultOutput = sectionSummaries[0]?.previews_directory
    ? `${sectionSummaries[0].previews_directory}/${slugify(seed)}-long-form.mp4`
    : resolve(runtimeRoot, `${slugify(seed)}-long-form.mp4`);
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(
    getStringOption(options, 'output', defaultOutput),
  );
  printInfo(`Assembling ${sectionPaths.length} native landscape sections (${plan.timing.total_duration_seconds}s).`);
  printInfo(`Output: ${resolvedOutput.outputPath}`);
  const renderResult = await assembleMixedChallengeVideo({
    sectionPaths,
    sections: plan.sections,
    programAssets: plan.assets.program,
    outputPath: resolvedOutput.outputPath,
    template,
    ffmpegExecutable,
    projectRoot,
    runtimeRoot: resolve(runtimeRoot, 'assembly'),
  });
  const generationDurationMinutes = (Date.now() - generationStartedAt) / 60_000;
  printInfo(`Rendered mixed long-form preview to ${renderResult.output_path}`);

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
    genreLabel: 'Long-form Pokemon Challenge Compilation',
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
    content_surface: plan.content_surface,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/generate-pokemon-long-form-review.mjs [options]',
      '',
      'Builds one native 16:9 section from every Pokemon Short template except Tournament,',
      'then assembles the sections into one YouTube watch-page review video.',
      '',
      'Options:',
      '  --channel <selector>       Pokemon channel. Default: poke-quizz-youtube',
      '  --thread-id <id>           Optional Discord review thread override.',
      '  --seed <text>              Deterministic episode seed. Default: current timestamp.',
      '  --catalog-json <path>      Localized Pokedex JSON override.',
      '  --template <path>          Long-form compilation template JSON override.',
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
