import test from 'node:test';
import assert from 'node:assert/strict';
import { planPokemonTypeChallenge } from '../src/pokemon-type-challenge-planner.mjs';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import {
  buildAudioFilterScript,
  buildTournamentCryCues,
} from '../src/domains/pokemon/templates/tournament/render/audio-filter-script.mjs';
import { resolveTournamentBattle } from '../src/domains/pokemon/templates/tournament/battle-logic.mjs';
import { applyNarrationDurationsToRenderPlan } from '../src/domains/pokemon/templates/tournament/render/render-plan.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/tournament/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/tournament/render/visual-inputs.mjs';

const template = {
  template_id: 'pokemon.tournament.v1',
  template_key: 'tournament',
  canvas: {
    width: 1080,
    height: 1920,
    fps: 30,
  },
  selection_rules: {
    generation_scope: [1],
    participant_count: 4,
    mode: 'single_elimination_bracket',
    animated_shiny_probability: 1,
    max_animated_shiny_participants: 1,
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
    hook_text: 'Who wins this tournament?',
    hook_text_variants: ['Who wins this tournament?'],
    champion_text: '{champion_name} won the tournament',
    champion_text_variants: ['{champion_name} won the tournament'],
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
      winner_y: 200,
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
        semi_1_a: { x: 40, y: 1100 },
        semi_1_b: { x: 300, y: 1100 },
        semi_1_winner: { x: 170, y: 800 },
        semi_2_a: { x: 560, y: 1100 },
        semi_2_b: { x: 820, y: 1100 },
        semi_2_winner: { x: 690, y: 800 },
        final_winner: { x: 430, y: 340 },
      },
    },
    battle_stage: {
      sprite_size_px: 408,
      left_center_x: 275,
      right_center_x: 805,
      center_y: 1150,
      name_y: 1430,
      name_font_size: 62,
      vs_y: 1125,
      vs_font_size: 100,
      versus_width_px: 250,
      versus_y_px: 960,
    },
    champion_stage: {
      sprite_size_px: 520,
      center_x: 540,
      center_y: 1120,
      name_y: 1510,
      name_font_size: 86,
    },
    sprite_platform: {
      option_enabled: true,
      option_width_multiplier: 0.85,
      center_y_offset_multiplier: 0.34,
      option_center_y_offset_px: 30,
    },
    rounds: {
      hook_hold_seconds: 1.1,
      intro_participant_hold_seconds: 2,
      inter_round_bracket_hold_seconds: 2.5,
      post_progress_hold_seconds: 1,
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
      intro_slot_reveal: {
        enabled: true,
        preferred_keywords: ['pokeball-open-sound'],
      },
      bracket_progress: {
        enabled: true,
        preferred_keywords: ['select-sound'],
      },
      winner_reveal: {
        enabled: true,
        preferred_keywords: ['ding-sound'],
      },
      stats_reveal: {
        enabled: true,
        preferred_keywords: ['electric-loading-sound'],
      },
      disappear: {
        enabled: true,
        preferred_keywords: ['disappear-sound'],
      },
    },
  },
  renderer: {
    intro_pokeball_scale_multiplier: 1.04,
    intro_slot_reveal_fade_seconds: 0.18,
    intro_slot_reveal_stagger_seconds: 0.3,
    intro_bracket_semi_slot_seconds: 0.3,
    intro_bracket_semi_connector_seconds: 1.3,
    intro_bracket_finalist_slot_seconds: 0.3,
    intro_bracket_final_connector_seconds: 1.3,
    intro_bracket_champion_slot_seconds: 0.3,
    battle_disappear_duration_seconds: 0.42,
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
    animated_sprite_path: '/tmp/charizard.gif',
    shiny_animated_sprite_path: '/tmp/charizard-shiny.gif',
    cry_path: '/tmp/0006.ogg',
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
    animated_sprite_path: '/tmp/blastoise.gif',
    shiny_animated_sprite_path: '/tmp/blastoise-shiny.gif',
    cry_path: '/tmp/0009.ogg',
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
    animated_sprite_path: '/tmp/dragonite.gif',
    shiny_animated_sprite_path: '/tmp/dragonite-shiny.gif',
    cry_path: '/tmp/0149.ogg',
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
    animated_sprite_path: '/tmp/gengar.gif',
    shiny_animated_sprite_path: '/tmp/gengar-shiny.gif',
    cry_path: '/tmp/0094.ogg',
    metadata: {
      base_stats: { hp: 60, attack: 65, defense: 60, special_attack: 130, special_defense: 75, speed: 110 },
    },
  },
];

