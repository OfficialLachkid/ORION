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
  processPixelArtAsset,
  processPixelArtEffectFrame,
} from './image-processor.mjs';
import {
  buildStateContactSheet,
  compositeItemFrame,
  createEnergyLevelFrame,
  createShieldIntegrityFrame,
  transparentFrame,
} from './interactive-item-states.mjs';
import {
  alignEffectCoreToAnchor,
  createEnergyPulseFrame,
  detectDynamicEnergyRegion,
  detectOpaqueObjectAnchor,
  inspectPulseIsolation,
} from './interactive-item-image.mjs';
import { OllamaImageAdapter } from './ollama-image-adapter.mjs';
import { assertGenerationResourcesAvailable } from './resource-preflight.mjs';
import { InteractiveItemAnimationBatchSchema, ProductSpecificationSchema } from './schemas.mjs';

export {
  alignEffectCoreToAnchor,
  createEnergyPulseFrame,
  detectDynamicEnergyRegion,
  detectOpaqueObjectAnchor,
  inspectPulseIsolation,
} from './interactive-item-image.mjs';

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
  energy_pickup: {
    active_key: 'idle-loop',
    active_name: 'Idle Energy Loop',
    active_phases: ['idle', 'pulse-rise', 'pulse-peak', 'pulse-fall'],
    active_intensities: [0.08, 0.32, 0.68, 0.32],
    active_durations: [160, 120, 100, 120],
    effect_transforms: [
      { scale: 0.5, opacity: 0.65, density: 0.72 },
      { scale: 0.82, opacity: 0.9, density: 0.9 },
      { scale: 1, opacity: 1, density: 1 },
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

async function generateDetonationFrames({ adapter, config, item, plan, canvas, targetOrigin }) {
  const generated = await adapter.generateAsset({
    asset: { generation_prompt: detonationPrompt(plan, item), seed: item.seed },
    sourceWidth: plan.style.source_width,
    sourceHeight: plan.style.source_height,
  });
  const center = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
  const anchorReserve = Math.ceil(Math.max(
    Math.abs(targetOrigin.x - center.x),
    Math.abs(targetOrigin.y - center.y),
  ));
  const processed = await processPixelArtEffectFrame(generated.buffer, {
    width: canvas.width,
    height: canvas.height,
    padding: Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.12)) + anchorReserve,
    placement: 'center',
    maxPaletteColors: plan.style.max_palette_colors,
    chromaKey: plan.style.chroma_key,
    chromaTolerance: config.generation.chroma_tolerance,
  });
  const aligned = await alignEffectCoreToAnchor(processed.buffer, {
    colors: plan.style.energy_colors,
    tolerance: plan.style.energy_color_tolerance,
    target: targetOrigin,
    maxPaletteColors: plan.style.max_palette_colors,
  });
  if (!aligned.report.passed) {
    throw new Error(`${item.target_asset_key} detonation could not be aligned without clipping.`);
  }
  const profile = RECIPE_PROFILES[item.recipe];
  const origin = targetOrigin;
  const frames = await Promise.all(profile.vfx_transforms.map((transform, index) => (
    index === 1
      ? aligned.buffer
      : derivePixelArtEffectFrame(aligned.buffer, {
        ...transform,
        origin,
        salt: item.seed + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
  )));
  return { generated, processed, frames, origin, alignment: aligned.report };
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

async function writeStates(root, item, states, canvas) {
  const written = [];
  for (const state of states) {
    const path = resolveInside(root, `states/${state.key}.png`, 'Interactive state');
    await writeBuffer(path, state.buffer);
    written.push({ key: state.key, name: state.name, path });
  }
  const previewPath = resolveInside(root, 'previews/states.png', 'State contact sheet');
  await writeBuffer(previewPath, await buildStateContactSheet(states, canvas));
  const metadata = {
    schema_version: '1.0',
    asset_key: item.target_asset_key,
    root_motion: { x: 0, y: 0 },
    canvas,
    states: written.map((state) => ({
      state_key: state.key,
      name: state.name,
      path: `../../states/${state.key}.png`,
    })),
    preview: '../../previews/states.png',
    preview_only: ['preview'],
  };
  const metadataPath = resolveInside(root, 'metadata/states.json', 'State metadata');
  await writeJson(metadataPath, metadata);
  return { states: written, previewPath, metadataPath, metadata };
}

function isolatedEffectPrompt(plan, item, description, exclusions) {
  return [
    description,
    `Use only this palette: ${plan.style.palette.join(', ')}.`,
    'Create one isolated effect keyframe in crisp low-resolution pixel art with square pixel clusters and no antialiasing.',
    `Effect only: no ${exclusions.join(', ')}.`,
    `Use a perfectly flat ${plan.style.chroma_key} background touching every border pixel.`,
    'No shadow, frame, scenery, text, logo, gradient background, or semi-transparent haze.',
  ].join(' ');
}

async function generateIsolatedEffect({ adapter, config, item, plan, canvas, prompt, targetOrigin, seedOffset = 0 }) {
  const generated = await adapter.generateAsset({
    asset: { generation_prompt: prompt, seed: item.seed + seedOffset },
    sourceWidth: plan.style.source_width,
    sourceHeight: plan.style.source_height,
  });
  const center = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
  const anchorReserve = targetOrigin ? Math.ceil(Math.max(
    Math.abs(targetOrigin.x - center.x),
    Math.abs(targetOrigin.y - center.y),
  )) : 0;
  const processed = await processPixelArtEffectFrame(generated.buffer, {
    width: canvas.width,
    height: canvas.height,
    padding: Math.max(8, Math.round(Math.min(canvas.width, canvas.height) * 0.12)) + anchorReserve,
    placement: 'center',
    maxPaletteColors: plan.style.max_palette_colors,
    chromaKey: plan.style.chroma_key,
    chromaTolerance: config.generation.chroma_tolerance,
  });
  const alignmentOptions = {
    colors: plan.style.energy_colors,
    tolerance: plan.style.energy_color_tolerance,
    target: targetOrigin,
    maxPaletteColors: plan.style.max_palette_colors,
  };
  let aligned = targetOrigin
    ? await alignEffectCoreToAnchor(processed.buffer, alignmentOptions)
    : { buffer: processed.buffer, report: null };
  if (aligned.report && !aligned.report.passed) {
    const detectedOrigin = aligned.report.detected_origin;
    for (const scale of [0.78, 0.62, 0.48]) {
      const compact = await derivePixelArtEffectFrame(processed.buffer, {
        scale,
        opacity: 1,
        density: 1,
        origin: detectedOrigin,
        salt: item.seed + seedOffset + Math.round(scale * 100),
        maxPaletteColors: plan.style.max_palette_colors,
      });
      aligned = await alignEffectCoreToAnchor(compact, alignmentOptions);
      if (aligned.report.passed) {
        aligned.report.retry_scale = scale;
        break;
      }
    }
  }
  if (aligned.report && !aligned.report.passed) throw new Error(`${item.target_asset_key} effect alignment failed.`);
  return { generated, processed, buffer: aligned.buffer, alignment: aligned.report };
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

async function resolveSourceProduct(store, targetProduct, sourceSlug) {
  try {
    const product = await store.loadProduct(sourceSlug);
    if (product) return { product, root: store.productRoot(product), layout: 'canonical_product' };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const targetRoot = store.productRoot(targetProduct);
  const root = resolveInside(targetRoot, `experiments/${sourceSlug}`, 'Interactive item source experiment');
  const product = ProductSpecificationSchema.parse(JSON.parse(await readFile(resolve(root, 'product.json'), 'utf8')));
  if (product.slug !== sourceSlug) throw new Error(`Interactive item source slug changed: ${sourceSlug}.`);
  return { product, root, layout: 'product_experiment' };
}

async function validateRuntimeBuffers(buffers, options, canvas) {
  return Promise.all(buffers.map((buffer) => validateGeneratedAsset(buffer, {
    width: canvas.width,
    height: canvas.height,
    maxPaletteColors: options.plan.style.max_palette_colors,
    minimumTransparentRatio: options.config.validation.minimum_transparent_ratio,
    forbiddenChroma: options.plan.style.chroma_key,
    chromaTolerance: 45,
    maximumChromaRatio: 0,
  })));
}

async function finalizeRecipeItem({
  options,
  plan,
  item,
  itemRoot,
  baseBuffer,
  sourceLayout,
  states,
  animations,
  validationBuffers,
  validationDetails = {},
  generationCalls = 0,
  qualityHolds = [],
}) {
  const reports = await validateRuntimeBuffers(validationBuffers, { ...options, plan }, {
    width: (await sharp(baseBuffer).metadata()).width,
    height: (await sharp(baseBuffer).metadata()).height,
  });
  const validation = {
    status: reports.every((report) => report.status === 'passed') ? 'passed' : 'failed',
    root_motion: { x: 0, y: 0, passed: true },
    base_sha256: sha256(baseBuffer),
    base_regenerated: false,
    quality_holds: qualityHolds,
    frame_reports: reports,
    ...validationDetails,
  };
  await writeJson(resolveInside(itemRoot, 'validation.json', 'Item validation'), validation);
  if (validation.status !== 'passed') throw new Error(`${item.target_asset_key} interactive frames failed validation.`);
  const manifest = await buildManifest(itemRoot, {
    schema_version: '1.0',
    item: {
      source_product_slug: item.source_product_slug,
      source_asset_key: item.source_asset_key,
      target_asset_key: item.target_asset_key,
      name: item.name,
      recipe: item.recipe,
      source_layout: sourceLayout,
    },
    status: 'awaiting_animation_review',
    base_regenerated: false,
    generation_calls: generationCalls,
    incurred_cost: 0,
    quality_holds: qualityHolds,
    buyer_runtime_formats: [
      'transparent_base_png',
      ...(states?.states?.length ? ['transparent_state_pngs', 'states_json'] : []),
      ...(animations.length ? [
        'transparent_overlay_png_frames',
        'transparent_composite_png_frames',
        'transparent_png_sprite_sheet',
        'animation_json',
      ] : []),
    ],
    preview_only_formats: [
      ...(states?.previewPath ? ['state_contact_sheet_png'] : []),
      ...(animations.length ? ['animated_gif'] : []),
    ],
    states: states?.states?.map((state) => state.key) || [],
    animations: animations.map((animation) => animation.key),
  });
  await writeJson(resolveInside(itemRoot, 'manifest.json', 'Item manifest'), manifest);
  return { item, itemRoot, manifest, validation, states, animations };
}

async function generateEnergyStatesRecipe(context) {
  const { options, plan, item, itemRoot, baseBuffer, canvas, detection, source } = context;
  const definitions = item.recipe === 'power_cell'
    ? [
      ['empty', 'Empty', -0.82],
      ['low', 'Low Charge', -0.42],
      ['full', 'Full Charge', 0],
      ['overcharged', 'Overcharged', 0.72],
    ]
    : [
      ['powered-off', 'Powered Off', -0.78],
      ['powered-on', 'Powered On', 0],
    ];
  const rendered = await Promise.all(definitions.map(async ([key, name, level]) => ({
    key,
    name,
    ...(await createEnergyLevelFrame(baseBuffer, detection, level)),
  })));
  const states = await writeStates(itemRoot, item, rendered.map((state) => ({
    key: state.key,
    name: state.name,
    buffer: state.compositeBuffer,
  })), canvas);
  const animations = [];
  const validationBuffers = rendered.map((state) => state.compositeBuffer);
  if (item.recipe === 'power_cell') {
    const charging = await Promise.all([-0.65, -0.3, 0.15, 0.65, 0.15, -0.3].map((level) => (
      createEnergyLevelFrame(baseBuffer, detection, level)
    )));
    animations.push(await writeAnimation(itemRoot, item, 'charging-loop', {
      name: 'Charging Loop',
      playback: 'loop',
      canvas,
      phases: ['empty', 'low', 'charging', 'overcharged', 'settling', 'low-return'],
      durations: [150, 120, 100, 90, 110, 130],
    }, charging.map((frame) => frame.compositeBuffer), charging.map((frame) => frame.overlayBuffer), options));
    validationBuffers.push(...charging.map((frame) => frame.compositeBuffer));
  }
  return finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states, animations, validationBuffers,
    validationDetails: { energy_region: detection.report },
  });
}

async function generatePickupRecipe(context) {
  const { options, plan, item, itemRoot, baseBuffer, canvas, detection, source, adapter } = context;
  const profile = RECIPE_PROFILES.energy_pickup;
  const active = await Promise.all(profile.active_intensities.map((intensity) => (
    createEnergyPulseFrame(baseBuffer, detection, intensity)
  )));
  const idle = await writeAnimation(itemRoot, item, profile.active_key, {
    name: profile.active_name,
    playback: 'loop',
    canvas,
    phases: profile.active_phases,
    durations: profile.active_durations,
  }, active.map((frame) => frame.compositeBuffer), active.map((frame) => frame.overlayBuffer), options);
  const anchor = detection.report.components[0]?.centroid || detection.report.centroid;
  const effect = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: anchor,
    prompt: isolatedEffectPrompt(plan, item, item.collection_description, [
      'pickup object', 'weapon', 'character', 'floor', 'scenery', 'duplicate burst',
    ]),
  });
  const burstOverlays = await Promise.all(profile.effect_transforms.map((transform, index) => (
    index === profile.effect_transforms.length - 1
      ? effect.buffer
      : derivePixelArtEffectFrame(effect.buffer, {
        ...transform,
        origin: anchor,
        salt: item.seed + 20 + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
  )));
  const empty = await transparentFrame(canvas);
  const collectFrames = [
    baseBuffer,
    await compositeItemFrame(baseBuffer, [burstOverlays[0]]),
    await compositeItemFrame(baseBuffer, [burstOverlays[1]]),
    burstOverlays[2],
    empty,
  ];
  const collect = await writeAnimation(itemRoot, item, 'collect-burst', {
    name: 'Collection Burst',
    playback: 'once',
    canvas,
    phases: ['available', 'contact', 'burst-rise', 'burst-peak', 'collected'],
    durations: [100, 70, 70, 90, 120],
  }, collectFrames, [empty, burstOverlays[0], burstOverlays[1], burstOverlays[2], empty], options);
  await writeBuffer(resolveInside(itemRoot, `source/collection-peak.${effect.generated.format}`, 'Collection source'), effect.generated.buffer);
  const states = await writeStates(itemRoot, item, [
    { key: 'available', name: 'Available', buffer: baseBuffer },
    { key: 'collected', name: 'Collected', buffer: empty },
  ], canvas);
  return finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [idle, collect],
    validationBuffers: [...active.map((frame) => frame.compositeBuffer), ...burstOverlays],
    validationDetails: { energy_region: detection.report, collection_alignment: effect.alignment },
    generationCalls: 1,
  });
}

async function generateShieldRecipe(context) {
  const { options, plan, item, itemRoot, baseBuffer, canvas, detection, source, adapter } = context;
  const deviceOrigin = await detectOpaqueObjectAnchor(baseBuffer);
  const deviceAnchor = {
    x: deviceOrigin.anchor.x,
    y: deviceOrigin.bounds.y + deviceOrigin.bounds.height - 1,
  };
  const field = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    prompt: isolatedEffectPrompt(plan, item, item.field_description, [
      'emitter device', 'mine', 'weapon', 'character', 'floor', 'scenery', 'full opaque fill',
    ]),
  });
  const impactTarget = { x: Math.round(canvas.width * 0.68), y: Math.round(canvas.height * 0.34) };
  const impact = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: impactTarget,
    seedOffset: 1,
    prompt: isolatedEffectPrompt(plan, item, item.impact_description, [
      'emitter device', 'shield bubble', 'weapon', 'projectile', 'character', 'floor', 'scenery',
    ]),
  });
  const brokenField = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    seedOffset: 2,
    prompt: isolatedEffectPrompt(plan, item, item.break_description, [
      'emitter device', 'intact shield orb', 'weapon', 'projectile', 'character', 'floor', 'scenery', 'smoke',
    ]),
  });
  const fieldFrames = await Promise.all([
    { scale: 0.45, opacity: 0.35, density: 1 },
    { scale: 0.72, opacity: 0.68, density: 1 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 0.96, opacity: 0.82, density: 1 },
  ].map((transform, index) => derivePixelArtEffectFrame(field.buffer, {
    ...transform,
    origin: deviceAnchor,
    salt: item.seed + 30 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const empty = await transparentFrame(canvas);
  const combineField = (overlay) => compositeItemFrame(baseBuffer, [overlay], { baseOnTop: true, canvas });
  const powerUpComposite = await Promise.all([empty, ...fieldFrames.slice(0, 3)].map((overlay, index) => (
    index === 0 ? baseBuffer : combineField(overlay)
  )));
  const powerUp = await writeAnimation(itemRoot, item, 'power-up', {
    name: 'Power Up', playback: 'once', canvas,
    phases: ['inactive', 'field-start', 'field-rise', 'active'], durations: [120, 90, 90, 140],
  }, powerUpComposite, [empty, ...fieldFrames.slice(0, 3)], options);
  const activeOverlays = [fieldFrames[2], fieldFrames[3], fieldFrames[2], fieldFrames[1]];
  const activeComposite = await Promise.all(activeOverlays.map(combineField));
  const active = await writeAnimation(itemRoot, item, 'active-loop', {
    name: 'Active Shield Loop', playback: 'loop', canvas,
    phases: ['active', 'field-soften', 'active-return', 'field-pulse'], durations: [140, 120, 140, 120],
  }, activeComposite, activeOverlays, options);
  const impactFrames = await Promise.all([
    { scale: 0.48, opacity: 0.64, density: 0.72 },
    { scale: 0.76, opacity: 0.9, density: 0.9 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 1.18, opacity: 0.42, density: 0.56 },
  ].map((transform, index) => derivePixelArtEffectFrame(impact.buffer, {
    ...transform,
    origin: impactTarget,
    salt: item.seed + 40 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const hitComposite = await Promise.all(impactFrames.map((hit) => (
    compositeItemFrame(baseBuffer, [fieldFrames[2], hit], { baseOnTop: true, canvas })
  )));
  const hit = await writeAnimation(itemRoot, item, 'shield-hit', {
    name: 'Shield Hit Reaction', playback: 'once', canvas,
    phases: ['contact', 'impact-rise', 'impact-peak', 'dissipation'], durations: [70, 60, 80, 120],
  }, hitComposite, impactFrames, options);
  const damagedOverlays = await Promise.all([
    [fieldFrames[2], impactFrames[2]],
    [fieldFrames[3], impactFrames[2]],
    [fieldFrames[2], impactFrames[1]],
  ].map((layers) => compositeItemFrame(empty, layers)));
  const damagedComposite = await Promise.all(damagedOverlays.map((overlay) => (
    compositeItemFrame(baseBuffer, [overlay], { baseOnTop: true, canvas })
  )));
  const damaged = await writeAnimation(itemRoot, item, 'damaged-loop', {
    name: 'Damaged Shield Loop', playback: 'loop', canvas,
    phases: ['cracked', 'stress-pulse', 'cracked-return'], durations: [160, 100, 140],
  }, damagedComposite, damagedOverlays, options);
  const breakFrames = await Promise.all([
    { scale: 0.58, opacity: 0.62, density: 0.86 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 1.18, opacity: 0.62, density: 0.7 },
  ].map((transform, index) => derivePixelArtEffectFrame(brokenField.buffer, {
    ...transform,
    origin: deviceAnchor,
    salt: item.seed + 50 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const breakOverlays = await Promise.all([
    [fieldFrames[2], impactFrames[2]],
    [fieldFrames[3], breakFrames[0]],
    [breakFrames[1]],
    [breakFrames[2]],
    [],
  ].map((layers) => compositeItemFrame(empty, layers)));
  const breakComposite = await Promise.all(breakOverlays.map((overlay) => (
    compositeItemFrame(baseBuffer, [overlay], { baseOnTop: true, canvas })
  )));
  const shieldBreak = await writeAnimation(itemRoot, item, 'shield-break', {
    name: 'Shield Break and Scatter', playback: 'once', canvas,
    phases: ['damaged', 'fracture', 'break', 'scatter', 'broken'], durations: [90, 70, 80, 120, 180],
  }, breakComposite, breakOverlays, options);
  const downOverlays = [fieldFrames[2], fieldFrames[1], fieldFrames[0], empty];
  const downComposite = await Promise.all(downOverlays.map((overlay, index) => (
    index === downOverlays.length - 1 ? baseBuffer : combineField(overlay)
  )));
  const powerDown = await writeAnimation(itemRoot, item, 'power-down', {
    name: 'Power Down', playback: 'once', canvas,
    phases: ['active', 'field-fall', 'field-end', 'inactive'], durations: [100, 90, 90, 140],
  }, downComposite, downOverlays, options);
  await Promise.all([
    writeBuffer(resolveInside(itemRoot, `source/shield-field.${field.generated.format}`, 'Shield field source'), field.generated.buffer),
    writeBuffer(resolveInside(itemRoot, `source/shield-impact.${impact.generated.format}`, 'Shield impact source'), impact.generated.buffer),
    writeBuffer(resolveInside(itemRoot, `source/shield-break.${brokenField.generated.format}`, 'Shield break source'), brokenField.generated.buffer),
  ]);
  const states = await writeStates(itemRoot, item, [
    { key: 'inactive', name: 'Inactive', buffer: baseBuffer },
    { key: 'active', name: 'Active Shield', buffer: activeComposite[0] },
    { key: 'damaged', name: 'Damaged / Cracked', buffer: damagedComposite[0] },
    { key: 'broken', name: 'Broken / Field Down', buffer: baseBuffer },
  ], canvas);
  return finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [powerUp, active, hit, damaged, shieldBreak, powerDown],
    validationBuffers: [
      ...fieldFrames,
      ...impactFrames,
      ...breakFrames,
      ...activeComposite,
      ...damagedComposite,
      ...breakComposite,
    ],
    validationDetails: {
      energy_region: detection.report,
      device_origin: deviceOrigin,
      field_origin: deviceAnchor,
      impact_alignment: impact.alignment,
    },
    generationCalls: 3,
  });
}

async function generatePlasmaShieldRecipe(context) {
  const { options, plan, item, itemRoot, baseBuffer, canvas, detection, source, adapter } = context;
  const fieldOrigin = await detectOpaqueObjectAnchor(baseBuffer);
  const integrityLevels = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
  const integrityFrames = await Promise.all(integrityLevels.map(async (level) => ({
    key: `integrity-${level}`,
    name: `${level}% Integrity`,
    buffer: await createShieldIntegrityFrame(baseBuffer, level, {
      seed: item.seed,
      cellSize: 6,
      maxPaletteColors: plan.style.max_palette_colors,
    }),
  })));
  const empty = await transparentFrame(canvas);
  const frameAt = (level) => integrityFrames.find((state) => state.name === `${level}% Integrity`).buffer;
  const states = await writeStates(itemRoot, item, [
    ...integrityFrames,
    { key: 'broken', name: 'Broken / Empty', buffer: empty },
  ], canvas);

  const activationFrames = await Promise.all([
    { scale: 0.35, opacity: 0.3, density: 0.72 },
    { scale: 0.62, opacity: 0.58, density: 0.86 },
    { scale: 0.84, opacity: 0.82, density: 0.94 },
  ].map((transform, index) => derivePixelArtEffectFrame(baseBuffer, {
    ...transform,
    origin: fieldOrigin.anchor,
    salt: item.seed + 10 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const powerUpFrames = [empty, ...activationFrames, baseBuffer];
  const powerUp = await writeAnimation(itemRoot, item, 'power-up', {
    name: 'Shield Power Up', playback: 'once', canvas,
    phases: ['inactive', 'field-start', 'field-rise', 'field-form', 'active'],
    durations: [100, 80, 80, 90, 140],
  }, powerUpFrames, powerUpFrames, options);

  const pulses = await Promise.all([0, 0.18, 0.38, 0.18].map((intensity) => (
    createEnergyPulseFrame(baseBuffer, detection, intensity)
  )));
  const active = await writeAnimation(itemRoot, item, 'active-loop', {
    name: 'Active Shield Loop', playback: 'loop', canvas,
    phases: ['active', 'pulse-rise', 'pulse-peak', 'pulse-fall'], durations: [140, 110, 90, 110],
  }, pulses.map((frame) => frame.compositeBuffer), pulses.map((frame) => frame.overlayBuffer), options);

  const impactTarget = { x: Math.round(canvas.width * 0.7), y: Math.round(canvas.height * 0.32) };
  const impact = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: impactTarget,
    prompt: isolatedEffectPrompt(plan, item, item.impact_description, [
      'emitter device', 'pedestal', 'statue', 'complete shield orb', 'weapon', 'projectile',
      'character', 'floor', 'scenery', 'text', 'logo',
    ]),
  });
  const impactFrames = await Promise.all([
    { scale: 0.42, opacity: 0.55, density: 0.72 },
    { scale: 0.72, opacity: 0.86, density: 0.9 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 1.14, opacity: 0.38, density: 0.52 },
  ].map((transform, index) => derivePixelArtEffectFrame(impact.buffer, {
    ...transform,
    origin: impactTarget,
    salt: item.seed + 30 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const hitComposite = await Promise.all(impactFrames.map((overlay) => (
    compositeItemFrame(baseBuffer, [overlay], { maxPaletteColors: plan.style.max_palette_colors })
  )));
  const hit = await writeAnimation(itemRoot, item, 'shield-hit', {
    name: 'Shield Hit Reaction', playback: 'once', canvas,
    phases: ['contact', 'impact-rise', 'impact-peak', 'dissipation'], durations: [70, 60, 80, 120],
  }, hitComposite, impactFrames, options);

  const decayFrames = integrityFrames.map((state) => state.buffer);
  const decay = await writeAnimation(itemRoot, item, 'integrity-decay', {
    name: 'Integrity Decay', playback: 'once', canvas,
    phases: integrityLevels.map((level) => `integrity-${level}`),
    durations: integrityLevels.map(() => 110),
  }, decayFrames, decayFrames, options);

  const brokenField = await generateIsolatedEffect({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: fieldOrigin.anchor,
    seedOffset: 1,
    prompt: isolatedEffectPrompt(plan, item, item.break_description, [
      'emitter device', 'pedestal', 'statue', 'intact shield orb', 'weapon', 'projectile',
      'character', 'floor', 'scenery', 'smoke', 'text', 'logo',
    ]),
  });
  const breakEffects = await Promise.all([
    { scale: 0.55, opacity: 0.58, density: 0.76 },
    { scale: 0.82, opacity: 0.86, density: 0.9 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 1.18, opacity: 0.44, density: 0.54 },
  ].map((transform, index) => derivePixelArtEffectFrame(brokenField.buffer, {
    ...transform,
    origin: fieldOrigin.anchor,
    salt: item.seed + 50 + index,
    maxPaletteColors: plan.style.max_palette_colors,
  })));
  const breakFrames = await Promise.all([
    Promise.resolve(frameAt(70)),
    compositeItemFrame(frameAt(50), [breakEffects[0]], { maxPaletteColors: plan.style.max_palette_colors }),
    compositeItemFrame(frameAt(30), [breakEffects[1]], { maxPaletteColors: plan.style.max_palette_colors }),
    compositeItemFrame(frameAt(10), [breakEffects[2]], { maxPaletteColors: plan.style.max_palette_colors }),
    Promise.resolve(breakEffects[3]),
    Promise.resolve(empty),
  ]);
  const shieldBreak = await writeAnimation(itemRoot, item, 'shield-break', {
    name: 'Shield Break and Scatter', playback: 'once', canvas,
    phases: ['damaged', 'fracture', 'collapse', 'break', 'scatter', 'empty'],
    durations: [90, 70, 70, 80, 120, 180],
  }, breakFrames, [frameAt(70), breakEffects[0], breakEffects[1], breakEffects[2], breakEffects[3], empty], options);

  const powerDownFrames = [baseBuffer, activationFrames[2], activationFrames[1], activationFrames[0], empty];
  const powerDown = await writeAnimation(itemRoot, item, 'power-down', {
    name: 'Shield Power Down', playback: 'once', canvas,
    phases: ['active', 'field-fall', 'field-contract', 'field-end', 'inactive'],
    durations: [100, 80, 80, 90, 140],
  }, powerDownFrames, powerDownFrames, options);
  await Promise.all([
    writeBuffer(resolveInside(itemRoot, `source/shield-impact.${impact.generated.format}`, 'Shield impact source'), impact.generated.buffer),
    writeBuffer(resolveInside(itemRoot, `source/shield-break.${brokenField.generated.format}`, 'Shield break source'), brokenField.generated.buffer),
  ]);
  return finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [powerUp, active, hit, decay, shieldBreak, powerDown],
    validationBuffers: [
      ...integrityFrames.map((state) => state.buffer),
      ...activationFrames,
      ...pulses.map((frame) => frame.compositeBuffer),
      ...hitComposite,
      ...breakFrames.slice(0, -1),
    ],
    validationDetails: {
      energy_region: detection.report,
      field_origin: fieldOrigin,
      impact_alignment: impact.alignment,
      integrity_levels: integrityLevels,
    },
    generationCalls: 2,
  });
}

async function generateCrateRecipe(context) {
  const { options, plan, item, itemRoot, baseBuffer, canvas, source, adapter } = context;
  async function generateState(key, name, description, seedOffset) {
    const generated = await adapter.generateAsset({
      asset: {
        seed: item.seed + seedOffset,
        generation_prompt: [
          `Create one ${name.toLowerCase()} state for the same science-fiction supply crate design described here: ${description}`,
          `Use only this palette: ${plan.style.palette.join(', ')}.`,
          'Crisp low-resolution pixel art with deliberate square pixel clusters and no antialiasing.',
          'One complete crate in slight three-quarter side view with generous empty padding.',
          `Use a perfectly flat ${plan.style.chroma_key} background touching every border pixel.`,
          'No weapon, loose item, character, floor, cast shadow, text, logo, scenery, or duplicate crate.',
        ].join(' '),
      },
      sourceWidth: plan.style.source_width,
      sourceHeight: plan.style.source_height,
    });
    const processed = await processPixelArtAsset(generated.buffer, {
      width: canvas.width,
      height: canvas.height,
      maxPaletteColors: plan.style.max_palette_colors,
      chromaKey: plan.style.chroma_key,
      chromaTolerance: options.config.generation.chroma_tolerance,
    });
    await writeBuffer(resolveInside(itemRoot, `source/${key}.${generated.format}`, 'Crate state source'), generated.buffer);
    return { key, name, buffer: processed.buffer };
  }
  const generated = await Promise.all([
    generateState('open', 'Open', item.open_description, 1),
    generateState('open-empty', 'Open Empty', item.empty_description, 2),
  ]);
  const stateDefinitions = [{ key: 'closed', name: 'Closed', buffer: baseBuffer }, ...generated];
  const states = await writeStates(itemRoot, item, stateDefinitions, canvas);
  return finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [],
    validationBuffers: stateDefinitions.map((state) => state.buffer),
    generationCalls: 2,
    qualityHolds: ['Text-only generation cannot prove crate identity consistency; human visual review is required.'],
  });
}

async function generateItem(options, plan, item, batchRoot, adapter, targetProduct) {
  const sourceStore = options.store || new CanonicalProductStore(options.outputRoot);
  const source = await resolveSourceProduct(sourceStore, targetProduct, item.source_product_slug);
  const sourceProduct = source.product;
  const sourceAsset = sourceProduct.assets.find((asset) => asset.asset_key === item.source_asset_key);
  if (!sourceAsset?.final_path || sourceAsset.status !== 'generated') {
    throw new Error(`Source asset ${item.source_product_slug}/${item.source_asset_key} is not generated.`);
  }
  const sourceRoot = source.root;
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
  const recipeContext = {
    options,
    plan,
    item,
    itemRoot,
    baseBuffer,
    canvas,
    detection,
    source,
    adapter,
  };
  if (item.recipe === 'power_cell' || item.recipe === 'workbench') {
    return generateEnergyStatesRecipe(recipeContext);
  }
  if (item.recipe === 'energy_pickup') return generatePickupRecipe(recipeContext);
  if (item.recipe === 'shield_emitter') return generateShieldRecipe(recipeContext);
  if (item.recipe === 'plasma_shield') return generatePlasmaShieldRecipe(recipeContext);
  if (item.recipe === 'supply_crate') return generateCrateRecipe(recipeContext);
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

  const detonationOrigin = await detectOpaqueObjectAnchor(baseBuffer);
  const detonation = await generateDetonationFrames({
    adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: detonationOrigin.anchor,
  });
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
    detonation_alignment: detonation.alignment,
    detonation_origin: detonationOrigin,
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
      source_layout: source.layout,
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
      results.push(await generateItem({ ...options, store }, plan, item, batchRoot, adapter, targetProduct));
    }
    const batchManifest = await buildManifest(batchRoot, {
      schema_version: '1.0',
      batch_id: plan.batch_id,
      product_slug: plan.product_slug,
      title: plan.title,
      status: 'awaiting_animation_review',
      base_assets_regenerated: false,
      generation_calls: results.reduce((total, result) => total + (result.manifest.generation_calls || 0), 0),
      quality_holds: results.flatMap((result) => (
        result.manifest.quality_holds || []
      ).map((reason) => ({ asset_key: result.item.target_asset_key, reason }))),
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
