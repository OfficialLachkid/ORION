#!/usr/bin/env node

import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import { planPokemonTypeChallenge } from '../../src/pokemon-type-challenge-planner.mjs';
import { normalizeTypePair } from '../../src/pokemon-type-pairs.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../src/poke-quizz-asset-layout.mjs';
import { renderPokeQuizzVideo } from '../../src/poke-quizz-renderer.mjs';
import {
  loadPokeQuizzSelectionStateFromStore,
  mergePokeQuizzSelectionStates,
} from '../../src/poke-quizz-selection-state.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  beginPokeQuizzGenerationProgress,
  markPokeQuizzGenerationRetry,
  markPokeQuizzGenerationFailed,
  postPokeQuizzGenerationStarted,
} from '../../src/poke-quizz-discord-progress.mjs';
import { resolveManagedPokeQuizzPreviewOutputPath } from '../../src/poke-quizz-preview-storage.mjs';
import { reviewPokeQuizzPublication } from './review-publication.mjs';
import { resolveFfmpegExecutable } from '../../src/runtime-executables.mjs';
import { moveOlderPreviewFiles } from './organize-previews.mjs';
import {
  DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  resolveVideoTemplateRuntime,
} from '../../src/video-template-context.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printWarn,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function loadJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
}

async function loadOptionalJson(relativePath) {
  try {
    return await loadJson(relativePath);
  } catch {
    return null;
  }
}