const assetInventory = {
  scanned_at: '2026-08-25T00:00:00.000Z',
  directories: {},
  backgrounds: ['/tmp/backgrounds/arena.png'],
  battle_backgrounds: ['/tmp/battle-backgrounds/arena.png'],
  music: ['/tmp/music.mp3'],
  sound_effects: {
    all: ['/tmp/ding-sound.mp3', '/tmp/select-sound.mp3', '/tmp/pokeball-open-sound.mp3', '/tmp/electric-loading-sound.mp3', '/tmp/disappear-sound.mp3'],
    timer_end: '/tmp/ding-sound.mp3',
    pokeball_intro: '/tmp/pokeball-open-sound.mp3',
    stats_reveal: '/tmp/electric-loading-sound.mp3',
    disappear: '/tmp/disappear-sound.mp3',
  },
  overlays: ['/tmp/open-close-pokeball.gif', '/tmp/disappear.gif', '/tmp/grass-plateau.png', '/tmp/versus.png'],
  overlay_presets: {
    pokeball_primary: '/tmp/open-close-pokeball.gif',
    disappear: '/tmp/disappear.gif',
    grass_plateau: '/tmp/grass-plateau.png',
    versus: '/tmp/versus.png',
  },
};

const legendaryPoolRows = [
  {
    id: 'pokedex-0144',
    national_dex_number: 144,
    name: 'Articuno',
    slug: 'articuno',
    generation: 1,
    region: 'kanto',
    types: ['ice', 'flying'],
    sprite_path: '/tmp/articuno.png',
    animated_sprite_path: '/tmp/articuno.gif',
    shiny_animated_sprite_path: '/tmp/articuno-shiny.gif',
    cry_path: '/tmp/0144.ogg',
    metadata: {
      is_legendary: true,
      base_stats: { hp: 90, attack: 85, defense: 100, special_attack: 95, special_defense: 125, speed: 85 },
    },
  },
  {
    id: 'pokedex-0145',
    national_dex_number: 145,
    name: 'Zapdos',
    slug: 'zapdos',
    generation: 1,
    region: 'kanto',
    types: ['electric', 'flying'],
    sprite_path: '/tmp/zapdos.png',
    animated_sprite_path: '/tmp/zapdos.gif',
    shiny_animated_sprite_path: '/tmp/zapdos-shiny.gif',
    cry_path: '/tmp/0145.ogg',
    metadata: {
      is_legendary: true,
      base_stats: { hp: 90, attack: 90, defense: 85, special_attack: 125, special_defense: 90, speed: 100 },
    },
  },
  {
    id: 'pokedex-0146',
    national_dex_number: 146,
    name: 'Moltres',
    slug: 'moltres',
    generation: 1,
    region: 'kanto',
    types: ['fire', 'flying'],
    sprite_path: '/tmp/moltres.png',
    animated_sprite_path: '/tmp/moltres.gif',
    shiny_animated_sprite_path: '/tmp/moltres-shiny.gif',
    cry_path: '/tmp/0146.ogg',
    metadata: {
      is_legendary: true,
      base_stats: { hp: 90, attack: 100, defense: 90, special_attack: 125, special_defense: 85, speed: 90 },
    },
  },
  {
    id: 'pokedex-0151',
    national_dex_number: 151,
    name: 'Mew',
    slug: 'mew',
    generation: 1,
    region: 'kanto',
    types: ['psychic'],
    sprite_path: '/tmp/mew.png',
    animated_sprite_path: '/tmp/mew.gif',
    shiny_animated_sprite_path: '/tmp/mew-shiny.gif',
    cry_path: '/tmp/0151.ogg',
    metadata: {
      is_mythical: true,
      base_stats: { hp: 100, attack: 100, defense: 100, special_attack: 100, special_defense: 100, speed: 100 },
    },
  },
];

