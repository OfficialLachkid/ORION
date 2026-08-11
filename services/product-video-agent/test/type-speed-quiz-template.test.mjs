import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/type-speed-quiz/render/audio-filter-script.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/type-speed-quiz/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/type-speed-quiz/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.type-speed-quiz.v1',
  template_key: 'type-speed-quiz',
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
    safe_zone: {
      top: 160,
      right: 100,
      bottom: 260,
      left: 100,
    },
  },
  selection_rules: {
    round_count: 5,
    mode: 'random',
    type_cardinality: 'any',
  },
  question_contract: {
    hook_text: 'Guess the Type',
    hook_text_variants: ['Guess the Type', 'Guess the Types'],
  },
  layout: {
    text: {
      hook_y: 320,
      hook_font_size: 176,
      prompt_y: 320,
      prompt_font_size: 176,
      counter_x: 72,
      counter_y: 144,
      counter_font_size: 96,
      name_y: 1490,
      name_font_size: 132,
      type_text_y: 280,
      type_text_font_size: 188,
    },
    sprite: {
      center_x: 540,
      center_y: 1030,
      size_px: 1600,
      scale_multiplier: 1,
      intro_duration_seconds: 0.34,
      intro_lift_px: 44,
      countdown_float_amplitude_px: 18,
      countdown_float_frequency_hz: 2.1,
    },
    type_badges: {
      center_y: 585,
      icon_size_px: 420,
      spacing_px: 28,
      pop_in_duration_seconds: 0.22,
    },
    timer: {
      countdown_from: 3,
      countdown_to: 0,
      size_px: 268,
      center_x: 540,
      center_y: 470,
    },
    rounds: {
      hook_hold_seconds: 1.1,
      pre_countdown_hold_seconds: 0.18,
      reveal_hold_seconds: 0.92,
      transition_duration_seconds: 0.42,
      final_hold_seconds: 1.12,
    },
  },
  reveal: {
    visual_delay_seconds: 0.16,
    shiny: {
      enabled: true,
      sparkle_duration_seconds: 0.9,
      sparkle_scale_multiplier: 1.35,
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
};

const pokedexRows = [
  {
    id: 'pokedex-0025',
    national_dex_number: 25,
    name: 'Pikachu',
    generation: 1,
    region: 'kanto',
    types: ['electric'],
    sprite_path: '/tmp/pikachu.png',
    shiny_sprite_path: '/tmp/pikachu-shiny.png',
    sprite_source_url: 'https://example.test/pikachu.png',
  },
  {
    id: 'pokedex-0001',
    national_dex_number: 1,
    name: 'Bulbasaur',
    generation: 1,
    region: 'kanto',
    types: ['grass', 'poison'],
    sprite_path: '/tmp/bulbasaur.png',
    shiny_sprite_path: '/tmp/bulbasaur-shiny.png',
    sprite_source_url: 'https://example.test/bulbasaur.png',
  },
  {
    id: 'pokedex-0094',
    national_dex_number: 94,
    name: 'Gengar',
    generation: 1,
    region: 'kanto',
    types: ['ghost', 'poison'],
    sprite_path: '/tmp/gengar.png',
    shiny_sprite_path: '/tmp/gengar-shiny.png',
    sprite_source_url: 'https://example.test/gengar.png',
  },
  {
    id: 'pokedex-0133',
    national_dex_number: 133,
    name: 'Eevee',
    generation: 1,
    region: 'kanto',
    types: ['normal'],
    sprite_path: '/tmp/eevee.png',
    shiny_sprite_path: '/tmp/eevee-shiny.png',
    sprite_source_url: 'https://example.test/eevee.png',
  },
  {
    id: 'pokedex-0149',
    national_dex_number: 149,
    name: 'Dragonite',
    generation: 1,
    region: 'kanto',
    types: ['dragon', 'flying'],
    sprite_path: '/tmp/dragonite.png',
    shiny_sprite_path: '/tmp/dragonite-shiny.png',
    sprite_source_url: 'https://example.test/dragonite.png',
  },
  {
    id: 'pokedex-0129',
    national_dex_number: 129,
    name: 'Magikarp',
    generation: 1,
    region: 'kanto',
    types: ['water'],
    sprite_path: '/tmp/magikarp.png',
    shiny_sprite_path: '/tmp/magikarp-shiny.png',
    sprite_source_url: 'https://example.test/magikarp.png',
  },
];

const assetInventory = {
  scanned_at: '2026-08-11T00:00:00.000Z',
  directories: {},
  backgrounds: ['/tmp/legacy-background.png'],
  gif_backgrounds: [
    '/tmp/gif-backgrounds/aurora.gif',
    '/tmp/gif-backgrounds/city.mp4',
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
    shiny_sparkle: '/tmp/shiny-sparkle.gif',
  },
  overlays: ['/tmp/timer.gif', '/tmp/timer-countdown.gif', '/tmp/timer-alarm.gif', '/tmp/shiny-sparkle.gif'],
  transitions: [],
  type_icons: {
    pixel: [
      '/tmp/pixel/electric.gif',
      '/tmp/pixel/grass.gif',
      '/tmp/pixel/poison.gif',
      '/tmp/pixel/ghost.gif',
      '/tmp/pixel/normal.gif',
      '/tmp/pixel/dragon.gif',
      '/tmp/pixel/flying.gif',
      '/tmp/pixel/water.gif',
    ],
    three_d: [
      '/tmp/3d/badge-style/electric.png',
      '/tmp/3d/badge-style/grass.png',
      '/tmp/3d/badge-style/poison.png',
      '/tmp/3d/badge-style/ghost.png',
      '/tmp/3d/badge-style/normal.png',
      '/tmp/3d/badge-style/dragon.png',
      '/tmp/3d/badge-style/flying.png',
      '/tmp/3d/badge-style/water.png',
    ],
    three_d_styles: {
      'badge-style': {
        style_variant: 'badge-style',
        directory: '/tmp/3d/badge-style',
        file_paths: [
          '/tmp/3d/badge-style/dragon.png',
          '/tmp/3d/badge-style/electric.png',
          '/tmp/3d/badge-style/flying.png',
          '/tmp/3d/badge-style/ghost.png',
          '/tmp/3d/badge-style/grass.png',
          '/tmp/3d/badge-style/normal.png',
          '/tmp/3d/badge-style/poison.png',
          '/tmp/3d/badge-style/water.png',
        ],
        paths_by_type: {
          electric: '/tmp/3d/badge-style/electric.png',
          grass: '/tmp/3d/badge-style/grass.png',
          poison: '/tmp/3d/badge-style/poison.png',
          ghost: '/tmp/3d/badge-style/ghost.png',
          normal: '/tmp/3d/badge-style/normal.png',
          dragon: '/tmp/3d/badge-style/dragon.png',
          flying: '/tmp/3d/badge-style/flying.png',
          water: '/tmp/3d/badge-style/water.png',
        },
      },
    },
  },
};

test('generic planner dispatch builds a random type speed quiz plan from localized rows', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-random',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.type-speed-quiz.v1');
  assert.equal(plan.template_key, 'type-speed-quiz');
  assert.equal(plan.selection.mode, 'random');
  assert.equal(plan.selection.round_count, 5);
  assert.equal(plan.selection.selected_subjects.length, 5);
  assert.equal(plan.assets.background.selected_path.startsWith('/tmp/gif-backgrounds/'), true);
  assert.equal(plan.rounds.length, 5);
  assert.equal(plan.rounds.some((round) => round.subject.types.length === 1), true);
  assert.equal(plan.rounds.some((round) => round.subject.types.length === 2), true);
  assert.equal(plan.rounds.every((round) => round.type_icons.length === round.subject.types.length), true);
  assert.equal(plan.rounds.filter((round) => round.subject.is_shiny_reveal).length, 1);
  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.assets.audio.selected_sound_effects.timer_end, '/tmp/ding-sound.mp3');
  assert.equal(plan.required_asset_gaps.length, 0);
});

