import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';

const template = {
  template_id: 'pokemon-type-challenge-v1',
  canvas: {
    width: 1080,
    height: 1920,
    safe_zone: {
      top: 160,
      right: 100,
      bottom: 260,
      left: 100,
    },
  },
  selection_rules: {
    generation_scope: [1, 2],
    type_pair_policy: {
      disallowed_type_pairs: [
        ['normal', 'ice'],
      ],
      min_catalog_matches: 1,
      selected_subjects_min: 1,
      selected_subjects_max: 12,
    },
  },
  question_contract: {
    hook_text: 'Guess the Pokemon',
    type_prompt_text: 'Which Pokemon matches these two types?',
    reveal_text: "Who's that Pokemon?",
  },
  layout: {
    pokeball_grid: {
      max_items: 12,
      max_columns: 4,
      item_size_px: 180,
      column_gap_px: 28,
      row_gap_px: 28,
      stage_bounds_px: {
        left: 120,
        top: 520,
        width: 840,
        height: 760,
      },
    },
    timer: {
      countdown_from: 5,
      countdown_to: 0,
    },
  },
};

const pokedexRows = [
  {
    id: 'pokedex-0001',
    national_dex_number: 1,
    name: 'Bulbasaur',
    generation: 1,
    region: 'kanto',
    types: ['grass', 'poison'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/001.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/grass.gif',
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
      ],
    },
  },
  {
    id: 'pokedex-0002',
    national_dex_number: 2,
    name: 'Ivysaur',
    generation: 1,
    region: 'kanto',
    types: ['grass', 'poison'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/002.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/grass.gif',
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
      ],
    },
  },
  {
    id: 'pokedex-0169',
    national_dex_number: 169,
    name: 'Crobat',
    generation: 2,
    region: 'johto',
    types: ['poison', 'flying'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/169.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/poison.gif',
        'https://www.serebii.net/pokedex-bw/type/flying.gif',
      ],
    },
  },
  {
    id: 'pokedex-0176',
    national_dex_number: 176,
    name: 'Togetic',
    generation: 2,
    region: 'johto',
    types: ['fairy', 'flying'],
    sprite_path: null,
    silhouette_path: null,
    cry_path: null,
    sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/176.png',
    silhouette_source_url: null,
    cry_source_url: null,
    metadata: {
      type_icon_source_urls: [
        'https://www.serebii.net/pokedex-bw/type/fairy.gif',
        'https://www.serebii.net/pokedex-bw/type/flying.gif',
      ],
    },
  },
];

test('planner selects an observed dual-type pair and emits asset gap guidance', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'grass-poison-test',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-07-28T00:00:00.000Z',
      directories: {},
      backgrounds: ['/tmp/background-1.png'],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.channel.name, 'Poke Quizz');
  assert.deepEqual(plan.selection.type_pair, ['grass', 'poison']);
  assert.equal(plan.selection.catalog_match_count, 2);
  assert.equal(plan.selection.selected_subject_count, 2);
  assert.equal(plan.assets.type_icons[0].local_path.includes('Pixel Types'), true);
  assert.equal(plan.assets.background.selected_path, '/tmp/background-1.png');
  assert.equal(plan.assets.audio.selected_battle_intro_music_path, '/tmp/battle-intro-1.mp3');
  assert.equal(plan.assets.overlays.selected_timer_path, '/tmp/Timer.gif');
  assert.equal(plan.assets.overlays.selected_primary_pokeball_overlay_path, '/tmp/3D Pokeball Wiggle.gif');
  assert.equal(plan.assets.overlays.pokeball_grid.item_count, 2);
  assert.equal(plan.assets.overlays.pokeball_grid.centered_from_middle, true);
  assert.equal(plan.assets.overlays.pokeball_grid.columns, 2);
  assert.ok(plan.required_asset_gaps.includes('pokemon_reveal_sprite_local_assets_missing'));
  assert.equal(plan.required_asset_gaps.includes('type_icons_missing'), false);
});

test('planner rejects disallowed or absent type pairs', async () => {
  await assert.rejects(
    () => planPokemonTypeChallenge({
      template,
      pokedexRows,
      seed: 'invalid',
      forcedTypePair: ['normal', 'ice'],
      assetInventory: {
        scanned_at: '2026-07-28T00:00:00.000Z',
        directories: {},
        backgrounds: [],
        music: [],
        sound_effects: {
          all: [],
          countdown_tick: null,
          timer_end: null,
          reveal: null,
        },
        type_icons: {
          pixel: [],
          three_d: [],
        },
        overlay_presets: {
          timer: null,
          pokeball_primary: null,
        },
        overlays: [],
        transitions: [],
      },
    }),
    /No eligible Pokemon match/u,
  );
});

test('planner centers incomplete pokeball rows within the stage bounds', async () => {
  const fiveMatchRows = [
    ...pokedexRows,
    {
      id: 'pokedex-0043',
      national_dex_number: 43,
      name: 'Oddish',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0043.png',
      silhouette_path: '/tmp/0043-silhouette.png',
      shiny_sprite_path: '/tmp/0043-shiny.png',
      cry_path: '/tmp/0043.wav',
      sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/043.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
      },
    },
    {
      id: 'pokedex-0044',
      national_dex_number: 44,
      name: 'Gloom',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0044.png',
      silhouette_path: '/tmp/0044-silhouette.png',
      shiny_sprite_path: '/tmp/0044-shiny.png',
      cry_path: '/tmp/0044.wav',
      sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/044.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
      },
    },
    {
      id: 'pokedex-0071',
      national_dex_number: 71,
      name: 'Victreebel',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0071.png',
      silhouette_path: '/tmp/0071-silhouette.png',
      shiny_sprite_path: '/tmp/0071-shiny.png',
      cry_path: '/tmp/0071.wav',
      sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/071.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: fiveMatchRows,
    seed: 'five-match-grid',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-07-28T00:00:00.000Z',
      directories: {},
      backgrounds: ['/tmp/background-1.png'],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.selection.catalog_match_count, 5);
  assert.equal(plan.selection.compatible_display_count, 5);
  assert.equal(plan.assets.overlays.pokeball_grid.columns, 3);
  assert.equal(plan.assets.overlays.pokeball_grid.rows, 2);
  assert.equal(plan.assets.overlays.pokeball_grid.cells[3].x, 346);
  assert.equal(plan.assets.overlays.pokeball_grid.cells[4].x, 554);
});
