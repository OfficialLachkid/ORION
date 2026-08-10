import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { createPokeQuizzVideoSignatureKey } from '../src/poke-quizz-selection-state.mjs';

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
      selected_subjects_max: 9,
    },
  },
  question_contract: {
    hook_text: 'Guess the Pokemon',
    type_prompt_text: 'Which Pokemon matches these two types?',
    reveal_text: "Who's that Pokemon?",
  },
  layout: {
    pokeball_grid: {
      max_items: 9,
      max_columns: 3,
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
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
  assert.equal(plan.assets.overlays.selected_timer_path, '/tmp/Timer Countdown.gif');
  assert.equal(plan.assets.overlays.selected_timer_countdown_path, '/tmp/Timer Countdown.gif');
  assert.equal(plan.assets.overlays.selected_timer_alarm_path, '/tmp/Timer Alarm.gif');
  assert.equal(plan.assets.overlays.selected_primary_pokeball_overlay_path, '/tmp/3D Pokeball Wiggle.gif');
  assert.equal(plan.assets.overlays.pokeball_grid.item_count, 2);
  assert.equal(plan.assets.overlays.pokeball_grid.centered_from_middle, true);
  assert.equal(plan.assets.overlays.pokeball_grid.columns, 2);
  assert.ok(plan.required_asset_gaps.includes('pokemon_reveal_sprite_local_assets_missing'));
  assert.equal(plan.required_asset_gaps.includes('type_icons_missing'), false);
});

test('planner uses all localized generations when no generation scope is configured', async () => {
  const unscopedTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      generation_scope: [],
    },
  };
  const gen3Rows = [
    ...pokedexRows,
    {
      id: 'pokedex-0343',
      national_dex_number: 343,
      name: 'Baltoy',
      generation: 3,
      region: 'hoenn',
      types: ['ground', 'psychic'],
      sprite_path: '/tmp/0343.png',
      silhouette_path: '/tmp/0343-silhouette.png',
      shiny_sprite_path: '/tmp/0343-shiny.png',
      cry_path: '/tmp/0343.wav',
      sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/343.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/ground.gif',
          'https://www.serebii.net/pokedex-bw/type/psychic.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template: unscopedTemplate,
    pokedexRows: gen3Rows,
    seed: 'gen3-unscoped',
    forcedTypePair: ['ground', 'psychic'],
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
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ground.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/psychic.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.deepEqual(plan.generation_scope, []);
  assert.deepEqual(plan.selection.type_pair, ['ground', 'psychic']);
  assert.equal(plan.selection.selected_subjects[0].generation, 3);
});

