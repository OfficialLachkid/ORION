import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPokemonSubjectsForPool,
  getPokemonPoolDefinition,
  normalizePokemonPoolKey,
} from '../src/domains/pokemon/templates/shared/pokemon-subject-pools.mjs';

function subject(slug, metadata = {}, direct = {}) {
  return {
    slug,
    name: slug,
    is_default_form: direct.is_default_form ?? true,
    metadata: {
      ...metadata,
      pokemon_api: {
        species_name: metadata?.pokemon_api?.species_name || slug,
        pokemon_name: slug,
        is_default_form: direct.is_default_form ?? true,
        ...metadata.pokemon_api,
      },
    },
    ...direct,
  };
}

const subjects = [
  subject('pichu', { is_baby: true, evolution_stage: 'baby' }),
  subject('bulbasaur', { evolution_stage: 'base', evolution_depth: 0, is_final_evolution: false }),
  subject('ivysaur', { evolution_stage: 'middle', evolution_depth: 1, is_final_evolution: false }),
  subject('venusaur', { evolution_stage: 'final', is_final_evolution: true }),
  subject('ditto', { evolution_stage: 'final', is_final_evolution: true }),
  subject('articuno', { is_legendary: true }),
  subject('mew', { is_mythical: true }),
  subject('articuno-galar', {
    is_legendary: true,
    pokemon_api: { species_name: 'articuno' },
  }, { is_default_form: false }),
  subject('mewtwo-mega-x', {
    is_legendary: true,
    pokemon_api: { species_name: 'mewtwo', is_mega: true },
  }, { is_default_form: false }),
  subject('charizard-gmax', {
    pokemon_api: { species_name: 'charizard', form_name: 'gigantamax' },
  }, { is_default_form: false }),
];

function slugsFor(pool) {
  return filterPokemonSubjectsForPool(subjects, pool).map((entry) => entry.slug);
}

test('shared Pokemon pools classify base, middle, special, and combined groups consistently', () => {
  assert.deepEqual(slugsFor('first_stage'), ['bulbasaur']);
  assert.deepEqual(slugsFor('middle_stage'), ['ivysaur']);
  assert.deepEqual(slugsFor('final_stage'), ['venusaur', 'ditto']);
  assert.deepEqual(slugsFor('legendary_mythical'), ['articuno', 'mew']);
  assert.deepEqual(slugsFor('dynamax'), ['charizard-gmax']);
  assert.deepEqual(slugsFor('final_starter'), ['venusaur']);
  assert.deepEqual(slugsFor('mega_legendary'), ['articuno', 'mewtwo-mega-x']);
  assert.deepEqual(slugsFor('mega'), ['mewtwo-mega-x']);
  assert.equal(slugsFor('mixed').length, subjects.length);
});

test('shared Pokemon pool aliases normalize strictly and expose stable labels', () => {
  assert.equal(normalizePokemonPoolKey('first-stage-evolutions'), 'first_stage');
  assert.equal(normalizePokemonPoolKey('gigantamax'), 'dynamax');
  assert.equal(getPokemonPoolDefinition('legendary_or_mythical').label, 'Legendary + Mythical Pokemon');
  assert.throws(() => normalizePokemonPoolKey('not-a-real-pool'), /Unsupported Pokemon pool/u);
});
