const BABY_POKEMON_SPECIES_SLUGS = new Set([
  'pichu',
  'cleffa',
  'igglybuff',
  'togepi',
  'tyrogue',
  'smoochum',
  'elekid',
  'magby',
  'azurill',
  'wynaut',
  'budew',
  'chingling',
  'bonsly',
  'mime-jr',
  'happiny',
  'munchlax',
  'riolu',
  'mantyke',
  'toxel',
]);

const FINAL_STARTER_EVOLUTION_SPECIES_SLUGS = new Set([
  'venusaur',
  'charizard',
  'blastoise',
  'meganium',
  'typhlosion',
  'feraligatr',
  'sceptile',
  'blaziken',
  'swampert',
  'torterra',
  'infernape',
  'empoleon',
  'serperior',
  'emboar',
  'samurott',
  'chesnaught',
  'delphox',
  'greninja',
  'decidueye',
  'incineroar',
  'primarina',
  'rillaboom',
  'cinderace',
  'inteleon',
  'meowscarada',
  'skeledirge',
  'quaquaval',
]);

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function readPokemonApiMetadata(subject, key) {
  const pokemonApi = subject?.metadata?.pokemon_api && typeof subject.metadata.pokemon_api === 'object'
    ? subject.metadata.pokemon_api
    : {};
  return pokemonApi[key];
}

function readSubjectMetadataValue(subject, keys = []) {
  const metadata = subject?.metadata && typeof subject.metadata === 'object'
    ? subject.metadata
    : {};
  for (const key of keys) {
    if (subject?.[key] !== undefined) return subject[key];
    if (metadata[key] !== undefined) return metadata[key];
    const pokemonApiValue = readPokemonApiMetadata(subject, key);
    if (pokemonApiValue !== undefined) return pokemonApiValue;
  }
  return undefined;
}

function isTruthyMetadataFlag(value) {
  if (value === true) return true;
  const normalized = normalizeSlug(value);
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function normalizeSubjectSlug(subject) {
  return normalizeSlug(
    readPokemonApiMetadata(subject, 'pokemon_name')
    || subject?.slug
    || subject?.name,
  );
}

function normalizeSubjectSpeciesSlug(subject) {
  return normalizeSlug(
    readPokemonApiMetadata(subject, 'species_name')
    || subject?.species_slug
    || subject?.metadata?.species_slug
    || readPokemonApiMetadata(subject, 'pokemon_name')
    || subject?.slug
    || subject?.name,
  );
}

function readEvolutionStage(subject) {
  return normalizeSlug(readSubjectMetadataValue(subject, [
    'evolution_stage',
    'evolutionStage',
  ]));
}

function readEvolutionPosition(subject) {
  const value = readSubjectMetadataValue(subject, [
    'evolution_chain_position',
    'evolutionChainPosition',
    'evolution_position',
    'evolutionPosition',
    'stage_index',
    'stageIndex',
  ]);
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBabyLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_baby',
    'baby',
    'isBaby',
  ]))) {
    return true;
  }
  return readEvolutionStage(subject) === 'baby'
    || BABY_POKEMON_SPECIES_SLUGS.has(normalizeSubjectSpeciesSlug(subject));
}

function isMegaLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_mega',
    'mega',
    'isMega',
  ]))) {
    return true;
  }
  const slug = normalizeSubjectSlug(subject);
  const formName = normalizeSlug(readPokemonApiMetadata(subject, 'form_name'));
  return slug.includes('-mega')
    || slug.includes('mega-')
    || slug.startsWith('mega-')
    || formName.includes('mega');
}

function isDynamaxLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_dynamax',
    'dynamax',
    'isDynamax',
    'is_gigantamax',
    'gigantamax',
    'isGigantamax',
  ]))) {
    return true;
  }
  const slug = normalizeSubjectSlug(subject);
  const formName = normalizeSlug(readPokemonApiMetadata(subject, 'form_name'));
  return formName === 'dynamax'
    || formName === 'gigantamax'
    || slug.includes('dynamax')
    || slug.includes('gigantamax')
    || slug.endsWith('-gmax');
}

function isLegendaryLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_legendary',
    'legendary',
    'isLegendary',
  ]))) {
    return true;
  }
  return normalizeSlug(readSubjectMetadataValue(subject, [
    'classification',
    'category',
  ])) === 'legendary';
}

function isMythicalLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_mythical',
    'mythical',
    'isMythical',
  ]))) {
    return true;
  }
  return normalizeSlug(readSubjectMetadataValue(subject, [
    'classification',
    'category',
  ])) === 'mythical';
}

function isFirstStageLikeSubject(subject) {
  if (isBabyLikeSubject(subject)) return false;
  if ([
    'base',
    'basic',
    'first',
    'first_stage',
    'stage_1',
    'stage1',
    'initial',
    'unevolved',
  ].includes(readEvolutionStage(subject))) {
    return true;
  }
  return readEvolutionPosition(subject) === 1;
}

function isFinalEvolutionLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_final_evolution',
    'final_evolution',
    'isFinalEvolution',
    'is_fully_evolved',
    'fully_evolved',
    'isFullyEvolved',
  ]))) {
    return true;
  }
  return ['final', 'fully_evolved'].includes(readEvolutionStage(subject));
}

function isMiddleStageLikeSubject(subject) {
  if ([
    'middle',
    'mid',
    'second',
    'second_stage',
    'stage_2',
    'stage2',
  ].includes(readEvolutionStage(subject))) {
    return true;
  }
  return readEvolutionPosition(subject) === 2
    && !isFinalEvolutionLikeSubject(subject);
}

function isFinalStarterEvolutionLikeSubject(subject) {
  const speciesSlug = normalizeSubjectSpeciesSlug(subject);
  const subjectSlug = normalizeSubjectSlug(subject);
  return FINAL_STARTER_EVOLUTION_SPECIES_SLUGS.has(speciesSlug)
    || [...FINAL_STARTER_EVOLUTION_SPECIES_SLUGS]
      .some((starterSlug) => subjectSlug === starterSlug || subjectSlug.startsWith(`${starterSlug}-`));
}

function isStandardEvolutionSubject(subject) {
  return !isLegendaryLikeSubject(subject)
    && !isMythicalLikeSubject(subject)
    && !isMegaLikeSubject(subject)
    && !isDynamaxLikeSubject(subject);
}

export function filterSubjectsForCryMatchPool(subjects = [], pool = {}) {
  const selector = normalizeSlug(pool?.selector || 'all');
  switch (selector) {
    case 'legendary':
    case 'legendary_only':
      return subjects.filter((subject) => isLegendaryLikeSubject(subject));
    case 'final_stage':
    case 'final_stage_only':
    case 'final_stage_evolutions':
      return subjects.filter((subject) => (
        isStandardEvolutionSubject(subject)
        && isFinalEvolutionLikeSubject(subject)
      ));
    case 'middle_stage':
    case 'middle_stage_only':
    case 'middle_stage_evolutions':
      return subjects.filter((subject) => (
        isStandardEvolutionSubject(subject)
        && isMiddleStageLikeSubject(subject)
      ));
    case 'first_stage':
    case 'first_stage_only':
    case 'first_stage_evolutions':
      return subjects.filter((subject) => (
        isStandardEvolutionSubject(subject)
        && isFirstStageLikeSubject(subject)
      ));
    case 'baby':
    case 'baby_only':
    case 'baby_pokemon':
      return subjects.filter((subject) => isBabyLikeSubject(subject));
    case 'mega':
    case 'mega_only':
    case 'mega_pokemon':
      return subjects.filter((subject) => isMegaLikeSubject(subject));
    case 'dynamax':
    case 'dynamax_only':
    case 'dynamax_pokemon':
    case 'gigantamax':
      return subjects.filter((subject) => isDynamaxLikeSubject(subject));
    case 'final_starter':
    case 'final_starter_evolutions':
    case 'last_stage_starter_evolutions':
      return subjects.filter((subject) => (
        !isMegaLikeSubject(subject)
        && !isDynamaxLikeSubject(subject)
        && isFinalStarterEvolutionLikeSubject(subject)
        && isFinalEvolutionLikeSubject(subject)
      ));
    case 'mixed':
    case 'all':
    default:
      return [...subjects];
  }
}

