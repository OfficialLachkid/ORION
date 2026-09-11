import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPokemonBuildYourTeamChallenge } from '../src/domains/pokemon/templates/build-your-team/planner.mjs';
import {
  applyNarrationDurationsToRenderPlan,
  buildAudioFilterScript,
  buildPokeQuizzRenderPlan,
  buildVisualFilterScript,
} from '../src/domains/pokemon/templates/build-your-team/renderer.mjs';
import {
  buildCandidateShinyCues,
  buildStatClashCryCues,
} from '../src/domains/pokemon/templates/stat-clash/render/audio-filter-script.mjs';
import { PRODUCT_VIDEO_TEMPLATE_OPTIONS } from '../../task-router/src/product-video-command-parser.mjs';
import {
  resolvePokeQuizzPlanner,
  resolvePokeQuizzTemplateKey,
} from '../src/poke-quizz-template-registry.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_CONFIG_PATH = resolve(HERE, '..', 'config', 'templates', 'pokemon', 'build-your-team.v1.json');
const fixtureRoot = await mkdtemp(join(tmpdir(), 'build-your-team-template-'));
const mediaPath = (filename) => join(fixtureRoot, filename);

const fixtureAssets = [
  'backgrounds-forest.png',
  'pixel-background.png',
  'music.mp3',
  'countdown.mp3',
  'ding-sound.mp3',
  'pokeball-intro.mp3',
  'pokeball-open-sound.mp3',
  'shiny.mp3',
  'grass-plateau.png',
  'open-close-pokeball.gif',
  'pokeball-sprite-01.png',
  'pokeball-sprite-02.png',
  'pokeball-sprite-03.png',
  'pokeball-sprite-04.png',
  'pokeball-sprite-05.png',
  'shiny-sparkle.gif',
];

const fixturePokemon = [
  ['pichu', 'Pichu', { evolution_stage: 'base' }],
  ['cleffa', 'Cleffa', { evolution_stage: 'base' }],
  ['igglybuff', 'Igglybuff', { evolution_stage: 'base' }],
  ['togepi', 'Togepi', { evolution_stage: 'base' }],
  ['charmander', 'Charmander', { evolution_stage: 'base' }],
  ['squirtle', 'Squirtle', { evolution_stage: 'base' }],
  ['bulbasaur', 'Bulbasaur', { evolution_stage: 'base' }],
  ['cyndaquil', 'Cyndaquil', { evolution_stage: 'base' }],
  ['caterpie', 'Caterpie', { evolution_stage: 'base' }],
  ['weedle', 'Weedle', { evolution_stage: 'base' }],
  ['pidgey', 'Pidgey', { evolution_stage: 'base' }],
  ['ralts', 'Ralts', { evolution_stage: 'base' }],
  ['charmeleon', 'Charmeleon', { evolution_stage: 'middle' }],
  ['wartortle', 'Wartortle', { evolution_stage: 'middle' }],
  ['ivysaur', 'Ivysaur', { evolution_stage: 'middle' }],
  ['bayleef', 'Bayleef', { evolution_stage: 'middle' }],
  ['charizard', 'Charizard', { is_final_evolution: true, evolution_stage: 'final' }],
  ['blastoise', 'Blastoise', { is_final_evolution: true, evolution_stage: 'final' }],
  ['venusaur', 'Venusaur', { is_final_evolution: true, evolution_stage: 'final' }],
  ['meganium', 'Meganium', { is_final_evolution: true, evolution_stage: 'final' }],
  ['charizard-mega-x', 'Mega Charizard X', { is_final_evolution: true, evolution_stage: 'final', pokemon_api: { is_mega: true } }],
  ['mewtwo', 'Mewtwo', { is_legendary: true }],
  ['mew', 'Mew', { is_mythical: true }],
  ['lugia', 'Lugia', { is_legendary: true }],
  ['celebi', 'Celebi', { is_mythical: true }],
  ['venusaur-gmax', 'Venusaur Gigantamax', { pokemon_api: { form_name: 'Gigantamax' } }],
  ['charizard-gmax', 'Charizard Gigantamax', { pokemon_api: { form_name: 'Gigantamax' } }],
  ['pikachu-gmax', 'Pikachu Gigantamax', { pokemon_api: { form_name: 'Gigantamax' } }],
  ['drednaw-gmax', 'Drednaw Gigantamax', { pokemon_api: { form_name: 'Gigantamax' } }],
];

