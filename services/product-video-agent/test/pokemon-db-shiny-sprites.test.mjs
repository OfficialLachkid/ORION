import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPokemonDbShinySpriteSlug,
  buildPokemonDbShinySpriteUrl,
  resolvePreferredShinySpriteSourceUrl,
} from '../src/pokemon-db-shiny-sprites.mjs';

test('PokemonDB shiny sprite slugs normalize special Pokemon names', () => {
  const cases = [
    ['Bulbasaur', 'bulbasaur'],
    ['Nidoran\u2640', 'nidoran-f'],
    ['Nidoran\u2642', 'nidoran-m'],
    ["Farfetch'd", 'farfetchd'],
    ['Mr. Mime', 'mr-mime'],
    ['Mime Jr.', 'mime-jr'],
    ["Sirfetch'd", 'sirfetchd'],
    ['Ho-Oh', 'ho-oh'],
    ['Porygon-Z', 'porygon-z'],
    ['Tapu Koko', 'tapu-koko'],
    ['Type: Null', 'type-null'],
    ['Flab\u00e9b\u00e9', 'flabebe'],
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

test('preferred shiny sprite sourcing uses transparent home art before jpeg fallbacks', () => {
  assert.equal(
    resolvePreferredShinySpriteSourceUrl({
      sprites: {
        front_shiny: 'https://example.test/pixel-shiny.png',
        other: {
          home: {
            front_shiny: 'https://example.test/home-shiny.png',
          },
          'official-artwork': {
            front_shiny: 'https://example.test/official-shiny.png',
          },
        },
      },
    }, { name: 'Bulbasaur' }),
    'https://example.test/home-shiny.png',
  );

  assert.equal(
    resolvePreferredShinySpriteSourceUrl({
      sprites: {
        front_shiny: 'https://example.test/pixel-shiny.png',
        other: {},
      },
    }, { name: 'Bulbasaur' }),
    'https://img.pokemondb.net/sprites/home/shiny/2x/bulbasaur.jpg',
  );
});
