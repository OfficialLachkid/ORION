import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { validateGeneratedAsset } from './asset-validator.mjs';
import { CanonicalProductStore } from './canonical-store.mjs';
import { assembleEffectSpriteSheet, writeAnimatedGifPreview } from './effect-pilot.mjs';
import { withGenerationLock } from './generation-lock.mjs';
import {
  createTransparencyPreview,
  derivePixelArtEffectFrame,
  processPixelArtEffectFrame,
} from './image-processor.mjs';
import { OllamaImageAdapter } from './ollama-image-adapter.mjs';
import { assertGenerationResourcesAvailable } from './resource-preflight.mjs';
import { InteractiveItemAnimationBatchSchema } from './schemas.mjs';

const SHEET_GUTTER = 4;

const RECIPE_PROFILES = Object.freeze({
  grenade: {
    active_key: 'armed-loop',
    active_name: 'Armed Warning Loop',
    active_phases: ['idle', 'warning-rise', 'warning-peak', 'warning-fall'],
    active_intensities: [0, 0.3, 0.72, 0.3],
    active_durations: [180, 120, 90, 120],
    detonation_phases: ['armed', 'charge', 'detonation', 'dissipation'],
    detonation_durations: [120, 80, 80, 140],
    vfx_transforms: [
      { scale: 0.55, opacity: 0.82, density: 0.82 },
      { scale: 1, opacity: 1, density: 1 },
      { scale: 1.22, opacity: 0.55, density: 0.62 },
    ],
  },
  proximity_mine: {
    active_key: 'sensor-alert-loop',
    active_name: 'Sensor Alert Loop',
    active_phases: ['scan-idle', 'scan-rise', 'scan-peak', 'scan-fall'],
    active_intensities: [0.08, 0.36, 0.78, 0.36],
    active_durations: [150, 110, 80, 110],
    detonation_phases: ['triggered', 'critical', 'detonation', 'dissipation'],
    detonation_durations: [110, 70, 80, 150],
    vfx_transforms: [
      { scale: 0.62, opacity: 0.85, density: 0.86 },
      { scale: 1, opacity: 1, density: 1 },
      { scale: 1.28, opacity: 0.5, density: 0.58 },
    ],
  },
});

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

function parseHex(value) {
  const normalized = value.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

function colorDistanceSquared(pixel, color) {
  return ((pixel[0] - color[0]) ** 2)
    + ((pixel[1] - color[1]) ** 2)
    + ((pixel[2] - color[2]) ** 2);
}

function summarizeComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const components = [];
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start];
    visited[start] = 1;
    let cursor = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let xTotal = 0;
    let yTotal = 0;
    while (cursor < queue.length) {
      const index = queue[cursor++];
      const x = index % width;
      const y = Math.floor(index / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      xTotal += x;
      yTotal += y;
      for (const [dx, dy] of neighbors) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) continue;
        const next = (nextY * width) + nextX;
        if (!mask[next] || visited[next]) continue;
        visited[next] = 1;
        queue.push(next);
      }
    }
    components.push({
      pixels: queue.length,
      bounds: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
      centroid: {
        x: Math.round(xTotal / queue.length),
        y: Math.round(yTotal / queue.length),
      },
    });
  }
  return components.sort((left, right) => right.pixels - left.pixels);
}

export async function detectDynamicEnergyRegion(assetBuffer, options) {
  const decoded = await sharp(assetBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = options.colors.map(parseHex);
  const threshold = options.tolerance ** 2;
  const mask = new Uint8Array(decoded.info.width * decoded.info.height);
  let xTotal = 0;
  let yTotal = 0;
  let matchedPixels = 0;
  for (let y = 0; y < decoded.info.height; y += 1) {
    for (let x = 0; x < decoded.info.width; x += 1) {
      const pixelIndex = (y * decoded.info.width) + x;
      const offset = pixelIndex * 4;
      if (decoded.data[offset + 3] < (options.alphaThreshold ?? 128)) continue;
      const pixel = [decoded.data[offset], decoded.data[offset + 1], decoded.data[offset + 2]];
      if (!colors.some((color) => colorDistanceSquared(pixel, color) <= threshold)) continue;
      mask[pixelIndex] = 1;
      matchedPixels += 1;
      xTotal += x;
      yTotal += y;
    }
  }
  if (matchedPixels < (options.minimumPixels ?? 4)) {
    throw new Error(`Dynamic energy-region detection found only ${matchedPixels} matching pixels.`);
  }
  const components = summarizeComponents(mask, decoded.info.width, decoded.info.height);
  return {
    mask,
    decoded,
    report: {
      strategy: 'palette_connected_components',
      colors: options.colors,
      tolerance: options.tolerance,
      matched_pixels: matchedPixels,
      centroid: { x: Math.round(xTotal / matchedPixels), y: Math.round(yTotal / matchedPixels) },
      components,
    },
  };
}

export async function createEnergyPulseFrame(assetBuffer, detection, intensity) {
  const overlay = Buffer.alloc(detection.decoded.data.length);
  for (let pixel = 0; pixel < detection.mask.length; pixel += 1) {
    if (!detection.mask[pixel] || intensity <= 0) continue;
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const source = detection.decoded.data[offset + channel];
      overlay[offset + channel] = Math.round(source + ((255 - source) * intensity));
    }
    overlay[offset + 3] = detection.decoded.data[offset + 3];
  }
  const overlayBuffer = await sharp(overlay, {
    raw: { width: detection.decoded.info.width, height: detection.decoded.info.height, channels: 4 },
  }).png({ palette: true, colours: 32, dither: 0, compressionLevel: 9 }).toBuffer();
  const compositeBuffer = intensity <= 0
    ? assetBuffer
    : await sharp(assetBuffer).composite([{ input: overlayBuffer }]).png({ compressionLevel: 9 }).toBuffer();
  return { overlayBuffer, compositeBuffer };
}

