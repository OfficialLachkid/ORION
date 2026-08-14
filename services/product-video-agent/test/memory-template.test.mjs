import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { buildAudioFilterScript } from '../src/domains/pokemon/templates/memory/render/audio-filter-script.mjs';
import { buildTextArtifacts } from '../src/domains/pokemon/templates/memory/render/drawtext-artifacts.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/memory/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/memory/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.memory.v1',
  template_key: 'memory',
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
    generation_scope: [1],
    type_pair_policy: {
      disallowed_type_pairs: [],
      min_catalog_matches: 5,
    },
  },
  question_contract: {
    hook_text: 'How good is your memory?',
    hook_text_variants: ['How good is your memory?'],
    question_text: 'Which Pokemon was NOT on screen?',
    question_text_variants: ['Which Pokemon was NOT on screen?'],
    reveal_text: 'The answer was {answer_name}.',
    reveal_text_variants: ['The answer was {answer_name}.'],
  },
  layout: {
    background: {
      source_policy: 'local_t7_backgrounds',
      media_type: 'looping_image_gif_or_video',
      fit: 'cover',
      blur_sigma: 1.8,
    },
    text: {
      hook_y: 210,
      hook_font_size: 124,
      question_y: 560,
      question_font_size: 88,
      option_label_gap_px: 10,
      option_label_font_size: 78,
      reveal_y: 1520,
      reveal_font_size: 110,
    },
    sprite_grid: {
      difficulty_levels: {
        medium: {
          sprite_count: 6,
          rows: 2,
          columns: 3,
        },
      },
      difficulty_weights: {
        medium: 1,
      },
      item_size_px: 236,
      min_item_size_px: 176,
      column_gap_px: 62,
      row_gap_px: 112,
      sprite_scale_multiplier: 1.58,
      placeholder_scale_multiplier: 0.92,
      stage_bounds_px: {
        left: 96,
        top: 360,
        width: 888,
        height: 620,
      },
    },
    option_grid: {
      rows: 2,
      columns: 2,
      item_size_px: 196,
      min_item_size_px: 168,
      column_gap_px: 120,
      row_gap_px: 96,
      sprite_scale_multiplier: 1.12,
      stage_bounds_px: {
        left: 160,
        top: 680,
        width: 760,
        height: 500,
      },
    },
    reveal_sprite: {
      center_x: 540,
      center_y: 920,
      item_size_px: 320,
      sprite_scale_multiplier: 1.08,
    },
    sprite_platform: {
      study_enabled: false,
      option_enabled: true,
      reveal_enabled: false,
      study_width_multiplier: 0.9,
      option_width_multiplier: 0.9,
      reveal_width_multiplier: 0.92,
      center_y_offset_multiplier: 0.34,
    },
    timer: {
      countdown_from: 3,
      countdown_to: 0,
      size_px: 268,
      center_x: 540,
      center_y: 930,
    },
    rounds: {
      hook_hold_seconds: 0.9,
      memorize_hold_seconds: 2,
      question_lead_seconds: 0.45,
      reveal_hold_seconds: 2.1,
    },
  },
  audio: {
    battle_intro_music: {
      start_seconds: 0,
    },
  },
  renderer: {
    intro_sprite_initial_delay_seconds: 0.08,
    intro_sprite_stagger_seconds: 0.18,
    intro_sprite_fade_duration_seconds: 0.22,
    intro_sprite_y_offset_px: 54,
    reveal_visual_delay_seconds: 0.3,
    reveal_move_duration_seconds: 0.35,
  },
};