test('generic planner dispatch builds a four-participant tournament bracket with at most one shiny gif', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'tournament-bracket',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.tournament.v1');
  assert.equal(plan.template_key, 'tournament');
  assert.equal(plan.selection.participant_count, 4);
  assert.equal(plan.tournament.participants.length, 4);
  assert.equal(plan.tournament.matches.length, 3);
  assert.equal(plan.tournament.matches[0].round_label, 'Semi Final 1');
  assert.equal(plan.tournament.participants[0].render_sprite_path.endsWith('.gif'), true);
  assert.equal(plan.tournament.participants.filter((participant) => participant.uses_shiny_render_sprite).length, 1);
  assert.equal(plan.selection.animated_shiny_participant_count, 1);
  assert.equal(plan.tournament.participants.every((participant) => participant.cry_path.endsWith('.ogg')), true);
  assert.equal(plan.assets.overlays.selected_intro_pokeball_path, '/tmp/open-close-pokeball.gif');
  assert.equal(plan.assets.overlays.selected_disappear_path, '/tmp/disappear.gif');
  assert.equal(plan.assets.overlays.selected_grass_plateau_path, '/tmp/grass-plateau.png');
  assert.equal(plan.assets.overlays.selected_versus_path, '/tmp/versus.png');
  assert.equal(plan.assets.audio.selected_sound_effects.intro_slot_reveal, '/tmp/pokeball-open-sound.mp3');
  assert.equal(plan.assets.audio.selected_sound_effects.bracket_progress, '/tmp/select-sound.mp3');
  assert.equal(plan.assets.audio.selected_sound_effects.winner_reveal, '/tmp/ding-sound.mp3');
  assert.equal(plan.assets.audio.selected_sound_effects.stats_reveal, '/tmp/electric-loading-sound.mp3');
  assert.equal(plan.assets.audio.selected_sound_effects.disappear, '/tmp/disappear-sound.mp3');
  assert.equal(plan.required_asset_gaps.length, 0);
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Tournament$/u);
  assert.equal(plan.narration.lines.some((line) => line.role === 'semi-final-1-insight'), true);
});

test('tournament battle commentary uses type advantage phrasing when typing decides the outcome', () => {
  const charizard = {
    id: 'charizard',
    display_name: 'Charizard',
    types: ['fire', 'flying'],
    base_stats: { hp: 78, attack: 84, defense: 78, special_attack: 109, special_defense: 85, speed: 100 },
    base_stat_total: 534,
  };
  const blastoise = {
    id: 'blastoise',
    display_name: 'Blastoise',
    types: ['water'],
    base_stats: { hp: 79, attack: 83, defense: 100, special_attack: 85, special_defense: 105, speed: 78 },
    base_stat_total: 530,
  };

  const battle = resolveTournamentBattle({
    left: charizard,
    right: blastoise,
    weights: {
      ...template.selection_rules.battle_weights,
      base_stat_total: 0,
      hp: 0,
      attack: 0,
      defense: 0,
      special_attack: 0,
      special_defense: 0,
      speed: 0,
      type_advantage: 120,
      speed_edge: 0,
      random_spread: 0,
    },
    random: () => 0.5,
  });

  assert.equal(battle.intro_line_text, 'Charizard versus Blastoise.');
  assert.equal(battle.insight_text, 'Blastoise has the type advantage.');
  assert.equal(battle.commentary_text, 'Charizard versus Blastoise. Blastoise has the type advantage.');
});