test('planner prefers legendary subjects before final-stage evolutions when trimming a pair roster', async () => {
  const priorityTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      type_pair_policy: {
        ...template.selection_rules.type_pair_policy,
        selected_subjects_min: 2,
        selected_subjects_max: 2,
      },
    },
  };
  const priorityRows = [
    {
      id: 'pokedex-0148',
      national_dex_number: 148,
      name: 'Dragonair',
      generation: 1,
      region: 'kanto',
      types: ['dragon', 'flying'],
      sprite_path: '/tmp/0148.png',
      silhouette_path: '/tmp/0148-silhouette.png',
      shiny_sprite_path: '/tmp/0148-shiny.png',
      cry_path: '/tmp/0148.wav',
      sprite_source_url: 'https://example.test/0148.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/dragon.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
    {
      id: 'pokedex-0149',
      national_dex_number: 149,
      name: 'Dragonite',
      generation: 1,
      region: 'kanto',
      types: ['dragon', 'flying'],
      sprite_path: '/tmp/0149.png',
      silhouette_path: '/tmp/0149-silhouette.png',
      shiny_sprite_path: '/tmp/0149-shiny.png',
      cry_path: '/tmp/0149.wav',
      sprite_source_url: 'https://example.test/0149.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/dragon.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
    {
      id: 'pokedex-0384',
      national_dex_number: 384,
      name: 'Rayquaza',
      generation: 3,
      region: 'hoenn',
      types: ['dragon', 'flying'],
      sprite_path: '/tmp/0384.png',
      silhouette_path: '/tmp/0384-silhouette.png',
      shiny_sprite_path: '/tmp/0384-shiny.png',
      cry_path: '/tmp/0384.wav',
      sprite_source_url: 'https://example.test/0384.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        legendary: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/dragon.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template: {
      ...priorityTemplate,
      selection_rules: {
        ...priorityTemplate.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: priorityRows,
    seed: 'priority-subject-trim',
    forcedTypePair: ['dragon', 'flying'],
    assetInventory: {
      scanned_at: '2026-08-04T00:00:00.000Z',
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
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/dragon.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.deepEqual(
    plan.selection.selected_subjects.map((subject) => subject.name),
    ['Dragonite', 'Rayquaza'],
  );
});

test('planner collapses same-dex variants and prefers Mega forms over base and Gigantamax final evolutions', async () => {
  const megaPriorityTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      type_pair_policy: {
        ...template.selection_rules.type_pair_policy,
        selected_subjects_min: 2,
        selected_subjects_max: 2,
      },
    },
  };
  const megaPriorityRows = [
    {
      id: 'pokedex-0002',
      national_dex_number: 2,
      name: 'Ivysaur',
      slug: 'ivysaur',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0002.png',
      silhouette_path: '/tmp/0002-silhouette.png',
      shiny_sprite_path: '/tmp/0002-shiny.png',
      cry_path: '/tmp/0002.wav',
      sprite_source_url: 'https://example.test/0002.png',
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
      id: 'pokedex-0003',
      national_dex_number: 3,
      name: 'Venusaur',
      slug: 'venusaur',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0003.png',
      silhouette_path: '/tmp/0003-silhouette.png',
      shiny_sprite_path: '/tmp/0003-shiny.png',
      cry_path: '/tmp/0003.wav',
      sprite_source_url: 'https://example.test/0003.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      is_default_form: true,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
        pokemon_api: {
          pokemon_name: 'venusaur',
          is_default_form: true,
          is_mega: false,
          is_battle_only: false,
          order: 3,
          form_order: 1,
        },
      },
    },
    {
      id: 'pokedex-0003-venusaur-mega',
      national_dex_number: 3,
      name: 'Venusaur (Mega)',
      slug: 'venusaur-mega',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0003-mega.png',
      silhouette_path: '/tmp/0003-mega-silhouette.png',
      shiny_sprite_path: '/tmp/0003-mega-shiny.png',
      cry_path: '/tmp/0003-mega.wav',
      sprite_source_url: 'https://example.test/0003-mega.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      is_default_form: false,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
        pokemon_api: {
          pokemon_name: 'venusaur-mega',
          is_default_form: false,
          is_mega: true,
          is_battle_only: true,
          order: 4,
          form_order: 2,
        },
      },
    },
    {
      id: 'pokedex-0003-venusaur-gmax',
      national_dex_number: 3,
      name: 'Venusaur (Gigantamax)',
      slug: 'venusaur-gmax',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0003-gmax.png',
      silhouette_path: '/tmp/0003-gmax-silhouette.png',
      shiny_sprite_path: '/tmp/0003-gmax-shiny.png',
      cry_path: '/tmp/0003-gmax.wav',
      sprite_source_url: 'https://example.test/0003-gmax.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      is_default_form: false,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
        pokemon_api: {
          pokemon_name: 'venusaur-gmax',
          form_name: 'Gigantamax',
          is_default_form: false,
          is_mega: false,
          is_battle_only: true,
          order: 5,
          form_order: 3,
        },
      },
    },
    {
      id: 'pokedex-0071',
      national_dex_number: 71,
      name: 'Victreebel',
      slug: 'victreebel',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0071.png',
      silhouette_path: '/tmp/0071-silhouette.png',
      shiny_sprite_path: '/tmp/0071-shiny.png',
      cry_path: '/tmp/0071.wav',
      sprite_source_url: 'https://example.test/0071.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template: megaPriorityTemplate,
    pokedexRows: megaPriorityRows,
    seed: 'mega-variant-preference',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-08-09T00:00:00.000Z',
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.deepEqual(
    plan.selection.selected_subjects.map((subject) => subject.name),
    ['Venusaur (Mega)', 'Victreebel'],
  );
  assert.equal(
    plan.selection.selected_subjects.filter((subject) => subject.national_dex_number === 3).length,
    1,
  );
});

test('planner keeps battle-relevant form-only dual-type rows such as Meloetta Pirouette and Lopunny Mega', async () => {
  const normalFightingRows = [
    {
      id: 'pokedex-0428-lopunny-mega',
      national_dex_number: 428,
      name: 'Lopunny (Mega)',
      slug: 'lopunny-mega',
      generation: 4,
      region: 'sinnoh',
      types: ['normal', 'fighting'],
      sprite_path: '/tmp/0428-lopunny-mega.png',
      silhouette_path: '/tmp/0428-lopunny-mega-silhouette.png',
      shiny_sprite_path: '/tmp/0428-lopunny-mega-shiny.png',
      cry_path: '/tmp/0428-lopunny-mega.wav',
      sprite_source_url: 'https://example.test/0428-lopunny-mega.png',
      shiny_sprite_source_url: 'https://example.test/0428-lopunny-mega-shiny.png',
      silhouette_source_url: null,
      cry_source_url: null,
      is_default_form: false,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/normal.gif',
          'https://www.serebii.net/pokedex-bw/type/fighting.gif',
        ],
        pokemon_api: {
          pokemon_name: 'lopunny-mega',
          form_name: 'Mega',
          is_default_form: false,
          is_battle_only: true,
          is_mega: true,
          order: 650,
          form_order: 2,
        },
      },
    },
    {
      id: 'pokedex-0648-meloetta-pirouette',
      national_dex_number: 648,
      name: 'Meloetta (Pirouette)',
      slug: 'meloetta-pirouette',
      generation: 5,
      region: 'unova',
      types: ['normal', 'fighting'],
      sprite_path: '/tmp/0648-meloetta-pirouette.png',
      silhouette_path: '/tmp/0648-meloetta-pirouette-silhouette.png',
      shiny_sprite_path: '/tmp/0648-meloetta-pirouette-shiny.png',
      cry_path: '/tmp/0648-meloetta-pirouette.wav',
      sprite_source_url: 'https://example.test/0648-meloetta-pirouette.png',
      shiny_sprite_source_url: 'https://example.test/0648-meloetta-pirouette-shiny.png',
      silhouette_source_url: null,
      cry_source_url: null,
      is_default_form: false,
      metadata: {
        is_mythical: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/normal.gif',
          'https://www.serebii.net/pokedex-bw/type/fighting.gif',
        ],
        pokemon_api: {
          pokemon_name: 'meloetta-pirouette',
          form_name: 'Pirouette',
          is_default_form: false,
          is_battle_only: true,
          is_mega: false,
          order: 982,
          form_order: 2,
        },
      },
    },
    {
      id: 'pokedex-0759',
      national_dex_number: 759,
      name: 'Stufful',
      slug: 'stufful',
      generation: 7,
      region: 'alola',
      types: ['normal', 'fighting'],
      sprite_path: '/tmp/0759.png',
      silhouette_path: '/tmp/0759-silhouette.png',
      shiny_sprite_path: '/tmp/0759-shiny.png',
      cry_path: '/tmp/0759.wav',
      sprite_source_url: 'https://example.test/0759.png',
      shiny_sprite_source_url: 'https://example.test/0759-shiny.png',
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/normal.gif',
          'https://www.serebii.net/pokedex-bw/type/fighting.gif',
        ],
      },
    },
    {
      id: 'pokedex-0760',
      national_dex_number: 760,
      name: 'Bewear',
      slug: 'bewear',
      generation: 7,
      region: 'alola',
      types: ['normal', 'fighting'],
      sprite_path: '/tmp/0760.png',
      silhouette_path: '/tmp/0760-silhouette.png',
      shiny_sprite_path: '/tmp/0760-shiny.png',
      cry_path: '/tmp/0760.wav',
      sprite_source_url: 'https://example.test/0760.png',
      shiny_sprite_source_url: 'https://example.test/0760-shiny.png',
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        is_final_evolution: true,
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/normal.gif',
          'https://www.serebii.net/pokedex-bw/type/fighting.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: normalFightingRows,
    seed: 'normal-fighting-forms',
    forcedTypePair: ['normal', 'fighting'],
    assetInventory: {
      scanned_at: '2026-08-10T00:00:00.000Z',
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
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/normal.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fighting.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.deepEqual(
    plan.selection.selected_subjects.map((subject) => subject.name),
    ['Lopunny (Mega)', 'Meloetta (Pirouette)', 'Stufful', 'Bewear'],
  );
  assert.equal(plan.selection.catalog_match_count, 4);
  assert.equal(plan.selection.selected_subject_count, 4);
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
          timer_countdown: null,
          timer_alarm: null,
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
    {
      ...pokedexRows[0],
      sprite_path: '/tmp/0001.png',
      silhouette_path: '/tmp/0001-silhouette.png',
      shiny_sprite_path: '/tmp/0001-shiny.png',
      cry_path: '/tmp/0001.wav',
    },
    {
      ...pokedexRows[1],
      sprite_path: '/tmp/0002.png',
      silhouette_path: '/tmp/0002-silhouette.png',
      shiny_sprite_path: '/tmp/0002-shiny.png',
      cry_path: '/tmp/0002.wav',
    },
    ...pokedexRows.slice(2),
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
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

test('planner caps large compatible groups to a centered 3x3 grid', async () => {
  const manyMatches = [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `pokedex-${String(index + 1).padStart(4, '0')}`,
      national_dex_number: index + 1,
      name: `GrassPoison${index + 1}`,
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: `/tmp/${String(index + 1).padStart(4, '0')}.png`,
      silhouette_path: `/tmp/${String(index + 1).padStart(4, '0')}-silhouette.png`,
      shiny_sprite_path: `/tmp/${String(index + 1).padStart(4, '0')}-shiny.png`,
      cry_path: `/tmp/${String(index + 1).padStart(4, '0')}.wav`,
      sprite_source_url: `https://example.test/${String(index + 1).padStart(4, '0')}.png`,
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/grass.gif',
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
        ],
      },
    })),
  ];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: manyMatches,
    seed: 'ten-match-grid',
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.selection.catalog_match_count, 10);
  assert.equal(plan.selection.compatible_display_count, 9);
  assert.equal(plan.selection.selected_subject_count, 9);
  assert.equal(plan.assets.overlays.pokeball_grid.item_count, 9);
  assert.equal(plan.assets.overlays.pokeball_grid.columns, 3);
  assert.equal(plan.assets.overlays.pokeball_grid.rows, 3);
});

