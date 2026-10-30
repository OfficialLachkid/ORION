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

const FINAL_STARTER_SPECIES = new Set([
  'venusaur', 'charizard', 'blastoise', 'meganium', 'typhlosion', 'feraligatr',
  'sceptile', 'blaziken', 'swampert', 'torterra', 'infernape', 'empoleon',
  'serperior', 'emboar', 'samurott', 'chesnaught', 'delphox', 'greninja',
  'decidueye', 'incineroar', 'primarina', 'rillaboom', 'cinderace', 'inteleon',
  'meowscarada', 'skeledirge', 'quaquaval',
]);

export const POKEMON_POOL_DEFINITIONS = Object.freeze({
  mixed: Object.freeze({ key: 'mixed', label: 'Mixed / All Pokemon' }),
  first_stage: Object.freeze({ key: 'first_stage', label: 'First / Base Stage Pokemon' }),
  middle_stage: Object.freeze({ key: 'middle_stage', label: 'Middle Stage Pokemon' }),
  legendary_mythical: Object.freeze({ key: 'legendary_mythical', label: 'Legendary + Mythical Pokemon' }),
  dynamax: Object.freeze({ key: 'dynamax', label: 'Dynamax / Gigantamax Pokemon' }),
  final_starter: Object.freeze({ key: 'final_starter', label: 'Final Starter Evolutions' }),
  mega_legendary: Object.freeze({ key: 'mega_legendary', label: 'Mega + Legendary Pokemon' }),
  baby: Object.freeze({ key: 'baby', label: 'Baby Pokemon' }),
  starter: Object.freeze({ key: 'starter', label: 'Starter Pokemon' }),
  final_stage: Object.freeze({ key: 'final_stage', label: 'Final Stage Evolutions' }),
  mega: Object.freeze({ key: 'mega', label: 'Mega Evolutions' }),
  legendary: Object.freeze({ key: 'legendary', label: 'Legendary Pokemon' }),
});

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/gu, '_');
}

function pokemonApiFor(subject) {
  return subject?.metadata?.pokemon_api && typeof subject.metadata.pokemon_api === 'object'
    ? subject.metadata.pokemon_api
    : {};
}

function metadataFor(subject) {
  return subject?.metadata && typeof subject.metadata === 'object' ? subject.metadata : {};
}

function readValue(subject, keys) {
  const metadata = metadataFor(subject);
  const pokemonApi = pokemonApiFor(subject);
  for (const key of keys) {
    if (subject?.[key] !== undefined) return subject[key];
    if (metadata[key] !== undefined) return metadata[key];
    if (pokemonApi[key] !== undefined) return pokemonApi[key];
  }
  return undefined;
}

function truthy(value) {
  if (value === true || value === 1) return true;
  return ['true', '1', 'yes'].includes(normalizeToken(value));
}

function subjectSlug(subject) {
  return normalizeToken(
    pokemonApiFor(subject).pokemon_name || subject?.slug || subject?.name,
  ).replaceAll('_', '-');
}

function speciesSlug(subject) {
  return normalizeToken(
    pokemonApiFor(subject).species_name
    || subject?.species_slug
    || metadataFor(subject).species_slug
    || pokemonApiFor(subject).pokemon_name
    || subject?.slug
    || subject?.name,
  ).replaceAll('_', '-');
}