test('speed quiz planner can filter to single-type only when configured', async () => {
  const singleTypeTemplate = structuredClone(template);
  singleTypeTemplate.selection_rules.type_cardinality = 'single-type-only';
  singleTypeTemplate.selection_rules.round_count = 3;

  const plan = await planPokemonTypeChallenge({
    template: singleTypeTemplate,
    pokedexRows,
    seed: 'type-speed-quiz-single',
    assetInventory,
  });

  assert.equal(plan.selection.type_cardinality, 'single');
  assert.equal(plan.rounds.every((round) => round.subject.types.length === 1), true);
});

test('speed quiz timer-end sound falls back to the shared default when the preferred ding file is unavailable', async () => {
  const fallbackInventory = structuredClone(assetInventory);
  fallbackInventory.sound_effects.all = ['/tmp/countdown.mp3', '/tmp/timer-end.mp3', '/tmp/shiny.mp3'];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-timer-end-fallback',
    assetInventory: fallbackInventory,
  });

  assert.equal(plan.assets.audio.selected_sound_effects.timer_end, '/tmp/timer-end.mp3');
});

test('render plan creates staggered round timing with slide transitions', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-render-plan',
    assetInventory,
  });

  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/type-speed-quiz.mp4',
  });

  assert.equal(renderPlan.rounds.length, 5);
  assert.equal(renderPlan.rounds[0].scene_start_seconds, 0);
  assert.equal(renderPlan.rounds[1].scene_start_seconds > renderPlan.rounds[0].scene_start_seconds, true);
  assert.equal(renderPlan.rounds[0].slide_start_seconds < renderPlan.rounds[0].scene_end_seconds, true);
  assert.equal(renderPlan.rounds[4].transition_duration_seconds, 0);
  assert.equal(renderPlan.total_duration_seconds, renderPlan.rounds[4].scene_end_seconds);
  assert.equal(renderPlan.output_path, '/tmp/type-speed-quiz.mp4');
});

