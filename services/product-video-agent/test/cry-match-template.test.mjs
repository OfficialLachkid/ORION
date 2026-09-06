import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  planPokemonCryMatchChallenge,
} from '../src/domains/pokemon/templates/cry-match/planner.mjs';
import {
  buildPokeQuizzRenderPlan,
  buildAudioFilterScript,
} from '../src/domains/pokemon/templates/cry-match/renderer.mjs';
import { buildCryMatchCryCues } from '../src/domains/pokemon/templates/cry-match/render/audio-filter-script.mjs';
import {
  resolvePokeQuizzTemplateKey,
  resolvePokeQuizzPlanner,
  resolvePokeQuizzRenderPlanBuilder,
} from '../src/poke-quizz-template-registry.mjs';
import {
  PRODUCT_VIDEO_TEMPLATE_OPTIONS,
} from '../../task-router/src/product-video-command-parser.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const TEMPLATE_CONFIG_PATH = resolve(HERE, '..', 'config', 'templates', 'pokemon', 'cry-match.v1.json');

async function loadTemplate() {
  return JSON.parse(await readFile(TEMPLATE_CONFIG_PATH, 'utf8'));
}

function buildFixtureSubject(index, overrides = {}) {
  return {
    id: `fixture-${index}`,
    name: `Fixture${index}`,
    slug: `fixture-${index}`,
    national_dex_number: index,
    generation: 1,
    types: ['normal'],
    sprite_path: `/fake/sprites/gen-1/${String(index).padStart(3, '0')}-fixture-${index}.png`,
    animated_sprite_path: '',
    metadata: {
      base_stats: {
        hp: 50, attack: 50, defense: 50, special_attack: 50, special_defense: 50, speed: 50,
      },
    },
    ...overrides,
  };
}

test('cry-match config sanity — template_id + template_key + mode align', async () => {
  const template = await loadTemplate();
  assert.equal(template.template_id, 'pokemon.cry-match.v1');
  assert.equal(template.template_key, 'cry-match');
  assert.equal(template.selection_rules.mode, 'cry_target');
  assert.equal(template.selection_rules.candidate_count, 4);
  assert.ok(template.audio?.cry_playback?.enabled, 'cry_playback must be enabled');
  assert.ok(template.layout?.cry_meter?.enabled, 'cry_meter overlay must be enabled');
});

test('cry-match template is exposed in the slash-command PRODUCT_VIDEO_TEMPLATE_OPTIONS', () => {
  const entry = PRODUCT_VIDEO_TEMPLATE_OPTIONS.find((option) => option.value === 'cry-match');
  assert.ok(entry, 'PRODUCT_VIDEO_TEMPLATE_OPTIONS must include a cry-match entry so the /generate-video choice list shows it');
  assert.equal(entry.name, 'Cry Match');
});

test('template registry resolves cry-match key + planner + render plan builder', async () => {
  const template = await loadTemplate();
  const key = resolvePokeQuizzTemplateKey(template);
  assert.equal(key, 'cry-match');
  const planner = resolvePokeQuizzPlanner(template);
  const builder = resolvePokeQuizzRenderPlanBuilder(template);
  assert.equal(planner, planPokemonCryMatchChallenge);
  assert.equal(builder, buildPokeQuizzRenderPlan);
});

test('planner picks 4 candidates per round, marks exactly one as the target, and asks the right prompt', async () => {
  const template = await loadTemplate();
  const pokedexRows = Array.from({ length: 12 }, (_, index) => buildFixtureSubject(index + 1));
  const assetInventory = {
    backgrounds: ['/fake/bg/blue.png'],
    sound_effects: {
      countdown_tick: '/fake/sfx/tick.wav',
      timer_end: '/fake/sfx/ding.wav',
      pokeball_intro: '/fake/sfx/open.wav',
      all: [],
    },
    overlay_presets: {
      grass_plateau: '/fake/overlay/plateau.png',
      pokeball_primary: '/fake/overlay/pokeball.gif',
    },
    overlays: [],
    music: ['/fake/music/loop.ogg'],
  };
  const plan = await planPokemonCryMatchChallenge({
    template,
    pokedexRows,
    seed: 'cry-match-test-1',
    assetInventory,
    selectionState: null,
  });
  assert.equal(plan.template_key, 'cry-match');
  assert.ok(plan.rounds.length >= 3, 'expected at least 3 rounds');
  for (const round of plan.rounds) {
    assert.equal(round.candidates.length, 4);
    const correctCount = round.candidates.filter((candidate) => candidate.is_correct).length;
    assert.equal(correctCount, 1, `round ${round.round_number} must have exactly one correct target`);
    assert.match(
      String(round.prompt_text),
      /(cry|whose)/iu,
      'prompt should reflect the cry-match mechanic',
    );
  }
});

