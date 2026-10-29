import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BUBBLE_SURVIVAL_CATEGORIES,
  isEligibleForBubbleSurvivalCategory,
  resolveBubbleSurvivalCategoryPool,
} from '../src/domains/pokemon/templates/bubble-survival/category-resolver.mjs';
import {
  movingCircleIntersectsSegment,
  simulateBubbleSurvival,
} from '../src/domains/pokemon/templates/bubble-survival/simulation.mjs';
import { planPokemonBubbleSurvival } from '../src/domains/pokemon/templates/bubble-survival/planner.mjs';
import {
  resolvePokeQuizzPlanner,
  resolvePokeQuizzRenderer,
  resolvePokeQuizzTemplateKey,
} from '../src/poke-quizz-template-registry.mjs';
import {
  PRODUCT_VIDEO_TEMPLATE_DEFINITIONS,
  resolveProductVideoTemplateId,
} from '../src/product-video-template-routing.mjs';
import { buildPokeQuizzPreviewDirectory } from '../src/poke-quizz-asset-layout.mjs';

function row(overrides = {}) {
  const { metadata: metadataOverrides = {}, ...directOverrides } = overrides;
  const pokemonApiOverrides = metadataOverrides.pokemon_api || {};
  return {
    id: overrides.id || overrides.slug || 'pokemon',
    national_dex_number: overrides.national_dex_number || 1,
    is_default_form: overrides.is_default_form ?? true,
    slug: overrides.slug || 'pokemon',
    name: overrides.name || overrides.slug || 'Pokemon',
    sprite_path: overrides.sprite_path || '/tmp/pokemon.png',
    metadata: {
      is_legendary: false,
      is_mythical: false,
      evolution_depth: 0,
      is_final_evolution: false,
      evolves_from_species_id: null,
      ...metadataOverrides,
      pokemon_api: {
        species_name: overrides.species_name || overrides.slug || 'pokemon',
        pokemon_name: overrides.slug || 'pokemon',
        pokemon_id: overrides.pokemon_id || overrides.national_dex_number || 1,
        is_default_form: overrides.is_default_form ?? true,
        is_mega: false,
        ...pokemonApiOverrides,
      },
    },
    ...directOverrides,
  };
}

test('category resolver implements the seven explicit Pokemon pools', () => {
  const examples = {
    legendary: row({ slug: 'mewtwo', metadata: { is_legendary: true, is_mythical: false } }),
    mythical: row({ slug: 'mew', metadata: { is_mythical: true } }),
    starters: row({ slug: 'bulbasaur' }),
    'first-evolutions': row({
      slug: 'ivysaur',
      metadata: { evolution_depth: 1, is_final_evolution: false },
    }),
    baby: row({ slug: 'pichu' }),
    'final-evolutions': row({
      slug: 'venusaur',
      metadata: { evolution_depth: 2, is_final_evolution: true, evolves_from_species_id: 2 },
    }),
    'mega-evolutions': row({
      slug: 'charizard-mega-x',
      is_default_form: false,
      metadata: { pokemon_api: { species_name: 'charizard', pokemon_name: 'charizard-mega-x', pokemon_id: 10034, is_default_form: false, is_mega: true } },
    }),
  };

  assert.deepEqual(Object.keys(examples), [...BUBBLE_SURVIVAL_CATEGORIES]);
  for (const [category, candidate] of Object.entries(examples)) {
    assert.equal(isEligibleForBubbleSurvivalCategory(candidate, category), true, category);
  }
  assert.equal(isEligibleForBubbleSurvivalCategory(examples.mythical, 'legendary'), false);
});

test('category pool removes duplicate forms and rows without localized sprites', () => {
  const legendary = row({ id: 'a', slug: 'mewtwo', pokemon_id: 150, metadata: { is_legendary: true } });
  const duplicate = row({ id: 'b', slug: 'mewtwo', pokemon_id: 150, metadata: { is_legendary: true } });
  const missingSprite = row({ id: 'c', slug: 'lugia', pokemon_id: 249, sprite_path: '', metadata: { is_legendary: true } });
  assert.deepEqual(
    resolveBubbleSurvivalCategoryPool([legendary, duplicate, missingSprite], 'legendary').map((item) => item.id),
    ['a'],
  );
});

