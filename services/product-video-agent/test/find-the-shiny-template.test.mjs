import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/find-the-shiny/render/audio-filter-script.mjs';
import { buildTextArtifacts } from '../src/domains/pokemon/templates/find-the-shiny/render/drawtext-artifacts.mjs';
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
    hook_text_variants: ['Find the Shiny!', "Where's the shiny Pokemon?"],
    type_prompt_text: "Guess where it's hiding",
    reveal_text: 'Did you find it?',
  },
  layout: {
    text: {
      hook_y: 420,
      hook_font_size: 173,
      prompt_y: 290,
      reveal_y: 260,
      prompt_font_size: 108,
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
      column_gap_px: 48,
      row_gap_px: 62,
      sprite_scale_multiplier: 1.264,
      stage_bounds_px: {
        left: 72,
        top: 620,
        width: 936,
        height: 900,
      },
    },
    pokeball_grid: {
      overlay_scale_multiplier: 1.404,
      intro_duration_seconds: 0.72,
      intro_stagger_seconds: 0.32,
    },
    timer: {
      countdown_from: 3,
      countdown_to: 0,
      display_mode: 'hp_bar_depletion',
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
    long_hp_bar: '/tmp/long-hp-bar-countdown-1s.mp4',
    hp_bar: '/tmp/hp-bar-countdown-1s.mp4',
    shiny_sparkle: '/tmp/shiny-sparkle.gif',
  },
  overlays: [
    '/tmp/pokeball.gif',
    '/tmp/timer-countdown.gif',
    '/tmp/timer-alarm.gif',
    '/tmp/long-hp-bar-countdown-1s.mp4',
    '/tmp/shiny-sparkle.gif',
  ],
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
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Find the Shiny$/u);
  assert.equal(plan.assets.pokemon[0].name, 'Articuno');
  assert.equal(plan.assets.overlays.selected_primary_pokeball_overlay_path, '/tmp/pokeball.gif');
  assert.equal(plan.assets.overlays.timer_display_mode, 'hp_bar_depletion');
  assert.equal(plan.assets.overlays.selected_timer_hp_bar_path, '/tmp/long-hp-bar-countdown-1s.mp4');
  assert.equal(plan.assets.overlays.selected_timer_path, null);
  assert.equal(plan.assets.overlays.selected_timer_alarm_path, null);
  assert.equal(plan.assets.audio.selected_sound_effects.pokeball_intro, '/tmp/pokeball-intro.mp3');
  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.shiny_reveal.selected_name, 'Articuno');
  assert.equal(plan.shiny_reveal.selected_cell_index >= 0, true);
  assert.equal(plan.shiny_reveal.selected_cell_index < plan.selection.display_subject_count, true);
  assert.equal(plan.timeline.find((entry) => entry.phase === 'reveal')?.spoken_text, 'Did you find it?');
  assert.equal(plan.assets.overlays.sprite_grid.cells.every((cell) => (
    Number.isFinite(cell.pokeball_intro_offset_ratio)
  )), true);
  assert.equal(
    new Set(plan.assets.overlays.sprite_grid.cells.map((cell) => cell.pokeball_intro_offset_ratio)).size,
    plan.assets.overlays.sprite_grid.cells.length,
  );
  assert.equal(plan.assets.overlays.sprite_grid.cells.every((cell) => (
    Number.isFinite(cell.pokeball_wiggle_offset_ratio)
  )), true);
  assert.equal(plan.assets.overlays.sprite_grid.cells.every((cell) => (
    Number.isFinite(cell.pokeball_replay_offset_ratio)
  )), true);
  assert.equal(
    new Set(plan.assets.overlays.sprite_grid.cells.map((cell) => cell.pokeball_replay_offset_ratio)).size,
    plan.assets.overlays.sprite_grid.cells.length,
  );
  assert.deepEqual(plan.required_asset_gaps, []);
});

test('find-the-shiny planner picks the hook text deterministically from configured variants', async () => {
  const seededTemplate = structuredClone(template);
  seededTemplate.question_contract.hook_text = 'Find the Shiny!';
  seededTemplate.question_contract.hook_text_variants = [
    'Find the Shiny!',
    "Where's the shiny Pokemon?",
  ];

  const planA = await planPokemonTypeChallenge({
    template: seededTemplate,
    pokedexRows,
    seed: 'find-the-shiny-hook-variant',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });
  const planB = await planPokemonTypeChallenge({
    template: seededTemplate,
    pokedexRows,
    seed: 'find-the-shiny-hook-variant',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });

  const hookLineA = planA.timeline.find((entry) => entry.phase === 'hook');
  const hookLineB = planB.timeline.find((entry) => entry.phase === 'hook');
  assert.equal(
    ['Find the Shiny!', "Where's the shiny Pokemon?"].includes(hookLineA?.spoken_text || ''),
    true,
  );
  assert.equal(hookLineA?.spoken_text, hookLineB?.spoken_text);
  assert.equal(planA.narration.lines[0].text, hookLineA?.spoken_text);
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
  assert.equal(renderPlan.audio_cues.reveal_start_seconds, 5.6);
  assert.equal(renderPlan.audio_cues.reveal_visual_start_seconds, 5.68);
  assert.equal(renderPlan.timer_layout.mode, 'hp_bar_depletion');
  assert.equal(renderPlan.timer_layout.y < renderPlan.grid.stage_bounds_px.top, true);
  assert.equal(renderPlan.output_path, '/tmp/find-the-shiny.mp4');
});

