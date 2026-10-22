import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  derivePixelArtEffectFrame,
  processPixelArtAsset,
} from './image-processor.mjs';
import {
  createEnergyPulseFrame,
  detectDynamicEnergyRegion,
  detectOpaqueObjectAnchor,
  inspectPulseIsolation,
} from './interactive-item-image.mjs';
import {
  compositeItemFrame,
  createEnergyLevelFrame,
  transparentFrame,
} from './interactive-item-states.mjs';

const ARCANE_RECIPES = new Set(['potion', 'crystal', 'rune_stone', 'tome', 'flask', 'candle', 'wand']);

export function isArcaneItemRecipe(recipe) {
  return ARCANE_RECIPES.has(recipe);
}

async function writeSource(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}

function effectPrompt(plan, description, exclusions) {
  return [
    description,
    `Use only this palette: ${plan.style.palette.join(', ')}.`,
    'Create one isolated magical effect keyframe in crisp low-resolution pixel art with deliberate square pixel clusters and no antialiasing.',
    `Effect only: no ${exclusions.join(', ')}.`,
    `Use a perfectly flat ${plan.style.chroma_key} background touching every border pixel.`,
    'No shadow, frame, scenery, text, logo, gradient background, or semi-transparent haze.',
  ].join(' ');
}

async function pulseFrames(baseBuffer, detection, intensities) {
  const frames = await Promise.all(intensities.map((intensity) => (
    createEnergyPulseFrame(baseBuffer, detection, intensity)
  )));
  const isolation = await Promise.all(frames.filter((_, index) => intensities[index] > 0).map((frame) => (
    inspectPulseIsolation(baseBuffer, frame.compositeBuffer, detection.mask)
  )));
  if (!isolation.every((report) => report.passed)) {
    throw new Error('Arcane energy pulse changed pixels outside the detected emissive region.');
  }
  return { frames, isolation };
}

async function effectSeries(buffer, origin, seed, maxPaletteColors) {
  const transforms = [
    { scale: 0.48, opacity: 0.62, density: 0.64 },
    { scale: 0.76, opacity: 0.86, density: 0.86 },
    { scale: 1, opacity: 1, density: 1 },
    { scale: 1.12, opacity: 0.6, density: 0.58 },
  ];
  return Promise.all(transforms.map((transform, index) => (
    index === 2 ? buffer : derivePixelArtEffectFrame(buffer, {
      ...transform,
      origin,
      salt: seed + index,
      maxPaletteColors,
    })
  )));
}

async function generatePotion(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const empty = await transparentFrame(canvas);
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, [0.08, 0.34, 0.7, 0.34]);
  const idle = await services.writeAnimation(itemRoot, item, 'idle-loop', {
    name: 'Liquid and Glow Idle Loop', playback: 'loop', canvas,
    phases: ['settled', 'bubble-rise', 'glow-peak', 'bubble-fall'],
    durations: [180, 130, 110, 130],
  }, pulses.map((frame) => frame.compositeBuffer), pulses.map((frame) => frame.overlayBuffer), options);

  const objectAnchor = await detectOpaqueObjectAnchor(baseBuffer);
  const effect = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: objectAnchor.anchor,
    seedOffset: 31,
    prompt: effectPrompt(plan, item.break_description, [
      'intact potion bottle', 'character', 'hand', 'floor', 'scenery', 'duplicate effect',
    ]),
  });
  const effects = await effectSeries(effect.buffer, objectAnchor.anchor, item.seed + 31, plan.style.max_palette_colors);
  const breakFrames = [
    baseBuffer,
    pulses[2].compositeBuffer,
    await compositeItemFrame(baseBuffer, [effects[0]], { maxPaletteColors: plan.style.max_palette_colors }),
    effects[2],
    effects[3],
    empty,
  ];
  const consumeBreak = await services.writeAnimation(itemRoot, item, 'consume-break', {
    name: 'Consume or Break Sequence', playback: 'once', canvas,
    phases: ['sealed', 'charged', 'fracture', 'release', 'dissipate', 'consumed'],
    durations: [140, 90, 80, 90, 130, 180],
  }, breakFrames, [empty, pulses[2].overlayBuffer, effects[0], effects[2], effects[3], empty], options);
  await writeSource(resolve(itemRoot, `source/break-peak.${effect.generated.format}`), effect.generated.buffer);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'sealed', name: 'Sealed', buffer: baseBuffer },
    { key: 'broken', name: 'Broken / Released', buffer: effects[3] },
    { key: 'consumed', name: 'Consumed', buffer: empty },
  ], canvas);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [idle, consumeBreak],
    validationBuffers: [...pulses.map((frame) => frame.compositeBuffer), ...breakFrames],
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: effect.alignment,
    },
    generationCalls: 1,
  });
}