test('planner avoids the immediately previous type pair and background when alternatives exist', async () => {
  const inventory = {
    scanned_at: '2026-07-31T00:00:00.000Z',
    directories: {},
    backgrounds: ['/tmp/background-1.png', '/tmp/background-2.png'],
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
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
        '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
      ],
      three_d: [],
    },
    overlay_presets: {
      timer: '/tmp/Timer.gif',
      timer_countdown: '/tmp/Timer Countdown.gif',
      timer_alarm: '/tmp/Timer Alarm.gif',
      pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
    },
    overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
    transitions: [],
  };

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'repeat-avoidance',
    assetInventory: inventory,
    selectionState: {
      last_type_pair_key: 'grass|poison',
      last_background_path: '/tmp/background-1.png',
    },
  });

  assert.notDeepEqual(plan.selection.type_pair, ['grass', 'poison']);
  assert.equal(plan.assets.background.selected_path, '/tmp/background-2.png');
  assert.notEqual(plan.selection_state.last_type_pair_key, 'grass|poison');
  assert.equal(plan.selection_state.last_background_path, '/tmp/background-2.png');
  assert.equal(
    plan.selection_state.used_video_signatures.includes(
      createPokeQuizzVideoSignatureKey(plan.selection.type_pair, '/tmp/background-2.png'),
    ),
    true,
  );
});