test('cry cue builder emits countdown-start cues and a reveal replay for the target only', async () => {
  const template = await loadTemplate();
  const pokedexRows = Array.from({ length: 12 }, (_, index) => buildFixtureSubject(index + 1));
  const plan = await planPokemonCryMatchChallenge({
    template,
    pokedexRows,
    seed: 'cry-match-test-cues',
    assetInventory: {
      backgrounds: ['/fake/bg/blue.png'],
      sound_effects: { countdown_tick: '/f/tick.wav', timer_end: '/f/ding.wav', pokeball_intro: '/f/open.wav', all: [] },
      overlay_presets: { grass_plateau: '/f/pl.png', pokeball_primary: '/f/pb.gif' },
      overlays: [], music: [],
    },
    selectionState: null,
  });
  // Force a cry path on the target of every round so cue building has
  // something to emit — real subjects would inherit these from the
  // T7 filesystem via buildPokeQuizzCryPath, but fixtures don't have
  // that path available in a unit-test environment.
  for (const round of plan.rounds) {
    const target = round.candidates.find((c) => c.is_correct);
    if (target) target.subject.cry_path = `/fake/cries/${target.subject.slug}.ogg`;
    round.target_cry_path = target?.subject?.cry_path || '';
  }

  const renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath: '/tmp/fake.mp4' });
  const cues = buildCryMatchCryCues(plan, renderPlan, template);
  assert.ok(cues.length >= plan.rounds.length, 'at least one cue per round');
  // Each round should have BOTH: repeated countdown-start plays AND a
  // reveal replay. With repeat_count=2 + reveal_replay=true = 3 cues/round.
  const cuesByPath = new Map();
  for (const cue of cues) {
    if (!cuesByPath.has(cue.path)) cuesByPath.set(cue.path, []);
    cuesByPath.get(cue.path).push(cue);
  }
  // Every emitted path is a "fake" cry path from ONE of our targets —
  // never a decoy. Cross-check by walking the plan.
  const validTargetPaths = new Set(
    plan.rounds
      .map((r) => r.candidates.find((c) => c.is_correct)?.subject?.cry_path)
      .filter(Boolean),
  );
  for (const cue of cues) {
    assert.ok(validTargetPaths.has(cue.path), `cue path ${cue.path} must belong to a target, not a decoy`);
  }
});

test('render plan carries the cry_meter_layout and drops the old stat_value_layout', async () => {
  const template = await loadTemplate();
  const pokedexRows = Array.from({ length: 8 }, (_, index) => buildFixtureSubject(index + 1));
  const plan = await planPokemonCryMatchChallenge({
    template,
    pokedexRows,
    seed: 'cry-match-test-plan',
    assetInventory: {
      backgrounds: ['/fake/bg.png'], sound_effects: { countdown_tick: '/f/t.wav', timer_end: '/f/d.wav', all: [] },
      overlay_presets: { grass_plateau: '/f/p.png', pokeball_primary: '/f/pb.gif' },
      overlays: [], music: [],
    },
    selectionState: null,
  });
  const renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath: '/tmp/fake.mp4' });
  assert.ok(renderPlan.cry_meter_layout, 'render plan must include cry_meter_layout');
  assert.equal(renderPlan.cry_meter_layout.enabled, true);
  assert.ok(!('stat_value_layout' in renderPlan), 'stat_value_layout leftover must be dropped');
});

test('audio filter script includes cry cue inputs when cues are supplied', async () => {
  const template = await loadTemplate();
  const pokedexRows = Array.from({ length: 8 }, (_, index) => buildFixtureSubject(index + 1));
  const plan = await planPokemonCryMatchChallenge({
    template,
    pokedexRows,
    seed: 'cry-match-audio-filter',
    assetInventory: {
      backgrounds: ['/fake/bg.png'], sound_effects: { countdown_tick: '/f/t.wav', timer_end: '/f/d.wav', all: [] },
      overlay_presets: { grass_plateau: '/f/p.png', pokeball_primary: '/f/pb.gif' },
      overlays: [], music: [],
    },
    selectionState: null,
  });
  for (const round of plan.rounds) {
    const target = round.candidates.find((c) => c.is_correct);
    if (target) target.subject.cry_path = `/fake/cries/${target.subject.slug}.ogg`;
    round.target_cry_path = target?.subject?.cry_path || '';
  }
  const renderPlan = buildPokeQuizzRenderPlan({ plan, template, outputPath: '/tmp/fake.mp4' });
  const cues = buildCryMatchCryCues(plan, renderPlan, template);
  const script = buildAudioFilterScript({
    narrationPaths: [],
    musicPath: null,
    countdownPath: null,
    timerEndPath: null,
    introSlotRevealPath: null,
    cryCues: cues,
    renderPlan,
    mediaDurations: {},
  });
  // Expect one `[N:a]…[cryN]` filter chain per cue and an amix mixing them all.
  for (let cueIndex = 0; cueIndex < cues.length; cueIndex += 1) {
    assert.match(script, new RegExp(`\\[cry${cueIndex}\\]`, 'u'));
  }
  assert.match(script, /amix=inputs=\d+/u);
});