test('tournament planner can restrict selection to a seeded legendary-only pool', async () => {
  const legendaryPoolTemplate = JSON.parse(JSON.stringify(template));
  legendaryPoolTemplate.selection_rules.generation_scope = [];
  legendaryPoolTemplate.selection_rules.pool_variants = [
    {
      key: 'legendary_only',
      label: 'Legendary Only',
      selector: 'legendary_only',
      weight: 1,
      max_base_stat_total_spread: 40,
      max_matchup_base_stat_total_delta: 20,
    },
  ];

  const plan = await planPokemonTypeChallenge({
    template: legendaryPoolTemplate,
    pokedexRows: [...pokedexRows, ...legendaryPoolRows],
    seed: 'tournament-legendary-pool',
    assetInventory,
  });

  assert.equal(plan.selection.pool_key, 'legendary_only');
  assert.equal(plan.selection.pool_label, 'Legendary Only');
  assert.equal(plan.selection.participant_count, 4);
  assert.equal(plan.tournament.participants.every((participant) => (
    participant.metadata.is_legendary || participant.metadata.is_mythical
  )), true);
  assert.ok((plan.selection.balance.base_stat_total_spread ?? 999) <= 40);
  assert.ok((plan.selection.balance.max_matchup_base_stat_total_delta ?? 999) <= 20);
});

test('tournament render plan and inputs stay deterministic for a four-Pokemon bracket', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'tournament-render-plan',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/tournament.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);

  assert.equal(renderPlan.matches.length, 3);
  assert.equal(renderPlan.output_path, '/tmp/tournament.mp4');
  assert.equal(renderPlan.bracket_layout.slots.final_winner.center_x, 540);
  assert.equal(renderPlan.bracket_layout.slots.semi_1_winner.center_y, 892);
  assert.equal(renderPlan.matches[0].intro_start_seconds, 5.98);
  assert.equal(renderPlan.matches[0].battle_transition_start_seconds, 5.58);
  assert.equal(renderPlan.matches[1].intro_start_seconds - renderPlan.matches[1].scene_start_seconds, 2.5);
  assert.equal(renderPlan.intro_sequence.bracket_draw_end_seconds, 2.9);
  assert.equal(renderPlan.intro_sequence.participant_reveal_stagger_seconds, 0.3);
  assert.equal(renderPlan.intro_sequence.participant_hold_end_seconds, renderPlan.matches[0].intro_start_seconds);
  assert.equal(renderPlan.matches[0].insight_start_seconds > renderPlan.matches[0].intro_start_seconds, true);
  assert.equal(renderPlan.narration_cues.some((cue) => cue.role === 'semi-final-1-insight'), true);
  assert.ok(
    (renderPlan.matches[1].battle_transition_start_seconds - renderPlan.matches[0].bracket_progress_end_seconds) >= 0.95,
  );
  assert.equal(renderPlan.champion_scene.start_seconds, renderPlan.matches.at(-1)?.bracket_progress_end_seconds);
  assert.equal(renderPlan.champion_scene.end_seconds > renderPlan.matches.at(-1)?.scene_end_seconds, true);
  assert.equal(visualInputs.length, 9);
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs[1].role, 'intro-pokeball');
  assert.equal(visualInputs[2].role, 'battle-disappear');
  assert.equal(visualInputs[3].role, 'grass-platform');
  assert.equal(visualInputs[4].role, 'versus');
  assert.equal(visualInputs.at(-1)?.role, 'participant-3');
  assert.deepEqual(visualInputs[5].args.slice(0, 4), ['-ignore_loop', '0', '-t', String(renderPlan.total_duration_seconds)]);
});

