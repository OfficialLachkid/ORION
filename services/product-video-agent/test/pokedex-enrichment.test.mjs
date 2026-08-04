import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEvolutionStageIndex,
  enrichPokedexRows,
  fetchPokeApiSpeciesEnrichment,
} from '../src/pokedex-enrichment.mjs';

test('buildEvolutionStageIndex marks base, middle, and final stages from a branched chain', () => {
  const index = buildEvolutionStageIndex({
    chain: {
      species: { name: 'gastly', url: 'https://pokeapi.co/api/v2/pokemon-species/92/' },
      evolves_to: [
        {
          species: { name: 'haunter', url: 'https://pokeapi.co/api/v2/pokemon-species/93/' },
          evolves_to: [
            {
              species: { name: 'gengar', url: 'https://pokeapi.co/api/v2/pokemon-species/94/' },
              evolves_to: [],
            },
          ],
        },
        {
          species: { name: 'ghost-branch', url: 'https://pokeapi.co/api/v2/pokemon-species/999/' },
          evolves_to: [],
        },
      ],
    },
  });

  assert.equal(index.get(92)?.evolutionStage, 'base');
  assert.equal(index.get(92)?.isFinalEvolution, false);
  assert.equal(index.get(93)?.evolutionStage, 'middle');
  assert.equal(index.get(94)?.evolutionStage, 'final');
  assert.equal(index.get(999)?.evolutionStage, 'final');
});

test('fetchPokeApiSpeciesEnrichment reads legendary/mythical and final-stage data from PokeAPI payloads', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url === 'https://pokeapi.co/api/v2/pokemon-species/151') {
      return Response.json({
        id: 151,
        is_legendary: false,
        is_mythical: true,
        evolves_from_species: null,
        evolution_chain: {
          url: 'https://pokeapi.co/api/v2/evolution-chain/78/',
        },
      });
    }
    if (url === 'https://pokeapi.co/api/v2/evolution-chain/78/') {
      return Response.json({
        chain: {
          species: { name: 'mew', url: 'https://pokeapi.co/api/v2/pokemon-species/151/' },
          evolves_to: [],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const enrichment = await fetchPokeApiSpeciesEnrichment(151, { fetchImpl });

  assert.equal(enrichment.isLegendary, false);
  assert.equal(enrichment.isMythical, true);
  assert.equal(enrichment.evolutionChainId, 78);
  assert.equal(enrichment.evolutionStage, 'final');
  assert.equal(enrichment.isFinalEvolution, true);
  assert.equal(fetchCalls.length, 2);
});

test('enrichPokedexRows caches evolution chains across members of the same family', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    if (url === 'https://pokeapi.co/api/v2/pokemon-species/133') {
      return Response.json({
        id: 133,
        is_legendary: false,
        is_mythical: false,
        evolves_from_species: null,
        evolution_chain: {
          url: 'https://pokeapi.co/api/v2/evolution-chain/67/',
        },
      });
    }
    if (url === 'https://pokeapi.co/api/v2/pokemon-species/134') {
      return Response.json({
        id: 134,
        is_legendary: false,
        is_mythical: false,
        evolves_from_species: {
          name: 'eevee',
          url: 'https://pokeapi.co/api/v2/pokemon-species/133/',
        },
        evolution_chain: {
          url: 'https://pokeapi.co/api/v2/evolution-chain/67/',
        },
      });
    }
    if (url === 'https://pokeapi.co/api/v2/evolution-chain/67/') {
      return Response.json({
        chain: {
          species: { name: 'eevee', url: 'https://pokeapi.co/api/v2/pokemon-species/133/' },
          evolves_to: [
            {
              species: { name: 'vaporeon', url: 'https://pokeapi.co/api/v2/pokemon-species/134/' },
              evolves_to: [],
            },
          ],
        },
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const rows = [
    {
      id: 'pokedex-0133',
      national_dex_number: 133,
      metadata: {},
    },
    {
      id: 'pokedex-0134',
      national_dex_number: 134,
      metadata: {},
    },
  ];

  const enriched = await enrichPokedexRows(rows, {
    fetchImpl,
    concurrency: 2,
  });

  assert.equal(rows[0].metadata.evolution_stage, 'base');
  assert.equal(rows[0].metadata.is_final_evolution, false);
  assert.equal(rows[1].metadata.evolution_stage, 'final');
  assert.equal(rows[1].metadata.is_final_evolution, true);
  assert.equal(rows[1].metadata.evolves_from_species_name, 'eevee');
  assert.equal(enriched.stats.speciesRequests, 2);
  assert.equal(enriched.stats.evolutionChainRequests, 1);
  assert.equal(
    fetchCalls.filter((url) => url === 'https://pokeapi.co/api/v2/evolution-chain/67/').length,
    1,
  );
});
