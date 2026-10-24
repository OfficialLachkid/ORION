#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { loadEngineConfig } from '../digital-asset-engine/src/config.mjs';
import {
  discordRequest,
  sendMessageWithFiles,
} from '../digital-asset-engine/src/discord-review.mjs';
import { withGenerationLock } from '../digital-asset-engine/src/generation-lock.mjs';
import { OllamaImageAdapter } from '../digital-asset-engine/src/ollama-image-adapter.mjs';
import { assertGenerationResourcesAvailable } from '../digital-asset-engine/src/resource-preflight.mjs';
import { loadRuntimeConfig, projectRoot } from '../lib/runtime-config.mjs';
import {
  ensureManualImageStorage,
  resolveManualImageGenerationConfig,
} from './src/config.mjs';
import { ensureManualImageGenerationChannel } from './src/discord.mjs';
import { removeConnectedChromaBackground } from './src/transparency.mjs';

export const DEFAULT_BENCHMARK_MODELS = Object.freeze([
  'x/flux2-klein:4b',
  'x/flux2-klein:4b-fp8',
]);

export const BENCHMARK_FIXTURES = Object.freeze([
  {
    id: 'plasma-rifle',
    label: 'Side-view plasma rifle',
    seed: 22201,
    transparent_background: true,
    prompt: [
      'Production-ready 2D pixel-art game asset of one original sci-fi plasma rifle.',
      'Strict right-facing side view, crisp mechanical silhouette, readable stock, grip, trigger opening, barrel, and muzzle exit.',
      'Dark graphite metal with restrained cyan energy accents, coherent hard-surface detail, no projectile or muzzle flash.',
      'Center the complete weapon with generous padding on a perfectly flat #ff00ff chroma background.',
      'No floor, scenery, shadow, border, text, logo, watermark, duplicate object, or cropped pixels.',
    ].join(' '),
  },
  {
    id: 'half-filled-potion',
    label: 'Half-filled glass potion',
    seed: 22202,
    transparent_background: true,
    prompt: [
      'Production-ready 2D pixel-art game asset of one original arcane glass potion bottle.',
      'The bottle is exactly half filled with luminous teal liquid: show a clear horizontal liquid surface and visibly empty transparent glass above it.',
      'Crisp readable glass rim, cork, highlights, refraction, and compact fantasy silhouette without baked spell effects.',
      'Center the complete bottle with generous padding on a perfectly flat #ff00ff chroma background.',
      'No floor, scenery, shadow, border, text, logo, watermark, duplicate object, confetti, dissolving, or cropped pixels.',
    ].join(' '),
  },
]);

export const PHOTOREALISTIC_BENCHMARK_FIXTURES = Object.freeze([
  {
    id: 'photorealistic-field-engineer',
    label: 'Photorealistic field engineer and exploration rover',
    seed: 22301,
    transparent_background: false,
    negative_prompt: [
      'illustration, painting, drawing, anime, pixel art, cartoon, stylized game art, obvious CGI, 3D render, plastic skin, waxy skin',
      'malformed anatomy, malformed hands, extra fingers, fused fingers, missing fingers, duplicate person, duplicate limbs',
      'oversharpened, low resolution, blurry subject, flat lighting, text, logo, border, frame, watermark',
    ].join(', '),
    prompt: [
      'Ultra-photorealistic cinematic editorial photograph of an adult field engineer beside a weathered futuristic exploration rover in a misty Icelandic volcanic valley at sunrise.',
      'The engineer is naturally posed while adjusting a brushed-metal scientific instrument with both hands fully visible; preserve realistic human anatomy, facial proportions, skin pores, individual hair strands, and detailed fabric weave.',
      'Render physically plausible warm sunrise light, cool atmospheric haze, wet basalt, fine water droplets, subtle lens depth, natural color grading, and convincing metal, glass, rubber, and textile materials.',
      'Shot on a full-frame camera with a 50mm lens at f/2.8, documentary composition, crisp focal subject, realistic depth of field, extremely detailed but not oversharpened.',
      'No illustration, painting, anime, pixel art, stylized game art, obvious CGI, plastic skin, extra fingers, malformed hands, duplicate people, text, logo, border, or watermark.',
    ].join(' '),
  },
]);

