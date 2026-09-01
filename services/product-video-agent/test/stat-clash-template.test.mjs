import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPokeQuizzRenderPlan } from '../src/poke-quizz-renderer.mjs';
import { planPokemonStatClashChallenge } from '../src/domains/pokemon/templates/stat-clash/planner.mjs';
import {
  buildAudioFilterScript,
  buildStatClashCryCues,
} from '../src/domains/pokemon/templates/stat-clash/render/audio-filter-script.mjs';
import { buildVisualFilterScript } from '../src/domains/pokemon/templates/stat-clash/render/visual-filter-script.mjs';
import { buildVisualInputs } from '../src/domains/pokemon/templates/stat-clash/render/visual-inputs.mjs';

const fixtureRoot = await mkdtemp(join(tmpdir(), 'stat-clash-template-'));
const mediaPath = (filename) => join(fixtureRoot, filename);

await Promise.all([
  'backgrounds-forest.png',
  'music.mp3',
  'countdown.mp3',
  'ding-sound.mp3',
  'pokeball-open-sound.mp3',
  'grass-plateau.png',
  'open-close-pokeball.gif',
  'onix.png',
  'onix.gif',
  'onix.ogg',
  'scyther.png',
  'scyther.gif',
  'scyther.ogg',
  'slowbro.png',
  'slowbro.gif',
  'slowbro.ogg',
  'snorlax.png',
  'snorlax.gif',
  'snorlax.ogg',
  'alakazam.png',
  'alakazam.gif',
  'alakazam.ogg',
  'lapras.png',
  'lapras.gif',
  'lapras.ogg',
  'dragonite.png',
  'dragonite.gif',
  'dragonite.ogg',
  'victreebel.png',
  'victreebel.gif',
  'victreebel.ogg',
].map((filename) => writeFile(mediaPath(filename), 'fixture', 'utf8')));

const template = {
  template_id: 'pokemon.stat-clash.v1',
  template_key: 'stat-clash',
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
    round_count: 3,
    round_count_weights: {
      medium: 1,
    },
    round_count_levels: {
      medium: { round_count: 3 },
    },
    candidate_count: 4,
    mode: 'highest_stat',
    stat_pool: ['defense', 'speed', 'special_attack'],
    sampling_attempts_per_round: 50,
    min_stat_value: 35,
    min_winner_margin: 4,
    max_winner_margin: 30,
    max_stat_spread: 45,
  },
  question_contract: {
    prompt_text: 'Who has the highest {stat}?',
    prompt_text_variants: ['Who has the highest {stat}?'],
    reveal_text: '{winner_name} has the highest {stat}!',
    reveal_text_variants: ['{winner_name} has the highest {stat}!'],
  },
  layout: {
    background: {
      blur_sigma: 3,
    },
    text: {
      prompt_y: 170,
      prompt_font_size: 102,
      reveal_y: 285,
      reveal_font_size: 92,
      counter_x: 72,
      counter_y: 144,
      counter_font_size: 96,
    },
    sprite_grid: {
      rows: 2,
      columns: 2,
      item_size_px: 252,
      min_item_size_px: 214,
      column_gap_px: 160,
      row_gap_px: 320,
      sprite_scale_multiplier: 1.18,
      sprite_center_y_offset_px: -10,
      stage_bounds_px: {
        left: 120,
        top: 455,
        width: 840,
        height: 820,
      },
    },
    sprite_platform: {
      option_enabled: true,
      option_width_multiplier: 0.92,
      center_y_offset_multiplier: 0.34,
      option_center_y_offset_px: 82,
    },
    timer: {
      countdown_from: 4,
      countdown_to: 0,
      bar_height_px: 38,
      bar_horizontal_inset_px: 20,
      center_y: 1010,
      bar_y_offset_px: 0,
    },
    stat_values: {
      font_size: 84,
      top_row_y_offset_px: -94,
      bottom_row_y_offset_px: 130,
      default_color: 'white',
      winner_color: '0x32D74B',
    },
    rounds: {
      pre_countdown_hold_seconds: 0.18,
      reveal_hold_seconds: 1.2,
      transition_duration_seconds: 0.42,
      final_hold_seconds: 1,
    },
  },
  reveal: {
    visual_delay_seconds: 0,
  },
  audio: {
    battle_intro_music: {
      start_seconds: 0,
    },
    sound_effects: {
      timer_end: {
        enabled: true,
        preferred_keywords: ['ding-sound'],
      },
      intro_slot_reveal: {
        enabled: true,
        preferred_keywords: ['pokeball-open-sound'],
      },
    },
  },
  renderer: {
    candidate_intro_initial_delay_seconds: 0.1,
    candidate_intro_stagger_seconds: 0.16,
    candidate_intro_duration_seconds: 0.22,
    candidate_intro_y_offset_px: 42,
    candidate_intro_scale_initial: 0.68,
    candidate_intro_scale_peak: 1.08,
    candidate_intro_scale_settle: 1,
    intro_pokeball_hold_seconds: 0.16,
    intro_pokeball_lead_seconds: 0.18,
    intro_pokeball_scale_multiplier: 1.04,
    stat_reveal_fade_duration_seconds: 0.22,
  },
};