await Promise.all([
  ...fixtureAssets,
  ...fixturePokemon.flatMap(([slug]) => [
    `${slug}.png`,
    `${slug}.gif`,
    `${slug}-shiny.gif`,
    `${slug}.ogg`,
  ]),
].map((filename) => writeFile(mediaPath(filename), 'fixture', 'utf8')));

const template = JSON.parse(await readFile(TEMPLATE_CONFIG_PATH, 'utf8'));

const pokedexRows = fixturePokemon.map(([slug, name, metadata], index) => ({
  id: `fixture-${slug}`,
  national_dex_number: index + 1,
  name,
  slug,
  generation: 1,
  region: 'fixture',
  types: ['normal'],
  sprite_path: mediaPath(`${slug}.png`),
  animated_sprite_path: mediaPath(`${slug}.gif`),
  shiny_animated_sprite_path: mediaPath(`${slug}-shiny.gif`),
  cry_path: mediaPath(`${slug}.ogg`),
  metadata,
}));

const assetInventory = {
  scanned_at: '2026-09-09T00:00:00.000Z',
  directories: {},
  backgrounds: [mediaPath('backgrounds-forest.png')],
  pixel_backgrounds: [mediaPath('pixel-background.png')],
  music: [mediaPath('music.mp3')],
  pokeball_sprites: [
    mediaPath('pokeball-sprite-01.png'),
    mediaPath('pokeball-sprite-02.png'),
    mediaPath('pokeball-sprite-03.png'),
    mediaPath('pokeball-sprite-04.png'),
    mediaPath('pokeball-sprite-05.png'),
  ],
  sound_effects: {
    all: [
      mediaPath('countdown.mp3'),
      mediaPath('ding-sound.mp3'),
      mediaPath('pokeball-intro.mp3'),
      mediaPath('pokeball-open-sound.mp3'),
      mediaPath('shiny.mp3'),
    ],
    countdown_tick: mediaPath('countdown.mp3'),
    timer_end: mediaPath('ding-sound.mp3'),
    pokeball_intro: mediaPath('pokeball-intro.mp3'),
    shiny: mediaPath('shiny.mp3'),
  },
  overlay_presets: {
    grass_plateau: mediaPath('grass-plateau.png'),
    pokeball_primary: mediaPath('open-close-pokeball.gif'),
    shiny_sparkle: mediaPath('shiny-sparkle.gif'),
  },
  overlays: [
    mediaPath('grass-plateau.png'),
    mediaPath('open-close-pokeball.gif'),
    mediaPath('shiny-sparkle.gif'),
  ],
};