export const BENCHMARK_PROFILES = Object.freeze({
  assets: BENCHMARK_FIXTURES,
  photorealistic: PHOTOREALISTIC_BENCHMARK_FIXTURES,
});

function parseModels(argv) {
  const optionIndex = argv.indexOf('--models');
  const supplied = optionIndex >= 0 ? String(argv[optionIndex + 1] || '') : '';
  const models = supplied
    ? supplied.split(',').map((model) => model.trim()).filter(Boolean)
    : [...DEFAULT_BENCHMARK_MODELS];
  if (models.length !== 2 || new Set(models).size !== 2) {
    throw new Error('The benchmark requires exactly two distinct comma-separated models.');
  }
  return models;
}

export function parseBenchmarkProfile(argv) {
  const optionIndex = argv.indexOf('--profile');
  const profile = optionIndex >= 0 ? String(argv[optionIndex + 1] || '') : 'assets';
  if (!Object.hasOwn(BENCHMARK_PROFILES, profile)) {
    throw new Error(`Unknown benchmark profile ${profile || '(empty)'}. Expected one of: ${Object.keys(BENCHMARK_PROFILES).join(', ')}.`);
  }
  return profile;
}

export function buildCounterbalancedBenchmarkCases(models, fixtures = BENCHMARK_FIXTURES) {
  if (models.length !== 2) throw new Error('Counterbalanced comparison requires exactly two models.');
  return fixtures.flatMap((fixture, fixtureIndex) => {
    const orderedModels = fixtureIndex % 2 === 0 ? models : [...models].reverse();
    return orderedModels.map((model) => ({ ...fixture, model }));
  });
}

function safeModelName(model) {
  return model.replace(/[^a-z0-9]+/giu, '-').replace(/^-|-$/gu, '').toLowerCase();
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function durationLabel(milliseconds) {
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function benchmarkModelRole(models, model) {
  if (model === models[0]) return 'CURRENT MODEL';
  if (model === models[1]) return 'CANDIDATE MODEL';
  return 'MODEL';
}

function escapeSvgText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

async function buildLabeledBenchmarkPreview(result, report, attachmentIndex) {
  const image = sharp(result.output_path);
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;
  const role = benchmarkModelRole(report.models, result.model);
  const label = `${attachmentIndex}. ${role}: ${result.model}`;
  const fontSize = Math.max(18, Math.round(width * 0.026));
  const badgeHeight = Math.max(50, Math.round(fontSize * 2.15));
  const badgeWidth = Math.min(width - 32, Math.max(360, Math.round(label.length * fontSize * 0.61)));
  const overlay = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    `<rect x="16" y="16" width="${badgeWidth}" height="${badgeHeight}" rx="12" fill="#111827" fill-opacity="0.94" stroke="#22d3ee" stroke-width="3"/>`,
    `<text x="34" y="${16 + Math.round(badgeHeight * 0.64)}" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="#f8fafc">${escapeSvgText(label)}</text>`,
    '</svg>',
  ].join(''));
  return image.composite([{ input: overlay, top: 0, left: 0 }]).png().toBuffer();
}

function progressContent({ cases, completed, current }) {
  return [
    '**Local image model benchmark running**',
    `**Progress:** **${completed}/${cases.length}**`,
    current ? `**Current:** ${current.label} with \`${current.model}\`` : '',
    '**Controls:** identical prompt, seed, 1024x1024 canvas, four steps, and negative prompt per fixture.',
    '**Order:** counterbalanced to reduce warm-up and thermal-order bias.',
  ].filter(Boolean).join('\n');
}

function finalContent(report, fixtures) {
  const lines = [
    '**Local image model benchmark complete**',
    `**Benchmark:** \`${report.benchmark_id}\``,
    '**API cost:** **EUR 0** (local execution)',
    '',
  ];
  for (const fixture of fixtures) {
    lines.push(`**${fixture.label}**`);
    for (const result of report.results.filter((entry) => entry.fixture_id === fixture.id)) {
      lines.push(
        `- \`${result.model}\`: **${durationLabel(result.generation_ms)}** generation, ${durationLabel(result.processing_ms)} alpha processing${result.transparency_error ? ' (alpha fallback)' : ''}`,
      );
    }
  }
  lines.push('', '**Attachment order**');
  for (const [index, result] of report.results.entries()) {
    lines.push(`${index + 1}. **${benchmarkModelRole(report.models, result.model)}** — ${result.fixture_label} — \`${result.model}\``);
  }
  lines.push('', 'Each preview is visibly labeled. Canonical unlabeled outputs remain on the T7 for inspection.');
  return lines.join('\n');
}

