import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/know-your-shiny/render/audio-filter-script.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/know-your-shiny/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/know-your-shiny/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.know-your-shiny.v1',
  template_key: 'know-your-shiny',
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
    safe_zone: {
      top: 160,
      right: 120,
      bottom: 260,
      left: 120,
    },
  },
  selection_rules: {
    round_count: 3,
    mode: 'random',
    generation_scope: [1],
  },
  question_contract: {
    hook_text: 'Know your shiny!',
    hook_text_variants: ['Know your shiny!'],
    prompt_text: 'Which is the shiny?',
    prompt_text_variants: ['Which is the shiny?'],
    reveal_text: 'That was the shiny!',
    reveal_text_variants: ['That was the shiny!'],
  },
  layout: {
    background: {
      blur_sigma: 2,
    },
    text: {
      hook_y: 300,
      hook_font_size: 136,
      prompt_y: 300,
      prompt_font_size: 122,
      reveal_y: 300,
      reveal_font_size: 110,
      counter_x: 72,
      counter_y: 144,
      counter_font_size: 96,
    },
    sprite_grid: {
      rows: 2,
      columns: 2,
      item_size_px: 258,
      min_item_size_px: 220,
      column_gap_px: 130,
      row_gap_px: 170,
      sprite_scale_multiplier: 1.56,
      stage_bounds_px: {
        left: 120,
        top: 690,
        width: 840,
        height: 920,
      },
    },
    reveal_sprite: {
      center_x: 540,
      center_y: 1010,
      item_size_px: 320,
      sprite_scale_multiplier: 1.72,
    },
    timer: {
      countdown_from: 3,
      countdown_to: 0,
      size_px: 268,
      center_x: 540,
      center_y: 500,
    },
    rounds: {
      hook_hold_seconds: 1.1,
      pre_countdown_hold_seconds: 0.24,
      reveal_hold_seconds: 1.05,
      transition_duration_seconds: 0.42,
      final_hold_seconds: 1,
    },
  },
  audio: {
    battle_intro_music: {
      start_seconds: 0,
    },
    sound_effects: {
      timer_end: {
        preferred_keywords: ['ding-sound'],
      },
    },
  },
  renderer: {
    candidate_intro_duration_seconds: 0.18,
    decoy_grayscale_fade_duration_seconds: 0.22,
    correct_move_duration_seconds: 0.36,
    correct_cell_fade_duration_seconds: 0.16,
    correct_scale_multiplier: 1.08,
  },
};

const pokedexRows = [
  { id: 'pokedex-0006', national_dex_number: 6, name: 'Charizard', generation: 1, region: 'kanto', types: ['fire', 'flying'], sprite_path: '/tmp/charizard.png', shiny_sprite_path: '/tmp/charizard-shiny.png' },
  { id: 'pokedex-0094', national_dex_number: 94, name: 'Gengar', generation: 1, region: 'kanto', types: ['ghost', 'poison'], sprite_path: '/tmp/gengar.png', shiny_sprite_path: '/tmp/gengar-shiny.png' },
  { id: 'pokedex-0130', national_dex_number: 130, name: 'Gyarados', generation: 1, region: 'kanto', types: ['water', 'flying'], sprite_path: '/tmp/gyarados.png', shiny_sprite_path: '/tmp/gyarados-shiny.png' },
  { id: 'pokedex-0197', national_dex_number: 197, name: 'Umbreon', generation: 2, region: 'johto', types: ['dark'], sprite_path: '/tmp/umbreon.png', shiny_sprite_path: '/tmp/umbreon-shiny.png' },
  { id: 'pokedex-0038', national_dex_number: 38, name: 'Ninetales', generation: 1, region: 'kanto', types: ['fire'], sprite_path: '/tmp/ninetales.png', shiny_sprite_path: '/tmp/ninetales-shiny.png' },
];

const assetInventory = {
  scanned_at: '2026-08-20T00:00:00.000Z',
  directories: {},
  backgrounds: [
    '/tmp/backgrounds/forest.png',
    '/tmp/backgrounds/city.png',
  ],
  music: ['/tmp/music.mp3'],
  sound_effects: {
    all: ['/tmp/countdown.mp3', '/tmp/timer-end.mp3', '/tmp/ding-sound.mp3'],
    countdown_tick: '/tmp/countdown.mp3',
    timer_end: '/tmp/timer-end.mp3',
  },
  overlay_presets: {
    timer: '/tmp/timer.gif',
    timer_countdown: '/tmp/timer-countdown.gif',
    timer_alarm: '/tmp/timer-alarm.gif',
  },
  overlays: ['/tmp/timer.gif', '/tmp/timer-countdown.gif', '/tmp/timer-alarm.gif'],
  transitions: [],
};

test('generic planner dispatch builds a know-your-shiny plan with three rounds and four candidates per round', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'know-your-shiny-rounds',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.know-your-shiny.v1');
  assert.equal(plan.template_key, 'know-your-shiny');
  assert.equal(plan.rounds.length, 3);
  assert.equal(plan.selection.selected_subject_count, 3);
  assert.equal(plan.assets.audio.selected_sound_effects.timer_end, '/tmp/ding-sound.mp3');
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Know Your Shiny$/u);
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    assert.equal(round.candidates.filter((candidate) => candidate.is_correct).length, 1);
    assert.equal(round.subject.render_sprite_path.endsWith('-shiny.png'), true);
  }
});

test('know-your-shiny render plan and input builders stay deterministic for slide rounds', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'know-your-shiny-render-plan',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/know-your-shiny.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);

  assert.equal(renderPlan.rounds.length, 3);
  assert.equal(renderPlan.output_path, '/tmp/know-your-shiny.mp4');
  assert.equal(renderPlan.rounds[1].scene_start_seconds > 0, true);
  assert.equal(visualInputs.length, 6);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs.at(-1).role, 'round-3-sprite');
});

test('know-your-shiny audio and visual filters include countdowns, grayscale decoys, and slide transitions', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'know-your-shiny-filters',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/know-your-shiny.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      timerCountdown: 1,
      timerAlarm: 2,
      rounds: [
        { sprite: 3 },
        { sprite: 4 },
        { sprite: 5 },
      ],
    },
    null,
  );
  const audioFilter = buildAudioFilterScript({
    narrationPaths: [],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/ding-sound.mp3',
    shinyPath: null,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.8,
    },
  });

  assert.match(visualFilter.script, /xfade=transition=slideleft/u);
  assert.match(visualFilter.script, /hue=s=0/u);
  assert.match(visualFilter.script, /That was the shiny!/u);
  assert.match(audioFilter, /timerend0/u);
  assert.match(audioFilter, /timerend2/u);
});