test('build-your-team config sanity aligns template identity and pool count', () => {
  assert.equal(template.template_id, 'pokemon.build-your-team.v1');
  assert.equal(template.template_key, 'build-your-team');
  assert.equal(template.selection_rules.round_count, 6);
  assert.equal(template.selection_rules.candidate_count, 4);
  assert.equal(template.selection_rules.max_shiny_per_round, 1);
  assert.equal(template.selection_rules.pool_variants.length, 7);
  assert.equal(template.question_contract.hook_text, 'BUILD YOUR ULTIMATE TEAM!');
  assert.equal(template.question_contract.final_prompt_text, 'Who did you choose?');
  assert.equal(template.layout.background.blur_sigma, 6);
  assert.equal(template.layout.background.motion.enabled, true);
  assert.equal(template.layout.background.motion.subpixel_scale, 2);
  assert.equal(template.reveal.shiny.enabled, true);
  assert.equal(template.layout.timer.countdown_from, 2.5);
  assert.equal(template.layout.timer.show_before_countdown, true);
  assert.ok(template.layout.rounds.hook_hold_seconds >= 2.3);
  assert.equal(template.layout.text.prompt_above_timer, true);
  assert.equal(template.layout.text.prompt_above_timer_gap_px, 28);
  assert.equal(template.layout.text.prompt_font_size, 68);
  assert.equal(template.layout.text.round_headline.enabled, true);
  assert.deepEqual(
    template.layout.text.round_headline.lines.map((line) => [line.text, line.color]),
    [
      ['BUILD YOUR', '0xF4FBFF'],
      ['ULTIMATE TEAM!', '0xFFD60A'],
    ],
  );
  assert.match(template.layout.text.font_candidates[0], /Arial Black\.ttf$/u);
  assert.deepEqual(template.layout.sprite_grid.row_y_offsets_px, [-150, 0]);
  assert.equal(template.layout.text.show_counter, false);
  assert.equal(template.layout.stat_values.enabled, false);
  assert.equal(template.reveal.decoy_grayscale_enabled, false);
  assert.equal(template.renderer.candidate_intro_anchor, 'reveal');
  assert.equal(template.renderer.hold_pokeballs_until_reveal, true);
  assert.equal(template.renderer.held_pokeball_source, 'random_static_sprite');
  assert.equal(template.renderer.reveal_pokeball_overlay_enabled, false);
  assert.equal(template.renderer.hook_pokeballs_enabled, true);
  assert.equal(template.renderer.hook_overlay_first_round, true);
  assert.equal(template.renderer.candidate_intro_stagger_seconds, 0.20);
  assert.equal(template.renderer.pokeball_spawn_sfx_enabled, true);
  assert.equal(template.renderer.held_pokeball_source_start_seconds, 0.7);
  assert.equal(template.renderer.held_pokeball_scale_multiplier, 0.416);
  assert.equal(template.renderer.held_pokeball_intro_duration_seconds, 1.12);
  assert.equal(template.renderer.held_pokeball_wiggle_amplitude_radians, 0.24);
  assert.equal(template.renderer.held_pokeball_wiggle_frequency_hz, 0.675);
  assert.equal(template.renderer.held_pokeball_wiggle_speed_variation_ratio, 0.12);
  assert.equal(template.renderer.held_pokeball_wiggle_momentum_strength, 0.45);
  assert.equal(template.renderer.held_pokeball_wiggle_horizontal_amplitude_px, 24);
  assert.deepEqual(template.renderer.held_pokeball_sprite_weights, {
    default: 1,
    1: 15,
    2: 5,
    3: 4,
    4: 3,
  });
  assert.equal(template.renderer.intro_pokeball_center_y_offset_px, 180);
});

test('build-your-team template is exposed in slash-command template options', () => {
  const entry = PRODUCT_VIDEO_TEMPLATE_OPTIONS.find((option) => option.value === 'build-your-team');

  assert.ok(entry, 'PRODUCT_VIDEO_TEMPLATE_OPTIONS must include build-your-team');
  assert.equal(entry.name, 'Build Your Team');
  assert.equal(entry.templateId, 'pokemon.build-your-team.v1');
});

test('template registry resolves build-your-team planner and render path', () => {
  const key = resolvePokeQuizzTemplateKey(template);
  const planner = resolvePokeQuizzPlanner(template);

  assert.equal(key, 'build-your-team');
  assert.equal(planner, planPokemonBuildYourTeamChallenge);
});