async function generateCrystal(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, [0.08, 0.34, 0.7, 0.34]);
  const objectAnchor = await detectOpaqueObjectAnchor(baseBuffer);
  const effect = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: objectAnchor.anchor,
    seedOffset: 41,
    prompt: effectPrompt(plan, item.orbit_description, [
      'crystal', 'character', 'hand', 'floor', 'scenery', 'solid orb',
    ]),
  });
  const orbit = await effectSeries(effect.buffer, objectAnchor.anchor, item.seed + 41, plan.style.max_palette_colors);
  const frames = await Promise.all(pulses.map((pulse, index) => (
    compositeItemFrame(pulse.compositeBuffer, [orbit[index]], { maxPaletteColors: plan.style.max_palette_colors })
  )));
  const idle = await services.writeAnimation(itemRoot, item, 'idle-loop', {
    name: 'Arcane Crystal Energy Loop', playback: 'loop', canvas,
    phases: ['rest', 'orbit-rise', 'glow-peak', 'orbit-fall'],
    durations: [170, 130, 110, 130],
  }, frames, orbit, options);
  await writeSource(resolve(itemRoot, `source/orbit-peak.${effect.generated.format}`), effect.generated.buffer);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states: null,
    animations: [idle],
    validationBuffers: frames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: effect.alignment,
    },
    generationCalls: 1,
  });
}

async function generateRuneStone(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const inactive = await createEnergyLevelFrame(baseBuffer, detection, -0.76);
  const { frames: activation, isolation } = await pulseFrames(baseBuffer, detection, [0, 0.22, 0.48, 0.78, 0.48, 0.22]);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'inactive', name: 'Inactive', buffer: inactive.compositeBuffer },
    { key: 'active', name: 'Active', buffer: activation[3].compositeBuffer },
  ], canvas);
  const animation = await services.writeAnimation(itemRoot, item, 'activation', {
    name: 'Rune Activation', playback: 'once', canvas,
    phases: ['inactive', 'wake', 'flow', 'active', 'settle', 'ready'],
    durations: [170, 110, 90, 110, 100, 150],
  }, [inactive.compositeBuffer, ...activation.slice(1).map((frame) => frame.compositeBuffer)], [
    inactive.overlayBuffer, ...activation.slice(1).map((frame) => frame.overlayBuffer),
  ], options);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [animation],
    validationBuffers: [inactive.compositeBuffer, ...activation.map((frame) => frame.compositeBuffer)],
    validationDetails: { energy_region: detection.report, pulse_isolation: isolation },
  });
}