test('swept circle-to-tail collision detects crossings between fixed steps', () => {
  assert.equal(movingCircleIntersectsSegment(
    { x: -5, y: 0 },
    { x: 5, y: 0 },
    0.5,
    { x: 0, y: -4 },
    { x: 0, y: 4 },
  ), true);
  assert.equal(movingCircleIntersectsSegment(
    { x: -5, y: 5 },
    { x: 5, y: 5 },
    0.5,
    { x: 0, y: -4 },
    { x: 0, y: 4 },
  ), false);
});

test('fixed-step simulation is deterministic, creates wall tails, and ends with one winner', () => {
  const subjects = Array.from({ length: 12 }, (_, index) => ({ id: `subject-${index}` }));
  const first = simulateBubbleSurvival({ subjects, seed: 'deterministic-seed' });
  const second = simulateBubbleSurvival({ subjects, seed: 'deterministic-seed' });
  assert.deepEqual(first, second);
  assert.equal(first.outcome, 'winner');
  assert.ok(first.winner_id);
  assert.equal(first.frames.at(-1).bubbles.length, 1);
  assert.equal(
    first.frames.some((frame) => frame.bubbles.some((bubble) => bubble.tail_count > 1)),
    true,
  );
  assert.equal(first.frames.some((frame) => frame.bubbles.length < subjects.length), true);
});

test('planner selects unique readable Pokemon, produces replay data, and is seed-stable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bubble-survival-'));
  try {
    const musicPath = join(root, 'music.mp3');
    await writeFile(musicPath, 'music');
    const rows = [];
    for (let index = 0; index < 14; index += 1) {
      const spritePath = join(root, `sprite-${index}.png`);
      await writeFile(spritePath, 'sprite');
      rows.push(row({
        id: `legendary-${index}`,
        slug: `legendary-${index}`,
        name: `Legendary ${index}`,
        pokemon_id: 1000 + index,
        national_dex_number: 1000 + index,
        sprite_path: spritePath,
        metadata: { is_legendary: true, is_mythical: false },
      }));
    }
    const template = {
      template_id: 'pokemon.bubble-survival.v1',
      template_key: 'bubble-survival',
      selection_rules: { category: 'legendary', pokemon_count: 12 },
      simulation: { maximum_seconds: 20, maximum_attempts: 2 },
    };
    const options = {
      template,
      pokedexRows: rows,
      seed: 'planner-seed',
      assetInventory: { music: [musicPath] },
    };
    const first = await planPokemonBubbleSurvival(options);
    const second = await planPokemonBubbleSurvival(options);
    assert.deepEqual(first, second);
    assert.equal(first.selection.selected_subjects.length, 12);
    assert.equal(new Set(first.selection.selected_subjects.map((subject) => subject.id)).size, 12);
    assert.equal(first.simulation.outcome, 'winner');
    assert.equal(first.assets.music_path, musicPath);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Bubble Survival is exposed through template routing and the runtime registry', () => {
  assert.equal(resolvePokeQuizzTemplateKey({ template_key: 'bubble-survival' }), 'bubble-survival');
  assert.equal(resolveProductVideoTemplateId('bubble-survival'), 'pokemon.bubble-survival.v1');
  assert.equal(typeof resolvePokeQuizzPlanner({ template_key: 'bubble-survival' }), 'function');
  assert.equal(typeof resolvePokeQuizzRenderer({ template_key: 'bubble-survival' }), 'function');
  assert.match(
    buildPokeQuizzPreviewDirectory({ template_key: 'bubble-survival' }),
    /Previews\/Bubble Survival$/u,
  );
  assert.equal(
    PRODUCT_VIDEO_TEMPLATE_DEFINITIONS.some((definition) => definition.templateKey === 'bubble-survival'),
    true,
  );
});