const pokedexRows = [
  { id: 'mon-1', national_dex_number: 95, name: 'Onix', slug: 'onix', generation: 1, types: ['rock', 'ground'], sprite_path: mediaPath('onix.png'), animated_sprite_path: mediaPath('onix.gif'), cry_path: mediaPath('onix.ogg'), metadata: { base_stats: { hp: 35, attack: 45, defense: 160, special_attack: 30, special_defense: 45, speed: 70 } } },
  { id: 'mon-2', national_dex_number: 123, name: 'Scyther', slug: 'scyther', generation: 1, types: ['bug', 'flying'], sprite_path: mediaPath('scyther.png'), animated_sprite_path: mediaPath('scyther.gif'), cry_path: mediaPath('scyther.ogg'), metadata: { base_stats: { hp: 70, attack: 110, defense: 80, special_attack: 55, special_defense: 80, speed: 105 } } },
  { id: 'mon-3', national_dex_number: 80, name: 'Slowbro', slug: 'slowbro', generation: 1, types: ['water', 'psychic'], sprite_path: mediaPath('slowbro.png'), animated_sprite_path: mediaPath('slowbro.gif'), cry_path: mediaPath('slowbro.ogg'), metadata: { base_stats: { hp: 95, attack: 75, defense: 110, special_attack: 100, special_defense: 80, speed: 30 } } },
  { id: 'mon-4', national_dex_number: 143, name: 'Snorlax', slug: 'snorlax', generation: 1, types: ['normal'], sprite_path: mediaPath('snorlax.png'), animated_sprite_path: mediaPath('snorlax.gif'), cry_path: mediaPath('snorlax.ogg'), metadata: { base_stats: { hp: 160, attack: 110, defense: 65, special_attack: 65, special_defense: 110, speed: 30 } } },
  { id: 'mon-5', national_dex_number: 65, name: 'Alakazam', slug: 'alakazam', generation: 1, types: ['psychic'], sprite_path: mediaPath('alakazam.png'), animated_sprite_path: mediaPath('alakazam.gif'), cry_path: mediaPath('alakazam.ogg'), metadata: { base_stats: { hp: 55, attack: 50, defense: 45, special_attack: 135, special_defense: 95, speed: 120 } } },
  { id: 'mon-6', national_dex_number: 131, name: 'Lapras', slug: 'lapras', generation: 1, types: ['water', 'ice'], sprite_path: mediaPath('lapras.png'), animated_sprite_path: mediaPath('lapras.gif'), cry_path: mediaPath('lapras.ogg'), metadata: { base_stats: { hp: 130, attack: 85, defense: 80, special_attack: 85, special_defense: 95, speed: 60 } } },
  { id: 'mon-7', national_dex_number: 149, name: 'Dragonite', slug: 'dragonite', generation: 1, types: ['dragon', 'flying'], sprite_path: mediaPath('dragonite.png'), animated_sprite_path: mediaPath('dragonite.gif'), cry_path: mediaPath('dragonite.ogg'), metadata: { base_stats: { hp: 91, attack: 134, defense: 95, special_attack: 100, special_defense: 100, speed: 80 } } },
  { id: 'mon-8', national_dex_number: 71, name: 'Victreebel', slug: 'victreebel', generation: 1, types: ['grass', 'poison'], sprite_path: mediaPath('victreebel.png'), animated_sprite_path: mediaPath('victreebel.gif'), cry_path: mediaPath('victreebel.ogg'), metadata: { base_stats: { hp: 80, attack: 105, defense: 65, special_attack: 100, special_defense: 70, speed: 70 } } },
];