test('tournament audio and visual filters include winner sting cues and champion overlay logic', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'tournament-filters',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/tournament.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      introPokeball: 1,
      battleDisappear: 2,
      grassPlatform: 3,
      versus: 4,
      participants: [5, 6, 7, 8],
    },
    '/tmp/font.ttf',
  );
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_, index) => `/tmp/${index}.wav`),
    introSlotRevealPath: '/tmp/pokeball-open-sound.mp3',
    musicPath: '/tmp/music.mp3',
    bracketProgressPath: '/tmp/select-sound.mp3',
    winnerRevealPath: '/tmp/ding-sound.mp3',
    statsRevealPath: '/tmp/electric-loading-sound.mp3',
    disappearPath: '/tmp/disappear-sound.mp3',
    cryCues: buildTournamentCryCues(plan, renderPlan),
    renderPlan,
  });
  const slotPositions = template.layout.bracket.slot_positions;
  const slotSize = template.layout.bracket.slot_card_width_px;
  const firstMatchWinnerSlot = renderPlan.matches[0].winner_side === 'left'
    ? slotPositions.semi_1_a
    : slotPositions.semi_1_b;
  const firstMatchWinnerCenterX = firstMatchWinnerSlot.x + (slotSize / 2);
  const firstMatchBracketCenterX = slotPositions.semi_1_winner.x + (slotSize / 2);
  const finalMatchWinnerSlot = renderPlan.matches[2].winner_side === 'left'
    ? slotPositions.semi_1_winner
    : slotPositions.semi_2_winner;
  const finalMatchWinnerCenterX = finalMatchWinnerSlot.x + (slotSize / 2);
  const finalBracketCenterX = slotPositions.final_winner.x + (slotSize / 2);

  assert.match(visualFilter.script, /\[0:v\]fps=30,scale=1080:1920/u);
  assert.match(visualFilter.script, /Winner/u);
  assert.match(visualFilter.script, /overlay=x='540-overlay_w\/2'/u);
  assert.equal(/:w=-/u.test(visualFilter.script), false);
  assert.equal(plan.assets.background.expected_directory, '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/battle-backgrounds');
  assert.equal(plan.assets.background.selected_path, '/tmp/battle-backgrounds/arena.png');
  assert.equal((visualFilter.script.match(/setsar=1\[p\d+champ0\]/gu) || []).length, 1);
  assert.equal((visualFilter.script.match(/colorchannelmixer=aa=0\.46\[p\d+stagegray0\]/gu) || []).length, 3);
  assert.match(visualFilter.script, /\[p\d+slotstatic\]/u);
  assert.match(visualFilter.script, /\[p\d+stagebattle0\]/u);
  assert.match(visualFilter.script, /\[p\d+stagewin0\]/u);
  assert.match(visualFilter.script, /\[p\d+slotgray0\]/u);
  assert.match(visualFilter.script, /vprogress0/u);
  assert.match(visualFilter.script, /vpokeball0/u);
  assert.match(visualFilter.script, /vmatchplatforml0/u);
  assert.match(visualFilter.script, /vversus0/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='VS'/u);
  assert.match(visualFilter.script, /fade=t=in:st=/u);
  assert.match(visualFilter.script, /drawtext=text='HP/u);
  assert.match(
    visualFilter.script,
    new RegExp(`${firstMatchWinnerCenterX}\\+\\(${firstMatchBracketCenterX}-${firstMatchWinnerCenterX}\\)`, 'u'),
  );
  assert.match(
    visualFilter.script,
    new RegExp(`${finalMatchWinnerCenterX}\\+\\(${finalBracketCenterX}-${finalMatchWinnerCenterX}\\)`, 'u'),
  );
  assert.match(
    visualFilter.script,
    /color=c=black@0:s=1080x1920:r=30:d=[0-9.]+,format=rgba,drawbox=x=40:y='1100\+if\(lt\(\(t\),0\.32\),\(1-\(\(\(t\)-0\)\/0\.32\)\)\*18\*sin\(\(\(t\)-0\)\*20\),0\)':w=220:h=184:color=0xFFFFFF@0\.95:t=3:replace=1,drawbox=x=43:y='\(1100\+if\(lt\(\(t\),0\.32\),\(1-\(\(\(t\)-0\)\/0\.32\)\)\*18\*sin\(\(\(t\)-0\)\*20\),0\)\)\+3':w=214:h=178:color=0x101010@0\.32:t=fill:replace=1,drawbox=x=300:y='1100\+if\(lt\(\(t\),0\.32\),\(1-\(\(\(t\)-0\)\/0\.32\)\)\*18\*sin\(\(\(t\)-0\)\*20\),0\)':w=220:h=184:color=0xFFFFFF@0\.95:t=3:replace=1/u,
  );
  assert.match(
    visualFilter.script,
    /drawbox=x=0:y='[^']+':w=446:h=40:color=0x2A171D@0\.94:t=fill:replace=1/u,
  );
  assert.match(
    visualFilter.script,
    /\[vbracketbase\]\[vcard0src\]overlay=x=0:y=0:enable='gte\(t,0\)'/u,
  );
  assert.match(visualFilter.script, /vmatch0leftstats/u);
  assert.match(visualFilter.script, /fade=t=out:st=/u);
  assert.match(visualFilter.script, /rotate='if\(lt\(t,[0-9.]+\),0,if\(lt\(t,[0-9.]+\),\(1-\(\(t-[0-9.]+\)\/0\.22\)\)\*PI\*2,0\)\)':ow=rotw\(iw\):oh=roth\(ih\):c=none/u);
  assert.ok((visualFilter.script.match(/color=0xFFFFFF@0\.7:t=fill/gu) || []).length >= 12);
  assert.match(visualFilter.script, /enable='\(between\(t,0,/u);
  assert.match(
    visualFilter.script,
    new RegExp(`enable='between\\(t,${renderPlan.matches[0].intro_start_seconds},${renderPlan.matches[0].reveal_start_seconds}\\)'`, 'u'),
  );
  assert.match(
    visualFilter.script,
    new RegExp(`between\\(t,${renderPlan.matches[0].insight_start_seconds},${renderPlan.matches[0].reveal_start_seconds}\\)`, 'u'),
  );
  assert.match(audioFilter, /asplit=4\[osrc0\]\[osrc1\]\[osrc2\]\[osrc3\]/u);
  assert.match(audioFilter, /volume=0\.113\[open0\]/u);
  assert.match(audioFilter, /asplit=3\[wsrc0\]\[wsrc1\]\[wsrc2\]/u);
  assert.match(audioFilter, /asplit=3\[ssrc0\]\[ssrc1\]\[ssrc2\]/u);
  assert.match(audioFilter, /asplit=3\[psrc0\]\[psrc1\]\[psrc2\]/u);
  assert.match(audioFilter, /asplit=3\[dsrc0\]\[dsrc1\]\[dsrc2\]/u);
  assert.match(audioFilter, /volume=0\.113\[progress0\]/u);
  assert.match(audioFilter, /volume=0\.36\[stats0\]/u);
  assert.match(audioFilter, /volume=0\.113\[cry0\]/u);
  assert.match(visualFilter.script, /vbattledisappearleft0/u);
  assert.match(visualFilter.script, /vbattledisappearright0/u);
  assert.match(audioFilter, /amix=inputs=/u);
});

