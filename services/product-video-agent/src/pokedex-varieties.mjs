import { formatDexNumber, sanitizePokemonSlug } from './poke-quizz-asset-layout.mjs';
import {
  resolvePreferredShinySpriteSourceUrl,
  resolvePreferredSpriteSourceUrl,
} from './pokemon-db-shiny-sprites.mjs';

const POKEAPI_BASE_URL = 'https://pokeapi.co/api/v2';
const POKEAPI_TYPE_ICON_ROOT = 'https://www.serebii.net/pokedex-bw/type';
const REGIONAL_FORM_LABELS = Object.freeze({
  alola: 'Alolan',
  galar: 'Galarian',
  hisui: 'Hisuian',
  paldea: 'Paldean',
});

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

function titleCaseToken(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (Object.prototype.hasOwnProperty.call(REGIONAL_FORM_LABELS, normalized)) {
    return REGIONAL_FORM_LABELS[normalized];
  }
  if (normalized === 'gmax') return 'Gigantamax';
  if (normalized === 'mega') return 'Mega';
  if (normalized === 'primal') return 'Primal';
  if (normalized === 'totem') return 'Totem';
  if (normalized === 'ultra') return 'Ultra';
  if (normalized === 'school') return 'School';
  if (normalized === 'single') return 'Single';
  if (normalized === 'rapid') return 'Rapid';
  if (normalized === 'low') return 'Low';
  if (normalized === 'amped') return 'Amped';
  if (normalized === 'zen') return 'Zen';
  if (normalized === 'dusk') return 'Dusk';
  if (normalized === 'dawn') return 'Dawn';
  if (normalized === 'midday') return 'Midday';
  if (normalized === 'midnight') return 'Midnight';
  if (normalized === 'eternamax') return 'Eternamax';
  if (normalized === 'crowned') return 'Crowned';
  if (normalized === 'combat') return 'Combat';
  if (normalized === 'blaze') return 'Blaze';
  if (normalized === 'aqua') return 'Aqua';
  if (normalized === 'white') return 'White';
  if (normalized === 'black') return 'Black';
  if (normalized === 'ice') return 'Ice';
  if (normalized === 'shadow') return 'Shadow';
  if (normalized === 'sunny') return 'Sunny';
  if (normalized === 'rainy') return 'Rainy';
  if (normalized === 'snowy') return 'Snowy';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeFormSuffix(suffix) {
  return String(suffix || '')
    .split('-')
    .map((token) => titleCaseToken(token))
    .filter(Boolean)
    .join(' ');
}

function getEnglishName(entries = []) {
  return (entries || []).find((entry) => entry?.language?.name === 'en' && String(entry?.name || '').trim())?.name || '';
}

function buildTypeIconSourceUrls(types = []) {
  return (types || []).map((typeName) => (
    `${POKEAPI_TYPE_ICON_ROOT}/${String(typeName || '').trim().toLowerCase()}.gif`
  ));
}

function normalizePokemonTypes(types = []) {
  return [...(types || [])]
    .sort((left, right) => Number(left?.slot || 0) - Number(right?.slot || 0))
    .map((entry) => String(entry?.type?.name || '').trim().toLowerCase())
    .filter(Boolean);
}

function buildFallbackFormLabel(baseSlug, pokemonName) {
  const normalizedBaseSlug = String(baseSlug || '').trim().toLowerCase();
  const normalizedPokemonName = String(pokemonName || '').trim().toLowerCase();
  if (!normalizedBaseSlug || !normalizedPokemonName || normalizedBaseSlug === normalizedPokemonName) {
    return '';
  }
  const prefix = `${normalizedBaseSlug}-`;
  const suffix = normalizedPokemonName.startsWith(prefix)
    ? normalizedPokemonName.slice(prefix.length)
    : normalizedPokemonName;
  return humanizeFormSuffix(suffix);
}

function buildDisplayName(baseRow, pokemonPayload, formPayload, isDefaultForm) {
  const baseName = String(baseRow?.name || '').trim();
  if (isDefaultForm) {
    return baseName;
  }

  const explicitFormName = String(getEnglishName(formPayload?.form_names) || '').trim();
  const explicitFullName = String(getEnglishName(formPayload?.names) || '').trim();
  if (explicitFullName) {
    return explicitFullName;
  }

  const fallbackFormLabel = explicitFormName || buildFallbackFormLabel(
    baseRow?.slug || pokemonPayload?.species?.name,
    pokemonPayload?.name,
  );
  if (!fallbackFormLabel) {
    return baseName;
  }
  return `${baseName} (${fallbackFormLabel})`;
}

function buildRowId(baseRow, pokemonPayload, isDefaultForm) {
  if (isDefaultForm) {
    return baseRow.id;
  }
  return `pokedex-${formatDexNumber(baseRow.national_dex_number)}-${sanitizePokemonSlug(pokemonPayload?.name)}`;
}

function buildVariantMetadata(baseRow, speciesPayload, pokemonPayload, formPayload, isDefaultForm) {
  const formName = String(getEnglishName(formPayload?.form_names) || formPayload?.form_name || '').trim();
  return {
    ...(baseRow?.metadata || {}),
    source_name: 'serebii_pokeapi_varieties',
    source_page_url: baseRow?.metadata?.source_page_url || null,
    display_dex_number: baseRow?.metadata?.display_dex_number || `#${formatDexNumber(baseRow?.national_dex_number)}`,
    typing_basis: 'current_canonical_types_from_pokeapi_variety',
    type_icon_source_urls: buildTypeIconSourceUrls(normalizePokemonTypes(pokemonPayload?.types)),
    abilities: [...(pokemonPayload?.abilities || [])]
      .sort((left, right) => Number(left?.slot || 0) - Number(right?.slot || 0))
      .map((entry) => titleCaseToken(String(entry?.ability?.name || '').replaceAll('-', ' ')))
      .filter(Boolean),
    base_stats: Object.fromEntries(
      [...(pokemonPayload?.stats || [])]
        .map((entry) => [
          String(entry?.stat?.name || '').trim().toLowerCase().replaceAll('-', '_'),
          Number(entry?.base_stat || 0),
        ])
        .filter(([key, value]) => key && Number.isFinite(value)),
    ),
    pokemon_api: {
      species_id: Number(speciesPayload?.id || baseRow?.national_dex_number || 0) || null,
      species_name: String(speciesPayload?.name || baseRow?.slug || '').trim() || null,
      pokemon_id: Number(pokemonPayload?.id || 0) || null,
      pokemon_name: String(pokemonPayload?.name || '').trim() || null,
      pokemon_url: Number(pokemonPayload?.id || 0)
        ? `${POKEAPI_BASE_URL}/pokemon/${Number(pokemonPayload.id)}/`
        : null,
      form_id: Number(formPayload?.id || 0) || null,
      form_name: formName || null,
      is_default_form: Boolean(isDefaultForm),
      is_battle_only: Boolean(formPayload?.is_battle_only),
      is_mega: Boolean(formPayload?.is_mega),
      form_order: Number(formPayload?.form_order || 0) || null,
      order: Number(formPayload?.order || 0) || Number(pokemonPayload?.order || 0) || null,
      version_group: String(formPayload?.version_group?.name || '').trim() || null,
    },
  };
}

function buildVariantRow(baseRow, speciesPayload, pokemonPayload, formPayload, isDefaultForm) {
  const types = normalizePokemonTypes(pokemonPayload?.types);
  const spriteSourceUrl = isDefaultForm
    ? baseRow.sprite_source_url || resolvePreferredSpriteSourceUrl(pokemonPayload, baseRow)
    : resolvePreferredSpriteSourceUrl(pokemonPayload, baseRow);
  return {
    id: buildRowId(baseRow, pokemonPayload, isDefaultForm),
    national_dex_number: baseRow.national_dex_number,
    is_default_form: Boolean(isDefaultForm),
    slug: String(pokemonPayload?.name || baseRow.slug || '').trim(),
    name: buildDisplayName(baseRow, pokemonPayload, formPayload, isDefaultForm),
    generation: baseRow.generation,
    region: baseRow.region,
    types,
    sprite_path: isDefaultForm ? (baseRow.sprite_path || null) : null,
    silhouette_path: isDefaultForm ? (baseRow.silhouette_path || null) : null,
    shiny_sprite_path: isDefaultForm ? (baseRow.shiny_sprite_path || null) : null,
    cry_path: isDefaultForm ? (baseRow.cry_path || null) : null,
    sprite_source_url: spriteSourceUrl || null,
    silhouette_source_url: baseRow.silhouette_source_url || null,
    shiny_sprite_source_url: resolvePreferredShinySpriteSourceUrl(pokemonPayload, pokemonPayload?.name || baseRow) || null,
    cry_source_url: pokemonPayload?.cries?.latest || pokemonPayload?.cries?.legacy || null,
    asset_status: isDefaultForm ? (baseRow.asset_status || 'core_facts_seeded') : 'core_facts_seeded',
    metadata: buildVariantMetadata(baseRow, speciesPayload, pokemonPayload, formPayload, isDefaultForm),
  };
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

async function fetchSpeciesPayload(baseRow, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const speciesCache = options.speciesCache || new Map();
  const cacheKey = Number(baseRow?.national_dex_number || 0);
  return getOrCreateCachedPromise(speciesCache, cacheKey, async () => (
    fetchJsonOrThrow(
      fetchImpl,
      `${POKEAPI_BASE_URL}/pokemon-species/${encodeURIComponent(String(baseRow.national_dex_number))}`,
      `Could not fetch PokeAPI species payload for #${baseRow?.national_dex_number}`,
    )
  ));
}

async function fetchPokemonPayload(resource, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const pokemonCache = options.pokemonCache || new Map();
  const resourceUrl = String(resource?.url || '').trim();
  const resourceName = String(resource?.name || '').trim();
  const cacheKey = resourceUrl || resourceName;
  const pokemonUrl = resourceUrl || `${POKEAPI_BASE_URL}/pokemon/${encodeURIComponent(resourceName)}`;
  return getOrCreateCachedPromise(pokemonCache, cacheKey, async () => (
    fetchJsonOrThrow(
      fetchImpl,
      pokemonUrl,
      `Could not fetch PokeAPI Pokemon payload for ${resourceName || resourceUrl}`,
    )
  ));
}

async function fetchPokemonFormPayload(pokemonPayload, options = {}) {
  const formResource = Array.isArray(pokemonPayload?.forms) ? pokemonPayload.forms[0] : null;
  const formUrl = String(formResource?.url || '').trim();
  if (!formUrl) {
    return null;
  }
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const formCache = options.formCache || new Map();
  return getOrCreateCachedPromise(formCache, formUrl, async () => (
    fetchJsonOrThrow(
      fetchImpl,
      formUrl,
      `Could not fetch PokeAPI Pokemon form payload for ${pokemonPayload?.name || formUrl}`,
    )
  ));
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

export async function expandPokedexRowsWithPokeApiVarieties(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const expandedRows = [];
  const speciesCache = options.speciesCache || new Map();
  const pokemonCache = options.pokemonCache || new Map();
  const formCache = options.formCache || new Map();

  await mapWithConcurrency(sourceRows, options.concurrency ?? 6, async (baseRow) => {
    const speciesPayload = await fetchSpeciesPayload(baseRow, {
      ...options,
      speciesCache,
    });
    const varieties = Array.isArray(speciesPayload?.varieties) && speciesPayload.varieties.length > 0
      ? speciesPayload.varieties
      : [{ is_default: true, pokemon: { name: baseRow.slug } }];

    const varietyRows = await Promise.all(varieties.map(async (variety) => {
      const pokemonPayload = await fetchPokemonPayload(variety.pokemon, {
        ...options,
        pokemonCache,
      });
      const formPayload = await fetchPokemonFormPayload(pokemonPayload, {
        ...options,
        formCache,
      });
      return buildVariantRow(
        baseRow,
        speciesPayload,
        pokemonPayload,
        formPayload,
        Boolean(variety?.is_default),
      );
    }));

    expandedRows.push(...varietyRows);
  });

  const rowsById = new Map();
  for (const row of expandedRows) {
    rowsById.set(row.id, row);
  }
  const sortedRows = [...rowsById.values()].sort((left, right) => (
    (Number(left.national_dex_number || 0) - Number(right.national_dex_number || 0))
    || (Number(Boolean(right.is_default_form)) - Number(Boolean(left.is_default_form)))
    || (Number(left?.metadata?.pokemon_api?.order || 0) - Number(right?.metadata?.pokemon_api?.order || 0))
    || String(left.slug || '').localeCompare(String(right.slug || ''))
  ));

  return {
    rows: sortedRows,
    stats: {
      baseRows: sourceRows.length,
      expandedRows: sortedRows.length,
      speciesRequests: speciesCache.size,
      pokemonRequests: pokemonCache.size,
      formRequests: formCache.size,
    },
  };
}
