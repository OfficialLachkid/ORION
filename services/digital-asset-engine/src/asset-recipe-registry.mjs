const ROOT_FIXED = Object.freeze({ mode: 'fixed_root', root_motion: { x: 0, y: 0 } });

export const ANIMATION_PRIMITIVES = Object.freeze({
  pulse: { engine: 'material', requires: ['mutable_region'] },
  flicker: { engine: 'material', requires: ['mutable_region'] },
  rotate: { engine: 'transform', requires: ['pivot'] },
  hover: { engine: 'transform', requires: ['anchor'] },
  fill: { engine: 'material', requires: ['mutable_region'] },
  deplete: { engine: 'material', requires: ['mutable_region'] },
  charge: { engine: 'material', requires: ['mutable_region'] },
  release: { engine: 'particles', requires: ['effect_anchor'] },
  open: { engine: 'constraint', requires: ['pivot'] },
  close: { engine: 'constraint', requires: ['pivot'] },
  crack: { engine: 'procedural_geometry', requires: ['damage_mask'] },
  break: { engine: 'procedural_geometry', requires: ['damage_mask'] },
  scatter: { engine: 'particles', requires: ['effect_anchor'] },
  dissolve: { engine: 'material', requires: ['mutable_region'] },
  liquid_motion: { engine: 'surface', requires: ['liquid_mask'] },
  bubbles: { engine: 'particles', requires: ['liquid_mask'] },
  glow_pulse: { engine: 'material', requires: ['emissive_mask'] },
  energy_flow: { engine: 'material', requires: ['flow_path'] },
  energy_arc: { engine: 'particles', requires: ['effect_anchor'] },
  spark_burst: { engine: 'particles', requires: ['effect_anchor'] },
  particle_orbit: { engine: 'particles', requires: ['pivot'] },
  flame_flicker: { engine: 'particles', requires: ['effect_anchor'] },
  smoke_emit: { engine: 'particles', requires: ['effect_anchor'] },
  fixed_root_impact: { engine: 'physics_reaction', requires: ['impact_region'] },
  activate: { engine: 'state_controller', requires: ['mutable_region'] },
  deactivate: { engine: 'state_controller', requires: ['mutable_region'] },
});

function animation(key, primitives, playback = 'loop', extra = {}) {
  return Object.freeze({ key, primitives, playback, ...ROOT_FIXED, ...extra });
}

function recipe(input) {
  return Object.freeze({
    version: '1.0',
    required_views: ['primary'],
    states: ['base'],
    animations: [],
    anchors: [],
    deliverables: ['transparent_png'],
    quality_validation: ['alpha', 'canvas', 'palette', 'single_object'],
    marketplace_preview: ['static_inventory'],
    executor: { status: 'planned', id: null, orchestration: 'manual' },
    ...input,
  });
}