test('find-the-shiny hook text uses the configured lower position and larger font size', async () => {
  const singleLineHookTemplate = structuredClone(template);
  singleLineHookTemplate.question_contract.hook_text = 'Find the Shiny!';
  singleLineHookTemplate.question_contract.hook_text_variants = ['Find the Shiny!'];
  const plan = await planPokemonTypeChallenge({
    template: singleLineHookTemplate,
    pokedexRows,
    seed: 'find-the-shiny-hook-layout',
    forcedTypePair: ['ice', 'fire'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template: singleLineHookTemplate,
    outputPath: '/tmp/find-the-shiny.mp4',
  });

  const textArtifacts = buildTextArtifacts({ renderPlan, template: singleLineHookTemplate });
  assert.equal(textArtifacts.hook.font_size, 173);
  const hookLineYs = textArtifacts.hook.lines.map((line) => line.y);
  const centeredY = (hookLineYs[0] + hookLineYs.at(-1)) / 2;
  assert.equal(centeredY, 419.5);
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
    'timer-hp-bar',
    'pokeball-grid',
    'normal-sprite',
    'shiny-sprite',
    'shiny-sparkle',
  ]);
  assert.deepEqual(inputs[1].args, ['-stream_loop', '-1', '-t', '8', '-i', '/tmp/long-hp-bar-countdown-1s.mp4']);
  assert.deepEqual(inputs[2].args, ['-stream_loop', '-1', '-ignore_loop', '0', '-t', '8', '-i', '/tmp/pokeball.gif']);
  assert.deepEqual(inputs[3].args, ['-loop', '1', '-framerate', '30', '-t', '2.4', '-i', '/tmp/articuno.png']);
  assert.deepEqual(inputs[4].args, ['-loop', '1', '-framerate', '30', '-t', '2.4', '-i', '/tmp/articuno-shiny.png']);

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
  assert.match(script, /\[4:a\]adelay=5680\|5680,volume=0\.5\[shiny\]/u);
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
  plan.assets.overlays.selected_timer_hp_bar_duration_seconds = 1;
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
      timerHpBar: 1,
      timerCountdown: null,
      timerAlarm: null,
      pokeball: 2,
      normalSprite: 3,
      shinySprite: 4,
      shinySparkle: 5,
    },
    null,
    {
      hook: { segments: [] },
      prompt: {
        segments: [
          {
            file_path: '/tmp/prompt-line.txt',
            y: template.layout.text.prompt_y,
            start_seconds: renderPlan.phases.type_prompt.start_seconds,
            end_seconds: renderPlan.audio_cues.prompt_end_seconds,
          },
        ],
      },
      reveal: { segments: [] },
    },
  );

  assert.match(visualFilter.script, /\[2:v\]fps=30,format=rgba,scale=/u);
  assert.match(visualFilter.script, /fontsize=108/u);
  assert.match(visualFilter.script, /\[1:v\]fps=30,trim=duration=1,setpts=\(PTS-STARTPTS\)\*3\+2\.6\/TB,scale=/u);
  assert.match(visualFilter.script, /\[4:v\]fps=30,trim=duration=2\.4,setpts=PTS-STARTPTS\+5\.68\/TB/u);
  assert.doesNotMatch(visualFilter.script, /pokeballstaticsource/u);
  assert.doesNotMatch(visualFilter.script, /timercountdown/u);
  assert.doesNotMatch(visualFilter.script, /timeralarm/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='3'/u);
  assert.match(visualFilter.script, new RegExp(`scale=${expectedSpriteHoldSize}:${expectedSpriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1\\[shinyhold\\]`, 'u'));
  assert.match(visualFilter.script, new RegExp(`scale=${expectedPokeballSize}:${expectedPokeballSize}:force_original_aspect_ratio=decrease`, 'u'));
  assert.match(visualFilter.script, /\[pbsrc0\]split=2\[pbisrc0\]\[pbrsrc0\]/u);
  assert.match(visualFilter.script, /\[pbr0\]split=2\[pbo0\]\[pbt0\]/u);
  assert.match(visualFilter.script, /\[vg0\]\[pbo0\]overlay=.*enable='gte\(t,[0-9.]+\)\*lt\(t,5\.68\)'/u);
  assert.match(visualFilter.script, new RegExp(`overlay=${shinyCell.center_x}-w/2:${shinyCell.center_y}-h/2`, 'u'));
  assert.match(visualFilter.script, /\[5:v\]fps=30,trim=duration=0\.9,setpts=PTS-STARTPTS\+5\.68\/TB/u);
  assert.match(visualFilter.script, /pokeballpop/u);
  assert.match(visualFilter.script, /normaltransition/u);
  assert.match(visualFilter.script, /\[pbisrc0\]trim=start=[0-9.]+:duration=0\.6,tpad=stop_mode=clone:stop_duration=[0-9.]+,setpts=PTS-STARTPTS\+[0-9.]+\/TB,scale=w='/u);
  assert.match(visualFilter.script, /\[pbrsrc0\]trim=start=[0-9.]+:duration=0\.6,tpad=stop_mode=clone:stop_duration=[0-9.]+,setpts=PTS-STARTPTS\+[0-9.]+\/TB,scale=/u);
  assert.match(visualFilter.script, /\[v0\]\[pbi0\]overlay=.*enable='gte\(t,[0-9.]+\)\*lt\(t,[0-9.]+\)'/u);
});