test('tournament render plan expands scene timings to measured narration durations', async () => {
  const plan = await planPokemonTypeChallenge({
    template,
    pokedexRows,
    seed: 'tournament-narration-stretch',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/tournament.mp4',
  });
  const stretchedPlan = applyNarrationDurationsToRenderPlan(renderPlan, [
    2.4,
    1.7,
    1.4,
    1.8,
    1.6,
    1.5,
    1.7,
    1.5,
    1.6,
    1.9,
    1.6,
  ]);

  assert.equal(stretchedPlan.matches[0].intro_start_seconds >= 2.4, true);
  assert.equal(
    (stretchedPlan.matches[0].insight_start_seconds - stretchedPlan.matches[0].intro_start_seconds) >= 1.69,
    true,
  );
  assert.equal(stretchedPlan.matches[0].reveal_start_seconds > renderPlan.matches[0].reveal_start_seconds, true);
  assert.equal(stretchedPlan.matches[1].scene_start_seconds >= stretchedPlan.matches[0].scene_end_seconds, true);
  assert.equal(stretchedPlan.matches.at(-1)?.bracket_progress_end_seconds >= stretchedPlan.matches.at(-1)?.scene_end_seconds, true);
  assert.equal(stretchedPlan.champion_scene.start_seconds >= stretchedPlan.matches.at(-1)?.scene_end_seconds, true);
  assert.equal(stretchedPlan.total_duration_seconds > renderPlan.total_duration_seconds, true);
});
