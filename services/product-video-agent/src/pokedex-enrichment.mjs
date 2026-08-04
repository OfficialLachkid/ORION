const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2';

function parseIdFromResourceUrl(resourceUrl) {
  const normalizedUrl = String(resourceUrl || '').trim();
  if (!normalizedUrl) {
    return null;
  }
  const match = /\/(\d+)\/?$/u.exec(normalizedUrl);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function evolutionStageForNode(node, depth) {
  const evolvesToCount = Array.isArray(node?.evolves_to) ? node.evolves_to.length : 0;
  if (evolvesToCount === 0) {
    return 'final';
  }
  return depth === 0 ? 'base' : 'middle';
}

export function buildEvolutionStageIndex(chainPayload = {}) {
  const index = new Map();

  function visit(node, depth) {
    if (!node?.species?.url) {
      return;
    }
    const speciesId = parseIdFromResourceUrl(node.species.url);
    if (!speciesId) {
      return;
    }
    const evolvesTo = Array.isArray(node.evolves_to) ? node.evolves_to : [];
    index.set(speciesId, {
      speciesId,
      speciesName: String(node?.species?.name || '').trim(),
      evolutionDepth: depth,
      evolvesToCount: evolvesTo.length,
      evolutionStage: evolutionStageForNode(node, depth),
      isFinalEvolution: evolvesTo.length === 0,
    });
    for (const child of evolvesTo) {
      visit(child, depth + 1);
    }
  }

  visit(chainPayload?.chain || null, 0);
  return index;
}

async function fetchJsonOrThrow(fetchImpl, url, errorPrefix) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`${errorPrefix} (${response.status}).`);
  }
  return response.json();
}

function getOrCreateCachedPromise(cache, key, factory) {
  if (cache.has(key)) {
    return cache.get(key);
  }
  const promise = Promise.resolve().then(factory);
  cache.set(key, promise);
  return promise;
}

async function fetchSpeciesPayload(nationalDexNumber, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const speciesCache = options.speciesCache || new Map();
  const cacheKey = Number(nationalDexNumber);
  return getOrCreateCachedPromise(speciesCache, cacheKey, async () => (
    fetchJsonOrThrow(
      fetchImpl,
      `${POKEAPI_BASE_URL}/pokemon-species/${encodeURIComponent(String(nationalDexNumber))}`,
      `Could not fetch PokeAPI species metadata for #${nationalDexNumber}`,
    )
  ));
}

async function fetchEvolutionStageRecord(speciesPayload, options = {}) {
  const evolutionChainUrl = String(speciesPayload?.evolution_chain?.url || '').trim();
  if (!evolutionChainUrl) {
    return {
      evolutionChainId: null,
      evolutionChainUrl: '',
      evolutionDepth: null,
      evolvesToCount: 0,
      evolutionStage: '',
      isFinalEvolution: false,
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const evolutionChainCache = options.evolutionChainCache || new Map();
  const stageIndex = await getOrCreateCachedPromise(evolutionChainCache, evolutionChainUrl, async () => {
    const chainPayload = await fetchJsonOrThrow(
      fetchImpl,
      evolutionChainUrl,
      `Could not fetch PokeAPI evolution chain ${evolutionChainUrl}`,
    );
    return buildEvolutionStageIndex(chainPayload);
  });

  const speciesId = Number(speciesPayload?.id || parseIdFromResourceUrl(speciesPayload?.url || ''));
  const stageRecord = Number.isFinite(speciesId) ? stageIndex.get(speciesId) : null;
  return {
    evolutionChainId: parseIdFromResourceUrl(evolutionChainUrl),
    evolutionChainUrl,
    evolutionDepth: stageRecord?.evolutionDepth ?? null,
    evolvesToCount: stageRecord?.evolvesToCount ?? 0,
    evolutionStage: stageRecord?.evolutionStage || '',
    isFinalEvolution: Boolean(stageRecord?.isFinalEvolution),
  };
}

export async function fetchPokeApiSpeciesEnrichment(nationalDexNumber, options = {}) {
  const speciesPayload = await fetchSpeciesPayload(nationalDexNumber, options);
  const evolutionStageRecord = await fetchEvolutionStageRecord(speciesPayload, options);

  return {
    isLegendary: Boolean(speciesPayload?.is_legendary),
    isMythical: Boolean(speciesPayload?.is_mythical),
    evolvesFromSpeciesId: parseIdFromResourceUrl(speciesPayload?.evolves_from_species?.url || ''),
    evolvesFromSpeciesName: String(speciesPayload?.evolves_from_species?.name || '').trim() || null,
    ...evolutionStageRecord,
  };
}

export async function enrichPokedexRow(row, options = {}) {
  if (!row || !Number.isFinite(Number(row.national_dex_number))) {
    return row;
  }

  const enrichment = await fetchPokeApiSpeciesEnrichment(row.national_dex_number, options);
  row.metadata = {
    ...(row.metadata || {}),
    is_legendary: enrichment.isLegendary,
    is_mythical: enrichment.isMythical,
    evolution_stage: enrichment.evolutionStage,
    is_final_evolution: enrichment.isFinalEvolution,
    evolution_depth: enrichment.evolutionDepth,
    evolves_to_count: enrichment.evolvesToCount,
    evolution_chain_id: enrichment.evolutionChainId,
    evolution_chain_url: enrichment.evolutionChainUrl,
    evolves_from_species_id: enrichment.evolvesFromSpeciesId,
    evolves_from_species_name: enrichment.evolvesFromSpeciesName,
    species_enrichment: {
      source_name: 'pokeapi',
      enriched_at: new Date().toISOString(),
    },
  };
  return row;
}

async function mapWithConcurrency(values, concurrency, iteratee) {
  const items = Array.isArray(values) ? values : [];
  const workerCount = Math.max(1, Math.min(items.length || 1, Number(concurrency) || 6));
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      await iteratee(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

export async function enrichPokedexRows(rows, options = {}) {
  const targetRows = Array.isArray(rows) ? rows : [];
  const speciesCache = options.speciesCache || new Map();
  const evolutionChainCache = options.evolutionChainCache || new Map();

  await mapWithConcurrency(
    targetRows,
    options.concurrency ?? 6,
    async (row) => enrichPokedexRow(row, {
      ...options,
      speciesCache,
      evolutionChainCache,
    }),
  );

  return {
    rows: targetRows,
    stats: {
      enrichedRows: targetRows.length,
      speciesRequests: speciesCache.size,
      evolutionChainRequests: evolutionChainCache.size,
    },
  };
}