export async function inspectPulseIsolation(baseBuffer, compositeBuffer, mask) {
  const [base, composite] = await Promise.all([
    sharp(baseBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(compositeBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (base.info.width !== composite.info.width || base.info.height !== composite.info.height) {
    return { passed: false, changed_pixels: 0, outside_region_changes: 1 };
  }
  let changedPixels = 0;
  let outsideRegionChanges = 0;
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    const bothTransparent = base.data[offset + 3] === 0 && composite.data[offset + 3] === 0;
    const changed = !bothTransparent
      && [0, 1, 2, 3].some((channel) => base.data[offset + channel] !== composite.data[offset + channel]);
    if (!changed) continue;
    changedPixels += 1;
    if (!mask[pixel]) outsideRegionChanges += 1;
  }
  return {
    passed: changedPixels > 0 && outsideRegionChanges === 0,
    changed_pixels: changedPixels,
    outside_region_changes: outsideRegionChanges,
  };
}

function detonationPrompt(plan, item) {
  return [
    `Create one isolated peak detonation VFX keyframe for the ${item.name}.`,
    item.detonation_description,
    `Use only this palette: ${plan.style.palette.join(', ')}.`,
    'Crisp low-resolution pixel art with deliberate square pixel clusters and no antialiasing.',
    'Effect only: no grenade, mine, weapon, character, floor, scenery, smoke cloud, text, logo, or duplicate effect.',
    'Centered compact radial burst with a bright cyan core, restrained violet fragments, and generous empty padding.',
    `Use a perfectly flat ${plan.style.chroma_key} background touching every border pixel.`,
    'No shadow, border, frame, gradient background, or semi-transparent haze.',
  ].join(' ');
}

async function generateDetonationFrames({ adapter, config, item, plan, canvas }) {
  const generated = await adapter.generateAsset({
    asset: { generation_prompt: detonationPrompt(plan, item), seed: item.seed },
    sourceWidth: plan.style.source_width,
    sourceHeight: plan.style.source_height,
  });
  const processed = await processPixelArtEffectFrame(generated.buffer, {
    width: canvas.width,
    height: canvas.height,
    padding: Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.12)),
    placement: 'center',
    maxPaletteColors: plan.style.max_palette_colors,
    chromaKey: plan.style.chroma_key,
    chromaTolerance: config.generation.chroma_tolerance,
  });
  const profile = RECIPE_PROFILES[item.recipe];
  const origin = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
  const frames = await Promise.all(profile.vfx_transforms.map((transform, index) => (
    index === 1
      ? processed.buffer
      : derivePixelArtEffectFrame(processed.buffer, {
        ...transform,
        origin,
        salt: item.seed + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
  )));
  return { generated, processed, frames, origin };
}

async function writeAnimation(root, item, key, definition, frames, overlays, options = {}) {
  const framePaths = [];
  const overlayPaths = [];
  for (let index = 0; index < frames.length; index += 1) {
    const framePath = resolveInside(root, `frames/${key}/${String(index).padStart(2, '0')}.png`, 'Animation frame');
    const overlayPath = resolveInside(root, `overlays/${key}/${String(index).padStart(2, '0')}.png`, 'Animation overlay');
    await Promise.all([writeBuffer(framePath, frames[index]), writeBuffer(overlayPath, overlays[index])]);
    framePaths.push(framePath);
    overlayPaths.push(overlayPath);
  }
  const sheet = await assembleEffectSpriteSheet(frames, { canvas: definition.canvas }, { gutter: SHEET_GUTTER });
  const sheetPath = resolveInside(root, `sheets/${key}.png`, 'Animation sheet');
  const gifPath = resolveInside(root, `previews/${key}.gif`, 'Animation GIF');
  await writeBuffer(sheetPath, sheet.buffer);
  await (options.gifWriter || writeAnimatedGifPreview)({
    framePaths,
    delays: definition.durations,
    outputPath: gifPath,
    runProcess: options.runProcess,
    ffmpegExecutable: options.ffmpegExecutable,
    cwd: options.projectRoot,
  });
  const metadata = {
    schema_version: '1.0',
    asset_key: item.target_asset_key,
    animation_key: key,
    name: definition.name,
    playback: definition.playback,
    root_motion: { x: 0, y: 0 },
    base_sprite: '../../base.png',
    canvas: definition.canvas,
    sprite_sheet: {
      path: `../../sheets/${key}.png`,
      width: sheet.width,
      height: sheet.height,
      gutter: sheet.gutter,
    },
    frames: sheet.frames.map((frame, index) => ({
      ...frame,
      phase: definition.phases[index],
      duration_ms: definition.durations[index],
      composite_path: `../../frames/${key}/${String(index).padStart(2, '0')}.png`,
      overlay_path: `../../overlays/${key}/${String(index).padStart(2, '0')}.png`,
    })),
    preview_gif: `../../previews/${key}.gif`,
    preview_only: ['preview_gif'],
  };
  const metadataPath = resolveInside(root, `metadata/${key}/animation.json`, 'Animation metadata');
  await writeJson(metadataPath, metadata);
  return { key, framePaths, overlayPaths, sheetPath, gifPath, metadataPath, metadata };
}

async function listFiles(rootPath, currentPath = rootPath) {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(currentPath, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(rootPath, path));
    else files.push(relative(rootPath, path).replaceAll('\\', '/'));
  }
  return files;
}

async function buildManifest(root, base) {
  const paths = (await listFiles(root)).filter((path) => path !== 'manifest.json').sort();
  const files = [];
  for (const path of paths) {
    const absolute = resolveInside(root, path, 'Manifest file');
    const [buffer, details] = await Promise.all([readFile(absolute), stat(absolute)]);
    files.push({ path, size: details.size, sha256: sha256(buffer) });
  }
  const payload = { ...base, files };
  return { ...payload, manifest_hash: sha256(JSON.stringify(payload)) };
}

async function generateItem(options, plan, item, batchRoot, adapter) {
  const sourceStore = options.store || new CanonicalProductStore(options.outputRoot);
  const sourceProduct = await sourceStore.loadProduct(item.source_product_slug);
  const sourceAsset = sourceProduct.assets.find((asset) => asset.asset_key === item.source_asset_key);
  if (!sourceAsset?.final_path || sourceAsset.status !== 'generated') {
    throw new Error(`Source asset ${item.source_product_slug}/${item.source_asset_key} is not generated.`);
  }
  const sourceRoot = sourceStore.productRoot(sourceProduct);
  const baseBuffer = await readFile(resolveInside(sourceRoot, sourceAsset.final_path, 'Interactive item base'));
  const metadata = await sharp(baseBuffer).metadata();
  const canvas = { width: metadata.width, height: metadata.height };
  const itemRoot = resolveInside(batchRoot, item.target_asset_key, 'Interactive item root');
  await writeBuffer(resolveInside(itemRoot, 'base.png', 'Base sprite'), baseBuffer);
  await writeBuffer(
    resolveInside(itemRoot, 'previews/base-transparency.png', 'Base transparency preview'),
    await createTransparencyPreview(baseBuffer),
  );

  const detection = await detectDynamicEnergyRegion(baseBuffer, {
    colors: plan.style.energy_colors,
    tolerance: plan.style.energy_color_tolerance,
  });
  await writeJson(resolveInside(itemRoot, 'metadata/energy-region.json', 'Energy region report'), detection.report);
  const profile = RECIPE_PROFILES[item.recipe];
  const active = await Promise.all(profile.active_intensities.map((intensity) => (
    createEnergyPulseFrame(baseBuffer, detection, intensity)
  )));
  const isolation = await Promise.all(active.slice(1).map((frame) => (
    inspectPulseIsolation(baseBuffer, frame.compositeBuffer, detection.mask)
  )));
  if (!isolation.every((report) => report.passed)) {
    throw new Error(`${item.target_asset_key} pulse isolation changed pixels outside the detected energy region.`);
  }
  const activeAnimation = await writeAnimation(
    itemRoot,
    item,
    profile.active_key,
    {
      name: profile.active_name,
      playback: 'loop',
      canvas,
      phases: profile.active_phases,
      durations: profile.active_durations,
    },
    active.map((frame) => frame.compositeBuffer),
    active.map((frame) => frame.overlayBuffer),
    options,
  );

  const detonation = await generateDetonationFrames({ adapter, config: options.config, item, plan, canvas });
  const sourceEffectPath = resolveInside(itemRoot, `source/detonation-peak.${detonation.generated.format}`, 'Detonation source');
  await writeBuffer(sourceEffectPath, detonation.generated.buffer);
  const charge = active.at(-1);
  const detonationCompositeFrames = [
    charge.compositeBuffer,
    ...detonation.frames,
  ];
  const detonationOverlayFrames = [
    charge.overlayBuffer,
    ...detonation.frames,
  ];
  const detonationAnimation = await writeAnimation(
    itemRoot,
    item,
    'detonation',
    {
      name: 'Detonation Sequence',
      playback: 'once',
      canvas,
      phases: profile.detonation_phases,
      durations: profile.detonation_durations,
    },
    detonationCompositeFrames,
    detonationOverlayFrames,
    options,
  );
  const validations = await Promise.all([
    ...active.map((frame) => frame.compositeBuffer),
    ...detonation.frames,
  ].map((buffer) => validateGeneratedAsset(buffer, {
    width: canvas.width,
    height: canvas.height,
    maxPaletteColors: plan.style.max_palette_colors,
    minimumTransparentRatio: options.config.validation.minimum_transparent_ratio,
    forbiddenChroma: plan.style.chroma_key,
    chromaTolerance: 45,
    maximumChromaRatio: 0,
  })));
  const validation = {
    status: validations.every((report) => report.status === 'passed') ? 'passed' : 'failed',
    root_motion: { x: 0, y: 0, passed: true },
    base_sha256: sha256(baseBuffer),
    base_regenerated: false,
    energy_region: detection.report,
    pulse_isolation: isolation,
    frame_reports: validations,
  };
  await writeJson(resolveInside(itemRoot, 'validation.json', 'Item validation'), validation);
  if (validation.status !== 'passed') throw new Error(`${item.target_asset_key} animation frames failed validation.`);
  const manifest = await buildManifest(itemRoot, {
    schema_version: '1.0',
    item: {
      source_product_slug: item.source_product_slug,
      source_asset_key: item.source_asset_key,
      target_asset_key: item.target_asset_key,
      name: item.name,
      recipe: item.recipe,
    },
    status: 'awaiting_animation_review',
    base_regenerated: false,
    generation_calls: 1,
    incurred_cost: 0,
    buyer_runtime_formats: [
      'transparent_base_png',
      'transparent_overlay_png_frames',
      'transparent_composite_png_frames',
      'transparent_png_sprite_sheet',
      'animation_json',
    ],
    preview_only_formats: ['animated_gif'],
    animations: [activeAnimation.key, detonationAnimation.key],
  });
  await writeJson(resolveInside(itemRoot, 'manifest.json', 'Item manifest'), manifest);
  return {
    item,
    itemRoot,
    manifest,
    validation,
    animations: [activeAnimation, detonationAnimation],
  };
}

export async function generateInteractiveItemAnimationBatch(options) {
  const plan = InteractiveItemAnimationBatchSchema.parse(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const targetProduct = await store.loadProduct(plan.product_slug);
  const batchRoot = resolveInside(store.productRoot(targetProduct), `experiments/${plan.batch_id}`, 'Animation batch path');
  const adapter = options.adapter || new OllamaImageAdapter(options.config.generation);
  const readiness = await adapter.checkReadiness();
  if (readiness.status !== 'ready') throw new Error(readiness.detail);

  return withGenerationLock({ projectRoot: options.projectRoot }, async () => {
    const resourceReport = await assertGenerationResourcesAvailable(options.config, {
      fetchImpl: options.fetchImpl,
    });
    const started = Date.now();
    const results = [];
    for (const item of plan.items) {
      results.push(await generateItem({ ...options, store }, plan, item, batchRoot, adapter));
    }
    const batchManifest = await buildManifest(batchRoot, {
      schema_version: '1.0',
      batch_id: plan.batch_id,
      product_slug: plan.product_slug,
      title: plan.title,
      status: 'awaiting_animation_review',
      base_assets_regenerated: false,
      generation_calls: results.length,
      incurred_cost: 0,
      item_manifests: results.map((result) => ({
        asset_key: result.item.target_asset_key,
        manifest_hash: result.manifest.manifest_hash,
      })),
      gates: {
        all_items_valid: results.every((result) => result.validation.status === 'passed'),
        human_review_required: true,
        package_modified: false,
      },
    });
    await writeJson(resolveInside(batchRoot, 'manifest.json', 'Batch manifest'), batchManifest);
    return {
      plan,
      batchRoot,
      manifest: batchManifest,
      results,
      resource_preflight: resourceReport,
      timing: { total_duration_ms: Date.now() - started },
      cost: { currency: 'EUR', incurred: 0, estimated: 0 },
    };
  });
}