test('build-your-team planner builds six four-option pool rounds', async () => {
  const plan = await planPokemonBuildYourTeamChallenge({
    template,
    pokedexRows,
    seed: 'build-team-plan',
    assetInventory,
  });

  assert.equal(plan.template_id, 'pokemon.build-your-team.v1');
  assert.equal(plan.template_key, 'build-your-team');
  assert.equal(plan.selection.mode, 'team_builder');
  assert.equal(plan.selection.round_count, 6);
  assert.equal(plan.selection.candidate_count, 4);
  assert.equal(plan.selection.display_subject_count, 24);
  assert.equal(plan.selection.pool_fallback_count, 0);
  assert.equal(plan.selection.pool_keys.length, 6);
  assert.equal(plan.assets.background.selected_path, mediaPath('pixel-background.png'));
  assert.equal(plan.assets.background.expected_directory, '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/pixel-backgrounds');
  assert.equal(plan.assets.audio.selected_sound_effects.pokeball_intro, mediaPath('pokeball-intro.mp3'));
  assert.equal(plan.assets.audio.selected_sound_effects.intro_slot_reveal, mediaPath('pokeball-open-sound.mp3'));
  assert.equal(
    plan.assets.overlays.pokeball_sprites_expected_directory,
    '/Volumes/T7/O.R.I.O.N. Video Generation/Pokemon/Poke Quizz/Overlays/Pokeball Sprites',
  );
  assert.ok(plan.assets.overlays.selected_pokeball_sprite_paths.length > 0);
  assert.ok(plan.selection.pool_keys.every((poolKey) => [
    'baby',
    'first_stage',
    'starter',
    'middle_stage',
    'final_stage',
    'legendary_mythical',
    'dynamax',
  ].includes(poolKey)));
  assert.equal(plan.rounds.length, 6);
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    assert.equal(round.candidates.some((candidate) => candidate.is_correct), false);
    assert.match(round.prompt_text, /(Build your team|Pick your|Choose your)/u);
    assert.ok(round.candidates.every((candidate) => candidate.subject.render_sprite_path.endsWith('.gif')));
    assert.ok(round.candidates.every((candidate) => candidate.subject.cry_path.endsWith('.ogg')));
    assert.ok(round.candidates.every((candidate) => candidate.pokeball_sprite_path.endsWith('.png')));
    assert.deepEqual(
      round.candidates
        .map((candidate) => candidate.pokeball_wiggle_speed_multiplier)
        .sort((left, right) => left - right),
      [0.88, 0.96, 1.04, 1.12],
    );
    assert.deepEqual(
      round.candidates
        .map((candidate) => candidate.pokeball_wiggle_direction_multiplier)
        .sort((left, right) => left - right),
      [-1, -1, 1, 1],
    );
  }
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Build Your Team$/u);
});

test('build-your-team weights common Pokeball sprites more heavily', async () => {
  const weightedTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      round_count: 250,
    },
  };
  const plan = await planPokemonBuildYourTeamChallenge({
    template: weightedTemplate,
    pokedexRows,
    seed: 'build-team-weighted-pokeballs',
    assetInventory,
  });
  const counts = Object.fromEntries(
    assetInventory.pokeball_sprites.map((filePath) => [filePath, 0]),
  );
  for (const candidate of plan.rounds.flatMap((round) => round.candidates)) {
    counts[candidate.pokeball_sprite_path] += 1;
  }

  const count = (spriteNumber) => counts[mediaPath(`pokeball-sprite-0${spriteNumber}.png`)];
  assert.ok(count(1) > count(2) * 1.6, JSON.stringify(counts));
  assert.ok(count(2) > count(4) * 1.2, JSON.stringify(counts));
  assert.ok(count(3) > count(4) * 1.2, JSON.stringify(counts));
  assert.ok(count(4) > count(5) * 1.4, JSON.stringify(counts));
});

test('build-your-team shiny selection is deterministic and capped to one per round', async () => {
  const forcedShinyTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      shiny_chance_per_candidate: 1,
      max_shiny_per_round: 1,
    },
  };
  const plan = await planPokemonBuildYourTeamChallenge({
    template: forcedShinyTemplate,
    pokedexRows,
    seed: 'build-team-shiny-cap',
    assetInventory,
  });

  for (const round of plan.rounds) {
    const shinyCandidates = round.candidates.filter((candidate) => candidate.subject.is_shiny_variant);
    assert.equal(shinyCandidates.length, 1);
    assert.match(shinyCandidates[0].subject.render_sprite_path, /-shiny\.gif$/u);
  }
  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(plan.shiny_reveal.shiny_candidate_count, 6);
  assert.equal(plan.assets.overlays.selected_shiny_sparkle_path, mediaPath('shiny-sparkle.gif'));
  assert.equal(plan.assets.audio.selected_sound_effects.shiny, mediaPath('shiny.mp3'));
});

