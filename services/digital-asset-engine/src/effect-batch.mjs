import { generateEffectPilot } from './effect-pilot.mjs';
import { EffectBatchPlanSchema, EffectPilotSchema } from './schemas.mjs';

const PALETTE = [
  '#10131d',
  '#20283a',
  '#44506b',
  '#7785a6',
  '#c8d4ec',
  '#35d9ff',
  '#875cff',
  '#ff4fd8',
];

const PROFILES = Object.freeze({
  compact: {
    weapon_canvas: { width: 208, height: 96 },
    weapon_position: { x: 16, y: 16 },
    travel_canvas: { width: 320, height: 96 },
    travel_duration_ms: 55,
    projectile_canvas: { width: 40, height: 20, padding: 3 },
    muzzle_canvas: { width: 48, height: 48, padding: 4 },
    impact_canvas: { width: 48, height: 48, padding: 4 },
    projectile_duration_ms: 80,
    muzzle_durations: [50, 60, 70, 90],
    impact_durations: [60, 80, 100, 120],
  },
  standard: {
    weapon_canvas: { width: 224, height: 104 },
    weapon_position: { x: 16, y: 20 },
    travel_canvas: { width: 352, height: 104 },
    travel_duration_ms: 70,
    projectile_canvas: { width: 48, height: 24, padding: 3 },
    muzzle_canvas: { width: 64, height: 64, padding: 4 },
    impact_canvas: { width: 64, height: 64, padding: 4 },
    projectile_duration_ms: 100,
    muzzle_durations: [70, 80, 90, 110],
    impact_durations: [70, 90, 110, 140],
  },
  heavy: {
    weapon_canvas: { width: 224, height: 112 },
    weapon_position: { x: 16, y: 24 },
    travel_canvas: { width: 352, height: 112 },
    travel_duration_ms: 80,
    projectile_canvas: { width: 64, height: 32, padding: 4 },
    muzzle_canvas: { width: 80, height: 72, padding: 4 },
    impact_canvas: { width: 80, height: 80, padding: 4 },
    projectile_duration_ms: 120,
    muzzle_durations: [90, 100, 120, 150],
    impact_durations: [90, 120, 150, 180],
  },
});

function centerOrigin(canvas) {
  return { x: Math.floor(canvas.width / 2), y: Math.floor(canvas.height / 2) };
}

function derivedFrame(frame, durationMs, phase, seed, transform) {
  return {
    frame,
    duration_ms: durationMs,
    phase,
    seed,
    prompt: `Deterministically derived ${phase} frame.`,
    transform,
  };
}

function strictPrompt(subject, description, canvas) {
  return `Create one original isolated pixel-art ${subject}, strict side view travelling or emitting only toward the right. ${description} Make it readable at ${canvas.width}x${canvas.height} pixels. Use crisp hard pixel clusters, no gradients, no antialiasing, no weapon, no character, no text, no shadow, no floor, no border, and no other objects. Use only dark gunmetal, cyan, violet, pale blue, and white. Keep it fully inside the canvas. The entire background, including every enclosed empty area, must be a perfectly flat solid pure green #00ff00 chroma field.`;
}