function collapseDuplicateSubjects(subjects = []) {
  const seen = new Set();
  const unique = [];
  for (const subject of subjects) {
    const key = normalizeSlug(subject?.slug || subject?.name || subject?.id || subject?.sprite_path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(subject);
  }
  return unique;
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePoolVariants(template = {}) {
  const variants = Array.isArray(template?.selection_rules?.pool_variants)
    ? template.selection_rules.pool_variants
    : [];
  return variants
    .map((variant, index) => ({
      key: normalizeSlug(variant?.key || `pool-${index + 1}`),
      label: String(variant?.label || variant?.key || `Pool ${index + 1}`).trim(),
      selector: normalizeSlug(variant?.selector || variant?.key || 'all'),
      weight: Math.max(1, ensurePositiveInteger(variant?.weight, 1)),
    }))
    .filter((variant) => variant.key);
}

function selectWeightedPool(pools, random) {
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);
  let cursor = random() * totalWeight;
  for (const pool of pools) {
    cursor -= pool.weight;
    if (cursor <= 0) return pool;
  }
  return pools.at(-1) || null;
}

export function selectCryMatchRoundPools({
  eligibleSubjects,
  template,
  candidateCount,
  roundCount,
  random = Math.random,
}) {
  const configuredPools = resolvePoolVariants(template);
  const forcedPoolKey = normalizeSlug(
    template?.selection_rules?.force_pool_key
    || template?.selection_rules?.forced_pool_key,
  );
  const evaluatedPools = configuredPools.map((pool) => ({
    ...pool,
    subjects: collapseDuplicateSubjects(filterSubjectsForCryMatchPool(eligibleSubjects, pool)),
  }));

  if (forcedPoolKey) {
    const forcedPool = evaluatedPools.find((pool) => (
      pool.key === forcedPoolKey || pool.selector === forcedPoolKey
    ));
    if (!forcedPool) {
      throw new Error(`Cry Match pool override "${forcedPoolKey}" does not match a configured pool.`);
    }
    if (forcedPool.subjects.length < candidateCount) {
      throw new Error(
        `Cry Match pool override "${forcedPoolKey}" only has ${forcedPool.subjects.length} eligible Pokemon; ${candidateCount} required.`,
      );
    }
    return Array.from(
      { length: Math.max(1, ensurePositiveInteger(roundCount, 1)) },
      () => ({ ...forcedPool, forced: true }),
    );
  }

  const viablePools = evaluatedPools.filter((pool) => pool.subjects.length >= candidateCount);
  const fallbackPool = {
    key: 'mixed',
    label: 'Mixed Pokemon',
    selector: 'all',
    weight: 1,
    subjects: collapseDuplicateSubjects(eligibleSubjects),
    forced: false,
  };
  const pools = viablePools.length > 0 ? viablePools : [fallbackPool];
  const sequence = [];
  let remainingPools = [];
  const targetRoundCount = Math.max(1, ensurePositiveInteger(roundCount, 1));
  while (sequence.length < targetRoundCount) {
    if (remainingPools.length === 0) remainingPools = [...pools];
    const previousPoolKey = sequence.at(-1)?.key || '';
    const selectablePools = previousPoolKey && remainingPools.length > 1
      ? remainingPools.filter((pool) => pool.key !== previousPoolKey)
      : remainingPools;
    const selectedPool = selectWeightedPool(selectablePools, random) || fallbackPool;
    sequence.push({ ...selectedPool, forced: false });
    remainingPools = remainingPools.filter((pool) => pool.key !== selectedPool.key);
  }
  return sequence;
}

export function selectCryMatchSubjectPool(options) {
  return selectCryMatchRoundPools({ ...options, roundCount: 1 })[0];
}