const assetInventory = {
  scanned_at: '2026-08-31T00:00:00.000Z',
  directories: {},
  backgrounds: [mediaPath('backgrounds-forest.png')],
  music: [mediaPath('music.mp3')],
  sound_effects: {
    all: [mediaPath('countdown.mp3'), mediaPath('ding-sound.mp3'), mediaPath('pokeball-open-sound.mp3')],
    countdown_tick: mediaPath('countdown.mp3'),
    timer_end: mediaPath('ding-sound.mp3'),
    pokeball_intro: mediaPath('pokeball-open-sound.mp3'),
  },
  overlay_presets: {
    grass_plateau: mediaPath('grass-plateau.png'),
    pokeball_primary: mediaPath('open-close-pokeball.gif'),
  },
  overlays: [mediaPath('grass-plateau.png'), mediaPath('open-close-pokeball.gif')],
};

test('stat-clash planner builds a four-candidate highest-stat round set', async () => {
  const plan = await planPokemonStatClashChallenge({
    template,
    pokedexRows,
    seed: 'stat-clash-plan',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.stat-clash.v1');
  assert.equal(plan.template_key, 'stat-clash');
  assert.equal(plan.rounds.length, 3);
  assert.equal(plan.selection.round_count, 3);
  assert.equal(plan.assets.audio.selected_sound_effects.timer_end, mediaPath('ding-sound.mp3'));
  assert.equal(plan.assets.audio.selected_sound_effects.intro_slot_reveal, mediaPath('pokeball-open-sound.mp3'));
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Stat Clash$/u);
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    assert.equal(round.candidates.filter((candidate) => candidate.is_correct).length, 1);
    assert.match(round.prompt_text, /highest/u);
    assert.ok(round.highest_stat_value >= 35);
    assert.ok(round.selection_score.winner_margin > 0);
    assert.ok(Number.isFinite(round.selection_score.penalty));
    assert.ok(round.candidates.every((candidate) => candidate.subject.render_sprite_path.endsWith('.gif')));
  }
});

test('stat-clash narration expands abbreviated stat labels for speech', async () => {
  const specialTemplate = JSON.parse(JSON.stringify(template));
  specialTemplate.selection_rules.round_count = 1;
  specialTemplate.selection_rules.round_count_weights = { medium: 1 };
  specialTemplate.selection_rules.round_count_levels = { medium: { round_count: 1 } };
  specialTemplate.selection_rules.stat_pool = ['special_defense'];

  const plan = await planPokemonStatClashChallenge({
    template: specialTemplate,
    pokedexRows,
    seed: 'stat-clash-special-speech',
    assetInventory,
  });

  assert.match(plan.rounds[0].prompt_text, /Sp\. Def/u);
  assert.equal(plan.rounds[0].spoken_prompt_text, 'Who has the highest Special Defense?');
  assert.equal(plan.narration.lines[0].text, 'Who has the highest Special Defense?');
  assert.equal(plan.timeline[0].spoken_text, 'Who has the highest Special Defense?');
});

test('stat-clash planner can build a five-round hard variant', async () => {
  const hardTemplate = JSON.parse(JSON.stringify(template));
  hardTemplate.selection_rules.generation_scope = [];
  hardTemplate.selection_rules.round_count_weights = { hard: 1 };
  hardTemplate.selection_rules.round_count_levels = { hard: { round_count: 5 } };
  hardTemplate.selection_rules.stat_pool = ['hp', 'attack', 'defense', 'special_attack', 'special_defense'];

  const plan = await planPokemonStatClashChallenge({
    template: hardTemplate,
    pokedexRows,
    seed: 'stat-clash-hard',
    assetInventory,
  });

  assert.equal(plan.selection.difficulty_id, 'hard');
  assert.equal(plan.selection.round_count, 5);
  assert.equal(plan.rounds.length, 5);
  assert.equal(plan.rounds[0].round_label, '1/5');
  assert.equal(plan.rounds.at(-1)?.round_label, '5/5');
});