test('planner allows reuse when only one type pair or background exists', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: pokedexRows.filter((row) => row.types.includes('grass')),
    seed: 'repeat-fallback',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-07-31T00:00:00.000Z',
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
    selectionState: {
      last_type_pair_key: 'grass|poison',
      last_background_path: '/tmp/background-1.png',
    },
  });

  assert.deepEqual(plan.selection.type_pair, ['grass', 'poison']);
  assert.equal(plan.assets.background.selected_path, '/tmp/background-1.png');
});

test('planner prefers the least-used type pair bucket before random tie-breaking', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'least-used-first',
    assetInventory: {
      scanned_at: '2026-07-31T00:00:00.000Z',
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
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fairy.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
    selectionState: {
      last_type_pair_key: 'poison|flying',
      type_pair_usage_counts: {
        'poison|flying': 0,
        'fairy|flying': 2,
        'grass|poison': 1,
      },
    },
  });

  assert.deepEqual(plan.selection.type_pair, ['grass', 'poison']);
  assert.equal(plan.selection_state.type_pair_usage_counts['grass|poison'], 2);
});

test('planner prefers beach backgrounds when a water type is in the selected pair', async () => {
  const waterRows = [
    {
      id: 'pokedex-0130',
      national_dex_number: 130,
      name: 'Gyarados',
      generation: 1,
      region: 'kanto',
      types: ['water', 'flying'],
      sprite_path: '/tmp/0130.png',
      silhouette_path: '/tmp/0130-silhouette.png',
      shiny_sprite_path: '/tmp/0130-shiny.png',
      cry_path: '/tmp/0130.wav',
      sprite_source_url: 'https://example.test/0130.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/water.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: waterRows,
    seed: 'water-beach-background',
    forcedTypePair: ['water', 'flying'],
    assetInventory: {
      scanned_at: '2026-07-31T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/beach-backgrounds/beach-2.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav', '/tmp/pokeball_wiggle.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
        pokeball_wiggle: '/tmp/pokeball_wiggle.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/water.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/beach-backgrounds\//u);
});

test('planner restricts fire pairs to fire backgrounds when a fire type is present', async () => {
  const fireRows = [
    {
      id: 'pokedex-0006',
      national_dex_number: 6,
      name: 'Charizard',
      generation: 1,
      region: 'kanto',
      types: ['fire', 'flying'],
      sprite_path: '/tmp/0006.png',
      silhouette_path: '/tmp/0006-silhouette.png',
      shiny_sprite_path: '/tmp/0006-shiny.png',
      cry_path: '/tmp/0006.wav',
      sprite_source_url: 'https://example.test/0006.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/fire.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: fireRows,
    seed: 'fire-background-lock',
    forcedTypePair: ['fire', 'flying'],
    assetInventory: {
      scanned_at: '2026-08-01T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
        '/tmp/fire-backgrounds/fire-2.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav', '/tmp/pokeball_wiggle.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
        pokeball_wiggle: '/tmp/pokeball_wiggle.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fire.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/fire-backgrounds\//u);
});

test('planner excludes beach backgrounds for non-water type pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'non-water-background-guard',
    forcedTypePair: ['poison', 'flying'],
    assetInventory: {
      scanned_at: '2026-08-01T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.assets.background.selected_path, '/tmp/background-plain.png');
});

test('planner prefers cave backgrounds for ground type pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: [
      ...pokedexRows,
      {
        id: 'pokedex-0343',
        national_dex_number: 343,
        name: 'Baltoy',
        generation: 3,
        region: 'hoenn',
        types: ['ground', 'psychic'],
        sprite_path: '/tmp/0343.png',
        silhouette_path: '/tmp/0343-silhouette.png',
        shiny_sprite_path: '/tmp/0343-shiny.png',
        cry_path: '/tmp/0343.wav',
        sprite_source_url: 'https://example.test/0343.png',
        shiny_sprite_source_url: null,
        silhouette_source_url: null,
        cry_source_url: null,
        metadata: {
          type_icon_source_urls: [
            'https://www.serebii.net/pokedex-bw/type/ground.gif',
            'https://www.serebii.net/pokedex-bw/type/psychic.gif',
          ],
        },
      },
    ],
    seed: 'ground-cave-background',
    forcedTypePair: ['ground', 'psychic'],
    assetInventory: {
      scanned_at: '2026-08-04T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/cave-backgrounds/cave-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ground.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/psychic.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/cave-backgrounds\//u);
});

test('planner prefers fire backgrounds for fire and ground pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: [
      ...pokedexRows,
      {
        id: 'pokedex-fire-ground-test',
        national_dex_number: 322,
        name: 'Numel',
        generation: 3,
        region: 'hoenn',
        types: ['fire', 'ground'],
        sprite_path: '/tmp/0322.png',
        silhouette_path: '/tmp/0322-silhouette.png',
        shiny_sprite_path: '/tmp/0322-shiny.png',
        cry_path: '/tmp/0322.wav',
        sprite_source_url: 'https://example.test/0322.png',
        shiny_sprite_source_url: null,
        silhouette_source_url: null,
        cry_source_url: null,
        metadata: {
          type_icon_source_urls: [
            'https://www.serebii.net/pokedex-bw/type/fire.gif',
            'https://www.serebii.net/pokedex-bw/type/ground.gif',
          ],
        },
      },
    ],
    seed: 'fire-ground-background-priority',
    forcedTypePair: ['fire', 'ground'],
    assetInventory: {
      scanned_at: '2026-08-04T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/cave-backgrounds/cave-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fire.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ground.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/fire-backgrounds\//u);
});

test('planner prefers fire backgrounds for fire and rock pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: [
      ...pokedexRows,
      {
        id: 'pokedex-fire-rock-test',
        national_dex_number: 219,
        name: 'Magcargo',
        generation: 2,
        region: 'johto',
        types: ['fire', 'rock'],
        sprite_path: '/tmp/0219.png',
        silhouette_path: '/tmp/0219-silhouette.png',
        shiny_sprite_path: '/tmp/0219-shiny.png',
        cry_path: '/tmp/0219.wav',
        sprite_source_url: 'https://example.test/0219.png',
        shiny_sprite_source_url: null,
        silhouette_source_url: null,
        cry_source_url: null,
        metadata: {
          type_icon_source_urls: [
            'https://www.serebii.net/pokedex-bw/type/fire.gif',
            'https://www.serebii.net/pokedex-bw/type/rock.gif',
          ],
        },
      },
    ],
    seed: 'fire-rock-background-priority',
    forcedTypePair: ['fire', 'rock'],
    assetInventory: {
      scanned_at: '2026-08-04T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/cave-backgrounds/cave-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fire.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/rock.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/fire-backgrounds\//u);
});

test('planner prefers ice backgrounds for ice and fire pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: [
      ...pokedexRows,
      {
        id: 'pokedex-ice-fire-test',
        national_dex_number: 225,
        name: 'Delibird',
        generation: 2,
        region: 'johto',
        types: ['ice', 'fire'],
        sprite_path: '/tmp/0225.png',
        silhouette_path: '/tmp/0225-silhouette.png',
        shiny_sprite_path: '/tmp/0225-shiny.png',
        cry_path: '/tmp/0225.wav',
        sprite_source_url: 'https://example.test/0225.png',
        shiny_sprite_source_url: null,
        silhouette_source_url: null,
        cry_source_url: null,
        metadata: {
          type_icon_source_urls: [
            'https://www.serebii.net/pokedex-bw/type/ice.gif',
            'https://www.serebii.net/pokedex-bw/type/fire.gif',
          ],
        },
      },
    ],
    seed: 'ice-fire-background-priority',
    forcedTypePair: ['ice', 'fire'],
    assetInventory: {
      scanned_at: '2026-08-09T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/fire-backgrounds/fire-1.png',
        '/tmp/ice-backgrounds/ice-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ice.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/fire.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/ice-backgrounds\//u);
});

test('planner prefers ice backgrounds for ice and ground pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template: {
      ...template,
      selection_rules: {
        ...template.selection_rules,
        generation_scope: [],
      },
    },
    pokedexRows: [
      ...pokedexRows,
      {
        id: 'pokedex-ice-ground-test',
        national_dex_number: 361,
        name: 'Snorunt',
        generation: 3,
        region: 'hoenn',
        types: ['ice', 'ground'],
        sprite_path: '/tmp/0361.png',
        silhouette_path: '/tmp/0361-silhouette.png',
        shiny_sprite_path: '/tmp/0361-shiny.png',
        cry_path: '/tmp/0361.wav',
        sprite_source_url: 'https://example.test/0361.png',
        shiny_sprite_source_url: null,
        silhouette_source_url: null,
        cry_source_url: null,
        metadata: {
          type_icon_source_urls: [
            'https://www.serebii.net/pokedex-bw/type/ice.gif',
            'https://www.serebii.net/pokedex-bw/type/ground.gif',
          ],
        },
      },
    ],
    seed: 'ice-ground-background-priority',
    forcedTypePair: ['ice', 'ground'],
    assetInventory: {
      scanned_at: '2026-08-09T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/cave-backgrounds/cave-1.png',
        '/tmp/ice-backgrounds/ice-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ice.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ground.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.match(plan.assets.background.selected_path || '', /\/ice-backgrounds\//u);
});

test('planner excludes cave backgrounds for non-ground non-rock type pairs', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'non-cave-background-guard',
    forcedTypePair: ['poison', 'flying'],
    assetInventory: {
      scanned_at: '2026-08-04T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/beach-backgrounds/beach-1.png',
        '/tmp/cave-backgrounds/cave-1.png',
        '/tmp/fire-backgrounds/fire-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.assets.background.selected_path, '/tmp/background-plain.png');
});

test('planner ignores archived backgrounds even when they appear in inventory', async () => {
  const archivedSafeRows = [
    {
      id: 'pokedex-0169',
      national_dex_number: 169,
      name: 'Crobat',
      generation: 2,
      region: 'johto',
      types: ['poison', 'flying'],
      sprite_path: '/tmp/0169.png',
      silhouette_path: '/tmp/0169-silhouette.png',
      shiny_sprite_path: '/tmp/0169-shiny.png',
      cry_path: '/tmp/0169.wav',
      sprite_source_url: 'https://example.test/0169.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/poison.gif',
          'https://www.serebii.net/pokedex-bw/type/flying.gif',
        ],
      },
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows: archivedSafeRows,
    seed: 'archived-background-guard',
    forcedTypePair: ['poison', 'flying'],
    assetInventory: {
      scanned_at: '2026-08-02T00:00:00.000Z',
      directories: {},
      backgrounds: [
        '/tmp/background-plain.png',
        '/tmp/archived-backgrounds/old-background.png',
        '/tmp/beach-backgrounds/beach-1.png',
      ],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/flying.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.equal(plan.assets.background.selected_path, '/tmp/background-plain.png');
});

test('planner prefers pairs with localized reveal sprites during random selection', async () => {
  const localizedRows = [
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
      sprite_source_url: 'https://example.test/0001.png',
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
      id: 'pokedex-0343',
      national_dex_number: 343,
      name: 'Baltoy',
      generation: 3,
      region: 'hoenn',
      types: ['ground', 'psychic'],
      sprite_path: '/tmp/0343.png',
      silhouette_path: '/tmp/0343-silhouette.png',
      shiny_sprite_path: '/tmp/0343-shiny.png',
      cry_path: '/tmp/0343.wav',
      sprite_source_url: 'https://example.test/0343.png',
      shiny_sprite_source_url: null,
      silhouette_source_url: null,
      cry_source_url: null,
      metadata: {
        type_icon_source_urls: [
          'https://www.serebii.net/pokedex-bw/type/ground.gif',
          'https://www.serebii.net/pokedex-bw/type/psychic.gif',
        ],
      },
    },
  ];

  const localizedTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      generation_scope: [],
    },
  };

  const plan = await planPokemonTypeChallenge({
    template: localizedTemplate,
    pokedexRows: localizedRows,
    seed: 'prefer-localized-pair',
    assetInventory: {
      scanned_at: '2026-08-02T00:00:00.000Z',
      directories: {},
      backgrounds: ['/tmp/background-plain.png'],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
      },
      type_icons: {
        pixel: [
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/ground.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/psychic.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/grass.gif',
          '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Pixel Types/poison.gif',
        ],
        three_d: [],
      },
      overlay_presets: {
        timer: '/tmp/Timer.gif',
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: ['/tmp/Timer Countdown.gif', '/tmp/Timer Alarm.gif', '/tmp/3D Pokeball Wiggle.gif'],
      transitions: [],
    },
  });

  assert.deepEqual(plan.selection.type_pair, ['ground', 'psychic']);
  assert.equal(plan.assets.pokemon.every((subject) => Boolean(subject.sprite_path)), true);
});