test('visual inputs loop gif backgrounds, use one shiny round, and include the sparkle overlay once', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-inputs',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/type-speed-quiz.mp4',
  });

  const inputs = buildVisualInputs(plan, renderPlan);
  const spriteInputs = inputs.filter((input) => input.role.endsWith('-sprite'));
  const typeIconInputs = inputs.filter((input) => input.role.includes('type-icon'));
  const shinyRound = renderPlan.rounds.find((round) => round.subject.is_shiny_reveal);

  if (plan.assets.background.selected_path.endsWith('.gif')) {
    assert.deepEqual(inputs[0].args, ['-ignore_loop', '0', '-t', String(renderPlan.total_duration_seconds), '-i', plan.assets.background.selected_path]);
  } else {
    assert.deepEqual(inputs[0].args, ['-stream_loop', '-1', '-t', String(renderPlan.total_duration_seconds), '-i', plan.assets.background.selected_path]);
  }
  assert.equal(spriteInputs.length, 5);
  assert.equal(typeIconInputs.length >= 5, true);
  assert.equal(inputs.filter((input) => input.role === 'shiny-sparkle').length, 1);
  assert.equal(
    spriteInputs.some((input) => input.path === shinyRound?.subject?.render_sprite_path),
    true,
  );
});

test('audio filter schedules countdown ticks, timer-end cues, and one shiny hit', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-audio',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/type-speed-quiz.mp4',
  });

  const script = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav'],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/timer-end.mp3',
    shinyPath: '/tmp/shiny.mp3',
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });

  assert.match(script, /\[0:a\]adelay=0\|0,volume=1\[n0\]/u);
  assert.match(script, /\[2:a\]asplit=15/u);
  assert.match(script, /\[3:a\]asplit=5/u);
  assert.match(script, /timerend4/u);
  assert.match(script, /\[4:a\]adelay=\d+\|\d+,volume=0\.5\[shiny\]/u);
  assert.match(script, /\[n0\]\[music\]\[cd0\]/u);
});

test('visual filter composes round scenes and chains them with slideleft xfade transitions', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'type-speed-quiz-visual',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/type-speed-quiz.mp4',
  });

  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      timerCountdown: 1,
      timerAlarm: 2,
      rounds: renderPlan.rounds.map((round, roundIndex) => ({
        sprite: 3 + roundIndex,
        typeIcons: round.type_icons.map((_, iconIndex) => 8 + (roundIndex * 2) + iconIndex),
      })),
      shinySparkle: 18,
    },
    '/tmp/font.ttf',
  );

  assert.match(visualFilter.script, /split=5\[bg0\]\[bg1\]\[bg2\]\[bg3\]\[bg4\]/u);
  assert.match(visualFilter.script, /drawtext=text='Guess'/u);
  assert.match(visualFilter.script, /drawtext=text='Guess the'/u);
  assert.match(visualFilter.script, /drawtext=text='1\/5'/u);
  assert.match(visualFilter.script, /between\(t,0\.46,/u);
  assert.doesNotMatch(visualFilter.script, /crop=iw\*0\.62/u);
  assert.match(visualFilter.script, /\[scene\d+sparkle\]/u);
  assert.match(visualFilter.script, /xfade=transition=slideleft:duration=0\.42:offset=/u);
  assert.match(visualFilter.script, /\[sceneout4\]format=yuv420p\[vout\]/u);
});
