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
    hook_text: 'Do you know your shiny?',
    hook_text_variants: ['Do you know your shiny?'],
    prompt_text: 'Which one\u2019s shiny?',
    prompt_text_variants: ['Which one\u2019s shiny?'],
    reveal_text: '',
    reveal_text_variants: [],
  },
  layout: {
    background: {
      blur_sigma: 2,
    },
    text: {
      hook_y: 300,
      hook_font_size: 136,
      prompt_y: 300,
      prompt_font_size: 98,
      reveal_y: 300,
      reveal_font_size: 110,
      counter_x: 72,
      counter_y: 144,
      counter_font_size: 96,
      highlight_color: '0xFFD60A',
      highlight_keywords: ['shiny'],
    },
    sprite_grid: {
      rows: 2,
      columns: 2,
      item_size_px: 258,
      min_item_size_px: 220,
      column_gap_px: 190,
      row_gap_px: 250,
      sprite_scale_multiplier: 1.5,
      stage_bounds_px: {
        left: 120,
        top: 470,
        width: 840,
        height: 760,
      },
    },
    reveal_sprite: {
      center_x: 540,
      center_y: 1010,
      item_size_px: 320,
      sprite_scale_multiplier: 1.38,
    },
    sprite_platform: {
      option_enabled: true,
      option_width_multiplier: 0.85,
      center_y_offset_multiplier: 0.34,
      option_center_y_offset_px: 80,
    },
    timer: {
      countdown_from: 4,
      countdown_to: 0,
      bar_height_px: 39,
      bar_horizontal_inset_px: 20,
      center_y: 1000,
      bar_y_offset_px: 0,
    },
    rounds: {
      hook_hold_seconds: 1.1,
      pre_countdown_hold_seconds: 0.24,
      reveal_hold_seconds: 1.05,
      transition_duration_seconds: 0.42,
      final_hold_seconds: 1,
    },
  },
  reveal: {
    visual_delay_seconds: 0,
    shiny: {
      enabled: true,
      sparkle_duration_seconds: 0.9,
      sparkle_scale_multiplier: 1.35,
      sound_volume_multiplier: 0.7,
    },
  },
  audio: {
    battle_intro_music: {
      start_seconds: 0,
    },
    sound_effects: {
      timer_end: {
        enabled: false,
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
  { id: 'pokedex-0006', national_dex_number: 6, name: 'Charizard', generation: 1, region: 'kanto', types: ['fire', 'flying'], sprite_path: '/tmp/charizard.png', shiny_sprite_path: '/tmp/charizard-shiny.png', shiny_animated_sprite_path: '/tmp/charizard-shiny.gif' },
  { id: 'pokedex-0094', national_dex_number: 94, name: 'Gengar', generation: 1, region: 'kanto', types: ['ghost', 'poison'], sprite_path: '/tmp/gengar.png', shiny_sprite_path: '/tmp/gengar-shiny.png', shiny_animated_sprite_path: '/tmp/gengar-shiny.gif' },
  { id: 'pokedex-0130', national_dex_number: 130, name: 'Gyarados', generation: 1, region: 'kanto', types: ['water', 'flying'], sprite_path: '/tmp/gyarados.png', shiny_sprite_path: '/tmp/gyarados-shiny.png', shiny_animated_sprite_path: '/tmp/gyarados-shiny.gif' },
  { id: 'pokedex-0197', national_dex_number: 197, name: 'Umbreon', generation: 2, region: 'johto', types: ['dark'], sprite_path: '/tmp/umbreon.png', shiny_sprite_path: '/tmp/umbreon-shiny.png', shiny_animated_sprite_path: '/tmp/umbreon-shiny.gif' },
  { id: 'pokedex-0038', national_dex_number: 38, name: 'Ninetales', generation: 1, region: 'kanto', types: ['fire'], sprite_path: '/tmp/ninetales.png', shiny_sprite_path: '/tmp/ninetales-shiny.png', shiny_animated_sprite_path: '/tmp/ninetales-shiny.gif' },
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
    all: ['/tmp/countdown.mp3', '/tmp/timer-end.mp3', '/tmp/ding-sound.mp3', '/tmp/shiny.mp3'],
    countdown_tick: '/tmp/countdown.mp3',
    timer_end: '/tmp/timer-end.mp3',
    shiny: '/tmp/shiny.mp3',
  },
  overlay_presets: {
    timer: '/tmp/timer.gif',
    timer_countdown: '/tmp/timer-countdown.gif',
    timer_alarm: '/tmp/timer-alarm.gif',
    grass_plateau: '/tmp/grass-plateau.png',
    shiny_sparkle: '/tmp/shiny-sparkle.gif',
  },
  overlays: ['/tmp/timer.gif', '/tmp/timer-countdown.gif', '/tmp/timer-alarm.gif', '/tmp/grass-plateau.png', '/tmp/shiny-sparkle.gif'],
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
  assert.equal(plan.assets.audio.selected_sound_effects.timer_end, null);
  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.assets.audio.selected_sound_effects.shiny, '/tmp/shiny.mp3');
  assert.equal(plan.assets.overlays.selected_grass_plateau_path, '/tmp/grass-plateau.png');
  assert.equal(plan.shiny_reveal.sound_volume_multiplier, 0.7);
  assert.equal(plan.rounds[0].countdown_from, 4);
  assert.equal(plan.rounds[0].countdown_duration_seconds, 4);
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Know Your Shiny$/u);
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    assert.equal(round.candidates.filter((candidate) => candidate.is_correct).length, 1);
    assert.equal(round.subject.render_sprite_path.endsWith('-shiny.gif'), true);
  }
});