test('planner selects at most one shiny reveal per video and records the deterministic roll', async () => {
  const shinyTemplate = {
    ...template,
    reveal: {
      shiny: {
        enabled: true,
        odds_numerator: 1,
        odds_denominator: 1,
        sparkle_duration_seconds: 0.9,
        sparkle_scale_multiplier: 1.35,
      },
    },
  };
  const shinyRows = [
    {
      id: 'pokedex-0001',
      national_dex_number: 1,
      name: 'Bulbasaur',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0001.png',
      silhouette_path: '/tmp/0001-silhouette.png',
      shiny_sprite_path: '/tmp/0001-shiny.png',
      cry_path: '/tmp/0001.wav',
      sprite_source_url: 'https://example.test/0001.png',
      shiny_sprite_source_url: 'https://example.test/0001-shiny.png',
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
      sprite_path: '/tmp/0002.png',
      silhouette_path: '/tmp/0002-silhouette.png',
      shiny_sprite_path: '/tmp/0002-shiny.png',
      cry_path: '/tmp/0002.wav',
      sprite_source_url: 'https://example.test/0002.png',
      shiny_sprite_source_url: 'https://example.test/0002-shiny.png',
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
    template: shinyTemplate,
    pokedexRows: shinyRows,
    seed: 'always-one-shiny',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-08-09T00:00:00.000Z',
      directories: {},
      backgrounds: ['/tmp/background-1.png'],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav', '/tmp/shiny-sound.mp3', '/tmp/enlarge-pokeball.mp3'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
        shiny: '/tmp/shiny-sound.mp3',
        pokeball_intro: '/tmp/enlarge-pokeball.mp3',
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        shiny_sparkle: '/tmp/shiny_sparkle.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: [
        '/tmp/Timer Countdown.gif',
        '/tmp/Timer Alarm.gif',
        '/tmp/shiny_sparkle.gif',
        '/tmp/3D Pokeball Wiggle.gif',
      ],
      transitions: [],
    },
  });

  const shinySubjects = plan.assets.pokemon.filter((subject) => subject.is_shiny_reveal);

  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.shiny_reveal.roll_mode, 'per_selected_subject');
  assert.deepEqual(plan.shiny_reveal.roll_values, [1, 1]);
  assert.equal(plan.shiny_reveal.hit_subject_count, 2);
  assert.equal(plan.shiny_reveal.max_per_video, 1);
  assert.equal(plan.shiny_reveal.chance_percentage, 100);
  assert.equal(plan.shiny_reveal.effective_video_chance_percentage, 100);
  assert.equal(shinySubjects.length, 1);
  assert.equal(shinySubjects[0].reveal_variant, 'shiny');
  assert.equal(shinySubjects[0].reveal_sprite_path, shinySubjects[0].shiny_sprite_path);
  assert.equal(plan.assets.pokemon.filter((subject) => subject.reveal_variant === 'shiny').length, 1);
  assert.equal(plan.assets.overlays.selected_shiny_sparkle_path, '/tmp/shiny_sparkle.gif');
  assert.equal(plan.assets.audio.selected_sound_effects.shiny, '/tmp/shiny-sound.mp3');
  assert.equal(plan.assets.audio.selected_sound_effects.pokeball_intro, '/tmp/enlarge-pokeball.mp3');
});

