import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { runLocalProcess } from '../../product-video-agent/src/process-runner.mjs';
import { resolveFfmpegExecutable } from '../../product-video-agent/src/runtime-executables.mjs';
import { validateGeneratedAsset } from './asset-validator.mjs';
import { CanonicalProductStore } from './canonical-store.mjs';
import { withGenerationLock } from './generation-lock.mjs';
import {
  createTransparencyPreview,
  derivePixelArtEffectFrame,
  inspectAnchorContact,
  PIXEL_ART_EFFECT_PROCESSING_VERSION,
  PIXEL_ART_PROCESSING_VERSION,
  processPixelArtEffectFrame,
} from './image-processor.mjs';
import { OllamaImageAdapter } from './ollama-image-adapter.mjs';
import { assertGenerationResourcesAvailable } from './resource-preflight.mjs';
import { EffectPilotSchema } from './schemas.mjs';

const SHEET_GUTTER = 4;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside ${root}.`);
  return target;
}

async function writeBuffer(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value);
}

async function writeJson(path, value) {
  await writeBuffer(path, `${JSON.stringify(value, null, 2)}\n`);
}

function frameName(frameNumber) {
  return String(frameNumber).padStart(2, '0');
}

function generationFingerprint(pilot, effect, frame) {
  return sha256(JSON.stringify({
    processing_version: PIXEL_ART_PROCESSING_VERSION,
    effect_processing_version: PIXEL_ART_EFFECT_PROCESSING_VERSION,
    style: pilot.style,
    canvas: effect.canvas,
    placement: effect.placement,
    origin: effect.origin,
    frame,
  }));
}

async function loadReusableFrame(paths, fingerprint) {
  try {
    const [buffer, validation] = await Promise.all([
      readFile(paths.final),
      readFile(paths.validation, 'utf8').then(JSON.parse),
    ]);
    if (
      validation.status !== 'passed'
      || validation.generation_fingerprint !== fingerprint
      || validation.metrics?.content_sha256 !== sha256(buffer)
      || validation.processing?.version !== PIXEL_ART_PROCESSING_VERSION
      || validation.processing?.effect_version !== PIXEL_ART_EFFECT_PROCESSING_VERSION
    ) return null;
    return { buffer, validation };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadExistingSource(paths) {
  try {
    return {
      buffer: await readFile(paths.source),
      format: 'png',
      reprocessed: true,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function framePaths(experimentRoot, effect, frame, sourceExtension = 'png') {
  const name = frameName(frame.frame);
  return {
    source: resolveInside(experimentRoot, `assets/source/${effect.effect_key}/${name}.${sourceExtension}`, 'Effect source path'),
    final: resolveInside(experimentRoot, `frames/${effect.effect_key}/${name}.png`, 'Effect frame path'),
    validation: resolveInside(experimentRoot, `validation/${effect.effect_key}/${name}.json`, 'Effect validation path'),
    preview: resolveInside(experimentRoot, `previews/transparency/${effect.effect_key}/${name}.png`, 'Effect transparency preview path'),
  };
}

export async function assembleEffectSpriteSheet(frameBuffers, effect, options = {}) {
  const gutter = options.gutter ?? SHEET_GUTTER;
  const width = (effect.canvas.width * frameBuffers.length) + (gutter * (frameBuffers.length - 1));
  const composites = frameBuffers.map((input, index) => ({
    input,
    left: index * (effect.canvas.width + gutter),
    top: 0,
  }));
  const buffer = await sharp({
    create: {
      width,
      height: effect.canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(composites).png({ compressionLevel: 9 }).toBuffer();
  return {
    buffer,
    width,
    height: effect.canvas.height,
    gutter,
    frames: frameBuffers.map((unused, index) => ({
      frame: index,
      x: index * (effect.canvas.width + gutter),
      y: 0,
      width: effect.canvas.width,
      height: effect.canvas.height,
    })),
  };
}

export async function writeAnimatedGifPreview(options) {
  if (options.framePaths.length < 2) throw new Error('Animated GIF preview requires at least two frames.');
  if (options.delays.length !== options.framePaths.length) {
    throw new Error('Animated GIF preview requires one delay per frame.');
  }
  const runProcess = options.runProcess || runLocalProcess;
  const inputs = options.framePaths.flatMap((path, index) => [
    '-framerate', '100',
    '-loop', '1',
    '-t', (options.delays[index] / 1000).toFixed(3),
    '-i', resolve(path),
  ]);
  const inputLabels = options.framePaths.map((unused, index) => `[${index}:v]`).join('');
  const filter = [
    `${inputLabels}concat=n=${options.framePaths.length}:v=1:a=0,mpdecimate,split[s0][s1]`,
    '[s0]palettegen=reserve_transparent=1:transparency_color=000000[p]',
    '[s1][p]paletteuse=alpha_threshold=128',
  ].join(';');
  await mkdir(dirname(options.outputPath), { recursive: true });
  await runProcess({
    executable: options.ffmpegExecutable || resolveFfmpegExecutable({ executable: 'auto' }),
    args: [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...inputs,
      '-filter_complex', filter,
      '-final_delay', String(Math.round(options.delays.at(-1) / 10)),
      '-loop', '0', options.outputPath,
    ],
    cwd: options.cwd,
    timeoutMs: 120_000,
  });
  return options.outputPath;
}

async function composeWeaponPreviewFrames({ weaponBuffer, frameBuffers, pilot, effect }) {
  const muzzleAnchor = {
    x: pilot.weapon_preview.weapon_position.x + pilot.weapon_preview.muzzle_anchor.x,
    y: pilot.weapon_preview.weapon_position.y + pilot.weapon_preview.muzzle_anchor.y,
  };
  return Promise.all(frameBuffers.map((frameBuffer) => sharp({
    create: {
      width: pilot.weapon_preview.canvas.width,
      height: pilot.weapon_preview.canvas.height,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    {
      input: weaponBuffer,
      left: pilot.weapon_preview.weapon_position.x,
      top: pilot.weapon_preview.weapon_position.y,
    },
    {
      input: frameBuffer,
      left: muzzleAnchor.x - effect.origin.x,
      top: muzzleAnchor.y - effect.origin.y,
    },
  ]).png({ compressionLevel: 9 }).toBuffer()));
}

export async function composeProjectileTravelPreviewFrames({
  weaponBuffer,
  projectileBuffer,
  pilot,
  effect,
}) {
  const travel = pilot.weapon_preview.projectile_travel_preview;
  if (!travel) return [];
  const muzzleAnchor = {
    x: pilot.weapon_preview.weapon_position.x + pilot.weapon_preview.muzzle_anchor.x,
    y: pilot.weapon_preview.weapon_position.y + pilot.weapon_preview.muzzle_anchor.y,
  };
  const startOriginX = muzzleAnchor.x + travel.start_offset_x;
  return Promise.all(Array.from({ length: travel.frame_count }, async (unused, index) => {
    const progress = index / (travel.frame_count - 1);
    const projectileOriginX = Math.round(
      startOriginX + ((travel.end_origin_x - startOriginX) * progress),
    );
    return sharp({
      create: {
        width: travel.canvas.width,
        height: travel.canvas.height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([
      {
        input: weaponBuffer,
        left: pilot.weapon_preview.weapon_position.x,
        top: pilot.weapon_preview.weapon_position.y,
      },
      {
        input: projectileBuffer,
        left: projectileOriginX - effect.origin.x,
        top: muzzleAnchor.y - effect.origin.y,
      },
    ]).png({ compressionLevel: 9 }).toBuffer();
  }));
}

async function writeGifFromBuffers(buffers, delays, outputPath, options) {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'orion-effect-composite-'));
  try {
    const paths = [];
    for (let index = 0; index < buffers.length; index += 1) {
      const path = join(temporaryDirectory, `${frameName(index)}.png`);
      await writeFile(path, buffers[index]);
      paths.push(path);
    }
    return await (options.gifWriter || writeAnimatedGifPreview)({
      framePaths: paths,
      delays,
      outputPath,
      runProcess: options.runProcess,
      ffmpegExecutable: options.ffmpegExecutable,
      cwd: options.projectRoot,
    });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function listFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = join(currentPath, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(rootPath, absolutePath));
    else files.push(relative(rootPath, absolutePath).replaceAll('\\', '/'));
  }
  return files;
}

async function buildManifest(experimentRoot, base) {
  const excluded = new Set(['manifest.json']);
  const paths = (await listFiles(experimentRoot)).filter((path) => !excluded.has(path)).sort();
  const files = [];
  for (const path of paths) {
    const absolutePath = resolveInside(experimentRoot, path, 'Manifest file');
    const [buffer, details] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
    files.push({ path, size: details.size, sha256: sha256(buffer) });
  }
  const payload = { ...base, files };
  return { ...payload, manifest_hash: sha256(JSON.stringify(payload)) };
}

async function loadTimingHistory(path) {
  try {
    const existing = JSON.parse(await readFile(path, 'utf8'));
    if (Array.isArray(existing.runs)) return existing.runs;
    const { runs, ...legacyRun } = existing;
    return [legacyRun];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function animationMetadata(effect, sheet) {
  return {
    schema_version: '1.0',
    effect_key: effect.effect_key,
    name: effect.name,
    kind: effect.kind,
    generation: effect.generation,
    playback: effect.playback,
    root_motion: { x: 0, y: 0 },
    origin: effect.origin,
    canvas: { width: effect.canvas.width, height: effect.canvas.height },
    sprite_sheet: {
      path: `../../sheets/${effect.effect_key}.png`,
      width: sheet.width,
      height: sheet.height,
      gutter: sheet.gutter,
    },
    frames: sheet.frames.map((frame, index) => ({
      ...frame,
      duration_ms: effect.frames[index].duration_ms,
      phase: effect.frames[index].phase,
      transform: effect.frames[index].transform || null,
      path: `../../frames/${effect.effect_key}/${frameName(index)}.png`,
    })),
    preview_gif: effect.frames.length > 1 ? `../../previews/${effect.effect_key}.gif` : null,
    preview_only: ['preview_gif'],
  };
}

export async function generateEffectPilot(options) {
  const pilot = EffectPilotSchema.parse(options.pilot);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(pilot.product_slug);
  const sourceAsset = product.assets.find((asset) => asset.asset_key === pilot.source_asset_key);
  if (!sourceAsset?.final_path || sourceAsset.status !== 'generated') {
    throw new Error(`Source asset ${pilot.source_asset_key} must be a generated canonical product asset.`);
  }
  const productRoot = store.productRoot(product);
  const weaponBuffer = await readFile(resolveInside(productRoot, sourceAsset.final_path, 'Source weapon path'));
  const weaponMetadata = await sharp(weaponBuffer).metadata();
  if (
    pilot.weapon_preview.muzzle_anchor.x > weaponMetadata.width
    || pilot.weapon_preview.muzzle_anchor.y >= weaponMetadata.height
  ) throw new Error('Weapon muzzle anchor must be on or inside the source weapon canvas edge.');
  const experimentRoot = resolveInside(productRoot, `experiments/${pilot.pilot_id}`, 'Effect pilot path');
  const adapter = options.adapter || new OllamaImageAdapter(options.config.generation);
  const readiness = await adapter.checkReadiness();
  if (readiness.status !== 'ready') throw new Error(readiness.detail);

  return withGenerationLock({ projectRoot: options.projectRoot }, async () => {
    const resourceReport = await assertGenerationResourcesAvailable(options.config, {
      fetchImpl: options.fetchImpl,
    });
    const startedAt = options.now || new Date().toISOString();
    const startedMs = Date.now();
    await mkdir(experimentRoot, { recursive: true });
    await writeJson(resolveInside(experimentRoot, 'pilot.json', 'Pilot specification'), pilot);
    const effects = [];
    let generationCalls = 0;

    for (const effect of pilot.effects) {
      const frameResults = [];
      const keyframeNumber = effect.generation.strategy === 'keyframe_transform'
        ? effect.generation.keyframe
        : null;
      const orderedFrames = keyframeNumber === null
        ? effect.frames
        : [
          effect.frames[keyframeNumber],
          ...effect.frames.filter((frame) => frame.frame !== keyframeNumber),
        ];
      let keyframeBuffer = null;
      for (const frame of orderedFrames) {
        const fingerprint = generationFingerprint(pilot, effect, frame);
        const paths = framePaths(experimentRoot, effect, frame);
        const reusable = await loadReusableFrame(paths, fingerprint);
        if (reusable) {
          if (frame.frame === keyframeNumber) keyframeBuffer = reusable.buffer;
          frameResults.push({
            frame: frame.frame,
            buffer: reusable.buffer,
            final_path: relative(experimentRoot, paths.final).replaceAll('\\', '/'),
            validation_path: relative(experimentRoot, paths.validation).replaceAll('\\', '/'),
            duration_ms: frame.duration_ms,
            generation_duration_ms: 0,
            resumed: true,
            source_reused: false,
            derived: keyframeNumber !== null && frame.frame !== keyframeNumber,
          });
          continue;
        }

        const frameStartedMs = Date.now();
        const derived = keyframeNumber !== null && frame.frame !== keyframeNumber;
        let generated = null;
        let processed;
        if (derived) {
          if (!keyframeBuffer) throw new Error(`${effect.effect_key} keyframe is unavailable for derivation.`);
          processed = {
            buffer: await derivePixelArtEffectFrame(keyframeBuffer, {
              ...frame.transform,
              origin: effect.origin,
              maxPaletteColors: pilot.style.max_palette_colors,
              salt: frame.frame,
            }),
            processing_version: PIXEL_ART_PROCESSING_VERSION,
            effect_processing_version: PIXEL_ART_EFFECT_PROCESSING_VERSION,
            derived_from_frame: keyframeNumber,
            transform: frame.transform,
            detected_chroma_key: pilot.style.chroma_key,
            anchor_correction: null,
          };
        } else {
          generated = await loadExistingSource(paths) || await adapter.generateAsset({
            asset: { generation_prompt: frame.prompt, seed: frame.seed },
            sourceWidth: pilot.style.source_width,
            sourceHeight: pilot.style.source_height,
          });
          if (!generated.reprocessed) generationCalls += 1;
          processed = await processPixelArtEffectFrame(generated.buffer, {
            width: effect.canvas.width,
            height: effect.canvas.height,
            padding: effect.canvas.padding,
            placement: effect.placement,
            maxPaletteColors: pilot.style.max_palette_colors,
            chromaKey: pilot.style.chroma_key,
            chromaTolerance: options.config.generation.chroma_tolerance,
            origin: effect.origin_contact_required ? effect.origin : null,
            maximumOriginGap: effect.origin_contact_required ? effect.origin_tolerance * 2 : null,
          });
          if (frame.frame === keyframeNumber) keyframeBuffer = processed.buffer;
        }
        const generatedPaths = framePaths(
          experimentRoot,
          effect,
          frame,
          generated?.format || 'png',
        );
        if (generated) await writeBuffer(generatedPaths.source, generated.buffer);
        await writeBuffer(generatedPaths.final, processed.buffer);
        const [validation, anchorContact] = await Promise.all([
          validateGeneratedAsset(processed.buffer, {
            width: effect.canvas.width,
            height: effect.canvas.height,
            maxPaletteColors: pilot.style.max_palette_colors,
            minimumTransparentRatio: options.config.validation.minimum_transparent_ratio,
            forbiddenChroma: processed.detected_chroma_key,
            chromaTolerance: 45,
            maximumChromaRatio: 0,
          }),
          inspectAnchorContact(processed.buffer, effect.origin, effect.origin_tolerance),
        ]);
        const checks = effect.origin_contact_required
          ? [...validation.checks, { name: 'origin_contact', ...anchorContact }]
          : validation.checks;
        const report = {
          ...validation,
          status: validation.status === 'passed'
            && (!effect.origin_contact_required || anchorContact.passed) ? 'passed' : 'failed',
          checks,
          generation_fingerprint: fingerprint,
          root_motion: { x: 0, y: 0, passed: true },
          origin: effect.origin,
          processing: {
            version: processed.processing_version,
            effect_version: processed.effect_processing_version,
            source: processed.source,
            extracted_bounds: processed.extracted_bounds,
            placed_bounds: processed.placed_bounds,
            removed_chroma_pixels: processed.removed_chroma_pixels,
            detected_chroma_key: processed.detected_chroma_key,
            border_chroma_match_ratio: processed.border_chroma_match_ratio ?? null,
            requested_chroma_distance: processed.requested_chroma_distance ?? null,
            anchor_correction: processed.anchor_correction,
            derived_from_frame: processed.derived_from_frame ?? null,
            transform: processed.transform ?? null,
          },
        };
        await writeJson(generatedPaths.validation, report);
        await writeBuffer(generatedPaths.preview, await createTransparencyPreview(processed.buffer));
        if (report.status !== 'passed') {
          throw new Error(`${effect.effect_key} frame ${frame.frame} failed validation.`);
        }
        frameResults.push({
          frame: frame.frame,
          buffer: processed.buffer,
          final_path: relative(experimentRoot, generatedPaths.final).replaceAll('\\', '/'),
          validation_path: relative(experimentRoot, generatedPaths.validation).replaceAll('\\', '/'),
          duration_ms: frame.duration_ms,
          generation_duration_ms: Date.now() - frameStartedMs,
          resumed: false,
          source_reused: generated?.reprocessed === true,
          derived,
        });
      }

      frameResults.sort((left, right) => left.frame - right.frame);

      const sheet = await assembleEffectSpriteSheet(frameResults.map((frame) => frame.buffer), effect);
      const sheetPath = resolveInside(experimentRoot, `sheets/${effect.effect_key}.png`, 'Effect sheet path');
      const animationPath = resolveInside(experimentRoot, `metadata/${effect.effect_key}/animation.json`, 'Effect animation path');
      await writeBuffer(sheetPath, sheet.buffer);
      await writeJson(animationPath, animationMetadata(effect, sheet));
      let gifPath = null;
      if (effect.frames.length > 1) {
        gifPath = resolveInside(experimentRoot, `previews/${effect.effect_key}.gif`, 'Effect GIF path');
        await (options.gifWriter || writeAnimatedGifPreview)({
          framePaths: frameResults.map((frame) => resolveInside(experimentRoot, frame.final_path, 'Effect frame path')),
          delays: effect.frames.map((frame) => frame.duration_ms),
          outputPath: gifPath,
          runProcess: options.runProcess,
          ffmpegExecutable: options.ffmpegExecutable,
          cwd: options.projectRoot,
        });
      }
      effects.push({
        effect_key: effect.effect_key,
        kind: effect.kind,
        generation: effect.generation,
        frame_count: frameResults.length,
        frames: frameResults.map(({ buffer, ...frame }) => frame),
        sheet_path: relative(experimentRoot, sheetPath).replaceAll('\\', '/'),
        animation_path: relative(experimentRoot, animationPath).replaceAll('\\', '/'),
        preview_gif_path: gifPath ? relative(experimentRoot, gifPath).replaceAll('\\', '/') : null,
      });
    }

    const muzzleEffect = pilot.effects.find((effect) => effect.kind === 'muzzle_flash');
    const muzzleResult = effects.find((effect) => effect.effect_key === muzzleEffect?.effect_key);
    let compositePreviewPath = null;
    if (muzzleEffect && muzzleResult && muzzleEffect.frames.length > 1) {
      const frameBuffers = await Promise.all(muzzleResult.frames.map((frame) => (
        readFile(resolveInside(experimentRoot, frame.final_path, 'Muzzle frame path'))
      )));
      const compositeBuffers = await composeWeaponPreviewFrames({
        weaponBuffer,
        frameBuffers,
        pilot,
        effect: muzzleEffect,
      });
      compositePreviewPath = resolveInside(experimentRoot, 'previews/arc-launcher-composite.gif', 'Composite preview path');
      await writeGifFromBuffers(
        compositeBuffers,
        muzzleEffect.frames.map((frame) => frame.duration_ms),
        compositePreviewPath,
        options,
      );
    }

    const projectileEffect = pilot.effects.find((effect) => effect.kind === 'projectile');
    const projectileResult = effects.find((effect) => effect.effect_key === projectileEffect?.effect_key);
    let projectileTravelPreviewPath = null;
    if (pilot.weapon_preview.projectile_travel_preview && projectileEffect && projectileResult) {
      const projectileBuffer = await readFile(resolveInside(
        experimentRoot,
        projectileResult.frames[0].final_path,
        'Projectile frame path',
      ));
      const travelBuffers = await composeProjectileTravelPreviewFrames({
        weaponBuffer,
        projectileBuffer,
        pilot,
        effect: projectileEffect,
      });
      const travel = pilot.weapon_preview.projectile_travel_preview;
      projectileTravelPreviewPath = resolveInside(
        experimentRoot,
        'previews/arc-launcher-projectile-travel.gif',
        'Projectile travel preview path',
      );
      await writeGifFromBuffers(
        travelBuffers,
        Array.from({ length: travel.frame_count }, () => travel.frame_duration_ms),
        projectileTravelPreviewPath,
        options,
      );
    }

    const completedAt = new Date().toISOString();
    const timingPath = resolveInside(experimentRoot, 'timing.json', 'Pilot timing path');
    const currentRun = {
      started_at: startedAt,
      completed_at: completedAt,
      total_duration_ms: Date.now() - startedMs,
      generation_calls: generationCalls,
      resumed_frames: effects.flatMap((effect) => effect.frames).filter((frame) => frame.resumed).length,
      source_reused_frames: effects.flatMap((effect) => effect.frames)
        .filter((frame) => frame.source_reused).length,
      derived_frames: effects.flatMap((effect) => effect.frames).filter((frame) => frame.derived).length,
      frames: effects.flatMap((effect) => effect.frames.map((frame) => ({
        effect_key: effect.effect_key,
        frame: frame.frame,
        generation_duration_ms: frame.generation_duration_ms,
        resumed: frame.resumed,
        source_reused: frame.source_reused,
        derived: frame.derived,
      }))),
    };
    const timing = {
      ...currentRun,
      runs: [...await loadTimingHistory(timingPath), currentRun],
    };
    await writeJson(timingPath, timing);
    const manifest = await buildManifest(experimentRoot, {
      schema_version: '1.0',
      pilot_id: pilot.pilot_id,
      product_id: product.product_id,
      product_version: product.version,
      source_asset_key: pilot.source_asset_key,
      source_asset_sha256: sha256(weaponBuffer),
      source_weapon_muzzle_anchor: pilot.weapon_preview.muzzle_anchor,
      status: 'awaiting_effects_review',
      canonical_release_mutated: false,
      marketplace_listing_mutated: false,
      distribution_ready: false,
      human_review_required: true,
      gif_role: 'preview_only',
      projectile_travel_role: projectileTravelPreviewPath ? 'preview_only' : null,
      buyer_runtime_formats: ['transparent_png_frames', 'transparent_png_sprite_sheet', 'animation_json'],
      created_at: completedAt,
    });
    await writeJson(resolveInside(experimentRoot, 'manifest.json', 'Pilot manifest path'), manifest);
    return {
      pilot,
      product,
      effects,
      experimentRoot,
      manifest,
      timing,
      composite_preview_path: compositePreviewPath
        ? relative(experimentRoot, compositePreviewPath).replaceAll('\\', '/')
        : null,
      projectile_travel_preview_path: projectileTravelPreviewPath
        ? relative(experimentRoot, projectileTravelPreviewPath).replaceAll('\\', '/')
        : null,
      resource_preflight: resourceReport,
      gates: {
        human_review_required: true,
        canonical_release_mutated: false,
        distribution_ready: false,
      },
      cost: { currency: 'EUR', incurred: 0, estimated: 0 },
    };
  });
}