test('build-your-team pool selectors handle babies starters and non-mega final stages', async () => {
  const sevenRoundTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      round_count: 7,
    },
  };
  const plan = await planPokemonBuildYourTeamChallenge({
    template: sevenRoundTemplate,
    pokedexRows,
    seed: 'build-team-seven-pools',
    assetInventory,
  });

  assert.deepEqual(new Set(plan.selection.pool_keys), new Set([
    'baby',
    'first_stage',
    'starter',
    'middle_stage',
    'final_stage',
    'legendary_mythical',
    'dynamax',
  ]));
  const babyRound = plan.rounds.find((round) => round.pool_key === 'baby');
  const starterRound = plan.rounds.find((round) => round.pool_key === 'starter');
  const finalRound = plan.rounds.find((round) => round.pool_key === 'final_stage');
  assert.ok(babyRound.candidates.every((candidate) => (
    ['pichu', 'cleffa', 'igglybuff', 'togepi'].includes(candidate.subject.slug)
  )));
  assert.ok(starterRound.candidates.every((candidate) => (
    ['charmander', 'squirtle', 'bulbasaur', 'cyndaquil'].includes(candidate.subject.slug)
  )));
  assert.ok(
    finalRound.candidates.every((candidate) => (
      !candidate.subject.slug.includes('-mega')
      && !candidate.subject.slug.startsWith('mega-')
      && !candidate.subject.slug.includes('gmax')
    )),
    JSON.stringify(finalRound.candidates.map((candidate) => candidate.subject.slug)),
  );
});