test('planner defaults shiny odds to one in eleven when the template omits an override', async () => {
  const shinyRows = [
    {
      id: 'pokedex-0001',
      national_dex_number: 1,
      name: 'Bulbasaur',
      generation: 1,
      region: 'kanto',
      types: ['grass', 'poison'],
      sprite_path: '/tmp/0001.png',
      silhouette_path: '/tmp/0001-silhouette.png',
      shiny_sprite_path: '/tmp/0001-shiny.png',
      cry_path: '/tmp/0001.wav',
      sprite_source_url: 'https://example.test/0001.png',
      shiny_sprite_source_url: 'https://example.test/0001-shiny.png',
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
    template: {
      ...template,
      reveal: {},
    },
    pokedexRows: shinyRows,
    seed: 'default-shiny-odds',
    forcedTypePair: ['grass', 'poison'],
    assetInventory: {
      scanned_at: '2026-08-09T00:00:00.000Z',
      directories: {},
      backgrounds: ['/tmp/background-1.png'],
      music: ['/tmp/battle-intro-1.mp3'],
      sound_effects: {
        all: ['/tmp/countdown-tick.wav', '/tmp/reveal.wav', '/tmp/shiny-sound.mp3'],
        countdown_tick: '/tmp/countdown-tick.wav',
        timer_end: '/tmp/reveal.wav',
        reveal: '/tmp/reveal.wav',
        shiny: '/tmp/shiny-sound.mp3',
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
        timer_countdown: '/tmp/Timer Countdown.gif',
        timer_alarm: '/tmp/Timer Alarm.gif',
        shiny_sparkle: '/tmp/shiny_sparkle.gif',
        pokeball_primary: '/tmp/3D Pokeball Wiggle.gif',
      },
      overlays: [
        '/tmp/Timer Countdown.gif',
        '/tmp/Timer Alarm.gif',
        '/tmp/shiny_sparkle.gif',
        '/tmp/3D Pokeball Wiggle.gif',
      ],
      transitions: [],
    },
  });

  assert.equal(plan.shiny_reveal.odds_numerator, 1);
  assert.equal(plan.shiny_reveal.odds_denominator, 11);
  assert.equal(plan.shiny_reveal.chance_percentage, 9.090909);
  assert.equal(plan.shiny_reveal.max_per_video, 1);
});