async function generateTome(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, source, sourceAsset,
  } = context;
  const generated = await context.adapter.generateAsset({
    asset: {
      seed: item.seed + 51,
      generation_prompt: [
        `Create the open state of the exact same ${item.name} described here: ${sourceAsset.generation_prompt}`,
        item.open_description,
        `Use only this palette: ${plan.style.palette.join(', ')}.`,
        'Crisp low-resolution pixel art with deliberate square pixel clusters and no antialiasing.',
        `Use a perfectly flat ${plan.style.chroma_key} background touching every border pixel.`,
        'One complete open tome in the same centered inventory-icon view, scale, lighting, outline, and identity as the closed source design.',
        'No hand, character, floor, scenery, text, logo, duplicate book, cast shadow, or frame.',
      ].join(' '),
    },
    sourceWidth: plan.style.source_width,
    sourceHeight: plan.style.source_height,
  });
  const open = await processPixelArtAsset(generated.buffer, {
    width: canvas.width,
    height: canvas.height,
    maxPaletteColors: plan.style.max_palette_colors,
    chromaKey: plan.style.chroma_key,
    chromaTolerance: options.config.generation.chroma_tolerance,
  });
  await writeSource(resolve(itemRoot, `source/open.${generated.format}`), generated.buffer);
  const openDetection = await detectDynamicEnergyRegion(open.buffer, {
    colors: plan.style.energy_colors,
    tolerance: plan.style.energy_color_tolerance,
  });
  const { frames: openPulses, isolation } = await pulseFrames(open.buffer, openDetection, [0.08, 0.36, 0.72, 0.36]);
  const empty = await transparentFrame(canvas);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'closed', name: 'Closed', buffer: baseBuffer },
    { key: 'open', name: 'Open', buffer: open.buffer },
  ], canvas);
  const opening = await services.writeAnimation(itemRoot, item, 'opening', {
    name: 'Tome Opening', playback: 'once', canvas,
    phases: ['closed', 'magic-wake', 'open', 'open-active'],
    durations: [170, 110, 120, 170],
  }, [baseBuffer, openPulses[1].compositeBuffer, open.buffer, openPulses[2].compositeBuffer], [
    empty, openPulses[1].overlayBuffer, empty, openPulses[2].overlayBuffer,
  ], options);
  const loop = await services.writeAnimation(itemRoot, item, 'open-energy-loop', {
    name: 'Open Tome Energy Loop', playback: 'loop', canvas,
    phases: ['rest', 'energy-rise', 'energy-peak', 'energy-fall'],
    durations: [170, 120, 100, 120],
  }, openPulses.map((frame) => frame.compositeBuffer), openPulses.map((frame) => frame.overlayBuffer), options);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [opening, loop],
    validationBuffers: [baseBuffer, open.buffer, ...openPulses.map((frame) => frame.compositeBuffer)],
    validationDetails: { energy_region: openDetection.report, pulse_isolation: isolation },
    generationCalls: 1,
    qualityHolds: ['Human review must confirm that the generated open state preserves the approved tome identity.'],
  });
}

async function generateFlask(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, [0.08, 0.32, 0.68, 0.92, 0.48, 0.22]);
  const origin = detection.report.components[0]?.centroid || detection.report.centroid;
  const effect = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: origin,
    seedOffset: 61,
    prompt: effectPrompt(plan, item.reaction_description, [
      'flask', 'bottle', 'character', 'hand', 'floor', 'scenery', 'large explosion',
    ]),
  });
  const bubbles = await effectSeries(effect.buffer, origin, item.seed + 61, plan.style.max_palette_colors);
  const frames = await Promise.all(pulses.map((pulse, index) => (
    compositeItemFrame(pulse.compositeBuffer, [bubbles[index % bubbles.length]], { maxPaletteColors: plan.style.max_palette_colors })
  )));
  const animation = await services.writeAnimation(itemRoot, item, 'liquid-reaction-loop', {
    name: 'Unstable Liquid Reaction Loop', playback: 'loop', canvas,
    phases: ['stable', 'bubble-rise', 'swirl', 'reaction-peak', 'settle', 'stable-return'],
    durations: [170, 120, 100, 90, 120, 150],
  }, frames, pulses.map((pulse, index) => (
    index < bubbles.length ? bubbles[index] : pulse.overlayBuffer
  )), options);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'stable', name: 'Stable', buffer: baseBuffer },
    { key: 'unstable', name: 'Unstable', buffer: frames[3] },
  ], canvas);
  await writeSource(resolve(itemRoot, `source/reaction-peak.${effect.generated.format}`), effect.generated.buffer);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [animation],
    validationBuffers: frames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: effect.alignment,
    },
    generationCalls: 1,
  });
}

