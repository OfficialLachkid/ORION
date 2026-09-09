import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planPokemonBuildYourTeamChallenge } from '../src/domains/pokemon/templates/build-your-team/planner.mjs';
import {
  buildAudioFilterScript,
  buildPokeQuizzRenderPlan,
  buildVisualFilterScript,
} from '../src/domains/pokemon/templates/build-your-team/renderer.mjs';
import { buildStatClashCryCues } from '../src/domains/pokemon/templates/stat-clash/render/audio-filter-script.mjs';
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
  'music.mp3',
  'countdown.mp3',
  'ding-sound.mp3',
  'pokeball-open-sound.mp3',
  'grass-plateau.png',
  'open-close-pokeball.gif',
];

const fixturePokemon = [
  ['pichu', 'Pichu', { is_baby: true, evolution_stage: 'baby' }],
  ['cleffa', 'Cleffa', { is_baby: true, evolution_stage: 'baby' }],
  ['igglybuff', 'Igglybuff', { is_baby: true, evolution_stage: 'baby' }],
  ['togepi', 'Togepi', { is_baby: true, evolution_stage: 'baby' }],
  ['charmander', 'Charmander', { evolution_stage: 'base' }],
  ['squirtle', 'Squirtle', { evolution_stage: 'base' }],
  ['bulbasaur', 'Bulbasaur', { evolution_stage: 'base' }],
  ['cyndaquil', 'Cyndaquil', { evolution_stage: 'base' }],
  ['charmeleon', 'Charmeleon', { evolution_stage: 'middle' }],
  ['wartortle', 'Wartortle', { evolution_stage: 'middle' }],
  ['ivysaur', 'Ivysaur', { evolution_stage: 'middle' }],
  ['bayleef', 'Bayleef', { evolution_stage: 'middle' }],
  ['charizard', 'Charizard', { is_final_evolution: true, evolution_stage: 'final' }],
  ['blastoise', 'Blastoise', { is_final_evolution: true, evolution_stage: 'final' }],
  ['venusaur', 'Venusaur', { is_final_evolution: true, evolution_stage: 'final' }],
  ['meganium', 'Meganium', { is_final_evolution: true, evolution_stage: 'final' }],
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
  cry_path: mediaPath(`${slug}.ogg`),
  metadata,
}));

const assetInventory = {
  scanned_at: '2026-09-09T00:00:00.000Z',
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

test('build-your-team config sanity aligns template identity and pool count', () => {
  assert.equal(template.template_id, 'pokemon.build-your-team.v1');
  assert.equal(template.template_key, 'build-your-team');
  assert.equal(template.selection_rules.round_count, 6);
  assert.equal(template.selection_rules.candidate_count, 4);
  assert.equal(template.selection_rules.pool_variants.length, 6);
  assert.equal(template.layout.stat_values.enabled, false);
  assert.equal(template.reveal.decoy_grayscale_enabled, false);
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
  assert.deepEqual(new Set(plan.selection.pool_keys), new Set([
    'baby',
    'first_stage',
    'middle_stage',
    'final_stage',
    'legendary_mythical',
    'dynamax',
  ]));
  assert.equal(plan.rounds.length, 6);
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    assert.equal(round.candidates.some((candidate) => candidate.is_correct), false);
    assert.match(round.prompt_text, /(Build your team|Pick your|Choose your)/u);
    assert.ok(round.candidates.every((candidate) => candidate.subject.render_sprite_path.endsWith('.gif')));
    assert.ok(round.candidates.every((candidate) => candidate.subject.cry_path.endsWith('.ogg')));
  }
  assert.match(plan.assets.outputs.previews_directory, /\/Previews\/Build Your Team$/u);
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
        candidates: round.candidates.map((_candidate, candidateIndex) => 3 + (roundIndex * 4) + candidateIndex),
      })),
    },
  );
  const cryCues = buildStatClashCryCues(plan, renderPlan);
  const audioFilter = buildAudioFilterScript({
    narrationPaths: Array.from({ length: plan.narration.lines.length }, (_unused, index) => `/tmp/${index}.wav`),
    musicPath: '/tmp/music.mp3',
    countdownPath: '/tmp/countdown.mp3',
    timerEndPath: '/tmp/ding-sound.mp3',
    introSlotRevealPath: '/tmp/pokeball-open-sound.mp3',
    cryCues,
    renderPlan,
    mediaDurations: {
      countdown_audio_duration_seconds: 0.7,
    },
  });

  assert.equal(renderPlan.rounds.length, 6);
  assert.equal(renderPlan.stat_value_layout.enabled, false);
  assert.match(visualFilter.script, /split=6\[bg0\]\[bg1\]\[bg2\]\[bg3\]\[bg4\]\[bg5\]/u);
  assert.match(visualFilter.script, /scene0platformv0/u);
  assert.match(visualFilter.script, /scene0pokeball0/u);
  assert.match(visualFilter.script, /scene0spriteform0whitesrc/u);
  assert.match(visualFilter.script, /scene1counter/u);
  assert.doesNotMatch(visualFilter.script, /scene0stat/u);
  assert.doesNotMatch(visualFilter.script, /eq=saturation=0:brightness=-0\.42:contrast=1\.22/u);
  assert.equal(cryCues.length, 24);
  assert.ok(cryCues.every((cue) => cue.volume > 0));
  assert.match(audioFilter, /asplit=24\[osrc0\]/u);
  assert.match(audioFilter, /cry0/u);
});
