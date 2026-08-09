import test from 'node:test';
import assert from 'node:assert/strict';
import { expandPokedexRowsWithPokeApiVarieties } from '../src/pokedex-varieties.mjs';

test('expandPokedexRowsWithPokeApiVarieties preserves the default row id and adds alternate forms', async () => {
  const fetchImpl = async (url) => {
    if (url === 'https://pokeapi.co/api/v2/pokemon-species/479') {
      return Response.json({
        id: 479,
        name: 'rotom',
        varieties: [
          {
            is_default: true,
            pokemon: {
              name: 'rotom',
              url: 'https://pokeapi.co/api/v2/pokemon/479/',
            },
          },
          {
            is_default: false,
            pokemon: {
              name: 'rotom-heat',
              url: 'https://pokeapi.co/api/v2/pokemon/10008/',
            },
          },
        ],
      });
    }
    if (url === 'https://pokeapi.co/api/v2/pokemon/479/') {
      return Response.json({
        id: 479,
        name: 'rotom',
        order: 681,
        cries: {
          latest: 'https://example.test/cries/479.ogg',
        },
        species: {
          name: 'rotom',
          url: 'https://pokeapi.co/api/v2/pokemon-species/479/',
        },
        forms: [
          {
            name: 'rotom',
            url: 'https://pokeapi.co/api/v2/pokemon-form/10059/',
          },
        ],
        sprites: {
          front_default: 'https://example.test/rotom-default.png',
          front_shiny: 'https://example.test/rotom-default-shiny.png',
          other: {
            home: {
              front_default: 'https://example.test/rotom-home.png',
              front_shiny: 'https://example.test/rotom-home-shiny.png',
            },
          },
        },
        abilities: [
          {
            slot: 1,
            ability: {
              name: 'levitate',
            },
          },
        ],
        stats: [
          { base_stat: 50, stat: { name: 'hp' } },
          { base_stat: 65, stat: { name: 'attack' } },
        ],
        types: [
          { slot: 1, type: { name: 'electric' } },
          { slot: 2, type: { name: 'ghost' } },
        ],
      });
    }
    if (url === 'https://pokeapi.co/api/v2/pokemon/10008/') {
      return Response.json({
        id: 10008,
        name: 'rotom-heat',
        order: 682,
        cries: {
          latest: 'https://example.test/cries/10008.ogg',
        },
        species: {
          name: 'rotom',
          url: 'https://pokeapi.co/api/v2/pokemon-species/479/',
        },
        forms: [
          {
            name: 'rotom-heat',
            url: 'https://pokeapi.co/api/v2/pokemon-form/10008/',
          },
        ],
        sprites: {
          front_default: 'https://example.test/rotom-heat-default.png',
          front_shiny: 'https://example.test/rotom-heat-default-shiny.png',
          other: {
            home: {
              front_default: 'https://example.test/rotom-heat-home.png',
              front_shiny: 'https://example.test/rotom-heat-home-shiny.png',
            },
          },
        },
        abilities: [
          {
            slot: 1,
            ability: {
              name: 'levitate',
            },
          },
        ],
        stats: [
          { base_stat: 50, stat: { name: 'hp' } },
          { base_stat: 65, stat: { name: 'attack' } },
        ],
        types: [
          { slot: 1, type: { name: 'electric' } },
          { slot: 2, type: { name: 'fire' } },
        ],
      });
    }
    if (url === 'https://pokeapi.co/api/v2/pokemon-form/10059/') {
      return Response.json({
        id: 10059,
        is_default: true,
        is_battle_only: false,
        is_mega: false,
        form_name: '',
        form_order: 1,
        order: 681,
        names: [],
        form_names: [],
        version_group: {
          name: 'diamond-pearl',
        },
      });
    }
    if (url === 'https://pokeapi.co/api/v2/pokemon-form/10008/') {
      return Response.json({
        id: 10008,
        is_default: false,
        is_battle_only: false,
        is_mega: false,
        form_name: 'heat',
        form_order: 2,
        order: 682,
        names: [],
        form_names: [
          {
            name: 'Heat',
            language: {
              name: 'en',
            },
          },
        ],
        version_group: {
          name: 'platinum',
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const expanded = await expandPokedexRowsWithPokeApiVarieties([
    {
      id: 'pokedex-0479',
      national_dex_number: 479,
      slug: 'rotom',
      name: 'Rotom',
      generation: 4,
      region: 'sinnoh',
      types: ['electric', 'ghost'],
      sprite_path: '/tmp/0479.png',
      silhouette_path: '/tmp/0479-silhouette.png',
      shiny_sprite_path: '/tmp/0479-shiny.png',
      cry_path: '/tmp/0479.ogg',
      sprite_source_url: 'https://www.serebii.net/scarletviolet/pokemon/new/small/479.png',
      silhouette_source_url: null,
      shiny_sprite_source_url: null,
      cry_source_url: null,
      asset_status: 'core_facts_seeded',
      metadata: {
        source_page_url: 'https://www.serebii.net/pokemon/gen4pokemon.shtml',
      },
    },
  ], {
    fetchImpl,
  });

  assert.equal(expanded.stats.baseRows, 1);
  assert.equal(expanded.rows.length, 2);
  assert.deepEqual(expanded.rows.map((row) => row.id), [
    'pokedex-0479',
    'pokedex-0479-rotom-heat',
  ]);

  const defaultRow = expanded.rows.find((row) => row.id === 'pokedex-0479');
  const heatRow = expanded.rows.find((row) => row.id === 'pokedex-0479-rotom-heat');

  assert.ok(defaultRow);
  assert.ok(heatRow);
  assert.equal(defaultRow.is_default_form, true);
  assert.equal(defaultRow.sprite_path, '/tmp/0479.png');
  assert.equal(defaultRow.sprite_source_url, 'https://www.serebii.net/scarletviolet/pokemon/new/small/479.png');
  assert.equal(heatRow.is_default_form, false);
  assert.equal(heatRow.sprite_path, null);
  assert.deepEqual(heatRow.types, ['electric', 'fire']);
  assert.equal(heatRow.name, 'Rotom (Heat)');
  assert.equal(heatRow.slug, 'rotom-heat');
  assert.equal(heatRow.sprite_source_url, 'https://example.test/rotom-heat-home.png');
  assert.equal(heatRow.shiny_sprite_source_url, 'https://example.test/rotom-heat-home-shiny.png');
  assert.equal(heatRow.metadata.pokemon_api.is_default_form, false);
  assert.equal(heatRow.metadata.pokemon_api.form_name, 'Heat');
});