test('build-your-team render plan reuses grid reveal without stat or decoy reveal overlays', async () => {
  const plan = await planPokemonBuildYourTeamChallenge({
    template,
    pokedexRows,
    seed: 'build-team-render',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template,
    outputPath: '/tmp/build-your-team.mp4',
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
        pokeball_hold_sprites: round.candidates.map((_candidate, candidateIndex) => 3 + (roundIndex * 8) + candidateIndex),
        candidates: round.candidates.map((_candidate, candidateIndex) => 7 + (roundIndex * 8) + candidateIndex),
      })),
    },
  );
  const cryCues = buildStatClashCryCues(plan, renderPlan);
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_unused, index) => `/tmp/${index}.wav`),
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/ding-sound.mp3',
    pokeballIntroPath: '/tmp/pokeball-intro.mp3',
    introSlotRevealPath: '/tmp/pokeball-open-sound.mp3',
    cryCues,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });

  assert.equal(renderPlan.rounds.length, 6);
  assert.equal(renderPlan.intro_hook.text, 'BUILD YOUR ULTIMATE TEAM!');
  assert.equal(renderPlan.rounds[0].scene_start_seconds, 0);
  assert.equal(renderPlan.grid_layout.cells[0].center_y, 430);
  assert.equal(renderPlan.grid_layout.cells[1].center_y, 430);
  assert.equal(renderPlan.grid_layout.cells[2].center_y, 1150);
  assert.equal(renderPlan.grid_layout.cells[3].center_y, 1150);
  const narrationAdjustedRenderPlan = applyNarrationDurationsToRenderPlan(
    renderPlan,
    Array.from({ length: plan.narration.lines.length }, () => 1.2),
  );
  assert.equal(narrationAdjustedRenderPlan.rounds[0].scene_start_seconds, 0);
  assert.ok(narrationAdjustedRenderPlan.rounds.every((round) => (
    round.candidates.every((candidate) => (
      candidate.pokeball_hold_start_seconds === round.activation_start_seconds
        && candidate.pokeball_hold_start_seconds < candidate.pokeball_start_seconds
    ))
  )));
  assert.equal(renderPlan.stat_value_layout.enabled, false);
  assert.ok(renderPlan.rounds[0].candidates.every((candidate) => (
    candidate.intro_start_seconds >= renderPlan.rounds[0].reveal_visual_start_seconds
  )));
  assert.ok(renderPlan.rounds[0].candidates.every((candidate) => (
    candidate.pokeball_hold_start_seconds === renderPlan.rounds[0].activation_start_seconds
      && candidate.pokeball_hold_start_seconds < candidate.pokeball_start_seconds
  )));
  assert.match(visualFilter.script, /split=6\[bg0\]\[bg1\]\[bg2\]\[bg3\]\[bg4\]\[bg5\]/u);
  assert.match(visualFilter.script, /crop=w=2160:h=3840:x='\(iw-2160\)\*\(0\.5\+0\.5\*sin\(t\*/u);
  assert.match(visualFilter.script, /scale=1080:1920:flags=lanczos/u);
  for (const [roundIndex, round] of renderPlan.rounds.entries()) {
    const expectedTrim = roundIndex === 0
      ? `[bg${roundIndex}]trim=duration=${round.scene_duration_seconds}`
      : `[bg${roundIndex}]trim=start=${round.scene_start_seconds}:duration=${round.scene_duration_seconds}`;
    assert.ok(visualFilter.script.includes(expectedTrim), expectedTrim);
  }
  assert.doesNotMatch(visualFilter.script, /bghook/u);
  assert.doesNotMatch(visualFilter.script, /introhooktext/u);
  assert.doesNotMatch(visualFilter.script, /scene0hookoverlay/u);
  for (let roundIndex = 0; roundIndex < renderPlan.rounds.length; roundIndex += 1) {
    assert.match(visualFilter.script, new RegExp(`scene${roundIndex}headline0face`, 'u'));
    assert.match(visualFilter.script, new RegExp(`scene${roundIndex}headline1face`, 'u'));
  }
  assert.match(visualFilter.script, /drawtext=text='ULTIMATE TEAM!'.*fontcolor=0xFFD60A.*shadowcolor=black@0\.72/u);
  assert.match(visualFilter.script, /drawtext=text='BUILD YOUR'.*fontcolor=0x2B6DA6/u);
  assert.match(visualFilter.script, /scene0platformv0/u);
  for (let roundIndex = 0; roundIndex < renderPlan.rounds.length; roundIndex += 1) {
    assert.match(visualFilter.script, new RegExp(`scene${roundIndex}pokeballhold0`, 'u'));
  }
  assert.doesNotMatch(visualFilter.script, /scene0pokeball0/u);
  assert.match(visualFilter.script, /\[3:v\]fps=30,trim=duration=.*scale=w='184\.08\*\(if\(lt/u);
  assert.match(visualFilter.script, /pad=258:258:\(ow-iw\)\/2:\(oh-ih\)\/2:color=black@0:eval=frame/u);
  const firstPokeballSpeed = renderPlan.rounds[0].candidates[0].pokeball_wiggle_speed_multiplier;
  const firstPokeballDirection = renderPlan.rounds[0].candidates[0].pokeball_wiggle_direction_multiplier;
  const firstPokeballFrequencyRadians = Number((
    template.renderer.held_pokeball_wiggle_frequency_hz
    * firstPokeballSpeed
    * Math.PI
    * 2
  ).toFixed(3));
  const firstRoundWiggleFrequencies = renderPlan.rounds[0].candidates.map((candidate) => Number((
    template.renderer.held_pokeball_wiggle_frequency_hz
    * candidate.pokeball_wiggle_speed_multiplier
    * Math.PI
    * 2
  ).toFixed(3)));
  assert.equal(new Set(firstRoundWiggleFrequencies).size, 4);
  for (const frequencyRadians of firstRoundWiggleFrequencies) {
    assert.match(visualFilter.script, new RegExp(`\\*${frequencyRadians}\\)`, 'u'));
  }
  assert.match(
    visualFilter.script,
    new RegExp(`rotate='if\\(lt\\(.*1\\.12\\),0,\\(\\(sin\\(.*\\*${firstPokeballFrequencyRadians}\\)\\)\\*\\(1\\+0\\.45\\*\\(1-abs\\(sin\\(.*\\*${firstPokeballFrequencyRadians}\\)\\)\\)\\)\\)\\*${firstPokeballDirection < 0 ? '-0\\.24' : '0\\.24'}\\)'`, 'u'),
  );
  assert.match(
    visualFilter.script,
    new RegExp(`overlay=x='335-w\\/2\\+\\(if\\(lt\\(\\(t\\),1\\.12\\),0,.*${firstPokeballFrequencyRadians}.*0\\.45.*${firstPokeballFrequencyRadians}.*\\*${firstPokeballDirection < 0 ? '-24' : '24'}\\)\\)'`, 'u'),
  );
  const firstPokeballY = Number((renderPlan.grid_layout.cells[0].center_y + 180).toFixed(3));
  assert.match(visualFilter.script, new RegExp(`y='${firstPokeballY}-h\\/2'`, 'u'));
  assert.match(visualFilter.script, /scene0pokeballhold0/u);
  assert.doesNotMatch(visualFilter.script, /trim=start=0\.7:duration=/u);
  assert.match(visualFilter.script, /scene0spriteform0whitesrc/u);
  assert.doesNotMatch(visualFilter.script, /scene1counter/u);
  assert.doesNotMatch(visualFilter.script, /scene0stat/u);
  assert.doesNotMatch(visualFilter.script, /eq=saturation=0:brightness=-0\.42:contrast=1\.22/u);
  const firstRound = renderPlan.rounds[0];
  const timerVisibleWindow = `enable='between(t,${firstRound.local.activation_start_seconds},${firstRound.local.reveal_start_seconds})'[scene0tb0]`;
  assert.ok(visualFilter.script.includes(timerVisibleWindow), timerVisibleWindow);
  const fullTimerScalePrefix = `max(2,if(lt(t,${firstRound.local.countdown_start_seconds}),${Math.round(renderPlan.timer_layout.width)}`;
  assert.ok(visualFilter.script.includes(fullTimerScalePrefix), fullTimerScalePrefix);
  const firstRoundPromptLines = visualFilter.script
    .split(';\n')
    .filter((line) => /\[scene0prompt\d+\]$/u.test(line));
  assert.ok(firstRoundPromptLines.length > 0);
  const lowestPromptEdge = Math.max(...firstRoundPromptLines.map((line) => {
    const y = Number(line.match(/:y='([0-9.]+)\+/u)?.[1]);
    const fontSize = Number(line.match(/:fontsize=([0-9.]+)/u)?.[1]);
    return y + fontSize;
  }));
  assert.ok(
    lowestPromptEdge <= renderPlan.timer_layout.y - template.layout.text.prompt_above_timer_gap_px,
    `${lowestPromptEdge} must stay above timer y=${renderPlan.timer_layout.y}`,
  );
  assert.equal(cryCues.length, 24);
  assert.ok(cryCues.every((cue) => cue.volume > 0));
  assert.match(audioFilter, /pokeballintro0/u);
  assert.match(audioFilter, /asplit=24\[osrc0\]/u);
  assert.match(audioFilter, /cry0/u);
});

test('build-your-team render path overlays shiny sparkle and audio for shiny candidates', async () => {
  const forcedShinyTemplate = {
    ...template,
    selection_rules: {
      ...template.selection_rules,
      shiny_chance_per_candidate: 1,
      max_shiny_per_round: 1,
    },
  };
  const plan = await planPokemonBuildYourTeamChallenge({
    template: forcedShinyTemplate,
    pokedexRows,
    seed: 'build-team-render-shiny',
    assetInventory,
  });
  const renderPlan = buildPokeQuizzRenderPlan({
    plan,
    template: forcedShinyTemplate,
    outputPath: '/tmp/build-your-team-shiny.mp4',
  });
  const visualFilter = buildVisualFilterScript(
    plan,
    forcedShinyTemplate,
    renderPlan,
    {
      background: 0,
      introPokeball: 1,
      grassPlatform: 2,
      shinySparkle: 3,
      rounds: renderPlan.rounds.map((round, roundIndex) => ({
        pokeball_hold_sprites: round.candidates.map((_candidate, candidateIndex) => 4 + (roundIndex * 8) + candidateIndex),
        candidates: round.candidates.map((_candidate, candidateIndex) => 8 + (roundIndex * 8) + candidateIndex),
      })),
    },
  );
  const shinyCues = buildCandidateShinyCues(plan, renderPlan);
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_unused, index) => `/tmp/${index}.wav`),
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/ding-sound.mp3',
    pokeballIntroPath: '/tmp/pokeball-intro.mp3',
    introSlotRevealPath: '/tmp/pokeball-open-sound.mp3',
    shinyPath: '/tmp/shiny.mp3',
    shinyCues,
    cryCues: buildStatClashCryCues(plan, renderPlan),
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });

  assert.equal(plan.shiny_reveal.active, true);
  assert.equal(shinyCues.length, 6);
  assert.match(visualFilter.script, /shiny-sparkle|sparklebase|sparklev/u);
  assert.match(audioFilter, /shiny0/u);
  assert.match(audioFilter, /asplit=6\[shsrc0\]/u);
});
