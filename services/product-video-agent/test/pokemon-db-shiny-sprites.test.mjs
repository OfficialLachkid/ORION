import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokemonDbShinySpriteSlug,
  buildPokemonDbShinySpriteUrl,
} from '../src/pokemon-db-shiny-sprites.mjs';

test('PokemonDB shiny sprite slugs normalize special Pokemon names', () => {
  const cases = [
    ['Bulbasaur', 'bulbasaur'],
    ['Nidoran♀', 'nidoran-f'],
    ['Nidoran♂', 'nidoran-m'],
    ["Farfetch'd", 'farfetchd'],
    ['Mr. Mime', 'mr-mime'],
    ['Mime Jr.', 'mime-jr'],
    ["Sirfetch'd", 'sirfetchd'],
    ['Ho-Oh', 'ho-oh'],
    ['Porygon-Z', 'porygon-z'],
    ['Tapu Koko', 'tapu-koko'],
    ['Type: Null', 'type-null'],
    ['Flabébé', 'flabebe'],
  ];

  for (const [name, expectedSlug] of cases) {
    assert.equal(buildPokemonDbShinySpriteSlug(name), expectedSlug);
  }
});

test('PokemonDB shiny sprite urls target the home shiny 2x art set', () => {
  assert.equal(
    buildPokemonDbShinySpriteUrl({ name: 'Bulbasaur' }),
    'https://img.pokemondb.net/sprites/home/shiny/2x/bulbasaur.jpg',
  );
});