test('stat-clash render plan and inputs stay deterministic', async () => {
  const plan = await planPokemonStatClashChallenge({
    template,
    pokedexRows,
    seed: 'stat-clash-render',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/stat-clash.mp4',
  });
  const visualInputs = buildVisualInputs(plan, renderPlan);

  assert.equal(renderPlan.rounds.length, 3);
  assert.equal(renderPlan.output_path, '/tmp/stat-clash.mp4');
  assert.equal(renderPlan.timer_layout.center_y, 1010);
  assert.equal(renderPlan.timer_layout.height, 38);
  assert.equal(renderPlan.grid_layout.cells.length, 4);
  assert.equal(renderPlan.stat_value_layout.font_size, 84);
  assert.ok(renderPlan.rounds[0].candidates[0].intro_end_seconds > renderPlan.rounds[0].candidates[0].intro_start_seconds);
  assert.equal(renderPlan.rounds[0].local.activation_start_seconds, 0);
  assert.equal(
    renderPlan.rounds[1].local.activation_start_seconds,
    renderPlan.rounds[0].transition_duration_seconds,
  );
  assert.ok(
    renderPlan.rounds[1].candidates[0].pokeball_start_seconds
      >= renderPlan.rounds[1].activation_start_seconds,
  );
  assert.equal(
    renderPlan.narration_cues[1].start_seconds,
    renderPlan.rounds[1].prompt_start_seconds,
  );
  assert.equal(visualInputs[0].role, 'background');
  assert.equal(visualInputs[1].role, 'intro-pokeball');
  assert.equal(visualInputs[2].role, 'grass-platform');
  assert.ok(visualInputs[3].path.endsWith('.gif'));
  assert.equal(visualInputs.length, 15);
});

test('stat-clash audio and visual filters include pokeball reveals, timer bar, and stat values', async () => {
  const plan = await planPokemonStatClashChallenge({
    template,
    pokedexRows,
    seed: 'stat-clash-filters',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/stat-clash.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    plan,
    template,
    renderPlan,
    {
      background: 0,
      introPokeball: 1,
      grassPlatform: 2,
      rounds: renderPlan.rounds.map((round, roundIndex) => ({
        candidates: round.candidates.map((_candidate, candidateIndex) => 3 + (roundIndex * 4) + candidateIndex),
      })),
    },
  );
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_, index) => `/tmp/${index}.wav`),
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/ding-sound.mp3',
    introSlotRevealPath: '/tmp/pokeball-open-sound.mp3',
    cryCues: buildStatClashCryCues(plan, renderPlan),
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });
  const cryCues = buildStatClashCryCues(plan, renderPlan);

  assert.match(visualFilter.script, /\[0:v\]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=3,fps=30,setsar=1,trim=duration=[0-9.]+,setpts=PTS-STARTPTS\[v0\]/u);
  assert.match(visualFilter.script, /setpts=PTS-STARTPTS\+[0-9.]+\/TB,scale=306\.8:306\.8/u);
  assert.match(visualFilter.script, /split=2\[scene0spriteintro[0-3]\]\[scene0spritesettledsrc[0-3]\]/u);
  assert.match(visualFilter.script, /split=3\[scene0spriteintro[0-3]\]\[scene0spritesettledsrc[0-3]\]\[scene0spritegraysrc[0-3]\]/u);
  assert.doesNotMatch(visualFilter.script, /scenecomposite0/u);
  assert.doesNotMatch(visualFilter.script, /overlay=x='if\(lt\(t,[0-9.]+\),w/u);
  assert.match(visualFilter.script, /scene0pokeball0/u);
  assert.match(visualFilter.script, /scene0platform0/u);
  assert.doesNotMatch(visualFilter.script, /drawtext=text='Who':/u);
  assert.match(visualFilter.script, /scene1counter[\s\S]*x='[^']*if\(/u);
  assert.match(visualFilter.script, /color=c=0x32D74B@0\.98/u);
  assert.match(visualFilter.script, /color=c=0xFFD60A@0\.98/u);
  assert.match(visualFilter.script, /color=c=0xFF453A@0\.98/u);
  assert.match(visualFilter.script, /eq=saturation=0:brightness=-0\.42:contrast=1\.22/u);
  assert.match(visualFilter.script, /drawtext=text='[0-9]+'/u);
  assert.match(visualFilter.script, /fontcolor=0x32D74B/u);
  assert.equal(cryCues.length, (renderPlan.rounds.length * 5));
  assert.match(audioFilter, /asplit=12\[osrc0\]|asplit=20\[osrc0\]/u);
  assert.match(audioFilter, /timerend0/u);
  assert.match(audioFilter, /cry0/u);
  assert.match(audioFilter, /amix=inputs=/u);
});
