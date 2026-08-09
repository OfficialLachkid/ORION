import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/find-the-shiny/render/audio-filter-script.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/find-the-shiny/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/find-the-shiny/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.find-the-shiny.v1',
  template_key: 'find-the-shiny',
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
    generation_scope: [1],
    type_pair_policy: {
      disallowed_type_pairs: [],
      min_catalog_matches: 1,
    },
  },
  question_contract: {
    hook_text: 'Find the Shiny!',
    type_prompt_text: 'Which spot will turn shiny?',
    reveal_text: 'Found it!',
  },
  layout: {
    text: {
      hook_y: 180,
      prompt_y: 290,
      reveal_y: 260,
    },
    sprite_grid: {
      difficulty_levels: {
        easy: {
          sprite_count: 3,
          rows: 1,
          columns: 3,
        },
        medium: {
          sprite_count: 6,
          rows: 2,
          columns: 3,
        },
        hard: {
          sprite_count: 9,
          rows: 3,
          columns: 3,
        },
      },
      difficulty_weights: {
        easy: 1,
        medium: 1,
        hard: 1,
      },
      item_size_px: 228,
      min_item_size_px: 148,
      column_gap_px: 26,
      row_gap_px: 38,
      sprite_scale_multiplier: 1.404,
      stage_bounds_px: {
        left: 72,
        top: 680,
        width: 936,
        height: 900,
      },
    },
    pokeball_grid: {
      overlay_scale_multiplier: 1.56,
      intro_duration_seconds: 0.56,
    },
    timer: {
      countdown_from: 5,
      countdown_to: 0,
    },
  },
  audio: {
    voice_profile_selection: {
      mode: 'seeded_random',
      allowed_genders: ['female', 'male'],
      allow_profile_ids: ['us-female-kokoro-heart', 'us-male-kokoro-deep'],
    },
  },
  reveal: {
    visual_delay_seconds: 0.08,
    shiny: {
      enabled: true,
      sparkle_duration_seconds: 0.9,
      sparkle_scale_multiplier: 1.35,
    },
  },
};

const pokedexRows = [
  {
    id: 'pokedex-0007',
    national_dex_number: 7,
    name: 'Squirtle',
    generation: 1,
    region: 'kanto',
    types: ['water', 'ice'],
    sprite_path: '/tmp/squirtle.png',
    shiny_sprite_path: '/tmp/squirtle-shiny.png',
    metadata: {
      type_icon_source_urls: [],
      pokemon_api: {
        is_default_form: true,
      },
    },
  },
  {
    id: 'pokedex-0124',
    national_dex_number: 124,
    name: 'Jynx',
    generation: 1,
    region: 'kanto',
    types: ['ice', 'fire'],
    sprite_path: '/tmp/jynx.png',
    shiny_sprite_path: '/tmp/jynx-shiny.png',
    metadata: {
      type_icon_source_urls: [],
      is_final_evolution: true,
      pokemon_api: {
        is_default_form: true,
      },
    },
  },
  {
    id: 'pokedex-0144',
    national_dex_number: 144,
    name: 'Articuno',
    generation: 1,
    region: 'kanto',
    types: ['ice', 'fire'],
    sprite_path: '/tmp/articuno.png',
    shiny_sprite_path: '/tmp/articuno-shiny.png',
    metadata: {
      type_icon_source_urls: [],
      is_legendary: true,
      pokemon_api: {
        is_default_form: true,
      },
    },
  },
];

const assetInventory = {
  scanned_at: '2026-08-09T00:00:00.000Z',
  directories: {},
  backgrounds: [
    '/tmp/beach-backgrounds/wave.png',
    '/tmp/fire-backgrounds/lava.png',
    '/tmp/ice-backgrounds/glacier.png',
  ],
  music: ['/tmp/music.mp3'],
  sound_effects: {
    all: ['/tmp/countdown.mp3', '/tmp/timer-end.mp3', '/tmp/pokeball-intro.mp3', '/tmp/shiny.mp3'],
    countdown_tick: '/tmp/countdown.mp3',
    timer_end: '/tmp/timer-end.mp3',
    pokeball_intro: '/tmp/pokeball-intro.mp3',
    shiny: '/tmp/shiny.mp3',
  },
  overlay_presets: {
    pokeball_primary: '/tmp/pokeball.gif',
    timer: '/tmp/timer.gif',
    timer_countdown: '/tmp/timer-countdown.gif',
    timer_alarm: '/tmp/timer-alarm.gif',
    shiny_sparkle: '/tmp/shiny-sparkle.gif',
  },
  overlays: ['/tmp/pokeball.gif', '/tmp/timer-countdown.gif', '/tmp/timer-alarm.gif', '/tmp/shiny-sparkle.gif'],
  transitions: [],
};

