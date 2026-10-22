import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { derivePixelArtEffectFrame } from './image-processor.mjs';
import {
  createEnergyPulseFrame,
  detectOpaqueObjectAnchor,
  inspectPulseIsolation,
} from './interactive-item-image.mjs';
import {
  compositeItemFrame,
  createEnergyLevelFrame,
  transparentFrame,
} from './interactive-item-states.mjs';
import {
  createArcaneAuraFrame,
  createExtinguishedCandleFrame,
  createEnergyScatterFrame,
  createFacetedCrystalTurnFrame,
  createFlameDanceFrame,
  createFracturedObjectFrame,
  createLiquidSwirlFrame,
  createRestorativeReleaseFrame,
  createTwinkleFrame,
  orientSmokeAboveWick,
} from './arcane-frame-effects.mjs';

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
  const pulseIntensities = [0.08, 0.34, 0.7, 0.34];
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, pulseIntensities);
  const twinkles = await Promise.all(pulseIntensities.map((_, index) => (
    createTwinkleFrame(baseBuffer, detection, index, { maxPaletteColors: plan.style.max_palette_colors })
  )));
  const idleFrames = await Promise.all(twinkles.map((twinkle, index) => (
    compositeItemFrame(twinkle.compositeBuffer, [pulses[index].overlayBuffer], {
      maxPaletteColors: plan.style.max_palette_colors,
    })
  )));
  const idleOverlays = await Promise.all(twinkles.map((twinkle, index) => (
    compositeItemFrame(empty, [twinkle.overlayBuffer, pulses[index].overlayBuffer], {
      maxPaletteColors: plan.style.max_palette_colors,
    })
  )));
  const idle = await services.writeAnimation(itemRoot, item, 'idle-loop', {
    name: 'Liquid and Glow Idle Loop', playback: 'loop', canvas,
    phases: ['settled', 'bubble-rise', 'glow-peak', 'bubble-fall'],
    durations: [180, 130, 110, 130],
  }, idleFrames, idleOverlays, options);

  let breakFrames;
  let breakStrategy;
  if (item.break_style === 'restorative_release') {
    const restorative = await Promise.all([0.18, 0.46, 0.74].map((progress, index) => (
      createRestorativeReleaseFrame(baseBuffer, detection, progress, {
        salt: item.seed + 51 + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
    )));
    breakFrames = [baseBuffer, pulses[2].compositeBuffer, ...restorative, empty];
    breakStrategy = 'upward_restorative_energy_release_and_dissolve';
  } else {
    const objectAnchor = await detectOpaqueObjectAnchor(baseBuffer);
    const fractures = await Promise.all([0.28, 0.62, 1].map((progress, index) => (
      createFracturedObjectFrame(baseBuffer, objectAnchor.anchor, progress, {
        distance: 7,
        salt: item.seed + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
    )));
    const liquidScatter = await Promise.all([0.24, 0.58, 0.92].map((progress, index) => (
      createEnergyScatterFrame(detection, objectAnchor.anchor, progress, {
        distance: 11,
        salt: item.seed + 31 + index,
        maxPaletteColors: plan.style.max_palette_colors,
      })
    )));
    breakFrames = [
      baseBuffer,
      pulses[2].compositeBuffer,
      await compositeItemFrame(fractures[0], [liquidScatter[0]], { maxPaletteColors: plan.style.max_palette_colors }),
      await compositeItemFrame(fractures[1], [liquidScatter[1]], { maxPaletteColors: plan.style.max_palette_colors }),
      await compositeItemFrame(fractures[2], [liquidScatter[2]], { maxPaletteColors: plan.style.max_palette_colors }),
      empty,
    ];
    breakStrategy = 'approved_base_radial_fragments_with_detected_liquid_scatter';
  }
  const consumeBreak = await services.writeAnimation(itemRoot, item, 'consume-break', {
    name: 'Consume or Break Sequence', playback: 'once', canvas,
    phases: ['sealed', 'charged', 'fracture', 'release', 'dissipate', 'consumed'],
    durations: [140, 90, 80, 90, 130, 180],
  }, breakFrames, [empty, pulses[2].overlayBuffer, breakFrames[2], breakFrames[3], breakFrames[4], empty], options);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'sealed', name: 'Sealed', buffer: baseBuffer },
    { key: 'broken', name: 'Broken / Released', buffer: breakFrames[4] },
    { key: 'consumed', name: 'Consumed', buffer: empty },
  ], canvas);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [idle, consumeBreak],
    // The terminal consumed frame is intentionally transparent. Validate every
    // visible runtime frame while representing that empty terminal state in
    // metadata and the emitted animation sequence.
    validationBuffers: [...pulses.map((frame) => frame.compositeBuffer), ...breakFrames.slice(0, -1)],
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      twinkle_motion: twinkles.map((frame) => frame.report),
      fracture_strategy: breakStrategy,
    },
    generationCalls: 0,
  });
}