export async function runManualImageModelBenchmark(options = {}) {
  const runtimeConfig = options.runtimeConfig || loadRuntimeConfig();
  const manualConfig = options.manualConfig || resolveManualImageGenerationConfig(runtimeConfig);
  const engineConfig = options.engineConfig || await loadEngineConfig(
    'services/digital-asset-engine/config.example.json',
    projectRoot,
  );
  const models = options.models || DEFAULT_BENCHMARK_MODELS;
  const fixtures = options.fixtures || BENCHMARK_FIXTURES;
  const cases = buildCounterbalancedBenchmarkCases(models, fixtures);
  const negativePrompts = [...new Set(cases.map((benchmarkCase) => (
    benchmarkCase.negative_prompt || engineConfig.generation.negative_prompt
  )))];
  await ensureManualImageStorage(manualConfig);
  const channel = await ensureManualImageGenerationChannel({
    runtimeConfig,
    config: manualConfig,
    fetchImpl: options.fetchImpl,
  });
  const benchmarkId = `image-model-benchmark-${new Date().toISOString().replace(/[:.]/gu, '-')}-${randomUUID().slice(0, 8)}`;
  const benchmarkRoot = resolve(manualConfig.archiveRoot, 'benchmarks', benchmarkId);
  const rawRoot = resolve(benchmarkRoot, 'raw');
  const outputRoot = resolve(benchmarkRoot, 'outputs');
  await mkdir(rawRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const status = await discordRequest(
    runtimeConfig.env.DISCORD_BOT_TOKEN,
    `/channels/${channel.channel.id}/messages`,
    {
      method: 'POST',
      fetchImpl: options.fetchImpl,
      body: { content: progressContent({ cases, completed: 0, current: cases[0] }) },
    },
  );
  const report = {
    schema_version: '1.0',
    benchmark_id: benchmarkId,
    started_at: new Date().toISOString(),
    completed_at: null,
    channel_id: channel.channel.id,
    discord_message_id: status.id,
    models,
    profile: options.profile || 'assets',
    controls: {
      width: 1024,
      height: 1024,
      steps: engineConfig.generation.steps,
      negative_prompt: negativePrompts.length === 1 ? negativePrompts[0] : 'Per fixture; see result records.',
      keep_alive: 0,
      execution: 'local',
      estimated_cost_eur: 0,
    },
    results: [],
  };

  const runWithLock = options.withGenerationLock || withGenerationLock;
  try {
    await runWithLock({ projectRoot }, async () => {
      await (options.assertResources || assertGenerationResourcesAvailable)(engineConfig, {
        fetchImpl: options.fetchImpl,
      });
      for (const [index, benchmarkCase] of cases.entries()) {
        await discordRequest(
          runtimeConfig.env.DISCORD_BOT_TOKEN,
          `/channels/${channel.channel.id}/messages/${status.id}`,
          {
            method: 'PATCH',
            fetchImpl: options.fetchImpl,
            body: { content: progressContent({ cases, completed: index, current: benchmarkCase }) },
          },
        );
        const adapter = new OllamaImageAdapter({
          ...engineConfig.generation,
          model: benchmarkCase.model,
          negative_prompt: benchmarkCase.negative_prompt || engineConfig.generation.negative_prompt,
          keep_alive: 0,
          require_local_endpoint: true,
        }, { fetchImpl: options.fetchImpl });
        const readiness = await adapter.checkReadiness();
        if (readiness.status !== 'ready') throw new Error(readiness.detail);
        const generationStarted = performance.now();
        const generated = await adapter.generateAsset({
          asset: { generation_prompt: benchmarkCase.prompt, seed: benchmarkCase.seed },
          sourceWidth: 1024,
          sourceHeight: 1024,
        });
        const generationMs = performance.now() - generationStarted;
        const rawExtension = generated.format === 'jpeg' ? 'jpg' : generated.format;
        const stem = `${String(index + 1).padStart(2, '0')}-${benchmarkCase.id}-${safeModelName(benchmarkCase.model)}`;
        const rawPath = resolve(rawRoot, `${stem}.${rawExtension}`);
        await writeFile(rawPath, generated.buffer);
        const processingStarted = performance.now();
        let outputBuffer = generated.buffer;
        let outputExtension = rawExtension;
        let transparency = null;
        let transparencyError = '';
        if (benchmarkCase.transparent_background !== false) {
          try {
            transparency = await removeConnectedChromaBackground(generated.buffer, {
              tolerance: engineConfig.generation.chroma_tolerance,
            });
            outputBuffer = transparency.buffer;
            outputExtension = 'png';
          } catch (error) {
            transparencyError = String(error?.message || error);
          }
        }
        const processingMs = performance.now() - processingStarted;
        const outputPath = resolve(outputRoot, `${stem}.${outputExtension}`);
        await writeFile(outputPath, outputBuffer);
        report.results.push({
          fixture_id: benchmarkCase.id,
          fixture_label: benchmarkCase.label,
          model: benchmarkCase.model,
          seed: benchmarkCase.seed,
          prompt: benchmarkCase.prompt,
          negative_prompt: benchmarkCase.negative_prompt || engineConfig.generation.negative_prompt,
          transparent_background: benchmarkCase.transparent_background !== false,
          generation_ms: Math.round(generationMs),
          processing_ms: Math.round(processingMs),
          raw_path: rawPath,
          output_path: outputPath,
          output_bytes: outputBuffer.length,
          output_sha256: sha256(outputBuffer),
          transparency_removed_pixels: transparency?.removedPixels || 0,
          transparency_error: transparencyError,
        });
        await writeFile(resolve(benchmarkRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
      }
    });
  } catch (error) {
    report.failed_at = new Date().toISOString();
    report.error = String(error?.stack || error?.message || error).slice(0, 8000);
    await writeFile(resolve(benchmarkRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await discordRequest(
      runtimeConfig.env.DISCORD_BOT_TOKEN,
      `/channels/${channel.channel.id}/messages/${status.id}`,
      {
        method: 'PATCH',
        fetchImpl: options.fetchImpl,
        body: {
          content: [
            '**Local image model benchmark stopped safely**',
            `**Completed:** **${report.results.length}/${cases.length}**`,
            `**Error:** ${String(error?.message || error).slice(0, 1200)}`,
            'Generated evidence remains on the T7 for diagnosis.',
          ].join('\n'),
        },
      },
    ).catch(() => null);
    throw error;
  }

  report.completed_at = new Date().toISOString();
  await writeFile(resolve(benchmarkRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const files = [];
  for (const [index, result] of report.results.entries()) {
    const attachmentIndex = index + 1;
    files.push({
      filename: `${String(attachmentIndex).padStart(2, '0')}-${safeModelName(benchmarkModelRole(report.models, result.model))}-${basename(result.output_path)}`,
      description: `${attachmentIndex}. ${benchmarkModelRole(report.models, result.model)}: ${result.fixture_label} generated by ${result.model}`,
      contentType: 'image/png',
      buffer: options.buildPreview
        ? await options.buildPreview(result, report, attachmentIndex)
        : await buildLabeledBenchmarkPreview(result, report, attachmentIndex),
    });
  }
  await sendMessageWithFiles(
    runtimeConfig.env.DISCORD_BOT_TOKEN,
    channel.channel.id,
    { content: finalContent(report, fixtures) },
    files,
    { messageId: status.id, fetchImpl: options.fetchImpl },
  );
  return report;
}

const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  const argv = process.argv.slice(2);
  const profile = parseBenchmarkProfile(argv);
  runManualImageModelBenchmark({
    models: parseModels(argv),
    profile,
    fixtures: BENCHMARK_PROFILES[profile],
  })
    .then((report) => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message || error}\n`);
      process.exitCode = 1;
    });
}
