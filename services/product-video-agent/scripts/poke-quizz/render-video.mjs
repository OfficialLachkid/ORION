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
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';
import { moveOlderPreviewFiles } from './organize-previews.mjs';
import { buildPokeQuizzRenderPlan, loadJson, renderPokeQuizzVideo } from '../../src/poke-quizz-renderer.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../src/poke-quizz-asset-layout.mjs';
import { resolveManagedPokeQuizzPreviewOutputPath } from '../../src/poke-quizz-preview-storage.mjs';
import { resolveFfmpegExecutable } from '../../src/runtime-executables.mjs';
import {
  DEFAULT_VIDEO_CHANNEL_CONFIG_PATH,
  resolveVideoTemplateRuntime,
} from '../../src/video-template-context.mjs';

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
      `  --channel-config <path>  Channel/program/style config. Default: ${DEFAULT_VIDEO_CHANNEL_CONFIG_PATH}`,
      '  --template <path>        Template JSON path. Default: services/product-video-agent/config/templates/pokemon/dual-type-reveal.v1.json',
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

  const templateRuntime = await resolveVideoTemplateRuntime({
    projectRoot,
    channelConfigPath: getStringOption(options, 'channel-config', DEFAULT_VIDEO_CHANNEL_CONFIG_PATH),
    templatePath: getStringOption(options, 'template', ''),
    configPath: getStringOption(options, 'config', ''),
  });
  const templatePath = templateRuntime.templatePath;
  const configPath = templateRuntime.configPath;

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
  const resolvedOutput = await resolveManagedPokeQuizzPreviewOutputPath(outputPath);
  const ffmpegExecutable = resolveFfmpegExecutable(config.render || config);
  const kokoro = resolveVoiceRuntime(config, options);
  const runtimeRoot = resolve(projectRoot, 'data/runtime/product-video-agent/poke-quizz-render');

  const previewPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath: resolvedOutput.outputPath });
  printInfo(`Rendering ${typePairSlug} Poke Quizz preview (${previewPlan.total_duration_seconds}s).`);
  printInfo(`Output: ${resolvedOutput.outputPath}`);

  const result = await renderPokeQuizzVideo({
    plan,
    template,
    outputPath: resolvedOutput.outputPath,
    projectRoot,
    ffmpegExecutable,
    kokoro,
    runtimeRoot,
  });

  printInfo(`Rendered Poke Quizz preview to ${result.output_path}`);
  printInfo(`Mixed audio track: ${result.audio_mix_path}`);
  printInfo(`Video filter script: ${result.video_filter_script_path}`);

  const previewRoot = resolve(projectRoot, POKE_QUIZZ_ASSET_LAYOUT.previews);
  if (resolve(result.output_path).startsWith(previewRoot)) {
    const organized = await moveOlderPreviewFiles({
      previewsDirectory: previewRoot,
      archiveDirectory: resolve(previewRoot, 'Older Generated Videos'),
      keepCount: 2,
    });
    printInfo(`Preview organizer kept ${organized.kept.length} preview(s) in root and archived ${organized.archived.length}.`);
  }
}
