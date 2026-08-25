import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/showdown/render/audio-filter-script.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/showdown/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/showdown/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.showdown.v1',
  template_key: 'showdown',
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
  selection_rules: {
    generation_scope: [1],
    participant_count: 4,
    mode: 'single_elimination_bracket',
    battle_weights: {
      base_stat_total: 0.06,
      hp: 0.18,
      attack: 0.24,
      defense: 0.19,
      special_attack: 0.23,
      special_defense: 0.19,
      speed: 0.25,
      type_advantage: 20,
      speed_edge: 0.42,
      random_spread: 0,
    },
  },
  question_contract: {
    hook_text: 'Who wins this showdown?',
    hook_text_variants: ['Who wins this showdown?'],
    champion_text: 'Champion: {champion_name}',
    champion_text_variants: ['Champion: {champion_name}'],
  },
  layout: {
    background: {
      blur_sigma: 2,
    },
    text: {
      hook_y: 150,
      hook_font_size: 122,
      round_y: 305,
      round_font_size: 68,
      matchup_y: 365,
      matchup_font_size: 92,
      insight_y: 470,
      insight_font_size: 58,
      winner_y: 1450,
      winner_font_size: 90,
      champion_y: 260,
      champion_font_size: 104,
    },
    bracket: {
      slot_sprite_size_px: 120,
      slot_name_font_size: 42,
      slot_card_width_px: 220,
      slot_card_height_px: 184,
      connector_thickness_px: 10,
      slot_positions: {
        semi_1_a: { x: 80, y: 470 },
        semi_1_b: { x: 80, y: 720 },
        semi_1_winner: { x: 270, y: 595 },
        semi_2_a: { x: 780, y: 470 },
        semi_2_b: { x: 780, y: 720 },
        semi_2_winner: { x: 590, y: 595 },
        final_winner: { x: 430, y: 380 },
      },
    },
    battle_stage: {
      sprite_size_px: 380,
      left_center_x: 275,
      right_center_x: 805,
      center_y: 1150,
      name_y: 1430,
      name_font_size: 62,
      vs_y: 1125,
      vs_font_size: 100,
    },
    champion_stage: {
      sprite_size_px: 520,
      center_x: 540,
      center_y: 1120,
      name_y: 1510,
      name_font_size: 86,
    },
    rounds: {
      hook_hold_seconds: 1.1,
      match_intro_hold_seconds: 1.8,
      suspense_hold_seconds: 0.9,
      reveal_hold_seconds: 1.2,
      transition_duration_seconds: 0.4,
      champion_hold_seconds: 1.1,
    },
  },
  audio: {
    battle_intro_music: {
      start_seconds: 0,
    },
    sound_effects: {
      winner_reveal: {
        enabled: true,
        preferred_keywords: ['ding-sound'],
      },
    },
  },
  renderer: {
    loser_alpha_multiplier: 0.46,
  },
};

const pokedexRows = [
  {
    id: 'pokedex-0006',
    national_dex_number: 6,
    name: 'Charizard',
    slug: 'charizard',
    generation: 1,
    region: 'kanto',
    types: ['fire', 'flying'],
    sprite_path: '/tmp/charizard.png',
    metadata: {
      base_stats: { hp: 78, attack: 84, defense: 78, special_attack: 109, special_defense: 85, speed: 100 },
    },
  },
  {
    id: 'pokedex-0009',
    national_dex_number: 9,
    name: 'Blastoise',
    slug: 'blastoise',
    generation: 1,
    region: 'kanto',
    types: ['water'],
    sprite_path: '/tmp/blastoise.png',
    metadata: {
      base_stats: { hp: 79, attack: 83, defense: 100, special_attack: 85, special_defense: 105, speed: 78 },
    },
  },
  {
    id: 'pokedex-0149',
    national_dex_number: 149,
    name: 'Dragonite',
    slug: 'dragonite',
    generation: 1,
    region: 'kanto',
    types: ['dragon', 'flying'],
    sprite_path: '/tmp/dragonite.png',
    metadata: {
      base_stats: { hp: 91, attack: 134, defense: 95, special_attack: 100, special_defense: 100, speed: 80 },
    },
  },
  {
    id: 'pokedex-0094',
    national_dex_number: 94,
    name: 'Gengar',
    slug: 'gengar',
    generation: 1,
    region: 'kanto',
    types: ['ghost', 'poison'],
    sprite_path: '/tmp/gengar.png',
    metadata: {
      base_stats: { hp: 60, attack: 65, defense: 60, special_attack: 130, special_defense: 75, speed: 110 },
    },
  },
];

const assetInventory = {
  scanned_at: '2026-08-25T00:00:00.000Z',
  directories: {},
  backgrounds: ['/tmp/backgrounds/arena.png'],
  music: ['/tmp/music.mp3'],
  sound_effects: {
    all: ['/tmp/ding-sound.mp3'],
    timer_end: '/tmp/ding-sound.mp3',
  },
  overlays: [],
  overlay_presets: {},
};

test('generic planner dispatch builds a four-participant showdown bracket', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'showdown-bracket',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.showdown.v1');
  assert.equal(plan.template_key, 'showdown');
  assert.equal(plan.selection.participant_count, 4);
  assert.equal(plan.tournament.participants.length, 4);
  assert.equal(plan.tournament.matches.length, 3);
  assert.equal(plan.tournament.matches[0].round_label, 'Semi Final 1');
  assert.equal(plan.assets.audio.selected_sound_effects.winner_reveal, '/tmp/ding-sound.mp3');
  assert.equal(plan.required_asset_gaps.length, 0);
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Showdown$/u);
});

test('showdown render plan and inputs stay deterministic for a four-Pokemon bracket', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'showdown-render-plan',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/showdown.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);

  assert.equal(renderPlan.matches.length, 3);
  assert.equal(renderPlan.output_path, '/tmp/showdown.mp4');
  assert.equal(renderPlan.bracket_layout.slots.final_winner.center_x, 540);
  assert.equal(renderPlan.matches[0].intro_start_seconds, 1.1);
  assert.equal(renderPlan.champion_scene.end_seconds > renderPlan.matches.at(-1)?.scene_end_seconds, true);
  assert.equal(visualInputs.length, 5);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs.at(-1)?.role, 'participant-3');
});

test('showdown audio and visual filters include winner sting cues and champion overlay logic', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'showdown-filters',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/showdown.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      participants: [1, 2, 3, 4],
    },
    '/tmp/font.ttf',
  );
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_, index) => `/tmp/${index}.wav`),
    musicPath: '/tmp/music.mp3',
    winnerRevealPath: '/tmp/ding-sound.mp3',
    renderPlan,
  });

  assert.match(visualFilter.script, /\[0:v\]fps=30,scale=1080:1920/u);
  assert.match(visualFilter.script, /Champion/u);
  assert.match(visualFilter.script, /overlay=x='540-w\/2'/u);
  assert.equal((visualFilter.script.match(/setsar=1\[p\d+champ\]/gu) || []).length, 1);
  assert.match(audioFilter, /asplit=3\[wsrc0\]\[wsrc1\]\[wsrc2\]/u);
  assert.match(audioFilter, /amix=inputs=/u);
});