function evolutionStage(subject) {
  return normalizeToken(readValue(subject, ['evolution_stage', 'evolutionStage']));
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function evolutionPosition(subject) {
  return finiteNumber(readValue(subject, [
    'evolution_chain_position', 'evolutionChainPosition', 'evolution_position',
    'evolutionPosition', 'stage_index', 'stageIndex',
  ]));
}

function evolutionDepth(subject) {
  return finiteNumber(readValue(subject, ['evolution_depth', 'evolutionDepth']));
}

export function isDefaultPokemonForm(subject) {
  return subject?.is_default_form !== false && pokemonApiFor(subject).is_default_form !== false;
}

export function isBabyPokemonSubject(subject) {
  return truthy(readValue(subject, ['is_baby', 'baby', 'isBaby']))
    || evolutionStage(subject) === 'baby'
    || BABY_SPECIES.has(speciesSlug(subject));
}

export function isStarterPokemonSubject(subject) {
  return STARTER_SPECIES.has(speciesSlug(subject));
}

export function isMegaPokemonSubject(subject) {
  if (truthy(readValue(subject, ['is_mega', 'mega', 'isMega']))) return true;
  const slug = subjectSlug(subject);
  const formName = normalizeToken(pokemonApiFor(subject).form_name);
  return slug.includes('-mega') || slug.startsWith('mega-') || formName.includes('mega');
}

export function isDynamaxPokemonSubject(subject) {
  if (truthy(readValue(subject, [
    'is_dynamax', 'dynamax', 'isDynamax', 'is_gigantamax', 'gigantamax', 'isGigantamax',
  ]))) return true;
  const slug = subjectSlug(subject);
  const formName = normalizeToken(pokemonApiFor(subject).form_name);
  return formName === 'dynamax'
    || formName === 'gigantamax'
    || slug.includes('dynamax')
    || slug.includes('gigantamax')
    || slug.endsWith('-gmax');
}

export function isLegendaryPokemonSubject(subject) {
  return truthy(readValue(subject, ['is_legendary', 'legendary', 'isLegendary']))
    || normalizeToken(readValue(subject, ['classification', 'category'])) === 'legendary';
}

export function isMythicalPokemonSubject(subject) {
  return truthy(readValue(subject, ['is_mythical', 'mythical', 'isMythical']))
    || normalizeToken(readValue(subject, ['classification', 'category'])) === 'mythical';
}

export function isFinalEvolutionPokemonSubject(subject) {
  return truthy(readValue(subject, [
    'is_final_evolution', 'final_evolution', 'isFinalEvolution',
    'is_fully_evolved', 'fully_evolved', 'isFullyEvolved',
  ])) || ['final', 'fully_evolved'].includes(evolutionStage(subject));
}

export function isBaseStagePokemonSubject(subject) {
  if (isBabyPokemonSubject(subject) || isFinalEvolutionPokemonSubject(subject)) return false;
  return [
    'base', 'basic', 'first', 'first_stage', 'stage_1', 'stage1', 'initial', 'unevolved',
  ].includes(evolutionStage(subject))
    || evolutionDepth(subject) === 0
    || evolutionPosition(subject) === 1;
}

export function isMiddleStagePokemonSubject(subject) {
  if (isFinalEvolutionPokemonSubject(subject)) return false;
  return ['middle', 'mid', 'second', 'second_stage', 'stage_2', 'stage2'].includes(evolutionStage(subject))
    || (evolutionDepth(subject) !== null && evolutionDepth(subject) > 0)
    || evolutionPosition(subject) === 2;
}

export function isFinalStarterEvolutionPokemonSubject(subject) {
  const species = speciesSlug(subject);
  const slug = subjectSlug(subject);
  return FINAL_STARTER_SPECIES.has(species) || FINAL_STARTER_SPECIES.has(slug);
}

function isStandardEvolutionSubject(subject) {
  return isDefaultPokemonForm(subject)
    && !isLegendaryPokemonSubject(subject)
    && !isMythicalPokemonSubject(subject)
    && !isMegaPokemonSubject(subject)
    && !isDynamaxPokemonSubject(subject);
}

const POOL_ALIASES = Object.freeze({
  all: 'mixed',
  mixed_pokemon: 'mixed',
  baby_only: 'baby',
  baby_pokemon: 'baby',
  first_stage_only: 'first_stage',
  first_stage_evolutions: 'first_stage',
  starter_only: 'starter',
  starter_pokemon: 'starter',
  starters: 'starter',
  middle_stage_only: 'middle_stage',
  middle_stage_evolutions: 'middle_stage',
  final_stage_only: 'final_stage',
  final_stage_evolutions: 'final_stage',
  final_evolutions: 'final_stage',
  legendary_only: 'legendary',
  legendary_or_mythical: 'legendary_mythical',
  dynamax_only: 'dynamax',
  dynamax_pokemon: 'dynamax',
  gigantamax: 'dynamax',
  gigantamax_pokemon: 'dynamax',
  mega_only: 'mega',
  mega_pokemon: 'mega',
  mega_evolutions: 'mega',
  final_starter_evolutions: 'final_starter',
  last_stage_starter_evolutions: 'final_starter',
  mega_or_legendary: 'mega_legendary',
  mega_and_legendary: 'mega_legendary',
});

export function normalizePokemonPoolKey(value) {
  const normalized = normalizeToken(value || 'mixed');
  const key = POOL_ALIASES[normalized] || normalized;
  if (!POKEMON_POOL_DEFINITIONS[key]) {
    throw new Error(`Unsupported Pokemon pool "${value}".`);
  }
  return key;
}

export function getPokemonPoolDefinition(value) {
  return POKEMON_POOL_DEFINITIONS[normalizePokemonPoolKey(value)];
}

export function filterPokemonSubjectsForPool(subjects = [], selector = 'mixed') {
  const key = normalizePokemonPoolKey(selector);
  const values = Array.isArray(subjects) ? subjects : [];
  switch (key) {
    case 'baby': return values.filter(isBabyPokemonSubject);
    case 'first_stage': return values.filter((subject) => (
      isStandardEvolutionSubject(subject) && isBaseStagePokemonSubject(subject)
    ));
    case 'starter': return values.filter((subject) => (
      isDefaultPokemonForm(subject)
      && !isMegaPokemonSubject(subject)
      && !isDynamaxPokemonSubject(subject)
      && isStarterPokemonSubject(subject)
    ));
    case 'middle_stage': return values.filter((subject) => (
      isStandardEvolutionSubject(subject) && isMiddleStagePokemonSubject(subject)
    ));
    case 'final_stage': return values.filter((subject) => (
      isStandardEvolutionSubject(subject) && isFinalEvolutionPokemonSubject(subject)
    ));
    case 'legendary': return values.filter((subject) => (
      isDefaultPokemonForm(subject) && isLegendaryPokemonSubject(subject)
    ));
    case 'legendary_mythical': return values.filter((subject) => (
      isDefaultPokemonForm(subject)
      && (isLegendaryPokemonSubject(subject) || isMythicalPokemonSubject(subject))
    ));
    case 'dynamax': return values.filter(isDynamaxPokemonSubject);
    case 'mega': return values.filter(isMegaPokemonSubject);
    case 'final_starter': return values.filter((subject) => (
      isDefaultPokemonForm(subject)
      && !isMegaPokemonSubject(subject)
      && !isDynamaxPokemonSubject(subject)
      && isFinalStarterEvolutionPokemonSubject(subject)
      && isFinalEvolutionPokemonSubject(subject)
    ));
    case 'mega_legendary': return values.filter((subject) => (
      isMegaPokemonSubject(subject)
      || (isDefaultPokemonForm(subject) && isLegendaryPokemonSubject(subject))
    ));
    case 'mixed': return [...values];
    default: return [];
  }
}