async function generateCrystal(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const phases = Array.from({ length: 8 }, (_, index) => (index / 8) * Math.PI * 2);
  const intensities = [0.18, 0.3, 0.44, 0.3, 0.18, 0.3, 0.44, 0.3];
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, intensities);
  const frames = await Promise.all(pulses.map((pulse, index) => createFacetedCrystalTurnFrame(
    pulse.compositeBuffer,
    phases[index],
    { maxPaletteColors: plan.style.max_palette_colors },
  )));
  const empty = await transparentFrame(canvas);
  const idle = await services.writeAnimation(itemRoot, item, 'spin-loop', {
    name: 'Arcane Crystal Spin Loop', playback: 'loop', canvas,
    phases: ['front', 'quarter-right', 'side-right', 'back-quarter-right', 'back', 'back-quarter-left', 'side-left', 'quarter-left'],
    durations: phases.map(() => 115),
  }, frames, frames.map(() => empty), options);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states: null,
    animations: [idle],
    validationBuffers: frames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      rotation: { strategy: 'fixed_anchor_faceted_turn_with_minimum_readable_width', phases },
    },
    generationCalls: 0,
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
    options, plan, item, itemRoot, baseBuffer, canvas, source, detection,
  } = context;
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, [0, 0.28, 0.64, 0.88, 0.42]);
  const empty = await transparentFrame(canvas);
  const tomeBounds = await detectOpaqueObjectAnchor(baseBuffer);
  const auraGeometry = {
    center: tomeBounds.anchor,
    radiusX: Math.round((tomeBounds.bounds.width / 2) + 8),
    radiusY: Math.round((tomeBounds.bounds.height / 2) + 8),
  };
  const auraIntensities = [0, 0.48, 0.72, 1, 0.58];
  const auras = await Promise.all(auraIntensities.map((intensity, index) => createArcaneAuraFrame(
    baseBuffer,
    detection,
    intensity,
    index,
    { ...auraGeometry, maxPaletteColors: plan.style.max_palette_colors },
  )));
  const awakenedFrames = await Promise.all(pulses.map((pulse, index) => compositeItemFrame(
    pulse.compositeBuffer,
    [auras[index].overlayBuffer],
    { maxPaletteColors: plan.style.max_palette_colors },
  )));
  const states = await services.writeStates(itemRoot, item, [
    { key: 'sealed', name: 'Sealed', buffer: baseBuffer },
    { key: 'awakened', name: 'Awakened', buffer: awakenedFrames[3] },
  ], canvas);
  const awakening = await services.writeAnimation(itemRoot, item, 'awakening', {
    name: 'Tome Awakening', playback: 'once', canvas,
    phases: ['sealed', 'rune-wake', 'energy-rise', 'awakened', 'settle'],
    durations: [170, 120, 100, 120, 170],
  }, awakenedFrames, [
    empty, ...auras.slice(1).map((frame) => frame.overlayBuffer),
  ], options);
  const loopFrameIndexes = [2, 3, 4, 3];
  const loop = await services.writeAnimation(itemRoot, item, 'rune-glow-loop', {
    name: 'Tome Awakened Aura Loop', playback: 'loop', canvas,
    phases: ['aura-rest', 'aura-rise', 'aura-shift', 'aura-fall'],
    durations: [170, 120, 100, 120],
  }, loopFrameIndexes.map((index) => awakenedFrames[index]), loopFrameIndexes.map((index) => auras[index].overlayBuffer), options);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [awakening, loop],
    validationBuffers: awakenedFrames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      awakened_aura: auras.map((frame) => frame.report),
      awakened_aura_geometry: auraGeometry,
      identity_preservation: item.replacement_base_description
        ? 'local_model_replacement_base_bound_to_human_review'
        : 'approved_base_only_no_model_redraw',
    },
    generationCalls: 0,
  });
}

async function generateFlask(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const intensities = [0.08, 0.28, 0.52, 0.78, 0.92, 0.68, 0.4, 0.18];
  const { frames: pulses, isolation } = await pulseFrames(baseBuffer, detection, intensities);
  const swirls = await Promise.all(intensities.map((_, index) => createLiquidSwirlFrame(
    baseBuffer,
    detection,
    (index / intensities.length) * Math.PI * 2,
    { amplitude: 5, maxPaletteColors: plan.style.max_palette_colors },
  )));
  const frames = await Promise.all(swirls.map((swirl, index) => compositeItemFrame(
    swirl.compositeBuffer,
    [pulses[index].overlayBuffer],
    { maxPaletteColors: plan.style.max_palette_colors },
  )));
  const empty = await transparentFrame(canvas);
  const overlays = await Promise.all(swirls.map((swirl, index) => compositeItemFrame(
    empty,
    [swirl.overlayBuffer, pulses[index].overlayBuffer],
    { maxPaletteColors: plan.style.max_palette_colors },
  )));
  const animation = await services.writeAnimation(itemRoot, item, 'liquid-swirl-loop', {
    name: 'Visible Liquid Swirl Loop', playback: 'loop', canvas,
    phases: ['stable', 'clockwise-1', 'clockwise-2', 'clockwise-3', 'reaction-peak', 'clockwise-4', 'clockwise-5', 'stable-return'],
    durations: [140, 90, 90, 90, 100, 90, 90, 140],
  }, frames, overlays, options);
  const states = await services.writeStates(itemRoot, item, [
    { key: 'stable', name: 'Stable', buffer: baseBuffer },
    { key: 'unstable', name: 'Unstable', buffer: frames[3] },
  ], canvas);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states,
    animations: [animation],
    validationBuffers: frames,
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      liquid_motion: swirls.map((frame) => frame.report),
    },
    generationCalls: 0,
  });
}

