#!/usr/bin/env node

import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  projectRoot,
} from '../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { buildPokeQuizzRenderPlan, loadJson, renderPokeQuizzVideo } from '../src/poke-quizz-renderer.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../src/poke-quizz-asset-layout.mjs';
import { resolveFfmpegExecutable } from '../src/runtime-executables.mjs';

function resolveTypePairSlug(plan) {
  return (plan.selection?.type_pair || [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join('-');
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();

  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/render-poke-quizz-video.mjs [options]',
      '',
      'Options:',
      '  --plan <path>            Required Poke Quizz plan JSON path',
      '  --template <path>        Template JSON path. Default: pokemon-type-challenge-v1.template.json',
      '  --config <path>          Product-video config JSON path. Default: services/product-video-agent/config.example.json',
      '  --output <path>          Output video path. Default: T7 Pokemon/Poke Quizz/Previews/<type-pair>-<seed>.mp4',
      '  --voice-python <path>    Override Kokoro Python executable',
      '  --voice-script <path>    Override kokoro-synthesize.py path',
      '  --voice-cache-dir <path> Override Kokoro cache/model directory',
      '  --voice-profile-id <id>  Override voice profile ID',
    ]);
    process.exit(0);
  }

  const planPath = getStringOption(options, 'plan', '');
  if (!planPath) {
    throw new Error('The --plan option is required.');
  }

  const templatePath = getStringOption(
    options,
    'template',
    'services/product-video-agent/pokemon-type-challenge-v1.template.json',
  );
  const configPath = getStringOption(
    options,
    'config',
    'services/product-video-agent/config.example.json',
  );

  const [plan, template, config] = await Promise.all([
    loadJson(resolve(projectRoot, planPath)),
    loadJson(resolve(projectRoot, templatePath)),
    loadRuntimeConfigJson(configPath),
  ]);

  const typePairSlug = resolveTypePairSlug(plan) || 'pokemon-type-challenge';
  const seedSlug = String(plan.seed || 'preview')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  const outputPath = getStringOption(
    options,
    'output',
    `${POKE_QUIZZ_ASSET_LAYOUT.previews}/${typePairSlug}-${seedSlug}.mp4`,
  );
  const ffmpegExecutable = resolveFfmpegExecutable(config.render || config);
  const kokoro = resolveVoiceRuntime(config, options);
  const runtimeRoot = resolve(projectRoot, 'data/runtime/product-video-agent/poke-quizz-render');

  const previewPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath });
  printInfo(`Rendering ${typePairSlug} Poke Quizz preview (${previewPlan.total_duration_seconds}s).`);
  printInfo(`Output: ${outputPath}`);

  const result = await renderPokeQuizzVideo({
    plan,
    template,
    outputPath,
    projectRoot,
    ffmpegExecutable,
    kokoro,
    runtimeRoot,
  });

  printInfo(`Rendered Poke Quizz preview to ${result.output_path}`);
  printInfo(`Mixed audio track: ${result.audio_mix_path}`);
  printInfo(`Video filter script: ${result.video_filter_script_path}`);
}