test('generic planner dispatch builds a find-the-shiny plan with one chosen subject and themed background priority', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'find-the-shiny-ice-fire',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.find-the-shiny.v1');
  assert.deepEqual(plan.selection.type_pair, ['fire', 'ice']);
  assert.equal(plan.selection.selected_subject_count, 1);
  assert.equal([3, 6, 9].includes(plan.selection.display_subject_count), true);
  assert.equal(plan.selection.grid.columns, 3);
  assert.equal(plan.selection.grid.rows, Math.ceil(plan.selection.display_subject_count / 3));
  assert.equal(plan.assets.background.selected_path, '/tmp/ice-backgrounds/glacier.png');
  assert.equal(plan.assets.pokemon[0].name, 'Articuno');
  assert.equal(plan.assets.overlays.selected_primary_pokeball_overlay_path, '/tmp/pokeball.gif');
  assert.equal(plan.assets.audio.selected_sound_effects.pokeball_intro, '/tmp/pokeball-intro.mp3');
  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.shiny_reveal.selected_name, 'Articuno');
  assert.equal(plan.shiny_reveal.selected_cell_index >= 0, true);
  assert.equal(plan.shiny_reveal.selected_cell_index < plan.selection.display_subject_count, true);
  assert.equal(plan.assets.overlays.sprite_grid.cells.every((cell) => (
    Number.isFinite(cell.pokeball_wiggle_offset_ratio)
  )), true);
  assert.deepEqual(plan.required_asset_gaps, []);
});

test('find-the-shiny planner can produce each supported grid size with a max of three columns', async () => {
  const displayCounts = new Set();

  for (const seed of [
    'find-the-shiny-grid-1',
    'find-the-shiny-grid-2',
    'find-the-shiny-grid-3',
    'find-the-shiny-grid-4',
    'find-the-shiny-grid-5',
    'find-the-shiny-grid-6',
    'find-the-shiny-grid-7',
    'find-the-shiny-grid-8',
    'find-the-shiny-grid-9',
    'find-the-shiny-grid-10',
    'find-the-shiny-grid-11',
    'find-the-shiny-grid-12',
  ]) {
    const plan = await planPokemonTypeChallenge({
      template,
      pokedexRows,
      seed,
      forcedTypePair: ['ice', 'fire'],
      assetInventory,
    });
    displayCounts.add(plan.selection.display_subject_count);
    assert.equal(plan.selection.grid.columns, 3);
    assert.equal(plan.assets.overlays.sprite_grid.columns, 3);
  }

  assert.deepEqual([...displayCounts].sort((left, right) => left - right), [3, 6, 9]);
});

test('generic render-plan dispatch keeps the shiny grid centered and reveal timing deterministic', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'find-the-shiny-render-plan',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });

  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/find-the-shiny.mp4',
  });

  assert.equal(renderPlan.grid.cells.length, plan.selection.grid.sprite_count);
  assert.equal(renderPlan.grid.rows, plan.selection.grid.rows);
  assert.equal(renderPlan.grid.columns, 3);
  assert.equal(renderPlan.audio_cues.reveal_start_seconds, 7.6);
  assert.equal(renderPlan.audio_cues.reveal_visual_start_seconds, 7.68);
  assert.equal(renderPlan.timer_layout.y < renderPlan.grid.stage_bounds_px.top, true);
  assert.equal(renderPlan.output_path, '/tmp/find-the-shiny.mp4');
});