async function writeJson(relativePath, payload) {
  const absolutePath = resolve(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return absolutePath;
}

async function loadRuntimeConfigJson(relativePath) {
  return JSON.parse(await readFile(resolve(projectRoot, relativePath), 'utf8'));
}

function resolveVoiceRuntime(config, options) {
  const defaultProfileId = getStringOption(options, 'voice-profile-id', config.voice.default_profile_id);
  const profile = (config.voice.profiles || []).find((item) => item.profile_id === defaultProfileId);
  if (!profile) {
    throw new Error(`Voice profile ${defaultProfileId} was not found in ${config.voice.default_profile_id}.`);
  }
  return {
    pythonExecutable: resolve(projectRoot, getStringOption(options, 'voice-python', config.voice.executable)),
    scriptPath: resolve(projectRoot, getStringOption(options, 'voice-script', config.voice.script_path)),
    cacheDir: resolve(projectRoot, getStringOption(options, 'voice-cache-dir', config.voice.data_directory)),
    profile,
  };
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function resolveTypePairSlug(plan) {
  return (plan.selection?.type_pair || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join('-');
}

async function resolvePlan(
  options,
  selectionState = null,
  defaultSeed = new Date().toISOString(),
  defaults = {},
) {
  const planPath = getStringOption(options, 'plan', '');
  if (planPath) {
    return {
      plan: await loadJson(planPath),
      planPath,
    };
  }

  const catalogJsonPath = getStringOption(options, 'catalog-json', '');
  if (!catalogJsonPath) {
    throw new Error('Provide either --plan or --catalog-json.');
  }

  const templatePath = getStringOption(options, 'template', defaults.templatePath || '');
  if (!templatePath) {
    throw new Error('No template path could be resolved for the requested video flow.');
  }
  const statePath = getStringOption(
    options,
    'state',
    'data/runtime/product-video-agent/poke-quizz/selection-state.json',
  );
  const outputPlanPath = getStringOption(
    options,
    'plan-output',
    'data/runtime/product-video-agent/poke-quizz/generated-review-plan.json',
  );
  const forcedTypePairInput = getStringOption(options, 'type-pair', '');
  const forcedTypePair = forcedTypePairInput
    ? normalizeTypePair(forcedTypePairInput.split(','))
    : null;

  const [template, pokedexRows, localSelectionState] = await Promise.all([
    loadJson(templatePath),
    loadJson(catalogJsonPath),
    loadOptionalJson(statePath),
  ]);
  const effectiveSelectionState = mergePokeQuizzSelectionStates(selectionState, localSelectionState);

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: getStringOption(options, 'seed', defaultSeed),
    forcedTypePair,
    selectionState: effectiveSelectionState,
  });
  await writeJson(outputPlanPath, plan);
  await writeJson(statePath, plan.selection_state || {});
  return {
    plan,
    planPath: outputPlanPath,
  };
}

async function resolveLiveSelectionState(runtimeConfig, channelProfile) {
  const supabaseUrl = runtimeConfig.env.SUPABASE_URL || '';
  const apiKey = runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY || '';
  if (!supabaseUrl || !apiKey) {
    return null;
  }

  const store = new SupabasePublicationStore({
    supabaseUrl,
    apiKey,
  });

  try {
    return await loadPokeQuizzSelectionStateFromStore({
      store,
      channelProfile,
      limit: 32,
    });
  } catch (error) {
    printWarn(`Could not load recent Poke Quizz selection history from Supabase: ${error.message}`);
    return null;
  }
}

async function generateAndReviewPokeQuizz(options) {
  const reviewThreadId = getStringOption(options, 'thread-id', '');
  if (!reviewThreadId) {
    throw new Error('The --thread-id option is required.');
  }

  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const templateRuntime = await resolveVideoTemplateRuntime({
    projectRoot,
    channelConfigPath: getStringOption(options, 'channel-config', DEFAULT_VIDEO_CHANNEL_CONFIG_PATH),
    templatePath: getStringOption(options, 'template', ''),
    configPath: getStringOption(options, 'config', ''),
    channelSelector: getStringOption(options, 'channel', ''),
  });
  const configPath = templateRuntime.configPath;
  const templatePath = templateRuntime.templatePath;
  const channelSelector = templateRuntime.channelSelector;
  const submittedAt = getStringOption(options, 'as-of', new Date().toISOString());
  const runtimeConfig = loadRuntimeConfig();
  const [profiles, template, config] = await Promise.all([
    loadPublicationChannelProfiles(channelsPath, { projectRoot }),
    loadJson(templatePath),
    loadRuntimeConfigJson(configPath),
  ]);
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const liveSelectionState = await resolveLiveSelectionState(runtimeConfig, channelProfile);
  const { plan, planPath } = await resolvePlan(
    options,
    liveSelectionState,
    submittedAt,
    { templatePath },
  );
  const typePairSlug = resolveTypePairSlug(plan) || 'pokemon-type-challenge';
  const seedSlug = slugify(plan.seed || 'preview');
  const outputPath = getStringOption(
    options,
    'output',
    `${POKE_QUIZZ_ASSET_LAYOUT.previews}/${typePairSlug}-${seedSlug}.mp4`,
  );
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(outputPath);
  const ffmpegExecutable = resolveFfmpegExecutable(config.render || config);
  const kokoro = resolveVoiceRuntime(config, options);
  const runtimeRoot = resolve(projectRoot, 'data/runtime/product-video-agent/poke-quizz-render');
  const overrideTitle = getStringOption(options, 'title', '');
  const overrideDescription = getStringOption(options, 'description', '');

  const startedMessage = await postPokeQuizzGenerationStarted(runtimeConfig, reviewThreadId, {
    channelProfile,
    typePair: plan.selection?.type_pair || [],
    title: overrideTitle,
    description: overrideDescription,
    genreLabel: templateRuntime.genreLabel,
    presentation: templateRuntime.generationProgressPresentation,
  });
  const progress = beginPokeQuizzGenerationProgress(runtimeConfig, startedMessage, {
    channelProfile,
    typePair: plan.selection?.type_pair || [],
    title: overrideTitle,
    description: overrideDescription,
    genreLabel: templateRuntime.genreLabel,
    presentation: templateRuntime.generationProgressPresentation,
  });

  try {
    printInfo(`Rendering ${typePairSlug} Poke Quizz preview.`);
    printInfo(`Output: ${resolvedOutput.outputPath}`);

    let renderResult = null;
    const maxRenderAttempts = 2;
    for (let attempt = 1; attempt <= maxRenderAttempts; attempt += 1) {
      try {
        renderResult = await renderPokeQuizzVideo({
          plan,
          template,
          outputPath: resolvedOutput.outputPath,
          projectRoot,
          ffmpegExecutable,
          kokoro,
          runtimeRoot,
        });
        break;
      } catch (error) {
        if (attempt >= maxRenderAttempts) {
          throw error;
        }
        await markPokeQuizzGenerationRetry(runtimeConfig, startedMessage, {
          channelProfile,
          typePair: plan.selection?.type_pair || [],
          title: overrideTitle,
          description: overrideDescription,
          elapsedMs: progress.getElapsedMs(),
          attemptLabel: `${attempt + 1}/${maxRenderAttempts}`,
          genreLabel: templateRuntime.genreLabel,
          presentation: templateRuntime.generationProgressPresentation,
        }, error);
      }
    }

    progress.stop();
    printInfo(`Rendered Poke Quizz preview to ${renderResult.output_path}`);

    const reviewResult = await reviewPokeQuizzPublication({
      planPath,
      reviewThreadId,
      renderPath: renderResult.output_path,
      reviewMessageId: startedMessage?.messageId || '',
      publicationId: getStringOption(options, 'publication-id', ''),
      catalogJsonPath: getStringOption(options, 'catalog-json', ''),
      channelsPath,
      configPath,
      templatePath,
      channelSelector,
      channelConfigPath: templateRuntime.channelConfigPath,
      genreLabel: templateRuntime.genreLabel,
      submittedAt,
      title: overrideTitle,
      description: overrideDescription,
      hashtags: getStringOption(options, 'hashtags', '')
        ? getStringOption(options, 'hashtags', '').split(',').map((item) => item.trim()).filter(Boolean)
        : [],
      localModel: getBooleanOption(options, 'local-model', true),
      generationDurationMinutes: progress.getElapsedMinutes(),
    });

    const previewRoot = resolve(projectRoot, POKE_QUIZZ_ASSET_LAYOUT.previews);
    if (await fileExists(resolve(renderResult.output_path)) && resolve(renderResult.output_path).startsWith(previewRoot)) {
      const organized = await moveOlderPreviewFiles({
        previewsDirectory: previewRoot,
        archiveDirectory: resolve(previewRoot, 'Older Generated Videos'),
        keepCount: 2,
      });
      printInfo(`Preview organizer kept ${organized.kept.length} preview(s) in root and archived ${organized.archived.length}.`);
    }

    return {
      ...reviewResult,
      plan_path: planPath,
      output_path: renderResult.output_path,
    };
  } catch (error) {
    progress.stop();
    await markPokeQuizzGenerationFailed(runtimeConfig, startedMessage, {
      channelProfile,
      typePair: plan.selection?.type_pair || [],
      title: overrideTitle,
      description: overrideDescription,
      elapsedMs: progress.getElapsedMs(),
      attemptLabel: '2/2',
      genreLabel: templateRuntime.genreLabel,
      presentation: templateRuntime.generationProgressPresentation,
    }, error);
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/generate-poke-quizz-review.mjs [options]',
      '',
      'Options:',
      '  --thread-id <id>           Required Discord thread id for progress + review.',
      '  --plan <path>              Optional existing Poke Quizz plan JSON path.',
      '  --catalog-json <path>      Catalog JSON used when a new plan should be built.',
      '  --plan-output <path>       Output path for a generated plan JSON.',
      '  --state <path>             Selection-state JSON path used by the planner.',
      '  --seed <text>              Deterministic planning seed.',
      '  --type-pair <a,b>          Optional forced pair such as water,flying.',
      '  --output <path>            Render output MP4 path.',
      `  --channel-config <path>    Channel/program/style config. Default: ${DEFAULT_VIDEO_CHANNEL_CONFIG_PATH}`,
      '  --channel <id>             Channel id or account_key. Default: derived from channel config',
      '  --channels <path>          Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --config <path>            Product-video config JSON. Default: services/product-video-agent/config.example.json',
      '  --template <path>          Template JSON. Default: services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json',
      '  --title <text>             Optional metadata title override.',
      '  --description <text>       Optional metadata description override.',
      '  --hashtags <a,b,c>         Optional metadata hashtag override.',
      '  --publication-id <id>      Optional existing publication row to reuse.',
      '  --no-local-model           Skip local Ollama metadata generation and use the deterministic fallback.',
      '  --as-of <ISO>              Registration timestamp. Default: now.',
    ]);
    process.exit(0);
  }

  generateAndReviewPokeQuizz(options)
    .then((result) => {
      printInfo(`Posted Poke Quizz review ${result.task_id} to Discord thread ${result.thread_id}.`);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