test('know-your-shiny can build a hard five-round variant when configured', async () => {
  const hardTemplate = JSON.parse(JSON.stringify(template));
  hardTemplate.selection_rules.generation_scope = [];
  hardTemplate.selection_rules.round_count_weights = {
    hard: 1,
  };
  hardTemplate.selection_rules.round_count_levels = {
    hard: {
      round_count: 5,
    },
  };
  const plan = await planPokemonTypeChallenge({
    template: hardTemplate,
    pokedexRows,
    seed: 'know-your-shiny-hard-rounds',
    assetInventory,
  });

  assert.equal(plan.selection.difficulty_id, 'hard');
  assert.equal(plan.selection.round_count, 5);
  assert.equal(plan.rounds.length, 5);
  assert.equal(plan.rounds[0].round_label, '1/5');
  assert.equal(plan.rounds.at(-1)?.round_label, '5/5');
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
  assert.equal(renderPlan.rounds[0].reveal_visual_start_seconds, renderPlan.rounds[0].reveal_start_seconds);
  assert.equal(renderPlan.timer_layout.center_y, 1000);
  assert.equal(renderPlan.timer_layout.width, 660);
  assert.equal(renderPlan.timer_layout.height, 39);
  assert.equal(renderPlan.grid_layout.sprite_scale_multiplier, 1.5);
  assert.equal(renderPlan.reveal_sprite.sprite_scale_multiplier, 1.38);
  assert.equal(renderPlan.grid_layout.cells[0].center_y, 597);
  assert.equal(visualInputs.length, 6);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs.at(-1).role, 'shiny-sparkle');
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
      rounds: [
        { sprite: 1 },
        { sprite: 2 },
        { sprite: 3 },
      ],
      grassPlatform: 4,
      shinySparkle: 5,
    },
    null,
  );
  const audioFilter = buildAudioFilterScript({
    narrationPaths: [],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: null,
    shinyPath: '/tmp/shiny.mp3',
    shinyVolumeMultiplier: 0.7,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.8,
    },
  });

  assert.match(visualFilter.script, /xfade=transition=slideleft/u);
  assert.match(visualFilter.script, /hue=s=0/u);
  assert.match(visualFilter.script, /grass-plateau|r0platform0|scene0platform0/u);
  assert.match(visualFilter.script, /color=c=0x32D74B@0\.98/u);
  assert.match(visualFilter.script, /scale=w='max\(2,/u);
  assert.match(visualFilter.script, /overlay=x='540-overlay_w\/2'/u);
  assert.match(visualFilter.script, /colorchannelmixer=/u);
  assert.match(visualFilter.script, /fontcolor=0xFFD60A/u);
  assert.match(visualFilter.script, /shiny-sparkle|scene0sparkle|scene0ss/u);
  assert.doesNotMatch(visualFilter.script, /color=c=[^:]+:s=\d+x\d+\.\d+/u);
  assert.doesNotMatch(visualFilter.script, /color=c=[^:]+:s=\d+\.\d+x\d+/u);
  assert.doesNotMatch(audioFilter, /timerend0/u);
  assert.doesNotMatch(audioFilter, /timerend2/u);
  assert.match(audioFilter, /volume=0\.35\[shiny0\]/u);
  assert.match(audioFilter, /shiny0/u);
  assert.match(audioFilter, /shiny2/u);
});