async function generateCandle(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const { frames: flame, isolation } = await pulseFrames(baseBuffer, detection, [0.08, 0.42, 0.76, 0.28, 0.64, 0.22]);
  const extinguished = await createEnergyLevelFrame(baseBuffer, detection, -0.92);
  const wick = detection.report.components[0]?.centroid || detection.report.centroid;
  const smoke = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: wick,
    seedOffset: 71,
    prompt: effectPrompt(plan, item.smoke_description, [
      'candle', 'flame', 'character', 'hand', 'floor', 'scenery', 'large smoke cloud',
    ]),
  });
  const smokeFrames = await effectSeries(smoke.buffer, wick, item.seed + 71, plan.style.max_palette_colors);
  const loop = await services.writeAnimation(itemRoot, item, 'flame-loop', {
    name: 'Ritual Flame Loop', playback: 'loop', canvas,
    phases: ['rest', 'flicker-high', 'flare', 'flicker-low', 'warm-rise', 'settle'],
    durations: [120, 80, 90, 80, 100, 110],
  }, flame.map((frame) => frame.compositeBuffer), flame.map((frame) => frame.overlayBuffer), options);
  const extinguishFrames = [
    baseBuffer,
    flame[2].compositeBuffer,
    await compositeItemFrame(extinguished.compositeBuffer, [smokeFrames[0]], { maxPaletteColors: plan.style.max_palette_colors }),
    await compositeItemFrame(extinguished.compositeBuffer, [smokeFrames[2]], { maxPaletteColors: plan.style.max_palette_colors }),
    await compositeItemFrame(extinguished.compositeBuffer, [smokeFrames[3]], { maxPaletteColors: plan.style.max_palette_colors }),
    extinguished.compositeBuffer,
  ];
  const extinguish = await services.writeAnimation(itemRoot, item, 'extinguish', {
    name: 'Flame Extinguish', playback: 'once', canvas,
    phases: ['lit', 'flare', 'snuff', 'smoke-rise', 'smoke-fade', 'extinguished'],
    durations: [140, 80, 90, 120, 150, 200],
  }, extinguishFrames, [
    flame[0].overlayBuffer, flame[2].overlayBuffer, smokeFrames[0], smokeFrames[2], smokeFrames[3], extinguished.overlayBuffer,
  ], options);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'lit', name: 'Lit', buffer: baseBuffer },
    { key: 'extinguished', name: 'Extinguished', buffer: extinguished.compositeBuffer },
  ], canvas);
  await writeSource(resolve(itemRoot, `source/smoke-peak.${smoke.generated.format}`), smoke.generated.buffer);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [loop, extinguish],
    validationBuffers: [...flame.map((frame) => frame.compositeBuffer), ...extinguishFrames],
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: smoke.alignment,
    },
    generationCalls: 1,
  });
}

async function generateWand(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const { frames: charge, isolation } = await pulseFrames(baseBuffer, detection, [0, 0.28, 0.58, 0.88]);
  const tip = detection.report.components[0]?.centroid || detection.report.centroid;
  const release = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: tip,
    seedOffset: 81,
    prompt: effectPrompt(plan, item.release_description, [
      'wand', 'weapon', 'character', 'hand', 'floor', 'scenery', 'duplicate effect',
    ]),
  });
  const burst = await effectSeries(release.buffer, tip, item.seed + 81, plan.style.max_palette_colors);
  const frames = [
    baseBuffer,
    charge[1].compositeBuffer,
    charge[2].compositeBuffer,
    charge[3].compositeBuffer,
    await compositeItemFrame(baseBuffer, [burst[2]], { maxPaletteColors: plan.style.max_palette_colors }),
    await compositeItemFrame(baseBuffer, [burst[3]], { maxPaletteColors: plan.style.max_palette_colors }),
    baseBuffer,
  ];
  const empty = await transparentFrame(canvas);
  const animation = await services.writeAnimation(itemRoot, item, 'charge-release', {
    name: 'Wand Charge and Release', playback: 'once', canvas,
    phases: ['idle', 'charge-rise', 'charge-build', 'charge-peak', 'release', 'spark-decay', 'ready'],
    durations: [150, 100, 90, 80, 80, 130, 180],
  }, frames, [empty, charge[1].overlayBuffer, charge[2].overlayBuffer, charge[3].overlayBuffer, burst[2], burst[3], empty], options);
  await writeSource(resolve(itemRoot, `source/release-peak.${release.generated.format}`), release.generated.buffer);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states: null,
    animations: [animation],
    validationBuffers: frames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: release.alignment,
    },
    generationCalls: 1,
  });
}

export async function generateArcaneItemRecipe(context, services) {
  if (context.item.recipe === 'potion') return generatePotion(context, services);
  if (context.item.recipe === 'crystal') return generateCrystal(context, services);
  if (context.item.recipe === 'rune_stone') return generateRuneStone(context, services);
  if (context.item.recipe === 'tome') return generateTome(context, services);
  if (context.item.recipe === 'flask') return generateFlask(context, services);
  if (context.item.recipe === 'candle') return generateCandle(context, services);
  if (context.item.recipe === 'wand') return generateWand(context, services);
  throw new Error(`Unsupported arcane item recipe: ${context.item.recipe}`);
}