test('visual inputs and audio cues use one normal sprite source plus one shiny reveal source', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'find-the-shiny-inputs',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/find-the-shiny.mp4',
  });

  const inputs = buildVisualInputs(plan, renderPlan);
  assert.deepEqual(inputs.map((input) => input.role), [
    'background',
    'timer-countdown',
    'timer-alarm',
    'pokeball-grid',
    'normal-sprite',
    'shiny-sprite',
    'shiny-sparkle',
  ]);
  assert.deepEqual(inputs[3].args, ['-stream_loop', '-1', '-ignore_loop', '0', '-t', '10', '-i', '/tmp/pokeball.gif']);
  assert.deepEqual(inputs[4].args, ['-loop', '1', '-framerate', '30', '-t', '2.4', '-i', '/tmp/articuno.png']);
  assert.deepEqual(inputs[5].args, ['-loop', '1', '-framerate', '30', '-t', '2.4', '-i', '/tmp/articuno-shiny.png']);

  const script = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav', '/tmp/prompt.wav', '/tmp/reveal.wav'],
    musicPath: null,
    countdownPath: null,
    timerEndPath: null,
    pokeballIntroPath: '/tmp/pokeball-intro.mp3',
    shinyPath: '/tmp/shiny.mp3',
    renderPlan,
  });

  assert.match(script, /\[3:a\]atrim=start=0\.3,asetpts=PTS-STARTPTS,adelay=2100\|2100,volume=0\.5\[pokeballintro\]/u);
  assert.match(script, /\[4:a\]adelay=7680\|7680,volume=0\.5\[shiny\]/u);
  assert.match(script, /\[n0\]\[n1\]\[n2\]\[pokeballintro\]\[shiny\]amix/u);
});

test('visual filter starts with pokeballs, then reveals the grid with exactly one shiny cell and sparkle', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'find-the-shiny-visual-filter',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/find-the-shiny.mp4',
  });
  const shinyCell = renderPlan.grid.cells[plan.shiny_reveal.selected_cell_index];
  const expectedSpriteHoldSize = Number(
    (renderPlan.grid.item_size_px * template.layout.sprite_grid.sprite_scale_multiplier).toFixed(3),
  );
  const expectedPokeballSize = Number(
    (renderPlan.grid.item_size_px * template.layout.pokeball_grid.overlay_scale_multiplier).toFixed(3),
  );

  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      timerCountdown: 1,
      timerAlarm: 2,
      pokeball: 3,
      normalSprite: 4,
      shinySprite: 5,
      shinySparkle: 6,
    },
    null,
    {
      hook: { segments: [] },
      prompt: { segments: [] },
      reveal: { segments: [] },
    },
  );

  assert.match(visualFilter.script, /\[3:v\]fps=30,format=rgba,scale=/u);
  assert.match(visualFilter.script, /\[5:v\]fps=30,trim=duration=2\.4,setpts=PTS-STARTPTS\+7\.68\/TB/u);
  assert.doesNotMatch(visualFilter.script, /pokeballstaticsource/u);
  assert.match(visualFilter.script, new RegExp(`scale=${expectedSpriteHoldSize}:${expectedSpriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1\\[shinyhold\\]`, 'u'));
  assert.match(visualFilter.script, new RegExp(`scale=${expectedPokeballSize}:${expectedPokeballSize}:force_original_aspect_ratio=decrease`, 'u'));
  assert.match(visualFilter.script, /\[pbsrc0\]trim=duration=0\.6,tpad=start_mode=clone:start_duration=[0-9.]+:stop_mode=clone:stop_duration=[0-9.]+,setpts=PTS-STARTPTS\+2\.1\/TB\[pbb0\]/u);
  assert.match(visualFilter.script, /\[pbi0\]split=2\[pbo0\]\[pbt0\]/u);
  assert.match(visualFilter.script, /\[v0\]\[pbo0\]overlay=.*enable='gte\(t,2\.1\)\*lt\(t,7\.68\)'/u);
  assert.match(visualFilter.script, new RegExp(`overlay=${shinyCell.center_x}-w/2:${shinyCell.center_y}-h/2`, 'u'));
  assert.match(visualFilter.script, /\[6:v\]fps=30,trim=duration=0\.9,setpts=PTS-STARTPTS\+7\.68\/TB/u);
  assert.match(visualFilter.script, /pokeballpop/u);
  assert.match(visualFilter.script, /normaltransition/u);
});