const pokedexRows = [
  { id: 'pokedex-0037', national_dex_number: 37, name: 'Vulpix', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/vulpix.png', metadata: { pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0058', national_dex_number: 58, name: 'Growlithe', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/growlithe.png', metadata: { pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0077', national_dex_number: 77, name: 'Ponyta', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/ponyta.png', metadata: { pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0126', national_dex_number: 126, name: 'Magmar', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/magmar.png', metadata: { is_final_evolution: true, pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0136', national_dex_number: 136, name: 'Flareon', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/flareon.png', metadata: { is_final_evolution: true, pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0144', national_dex_number: 144, name: 'Articuno', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/articuno.png', metadata: { is_legendary: true, pokemon_api: { is_default_form: true } } },
  { id: 'pokedex-0146', national_dex_number: 146, name: 'Moltres', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/moltres.png', metadata: { is_legendary: true, pokemon_api: { is_default_form: true } } },
];

const assetInventory = {
  scanned_at: '2026-08-13T00:00:00.000Z',
  directories: {},
  backgrounds: [
    '/tmp/fire-backgrounds/lava.png',
    '/tmp/ice-backgrounds/glacier.png',
  ],
  music: ['/tmp/music.mp3'],
  sound_effects: {
    all: ['/tmp/countdown.mp3', '/tmp/timer-end.mp3'],
    countdown_tick: '/tmp/countdown.mp3',
    timer_end: '/tmp/timer-end.mp3',
  },
  overlay_presets: {
    timer: '/tmp/timer.gif',
    timer_countdown: '/tmp/timer-countdown.gif',
    timer_alarm: '/tmp/timer-alarm.gif',
    grass_plateau: '/tmp/grass-plateau.png',
    type_placeholder: '/tmp/question-mark.png',
  },
  overlays: [
    '/tmp/timer.gif',
    '/tmp/timer-countdown.gif',
    '/tmp/timer-alarm.gif',
    '/tmp/grass-plateau.png',
    '/tmp/question-mark.png',
  ],
  transitions: [],
};

test('generic planner dispatch builds a memory round with one off-screen answer and four options', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-fire-ice',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.memory.v1');
  assert.equal(plan.template_key, 'memory');
  assert.deepEqual(plan.selection.type_pair, ['fire', 'ice']);
  assert.equal(plan.selection.display_subject_count, 6);
  assert.equal(plan.selection.grid.columns, 3);
  assert.equal(plan.selection.grid.rows, 2);
  assert.equal(plan.question.mode, 'which_not_on_screen');
  assert.equal(plan.question.option_count, 4);
  assert.equal(plan.question.options.filter((option) => option.is_correct).length, 1);
  assert.equal(
    plan.selection.selected_subjects.some((subject) => subject.name === plan.question.hidden_subject.name),
    false,
  );
  assert.equal(
    plan.question.options.filter((option) => option.appeared_on_screen).length,
    3,
  );
  assert.equal(plan.question.options.every((option) => option.render_sprite_path), true);
  assert.equal(plan.assets.reveal_pokemon.name, plan.question.hidden_subject.name);
  assert.equal(plan.assets.background.selected_path, '/tmp/ice-backgrounds/glacier.png');
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Memory$/u);
  assert.deepEqual(plan.required_asset_gaps, []);
});

test('memory planner rejects a forced pair when form-collapsing leaves too few unique Pokemon for any grid', async () => {
  const constrainedTemplate = {
    ...template,
    layout: {
      ...template.layout,
      sprite_grid: {
        ...template.layout.sprite_grid,
        difficulty_levels: {
          easy: {
            sprite_count: 4,
            rows: 2,
            columns: 2,
          },
          medium: {
            sprite_count: 6,
            rows: 2,
            columns: 3,
          },
        },
        difficulty_weights: {
          easy: 1,
          medium: 1,
        },
      },
    },
  };
  const constrainedRows = [
    { id: 'pokedex-0150', national_dex_number: 150, name: 'Mewtwo', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/mewtwo-base.png', metadata: { pokemon_api: { is_default_form: true, order: 1 } } },
    { id: 'pokedex-0150-mega-x', national_dex_number: 150, name: 'Mewtwo Mega X', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/mewtwo-mega-x.png', metadata: { pokemon_api: { is_mega: true, order: 2 } } },
    { id: 'pokedex-0059', national_dex_number: 59, name: 'Arcanine', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/arcanine.png', metadata: { pokemon_api: { is_default_form: true } } },
    { id: 'pokedex-0078', national_dex_number: 78, name: 'Rapidash', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/rapidash.png', metadata: { pokemon_api: { is_default_form: true } } },
    { id: 'pokedex-0136', national_dex_number: 136, name: 'Flareon', generation: 1, region: 'kanto', types: ['fire', 'ice'], sprite_path: '/tmp/flareon.png', metadata: { pokemon_api: { is_default_form: true } } },
  ];

  await assert.rejects(
    planPokemonTypeChallenge({
      template: constrainedTemplate,
      pokedexRows: constrainedRows,
      seed: 'memory-invalid-collapsed-pair',
      forcedTypePair: ['fire', 'ice'],
      assetInventory,
    }),
    /No eligible Pokemon match the requested type pair/u,
  );
});

test('memory render plan keeps memorize, question, countdown, and reveal timing deterministic', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-render-plan',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });

  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/memory.mp4',
  });

  assert.equal(renderPlan.phases.hook.start_seconds, 0);
  assert.equal(renderPlan.phases.question.start_seconds, 2.9);
  assert.equal(renderPlan.phases.countdown.start_seconds, 3.35);
  assert.equal(renderPlan.phases.reveal.start_seconds, 6.35);
  assert.equal(renderPlan.grid.cells.length, 6);
  assert.equal(renderPlan.question.options.length, 4);
  assert.equal(renderPlan.output_path, '/tmp/memory.mp4');
});

test('memory visual inputs include study sprites, question-option sprites, and the reveal sprite', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-inputs',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/memory.mp4',
  });

  const inputs = buildVisualInputs(plan, renderPlan);
  assert.deepEqual(inputs.slice(0, 4).map((input) => input.role), [
    'background',
    'timer-countdown',
    'timer-alarm',
    'grass-platform',
  ]);
  assert.equal(inputs.filter((input) => input.role.startsWith('display-sprite-')).length, 6);
  assert.equal(inputs.filter((input) => input.role.startsWith('option-sprite-')).length, 4);
  assert.equal(inputs.some((input) => input.role === 'reveal-sprite'), true);
});