export const ASSET_RECIPE_REGISTRY = Object.freeze({
  generic_static: recipe({
    label: 'Generic static asset',
    executor: { status: 'available', id: 'base_sprite_v1', orchestration: 'automatic' },
  }),
  weapon: recipe({
    label: 'Side-view weapon',
    animations: [
      animation('charge', ['charge', 'energy_flow'], 'once', { anchor: 'muzzle' }),
      animation('muzzle-flash', ['release', 'spark_burst'], 'once', { anchor: 'muzzle' }),
      animation('projectile', ['release'], 'loop', { anchor: 'muzzle' }),
      animation('impact-decay', ['fixed_root_impact', 'dissolve'], 'once', { anchor: 'impact_center' }),
    ],
    anchors: ['muzzle', 'impact_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    quality_validation: ['alpha', 'canvas', 'palette', 'single_object', 'dynamic_anchor', 'zero_root_motion'],
    marketplace_preview: ['static_inventory', 'effects_breakdown', 'combined_cycle_gif'],
    executor: { status: 'available', id: 'weapon_effects_v1', orchestration: 'manual' },
  }),
  grenade: recipe({
    label: 'Grenade',
    states: ['base', 'armed'],
    animations: [
      animation('armed-loop', ['pulse', 'flicker']),
      animation('detonation', ['charge', 'release', 'break', 'scatter'], 'once', { anchor: 'object_center' }),
    ],
    anchors: ['object_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  proximity_mine: recipe({
    label: 'Proximity mine',
    states: ['base', 'armed'],
    animations: [
      animation('sensor-alert-loop', ['pulse', 'flicker']),
      animation('detonation', ['charge', 'release', 'break', 'scatter'], 'once', { anchor: 'object_center' }),
    ],
    anchors: ['object_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  plasma_shield: recipe({
    label: 'Character plasma shield',
    states: ['full', 'damaged-75', 'damaged-50', 'damaged-25', 'broken'],
    animations: [
      animation('power-up', ['activate', 'energy_flow'], 'once'),
      animation('active-loop', ['pulse', 'energy_flow']),
      animation('shield-hit', ['fixed_root_impact', 'flicker'], 'once'),
      animation('integrity-decay', ['crack', 'deplete'], 'once'),
      animation('shield-break', ['break', 'scatter', 'dissolve'], 'once'),
      animation('power-down', ['deactivate', 'dissolve'], 'once'),
    ],
    anchors: ['shield_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    quality_validation: ['alpha', 'canvas', 'palette', 'transparent_interior', 'radial_damage', 'zero_root_motion'],
    marketplace_preview: ['state_sheet', 'animated_cycle'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  shield_emitter: recipe({
    label: 'Legacy stationary shield emitter',
    states: ['inactive', 'active'],
    animations: [
      animation('power-up', ['activate', 'energy_flow'], 'once'),
      animation('active-loop', ['pulse', 'energy_flow']),
      animation('shield-hit', ['fixed_root_impact', 'flicker'], 'once'),
      animation('shield-break', ['break', 'scatter', 'dissolve'], 'once'),
      animation('power-down', ['deactivate', 'dissolve'], 'once'),
    ],
    anchors: ['field_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  power_cell: recipe({
    label: 'Power cell',
    states: ['empty', 'low', 'full', 'overcharged'],
    animations: [animation('charging-loop', ['fill', 'glow_pulse'])],
    anchors: ['energy_region'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  energy_pickup: recipe({
    label: 'Energy pickup',
    animations: [
      animation('idle-loop', ['hover', 'glow_pulse']),
      animation('collect-burst', ['release', 'spark_burst', 'dissolve'], 'once'),
    ],
    anchors: ['object_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  supply_crate: recipe({
    label: 'Supply crate',
    states: ['closed', 'open', 'open-empty'],
    animations: [animation('open', ['open'], 'once', { anchor: 'lid_hinge' })],
    anchors: ['lid_hinge'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  workbench: recipe({
    label: 'Workbench',
    states: ['powered-off', 'powered-on'],
    animations: [animation('screen-loop', ['flicker', 'glow_pulse'])],
    anchors: ['screen_region'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  potion: recipe({
    label: 'Potion',
    states: ['sealed', 'consumed', 'broken'],
    animations: [
      animation('idle-loop', ['bubbles', 'liquid_motion', 'glow_pulse']),
      animation('consume-break', ['release', 'break', 'scatter', 'dissolve'], 'once'),
    ],
    anchors: ['liquid_region', 'object_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  crystal: recipe({
    label: 'Magic crystal',
    animations: [animation('spin-loop', ['rotate', 'glow_pulse'])],
    anchors: ['object_center'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  rune_stone: recipe({
    label: 'Rune stone',
    states: ['inactive', 'active'],
    animations: [animation('activation', ['activate', 'energy_flow', 'glow_pulse'], 'once')],
    anchors: ['rune_region'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  tome: recipe({
    label: 'Book or tome',
    states: ['sealed', 'awakened'],
    animations: [
      animation('awakening', ['activate', 'energy_flow', 'glow_pulse'], 'once'),
      animation('rune-glow-loop', ['energy_flow', 'glow_pulse']),
    ],
    anchors: ['rune_region'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  flask: recipe({
    label: 'Alchemy flask',
    states: ['stable', 'unstable'],
    animations: [animation('liquid-swirl-loop', ['liquid_motion', 'bubbles', 'flicker'])],
    anchors: ['liquid_region'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  candle: recipe({
    label: 'Candle',
    states: ['lit', 'extinguished'],
    animations: [
      animation('flame-loop', ['flame_flicker', 'glow_pulse']),
      animation('extinguish', ['deactivate', 'smoke_emit'], 'once'),
    ],
    anchors: ['wick'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  wand: recipe({
    label: 'Wand',
    animations: [
      animation('wand-charge', ['charge', 'glow_pulse'], 'once', { anchor: 'tip' }),
      animation('spell-burst', ['release', 'spark_burst', 'dissolve'], 'once', { anchor: 'tip', composition: 'independent_effect' }),
    ],
    anchors: ['tip'],
    deliverables: ['transparent_png', 'frames', 'sprite_sheet', 'animation_json', 'gif_preview'],
    executor: { status: 'available', id: 'interactive_items_v1', orchestration: 'manual' },
  }),
  chair: recipe({
    label: 'Chair',
    executor: { status: 'available', id: 'base_sprite_v1', orchestration: 'automatic' },
  }),
});

const KIND_ALIASES = Object.freeze({
  gun: 'weapon', pistol: 'weapon', rifle: 'weapon', shotgun: 'weapon', launcher: 'weapon', cannon: 'weapon',
  mine: 'proximity_mine', 'proximity-mine': 'proximity_mine',
  shield: 'plasma_shield', 'plasma-shield': 'plasma_shield',
  battery: 'power_cell', 'power-cell': 'power_cell',
  pickup: 'energy_pickup', 'energy-pickup': 'energy_pickup',
  crate: 'supply_crate', 'supply-crate': 'supply_crate',
  'rune-stone': 'rune_stone', rune: 'rune_stone', relic: 'rune_stone',
  book: 'tome', spellbook: 'tome',
  'alchemy-tool': 'flask', alchemy_tool: 'flask',
  'ritual-object': 'candle', ritual_object: 'candle',
  focus: 'wand',
});

function normalizedKind(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s/]+/gu, '_');
}

export function resolveAssetRecipe(kind) {
  const normalized = normalizedKind(kind);
  const alias = KIND_ALIASES[normalized] || KIND_ALIASES[normalized.replaceAll('_', '-')];
  const recipeId = ASSET_RECIPE_REGISTRY[normalized] ? normalized
    : alias && ASSET_RECIPE_REGISTRY[alias] ? alias
      : 'generic_static';
  const definition = ASSET_RECIPE_REGISTRY[recipeId];
  return {
    recipe_id: recipeId,
    matched_by: recipeId === 'generic_static' && normalized !== 'generic_static' ? 'fallback'
      : recipeId === normalized ? 'exact' : 'alias',
    source_kind: String(kind || ''),
    ...structuredClone(definition),
  };
}

export function validateAssetRecipeRegistry() {
  const issues = [];
  for (const [recipeId, definition] of Object.entries(ASSET_RECIPE_REGISTRY)) {
    for (const item of definition.animations) {
      for (const primitive of item.primitives) {
        if (!ANIMATION_PRIMITIVES[primitive]) issues.push(`${recipeId}/${item.key}: unknown primitive ${primitive}`);
      }
      if (item.root_motion?.x !== 0 || item.root_motion?.y !== 0) {
        issues.push(`${recipeId}/${item.key}: root motion must remain zero`);
      }
    }
  }
  if (issues.length) throw new Error(`Asset recipe registry is invalid: ${issues.join('; ')}`);
  return true;
}

validateAssetRecipeRegistry();