export function createWeaponEffectPilot(batchPlan, weaponSpecification) {
  const plan = EffectBatchPlanSchema.parse(batchPlan);
  const weapon = weaponSpecification || plan.weapons[0];
  const profile = PROFILES[weapon.profile];
  const key = weapon.source_asset_key;
  const muzzleOrigin = { x: 4, y: Math.floor(profile.muzzle_canvas.height / 2) };
  const impactOrigin = centerOrigin(profile.impact_canvas);
  const seed = weapon.seed_base;
  return EffectPilotSchema.parse({
    schema_version: '1.0',
    pilot_id: `${key}-effects-proof-v1`,
    product_slug: plan.product_slug,
    source_asset_key: key,
    status: 'planned',
    purpose: `Generate an isolated versioned effects proof for ${weapon.name}.`,
    style: {
      medium: 'pixel_art',
      perspective: 'strict side view, effect travels or emits toward the right',
      palette: PALETTE,
      max_palette_colors: 32,
      chroma_key: '#00ff00',
      source_width: 1024,
      source_height: 1024,
    },
    weapon_preview: {
      canvas: profile.weapon_canvas,
      weapon_position: profile.weapon_position,
      muzzle_anchor: {
        strategy: 'rightmost_opaque',
        terminal_band_width: 4,
        alpha_threshold: 128,
      },
      projectile_travel_preview: {
        canvas: profile.travel_canvas,
        start_gap_px: 0,
        end_margin_right_px: 0,
        frame_count: 10,
        frame_duration_ms: profile.travel_duration_ms,
      },
    },
    effects: [
      {
        effect_key: `${key}-projectile`,
        name: `${weapon.name} Projectile`,
        kind: 'projectile',
        canvas: profile.projectile_canvas,
        placement: 'center',
        origin: centerOrigin(profile.projectile_canvas),
        origin_contact_required: false,
        origin_tolerance: 6,
        generation: { strategy: 'independent' },
        playback: 'once',
        frames: [{
          frame: 0,
          duration_ms: profile.projectile_duration_ms,
          phase: 'projectile',
          seed,
          prompt: strictPrompt(`${weapon.name} projectile sprite`, weapon.projectile_description, profile.projectile_canvas),
        }],
      },
      {
        effect_key: `${key}-muzzle-flash`,
        name: `${weapon.name} Muzzle Flash`,
        kind: 'muzzle_flash',
        canvas: profile.muzzle_canvas,
        placement: 'west_center',
        origin: muzzleOrigin,
        origin_contact_required: true,
        origin_tolerance: 8,
        generation: { strategy: 'keyframe_transform', keyframe: 2 },
        playback: 'once',
        frames: [
          derivedFrame(0, profile.muzzle_durations[0], 'ignition', seed + 10, {
            scale: 0.35, opacity: 1, density: 1,
          }),
          derivedFrame(1, profile.muzzle_durations[1], 'expansion', seed + 11, {
            scale: 0.7, opacity: 1, density: 1,
          }),
          {
            frame: 2,
            duration_ms: profile.muzzle_durations[2],
            phase: 'peak',
            seed: seed + 12,
            prompt: strictPrompt(
              `${weapon.name} muzzle-flash peak keyframe`,
              `${weapon.muzzle_description} Begin at one narrow attachment point on the exact left-center edge and expand rightward. Do not draw a circular explosion, ring, orb, or projectile.`,
              profile.muzzle_canvas,
            ),
            transform: { scale: 1, opacity: 1, density: 1 },
          },
          derivedFrame(3, profile.muzzle_durations[3], 'dissipation', seed + 13, {
            scale: 0.65, opacity: 0.8, density: 0.55,
          }),
        ],
      },
      {
        effect_key: `${key}-impact-decay`,
        name: `${weapon.name} Impact and Decay`,
        kind: 'impact_decay',
        canvas: profile.impact_canvas,
        placement: 'center',
        origin: impactOrigin,
        origin_contact_required: false,
        origin_tolerance: 8,
        generation: { strategy: 'keyframe_transform', keyframe: 2 },
        playback: 'once',
        frames: [
          derivedFrame(0, profile.impact_durations[0], 'contact', seed + 20, {
            scale: 0.25, opacity: 1, density: 1,
          }),
          derivedFrame(1, profile.impact_durations[1], 'burst', seed + 21, {
            scale: 0.6, opacity: 1, density: 1,
          }),
          {
            frame: 2,
            duration_ms: profile.impact_durations[2],
            phase: 'peak',
            seed: seed + 22,
            prompt: strictPrompt(
              'stationary energy impact peak keyframe',
              `${weapon.impact_description} Match only the weapon's palette and energy type; never reproduce its silhouette, body, barrel, stock, grip, trigger, or other gun parts. Center the effect exactly and keep it symmetrical enough to scale without implying x/y travel. Do not draw a projectile or surface.`,
              profile.impact_canvas,
            ),
            transform: { scale: 1, opacity: 1, density: 1 },
          },
          derivedFrame(3, profile.impact_durations[3], 'fade', seed + 23, {
            scale: 1, opacity: 0.65, density: 0.35,
          }),
        ],
      },
    ],
  });
}

export async function generateEffectBatch(options) {
  const plan = EffectBatchPlanSchema.parse(options.plan);
  const generatePilot = options.generatePilot || generateEffectPilot;
  const results = [];
  for (const weapon of plan.weapons) {
    const pilot = createWeaponEffectPilot(plan, weapon);
    results.push(await generatePilot({ ...options, pilot }));
  }
  return {
    batch_id: plan.batch_id,
    product_slug: plan.product_slug,
    results,
    total_generation_calls: results.reduce((sum, result) => sum + result.timing.generation_calls, 0),
    total_duration_ms: results.reduce((sum, result) => sum + result.timing.total_duration_ms, 0),
    incurred_cost: 0,
  };
}