test('memory drawtext artifacts place the multiple-choice labels under a 2x2 sprite grid', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-text-artifacts',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/memory.mp4',
  });

  const artifacts = buildTextArtifacts({ renderPlan, template });
  assert.equal(artifacts.options.lines.length, 4);
  assert.equal(artifacts.options.lines[0].text, 'A');
  assert.match(artifacts.options.lines[0].x_expression, /-text_w\/2$/u);
  assert.notEqual(artifacts.options.lines[1].y - artifacts.options.lines[0].y, 116);
});

test('memory audio filter schedules hook, question, countdown ticks, and reveal cue in order', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-audio',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/memory.mp4',
  });

  const script = buildAudioFilterScript({
    narrationPaths: ['/tmp/hook.wav', '/tmp/question.wav', '/tmp/reveal.wav'],
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/timer-end.mp3',
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });

  assert.match(script, /\[0:a\]adelay=0\|0,volume=1\[n0\]/u);
  assert.match(script, /\[1:a\]adelay=2900\|2900,volume=1\[n1\]/u);
  assert.match(script, /\[4:a\]asplit=3/u);
  assert.match(script, /\[5:a\]adelay=6350\|6350,volume=0\.9\[timerend\]/u);
});

test('memory visual filter shows intro sprites, 2x2 option sprites, the hidden answer reveal, and never draws a zero countdown', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'memory-visual',
    forcedTypePair: ['fire', 'ice'],
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/memory.mp4',
  });

  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      timerCountdown: 1,
      timerAlarm: 2,
      grassPlatform: 3,
      sprites: [4, 5, 6, 7, 8, 9],
      optionSprites: [10, 11, 12, 13],
      revealSprite: 14,
    },
    '/tmp/font.ttf',
    {
      hook: { segments: [{ file_path: '/tmp/hook.txt', y: 250, font_size: 132, start_seconds: 0, end_seconds: 2.9 }] },
      question: { segments: [{ file_path: '/tmp/question.txt', y: 1020, font_size: 88, start_seconds: 2.9, end_seconds: 6.35 }] },
      options: {
        segments: plan.question.options.map((option, index) => ({
          file_path: `/tmp/option-${index}.txt`,
          x_expression: `${300 + (index * 10)}-text_w/2`,
          y: 1220 + (index * 40),
          font_size: 78,
          start_seconds: 2.9,
          end_seconds: 6.35,
        })),
      },
      reveal: { segments: [{ file_path: '/tmp/reveal.txt', y: 1690, font_size: 110, start_seconds: 6.51, end_seconds: 8.45 }] },
    },
  );

  assert.match(visualFilter.script, /\[0:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=1\.8:steps=1,fps=30,setsar=1\[v0\]/u);
  assert.match(visualFilter.script, /\[3:v\]fps=30,scale=.*:-1,format=rgba,setsar=1,fade=t=out:st=6\.35:d=0\.3:alpha=1/u);
  assert.match(visualFilter.script, /\[4:v\]fps=30,scale=.*format=rgba,setsar=1,fade=t=in:st=/u);
  assert.match(visualFilter.script, /\[10:v\]fps=30,scale=.*format=rgba,setsar=1,fade=t=out:st=6\.35:d=0\.3:alpha=1/u);
  assert.match(visualFilter.script, /\[14:v\]fps=30,scale=/u);
  assert.match(visualFilter.script, /memoption0platform/u);
  assert.doesNotMatch(visualFilter.script, /memstudy0platform/u);
  assert.doesNotMatch(visualFilter.script, /memrevealplatform/u);
  assert.match(visualFilter.script, /overlay=.*enable='between\(t,2\.9,6\.65\)'/u);
  assert.match(visualFilter.script, /overlay=.*enable='between\(t,6\.65,8\.45\)'/u);
  assert.match(visualFilter.script, /if\(lt\(t,6\.65\),/u);
  assert.match(visualFilter.script, /drawtext=textfile='\/tmp\/option-0\.txt'/u);
  assert.match(visualFilter.script, /drawtext=text='3'/u);
  assert.match(visualFilter.script, /drawtext=text='1'/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='0'/u);
});