async function generateCandle(context, services) {
  const {
    options, plan, item, itemRoot, baseBuffer, canvas, detection, source,
  } = context;
  const dancePhases = [0, 0.9, 1.8, 2.7, 3.6, 4.5];
  const flame = await Promise.all(dancePhases.map((phase) => createFlameDanceFrame(
    baseBuffer,
    detection,
    phase,
    { amplitude: 3, maxPaletteColors: plan.style.max_palette_colors },
  )));
  const extinguished = await createExtinguishedCandleFrame(baseBuffer, detection, {
    maxPaletteColors: plan.style.max_palette_colors,
  });
  const wick = extinguished.wick;
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
  const risingSmoke = await orientSmokeAboveWick(smoke.buffer, wick, {
    maxPaletteColors: plan.style.max_palette_colors,
  });
  const smokeFrames = await effectSeries(risingSmoke.buffer, wick, item.seed + 71, plan.style.max_palette_colors);
  const loop = await services.writeAnimation(itemRoot, item, 'flame-loop', {
    name: 'Dancing Ritual Flame Loop', playback: 'loop', canvas,
    phases: ['upright', 'bend-right', 'stretch-right', 'upright-return', 'bend-left', 'stretch-left'],
    durations: [105, 90, 85, 105, 90, 85],
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
      flame_motion: flame.map((frame) => frame.report),
      extinguish_mask: extinguished.report,
      effect_alignment: smoke.alignment,
      smoke_direction: risingSmoke.report,
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
  const spellOrigin = { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
  const release = await services.generateIsolatedEffect({
    adapter: context.adapter,
    config: options.config,
    item,
    plan,
    canvas,
    targetOrigin: spellOrigin,
    seedOffset: 81,
    prompt: effectPrompt(plan, item.release_description, [
      'wand', 'weapon', 'character', 'hand', 'floor', 'scenery', 'duplicate effect',
    ]),
  });
  const spellTransforms = [
    { scale: 0.62, opacity: 0.72, density: 0.72 },
    { scale: 0.86, opacity: 0.9, density: 0.9 },
    { scale: 1.12, opacity: 1, density: 1 },
    { scale: 1.3, opacity: 0.58, density: 0.6 },
  ];
  const burst = await Promise.all(spellTransforms.map((transform, index) => derivePixelArtEffectFrame(
    release.buffer,
    { ...transform, origin: spellOrigin, salt: item.seed + 81 + index, maxPaletteColors: plan.style.max_palette_colors },
  )));
  const chargeFrames = [
    baseBuffer,
    charge[1].compositeBuffer,
    charge[2].compositeBuffer,
    charge[3].compositeBuffer,
    baseBuffer,
  ];
  const empty = await transparentFrame(canvas);
  const chargeAnimation = await services.writeAnimation(itemRoot, item, 'wand-charge', {
    name: 'Wand Charge', playback: 'once', canvas,
    phases: ['idle', 'charge-rise', 'charge-build', 'charge-peak', 'ready'],
    durations: [150, 100, 90, 100, 180],
  }, chargeFrames, [empty, charge[1].overlayBuffer, charge[2].overlayBuffer, charge[3].overlayBuffer, empty], options);
  const spellFrames = [burst[0], burst[1], burst[2], burst[3], empty];
  const spellAnimation = await services.writeAnimation(itemRoot, item, 'spell-burst', {
    name: 'Independent Spell Burst', playback: 'once', canvas,
    phases: ['spark', 'form', 'release', 'dissipate', 'clear'],
    durations: [70, 70, 90, 130, 160],
    effectOnly: true,
    origin: spellOrigin,
  }, spellFrames, spellFrames, options);
  await writeSource(resolve(itemRoot, `source/release-peak.${release.generated.format}`), release.generated.buffer);
  return services.finalizeRecipeItem({
    options, plan, item, itemRoot, baseBuffer, sourceLayout: source.layout,
    states: null,
    animations: [chargeAnimation, spellAnimation],
    validationBuffers: [...chargeFrames, ...spellFrames.slice(0, -1)],
    validationDetails: {
      energy_region: detection.report,
      pulse_isolation: isolation,
      effect_alignment: release.alignment,
      wand_tip_anchor: tip,
      spell_origin: spellOrigin,
      separation: 'wand_charge_and_spell_vfx_are_independent_runtime_assets',
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
