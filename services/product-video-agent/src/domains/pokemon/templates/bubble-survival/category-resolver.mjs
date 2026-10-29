const BABY_SPECIES = new Set([
  'pichu', 'cleffa', 'igglybuff', 'togepi', 'tyrogue', 'smoochum', 'elekid', 'magby',
  'azurill', 'wynaut', 'budew', 'chingling', 'bonsly', 'mime-jr', 'happiny', 'munchlax',
  'riolu', 'mantyke', 'toxel',
]);

const STARTER_SPECIES = new Set([
  'bulbasaur', 'charmander', 'squirtle', 'chikorita', 'cyndaquil', 'totodile',
  'treecko', 'torchic', 'mudkip', 'turtwig', 'chimchar', 'piplup', 'snivy', 'tepig',
  'oshawott', 'chespin', 'fennekin', 'froakie', 'rowlet', 'litten', 'popplio',
  'grookey', 'scorbunny', 'sobble', 'sprigatito', 'fuecoco', 'quaxly',
]);

export const BUBBLE_SURVIVAL_CATEGORIES = Object.freeze([
  'legendary',
  'mythical',
  'starters',
  'first-evolutions',
  'baby',
  'final-evolutions',
  'mega-evolutions',
]);

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

function metadataFor(row) {
  return row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
}

function pokemonApiFor(row) {
  const metadata = metadataFor(row);
  return metadata.pokemon_api && typeof metadata.pokemon_api === 'object'
    ? metadata.pokemon_api
    : {};
}

function speciesSlugFor(row) {
  return normalizeToken(
    pokemonApiFor(row).species_name
    || row?.species_slug
    || row?.slug
    || row?.name,
  );
}

function booleanMetadata(row, key) {
  const value = row?.[key] ?? metadataFor(row)[key];
  return value === true || value === 1 || normalizeToken(value) === 'true';
}

function evolutionDepth(row) {
  const value = row?.evolution_depth ?? metadataFor(row).evolution_depth;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPreEvolution(row) {
  const metadata = metadataFor(row);
  return Boolean(
    row?.evolves_from_species_id
    || metadata.evolves_from_species_id
    || row?.evolves_from_species_name
    || metadata.evolves_from_species_name
    || (evolutionDepth(row) ?? 0) > 0,
  );
}

export function normalizeBubbleSurvivalCategory(value) {
  const normalized = normalizeToken(value || 'legendary');
  const aliases = {
    starter: 'starters',
    babies: 'baby',
    'first-evolution': 'first-evolutions',
    'middle-evolution': 'first-evolutions',
    'middle-evolutions': 'first-evolutions',
    'final-evolution': 'final-evolutions',
    mega: 'mega-evolutions',
    'mega-evolution': 'mega-evolutions',
  };
  const category = aliases[normalized] || normalized;
  if (!BUBBLE_SURVIVAL_CATEGORIES.includes(category)) {
    throw new Error(
      `Unsupported Bubble Survival category "${value}". Expected one of: ${BUBBLE_SURVIVAL_CATEGORIES.join(', ')}.`,
    );
  }
  return category;
}

export function isEligibleForBubbleSurvivalCategory(row, categoryValue) {
  const category = normalizeBubbleSurvivalCategory(categoryValue);
  const metadata = metadataFor(row);
  const pokemonApi = pokemonApiFor(row);
  const speciesSlug = speciesSlugFor(row);
  const isDefaultForm = row?.is_default_form !== false && pokemonApi.is_default_form !== false;

  if (category === 'legendary') {
    return isDefaultForm && booleanMetadata(row, 'is_legendary') && !booleanMetadata(row, 'is_mythical');
  }
  if (category === 'mythical') {
    return isDefaultForm && booleanMetadata(row, 'is_mythical');
  }
  if (category === 'starters') {
    return isDefaultForm && STARTER_SPECIES.has(speciesSlug);
  }
  if (category === 'baby') {
    return isDefaultForm && (booleanMetadata(row, 'is_baby') || BABY_SPECIES.has(speciesSlug));
  }
  if (category === 'first-evolutions') {
    return isDefaultForm
      && evolutionDepth(row) === 1
      && !booleanMetadata(row, 'is_final_evolution');
  }
  if (category === 'final-evolutions') {
    return isDefaultForm
      && booleanMetadata(row, 'is_final_evolution')
      && hasPreEvolution(row);
  }
  if (category === 'mega-evolutions') {
    return pokemonApi.is_mega === true || booleanMetadata(row, 'is_mega') || normalizeToken(row?.slug).includes('mega');
  }
  return false;
}

function uniqueFormKey(row) {
  const pokemonApi = pokemonApiFor(row);
  return String(
    pokemonApi.pokemon_id
    || pokemonApi.pokemon_name
    || row?.id
    || `${row?.national_dex_number || ''}:${row?.slug || row?.name || ''}`,
  );
}

export function resolveBubbleSurvivalCategoryPool(rows, categoryValue) {
  const category = normalizeBubbleSurvivalCategory(categoryValue);
  const seen = new Set();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && String(row.sprite_path || '').trim())
    .filter((row) => isEligibleForBubbleSurvivalCategory(row, category))
    .filter((row) => {
      const key = uniqueFormKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

