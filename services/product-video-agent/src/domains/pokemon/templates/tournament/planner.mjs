import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  buildPokeQuizzAnimatedShinySpritePath,
  buildPokeQuizzAnimatedSpritePath,
  buildPokeQuizzCryPath,
  buildPokeQuizzMirroredSpritePath,
  buildPokeQuizzPreviewDirectory,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../../../poke-quizz-asset-layout.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
} from '../../../../poke-quizz-asset-inventory.mjs';
import {
  normalizeBaseStats,
  resolveTournamentBattle,
  sumBaseStats,
} from './battle-logic.mjs';

const DEFAULT_PARTICIPANT_COUNT = 4;
const mirroredSpriteAvailabilityCache = new Map();
const cryAvailabilityCache = new Map();
const cryDownloadCache = new Map();
const crySourceUrlCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-tournament')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function readSubjectMetadataValue(subject, keys = []) {
  const metadata = subject?.metadata && typeof subject.metadata === 'object'
    ? subject.metadata
    : {};
  for (const key of keys) {
    if (subject?.[key] !== undefined) {
      return subject[key];
    }
    if (metadata[key] !== undefined) {
      return metadata[key];
    }
  }
  return undefined;
}

function readSubjectPokemonApiMetadata(subject, key) {
  const pokemonApi = subject?.metadata?.pokemon_api && typeof subject.metadata.pokemon_api === 'object'
    ? subject.metadata.pokemon_api
    : {};
  return pokemonApi[key];
}

function isTruthyMetadataFlag(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function estimateCombatantBaseStatTotal(subject) {
  if (Number.isFinite(Number(subject?.base_stat_total))) {
    return Number(subject.base_stat_total);
  }
  return sumBaseStats(normalizeBaseStats(subject?.metadata?.base_stats || subject?.base_stats || {}));
}

function resolveEvolutionStageToken(subject) {
  return String(readSubjectMetadataValue(subject, [
    'evolution_stage',
    'evolutionStage',
  ]) || '').trim().toLowerCase();
}

function isLegendaryLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_legendary',
    'legendary',
    'isLegendary',
    'is_mythical',
    'mythical',
    'isMythical',
  ]))) {
    return true;
  }
  const classification = String(readSubjectMetadataValue(subject, [
    'classification',
    'category',
  ]) || '').trim().toLowerCase();
  return classification === 'legendary' || classification === 'mythical';
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
  const evolutionStage = resolveEvolutionStageToken(subject);
  return evolutionStage === 'final' || evolutionStage === 'fully_evolved';
}

function isFirstStageLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_baby',
    'baby',
    'isBaby',
  ]))) {
    return true;
  }
  const evolutionStage = resolveEvolutionStageToken(subject);
  if ([
    'baby',
    'basic',
    'base',
    'first',
    'first_stage',
    'stage_1',
    'initial',
    'unevolved',
  ].includes(evolutionStage)) {
    return true;
  }
  const evolutionPosition = Number(
    readSubjectMetadataValue(subject, [
      'evolution_chain_position',
      'evolutionChainPosition',
      'evolution_position',
      'evolutionPosition',
      'stage_index',
      'stageIndex',
    ])
      ?? readSubjectPokemonApiMetadata(subject, 'evolution_chain_position')
      ?? NaN,
  );
  return Number.isFinite(evolutionPosition) && evolutionPosition === 1;
}

function isPseudoLegendaryLikeSubject(subject) {
  if (isLegendaryLikeSubject(subject) || !isFinalEvolutionLikeSubject(subject)) {
    return false;
  }
  const baseStatTotal = estimateCombatantBaseStatTotal(subject);
  return baseStatTotal >= 600 && baseStatTotal < 630;
}

function isStrongFinalEvolutionLikeSubject(subject, minimumBaseStatTotal = 500) {
  return !isLegendaryLikeSubject(subject)
    && isFinalEvolutionLikeSubject(subject)
    && estimateCombatantBaseStatTotal(subject) >= minimumBaseStatTotal;
}

async function canAccessPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) {
    return false;
  }
  if (!mirroredSpriteAvailabilityCache.has(normalizedPath)) {
    mirroredSpriteAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath)
        .then(() => true)
        .catch(() => false),
    );
  }
  return mirroredSpriteAvailabilityCache.get(normalizedPath);
}

async function canAccessCryPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) {
    return false;
  }
  if (!cryAvailabilityCache.has(normalizedPath)) {
    cryAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath)
        .then(() => true)
        .catch(() => false),
    );
  }
  return cryAvailabilityCache.get(normalizedPath);
}

async function downloadCryToFile(sourceUrl, outputPath) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Could not download Pokemon cry from ${sourceUrl} (${response.status}).`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  const payload = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, payload);
}

async function resolveTournamentCrySourceUrl(subject = {}) {
  const explicitCrySourceUrl = String(subject?.cry_source_url || '').trim();
  if (explicitCrySourceUrl) {
    return explicitCrySourceUrl;
  }

  const lookupKey = subject?.metadata?.pokemon_api?.pokemon_id
    || subject?.slug
    || subject?.national_dex_number;
  const normalizedLookupKey = String(lookupKey || '').trim().toLowerCase();
  if (!normalizedLookupKey) {
    return '';
  }

  if (!crySourceUrlCache.has(normalizedLookupKey)) {
    crySourceUrlCache.set(normalizedLookupKey, (async () => {
      try {
        const response = await fetch(`https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(normalizedLookupKey)}`);
        if (!response.ok) {
          return '';
        }
        const payload = await response.json();
        return String(payload?.cries?.latest || payload?.cries?.legacy || '').trim();
      } catch {
        return '';
      }
    })());
  }

  return crySourceUrlCache.get(normalizedLookupKey);
}

async function resolveTournamentSpritePath(subject = {}) {
  const explicitAnimatedPath = String(subject?.animated_sprite_path || '').trim();
  if (explicitAnimatedPath) {
    return explicitAnimatedPath;
  }
  const derivedAnimatedPath = buildPokeQuizzAnimatedSpritePath(subject);
  if (derivedAnimatedPath && await canAccessPath(derivedAnimatedPath)) {
    return derivedAnimatedPath;
  }
  const normalizedPath = String(subject?.sprite_path || '').trim();
  if (!normalizedPath) {
    return normalizedPath;
  }
  const mirrorPath = buildPokeQuizzMirroredSpritePath(normalizedPath);
  if (!mirrorPath) {
    return normalizedPath;
  }
  return (await canAccessPath(mirrorPath)) ? mirrorPath : normalizedPath;
}

async function resolveTournamentAnimatedShinySpritePath(subject = {}) {
  const explicitAnimatedPath = String(subject?.shiny_animated_sprite_path || '').trim();
  if (explicitAnimatedPath) {
    return explicitAnimatedPath;
  }
  const derivedAnimatedPath = buildPokeQuizzAnimatedShinySpritePath(subject);
  if (derivedAnimatedPath && await canAccessPath(derivedAnimatedPath)) {
    return derivedAnimatedPath;
  }
  return '';
}

async function resolveTournamentCryPath(subject = {}) {
  const explicitCryPath = String(subject?.cry_path || '').trim();
  if (explicitCryPath && await canAccessCryPath(explicitCryPath)) {
    return explicitCryPath;
  }

  const derivedCryPath = buildPokeQuizzCryPath(subject);
  if (derivedCryPath && await canAccessCryPath(derivedCryPath)) {
    return derivedCryPath;
  }

  const crySourceUrl = String(
    subject?.cry_source_url
    || await resolveTournamentCrySourceUrl(subject)
    || '',
  ).trim();
  if (!crySourceUrl || !derivedCryPath) {
    return explicitCryPath || '';
  }

  if (!cryDownloadCache.has(derivedCryPath)) {
    cryDownloadCache.set(derivedCryPath, (async () => {
      try {
        await downloadCryToFile(crySourceUrl, derivedCryPath);
        cryAvailabilityCache.set(derivedCryPath, Promise.resolve(true));
        return derivedCryPath;
      } catch {
        return explicitCryPath || '';
      }
    })());
  }

  return cryDownloadCache.get(derivedCryPath);
}

function buildTournamentSubjectIdentity(subject = {}) {
  return normalizeSlug(subject?.id || subject?.slug || subject?.name);
}

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function normalizeQuestionTextOptions(primaryText, variants = []) {
  const options = [];
  const normalizedPrimaryText = String(primaryText || '').trim();
  if (normalizedPrimaryText) {
    options.push(normalizedPrimaryText);
  }
  for (const variant of Array.isArray(variants) ? variants : []) {
    const normalizedVariant = String(variant || '').trim();
    if (normalizedVariant && !options.includes(normalizedVariant)) {
      options.push(normalizedVariant);
    }
  }
  return options;
}

function pickSeededQuestionText(primaryText, variants, random, replacements = {}) {
  const options = normalizeQuestionTextOptions(primaryText, variants);
  const rawText = options.length > 0
    ? (options[Math.floor(random() * options.length)] || options[0])
    : '';
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(`{${token}}`, String(value || '').trim()),
    rawText,
  );
}

function buildDisplayName(name) {
  const normalizedName = String(name || '').trim();
  if (normalizedName.length <= 16) {
    return normalizedName;
  }
  const words = normalizedName.split(/\s+/u).filter(Boolean);
  if (words.length > 1) {
    const tail = words.at(-1);
    if (tail.length <= 14) {
      return tail;
    }
  }
  return `${normalizedName.slice(0, 13).trim()}...`;
}

function selectEligibleCombatants(pokedexRows = [], generationScope = []) {
  const generationFilter = new Set(
    (Array.isArray(generationScope) ? generationScope : [])
      .map((value) => Number.parseInt(String(value ?? ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0),
  );
  return (Array.isArray(pokedexRows) ? pokedexRows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => String(row.name || '').trim())
    .filter((row) => Array.isArray(row.types) && row.types.length > 0)
    .filter((row) => String(row.sprite_path || '').trim())
    .filter((row) => {
      const stats = normalizeBaseStats(row?.metadata?.base_stats || {});
      return Object.values(stats).every((value) => Number.isFinite(value) && value > 0);
    })
    .filter((row) => (
      generationFilter.size === 0
      || generationFilter.has(Number.parseInt(String(row.generation || ''), 10))
    ));
}

function collapseDuplicateCombatants(subjects = []) {
  const seen = new Set();
  const unique = [];
  for (const subject of subjects) {
    const key = normalizeSlug(subject.slug || subject.name || subject.id);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(subject);
  }
  return unique;
}

function resolveTournamentPoolVariants(template = {}) {
  const configuredVariants = Array.isArray(template?.selection_rules?.pool_variants)
    ? template.selection_rules.pool_variants
    : [];
  return configuredVariants
    .map((variant, index) => ({
      key: String(variant?.key || `pool-${index + 1}`).trim().toLowerCase(),
      label: String(variant?.label || variant?.key || `Pool ${index + 1}`).trim(),
      selector: String(variant?.selector || variant?.key || 'all').trim().toLowerCase(),
      weight: Math.max(1, Number(variant?.weight) || 1),
      max_base_stat_total_spread: Number.isFinite(Number(variant?.max_base_stat_total_spread))
        ? Number(variant.max_base_stat_total_spread)
        : null,
      max_matchup_base_stat_total_delta: Number.isFinite(Number(variant?.max_matchup_base_stat_total_delta))
        ? Number(variant.max_matchup_base_stat_total_delta)
        : null,
      strong_final_evolution_min_base_stat_total: Number.isFinite(Number(variant?.strong_final_evolution_min_base_stat_total))
        ? Number(variant.strong_final_evolution_min_base_stat_total)
        : 500,
    }))
    .filter((variant) => variant.key);
}

function filterCombatantsForTournamentPool(subjects = [], pool = {}, template = {}) {
  const selector = String(pool?.selector || 'all').trim().toLowerCase();
  const minimumStrongFinalBaseStatTotal = Number.isFinite(Number(pool?.strong_final_evolution_min_base_stat_total))
    ? Number(pool.strong_final_evolution_min_base_stat_total)
    : Number.isFinite(Number(template?.selection_rules?.strong_final_evolution_min_base_stat_total))
      ? Number(template.selection_rules.strong_final_evolution_min_base_stat_total)
      : 500;
  switch (selector) {
    case 'legendary_only':
      return subjects.filter((subject) => isLegendaryLikeSubject(subject));
    case 'final_evolution_only':
      return subjects.filter((subject) => !isLegendaryLikeSubject(subject) && isFinalEvolutionLikeSubject(subject));
    case 'first_stage_only':
    case 'baby_only':
      return subjects.filter((subject) => !isLegendaryLikeSubject(subject) && isFirstStageLikeSubject(subject));
    case 'power_mix':
    case 'mix':
      return subjects.filter((subject) => (
        isLegendaryLikeSubject(subject)
        || isPseudoLegendaryLikeSubject(subject)
        || isStrongFinalEvolutionLikeSubject(subject, minimumStrongFinalBaseStatTotal)
      ));
    case 'all':
    default:
      return [...subjects];
  }
}

function selectWeightedTournamentPool(pools = [], random = Math.random) {
  const availablePools = (Array.isArray(pools) ? pools : []).filter((pool) => (pool?.subjects?.length || 0) > 0);
  if (availablePools.length === 0) {
    return null;
  }
  const totalWeight = availablePools.reduce((sum, pool) => sum + Math.max(1, Number(pool.weight) || 1), 0);
  let cursor = random() * totalWeight;
  for (const pool of availablePools) {
    cursor -= Math.max(1, Number(pool.weight) || 1);
    if (cursor <= 0) {
      return pool;
    }
  }
  return availablePools.at(-1) || null;
}

function resolveTournamentBalanceConfig(template = {}, pool = {}) {
  const selectionRules = template?.selection_rules || {};
  const maxSpread = Number(pool?.max_base_stat_total_spread ?? selectionRules.max_base_stat_total_spread);
  const maxPairDelta = Number(pool?.max_matchup_base_stat_total_delta ?? selectionRules.max_matchup_base_stat_total_delta);
  return {
    max_base_stat_total_spread: Number.isFinite(maxSpread) && maxSpread > 0 ? maxSpread : Number.POSITIVE_INFINITY,
    max_matchup_base_stat_total_delta: Number.isFinite(maxPairDelta) && maxPairDelta > 0 ? maxPairDelta : Number.POSITIVE_INFINITY,
    sampling_attempts: Math.max(24, ensurePositiveInteger(
      pool?.sampling_attempts ?? selectionRules.sampling_attempts,
      160,
    )),
  };
}

function buildBalancedBracketOrder(subjects = [], random = Math.random) {
  const sorted = [...subjects].sort((left, right) => (
    estimateCombatantBaseStatTotal(left) - estimateCombatantBaseStatTotal(right)
  ));
  const pairs = [];
  for (let index = 0; index < sorted.length; index += 2) {
    const pair = sorted.slice(index, index + 2);
    if (pair.length === 0) {
      continue;
    }
    if (pair.length === 2 && random() >= 0.5) {
      pair.reverse();
    }
    pairs.push(pair);
  }
  const orderedPairs = shuffle(pairs, random);
  return orderedPairs.flat();
}

function evaluateBalancedBracketOrder(subjects = []) {
  const baseStatTotals = subjects.map((subject) => estimateCombatantBaseStatTotal(subject));
  const spread = baseStatTotals.length > 0
    ? Math.max(...baseStatTotals) - Math.min(...baseStatTotals)
    : 0;
  const pairDeltas = [];
  for (let index = 0; index < subjects.length - 1; index += 2) {
    pairDeltas.push(Math.abs(
      estimateCombatantBaseStatTotal(subjects[index])
      - estimateCombatantBaseStatTotal(subjects[index + 1]),
    ));
  }
  const maxPairDelta = pairDeltas.length > 0 ? Math.max(...pairDeltas) : 0;
  const totalPairDelta = pairDeltas.reduce((sum, value) => sum + value, 0);
  return {
    spread,
    maxPairDelta,
    totalPairDelta,
  };
}

function selectBalancedCombatants(subjects = [], participantCount, template = {}, pool = {}, random = Math.random) {
  if (!Array.isArray(subjects) || subjects.length <= participantCount) {
    const fallbackSelection = buildBalancedBracketOrder(
      [...subjects].slice(0, participantCount),
      random,
    );
    return {
      selected_subjects: fallbackSelection,
      metrics: evaluateBalancedBracketOrder(fallbackSelection),
    };
  }
  const balanceConfig = resolveTournamentBalanceConfig(template, pool);
  let bestSelection = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < balanceConfig.sampling_attempts; attempt += 1) {
    const sample = shuffle(subjects, random).slice(0, participantCount);
    const orderedSample = buildBalancedBracketOrder(sample, random);
    const metrics = evaluateBalancedBracketOrder(orderedSample);
    const spreadPenalty = Math.max(0, metrics.spread - balanceConfig.max_base_stat_total_spread);
    const pairPenalty = Math.max(0, metrics.maxPairDelta - balanceConfig.max_matchup_base_stat_total_delta);
    const score = (spreadPenalty * 1000) + (pairPenalty * 100) + metrics.totalPairDelta + (metrics.spread * 0.01);
    if (
      metrics.spread <= balanceConfig.max_base_stat_total_spread
      && metrics.maxPairDelta <= balanceConfig.max_matchup_base_stat_total_delta
    ) {
      return {
        selected_subjects: orderedSample,
        metrics,
      };
    }
    if (score < bestScore) {
      bestScore = score;
      bestSelection = {
        selected_subjects: orderedSample,
        metrics,
      };
    }
  }
  const fallbackSelection = buildBalancedBracketOrder(
    shuffle(subjects, random).slice(0, participantCount),
    random,
  );
  return bestSelection || {
    selected_subjects: fallbackSelection,
    metrics: evaluateBalancedBracketOrder(fallbackSelection),
  };
}

function selectBackground(backgrounds = [], random, selectionState = {}) {
  const usableBackgrounds = (Array.isArray(backgrounds) ? backgrounds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !value.toLowerCase().includes('/archived-backgrounds/'));
  if (usableBackgrounds.length === 0) {
    return '';
  }
  const lastBackground = String(selectionState?.last_background_path || '').trim().toLowerCase();
  const filteredBackgrounds = usableBackgrounds.filter((value) => value.toLowerCase() !== lastBackground);
  const pool = filteredBackgrounds.length > 0 ? filteredBackgrounds : usableBackgrounds;
  return pool[Math.floor(random() * pool.length)] || pool[0];
}

function selectPreferredSoundEffectPath(soundEffects = {}, config = {}, fallbackOverride = null) {
  if (config?.enabled === false) {
    return null;
  }
  const fallbackPath = fallbackOverride ?? soundEffects.timer_end ?? soundEffects.ding ?? null;
  const preferredKeywords = (Array.isArray(config?.preferred_keywords)
    ? config.preferred_keywords
    : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (preferredKeywords.length === 0) {
    return fallbackPath;
  }
  return (Array.isArray(soundEffects.all) ? soundEffects.all : [])
    .find((filePath) => {
      const normalizedPath = String(filePath || '').trim().toLowerCase();
      return preferredKeywords.every((keyword) => normalizedPath.includes(keyword));
    }) || fallbackPath;
}

function selectIntroSlotRevealSoundPath(soundEffects = {}, config = {}) {
  if (config?.enabled === false) {
    return null;
  }
  const preferredKeywords = (Array.isArray(config?.preferred_keywords)
    ? config.preferred_keywords
    : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const matchedPreferred = (Array.isArray(soundEffects.all) ? soundEffects.all : [])
    .find((filePath) => {
      const normalizedPath = String(filePath || '').trim().toLowerCase();
      return preferredKeywords.every((keyword) => normalizedPath.includes(keyword));
    });
  return matchedPreferred || soundEffects.pokeball_intro || null;
}

function resolveTournamentAnimatedShinyConfig(template = {}) {
  const selectionRules = template?.selection_rules || {};
  const probability = Number(selectionRules.animated_shiny_probability);
  return {
    probability: Number.isFinite(probability)
      ? Math.max(0, Math.min(1, probability))
      : 0.5,
    max_participants: Math.max(
      0,
      ensurePositiveInteger(selectionRules.max_animated_shiny_participants, 1),
    ),
  };
}

async function selectTournamentRenderSpritePlans(subjects = [], template = {}, random = Math.random) {
  const spritePlans = await Promise.all((Array.isArray(subjects) ? subjects : []).map(async (subject) => ({
    subject,
    key: buildTournamentSubjectIdentity(subject),
    normal_path: await resolveTournamentSpritePath(subject),
    shiny_animated_path: await resolveTournamentAnimatedShinySpritePath(subject),
  })));
  const config = resolveTournamentAnimatedShinyConfig(template);
  if (config.max_participants <= 0 || config.probability <= 0) {
    return spritePlans.map((plan) => ({
      ...plan,
      render_path: plan.normal_path,
      uses_shiny_render_sprite: false,
    }));
  }
  const shinyCandidates = spritePlans.filter((plan) => plan.key && plan.shiny_animated_path);
  const selectedShinyKeys = new Set();
  if (shinyCandidates.length > 0 && random() < config.probability) {
    shuffle(shinyCandidates, random)
      .slice(0, Math.min(config.max_participants, shinyCandidates.length))
      .forEach((plan) => selectedShinyKeys.add(plan.key));
  }
  return spritePlans.map((plan) => {
    const usesShinyRenderSprite = Boolean(plan.key) && selectedShinyKeys.has(plan.key);
    return {
      ...plan,
      render_path: usesShinyRenderSprite
        ? (plan.shiny_animated_path || plan.normal_path)
        : plan.normal_path,
      uses_shiny_render_sprite: usesShinyRenderSprite,
    };
  });
}

function buildParticipantRecord(subject, renderSpritePath, cryPath, bracketSeedIndex, options = {}) {
  const baseStats = normalizeBaseStats(subject?.metadata?.base_stats || {});
  return {
    id: String(subject.id || '').trim(),
    bracket_seed_index: bracketSeedIndex,
    pokedex_id: String(subject.id || '').trim(),
    national_dex_number: Number(subject.national_dex_number),
    name: String(subject.name || '').trim(),
    display_name: buildDisplayName(subject.name),
    generation: Number(subject.generation),
    region: String(subject.region || '').trim(),
    slug: String(subject.slug || '').trim(),
    types: Array.isArray(subject.types) ? [...subject.types] : [],
    sprite_path: String(subject.sprite_path || '').trim(),
    shiny_sprite_path: String(subject.shiny_sprite_path || '').trim(),
    animated_sprite_path: String(subject.animated_sprite_path || '').trim(),
    shiny_animated_sprite_path: String(
      options.shiny_animated_sprite_path
      || subject.shiny_animated_sprite_path
      || '',
    ).trim(),
    render_sprite_path: String(renderSpritePath || subject.sprite_path || '').trim(),
    uses_shiny_render_sprite: Boolean(options.uses_shiny_render_sprite),
    cry_path: String(cryPath || subject.cry_path || '').trim(),
    cry_source_url: subject.cry_source_url || null,
    sprite_source_url: subject.sprite_source_url || null,
    base_stats: baseStats,
    base_stat_total: sumBaseStats(baseStats),
    metadata: {
      evolution_stage: subject?.metadata?.evolution_stage || null,
      is_final_evolution: Boolean(subject?.metadata?.is_final_evolution),
      is_legendary: Boolean(subject?.metadata?.is_legendary),
      is_mythical: Boolean(subject?.metadata?.is_mythical),
    },
  };
}

function buildMatchRecord({
  matchId,
  roundKey,
  roundLabel,
  left,
  right,
  template,
  random,
}) {
  const battle = resolveTournamentBattle({
    left,
    right,
    weights: template?.selection_rules?.battle_weights || {},
    random,
    matchId,
    roundLabel,
  });
  return {
    match_id: matchId,
    round_key: roundKey,
    round_label: roundLabel,
    participant_a: battle.left,
    participant_b: battle.right,
    winner: battle.winner,
    loser: battle.loser,
    winner_side: battle.winner_side,
    intro_line_text: battle.intro_line_text,
    insight_text: battle.insight_text,
    breakdown_text: battle.breakdown_text,
    commentary_text: battle.commentary_text,
    winner_line_text: battle.winner_line_text,
    score_cards: battle.score_cards,
  };
}

function buildNarrationLines(template, hookText, matches, champion, random) {
  const championText = pickSeededQuestionText(
    template?.question_contract?.champion_text,
    template?.question_contract?.champion_text_variants,
    random,
    { champion_name: champion.display_name },
  );
  return [
    { role: 'hook', text: hookText },
    ...matches.flatMap((match) => ([
      { role: `${match.match_id}-intro`, text: match.intro_line_text },
      { role: `${match.match_id}-insight`, text: match.insight_text },
      { role: `${match.match_id}-winner`, text: match.winner_line_text },
    ])),
    { role: 'champion', text: championText },
  ].filter((line) => String(line.text || '').trim());
}

function buildTimeline(template, hookText, matches, championText) {
  const rounds = template?.layout?.rounds || {};
  const hookHoldSeconds = Number(rounds.hook_hold_seconds ?? 1.1);
  const matchIntroHoldSeconds = Number(rounds.match_intro_hold_seconds ?? 1.8);
  const suspenseHoldSeconds = Number(rounds.suspense_hold_seconds ?? 0.9);
  const revealHoldSeconds = Number(rounds.reveal_hold_seconds ?? 1.2);
  const transitionDurationSeconds = Number(rounds.transition_duration_seconds ?? 0.4);
  const championHoldSeconds = Number(rounds.champion_hold_seconds ?? 1.1);
  return [
    {
      phase: 'hook',
      duration_seconds: hookHoldSeconds,
      spoken_text: hookText,
      on_screen_text: hookText,
    },
    ...matches.map((match, index) => ({
      phase: match.round_key,
      match_id: match.match_id,
      duration_seconds: matchIntroHoldSeconds + suspenseHoldSeconds + revealHoldSeconds + (
        index === matches.length - 1 ? 0 : transitionDurationSeconds
      ),
      spoken_text: `${match.intro_line_text} ${match.insight_text} ${match.winner_line_text}`.trim(),
      on_screen_text: match.breakdown_text,
    })),
    {
      phase: 'champion',
      duration_seconds: championHoldSeconds,
      spoken_text: championText,
      on_screen_text: championText,
    },
  ];
}

export async function planPokemonTournamentChallenge({
  template,
  pokedexRows,
  seed = 'pokemon-tournament',
  assetInventory = null,
  selectionState = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const participantCount = ensurePositiveInteger(
    template?.selection_rules?.participant_count,
    DEFAULT_PARTICIPANT_COUNT,
  );
  const eligibleCombatants = collapseDuplicateCombatants(
    selectEligibleCombatants(pokedexRows, template?.selection_rules?.generation_scope || []),
  );

  if (eligibleCombatants.length < participantCount) {
    throw new Error(`Tournament requires at least ${participantCount} Pokemon with local sprites and base stats, found ${eligibleCombatants.length}.`);
  }
  const configuredPools = resolveTournamentPoolVariants(template);
  const availablePools = configuredPools
    .map((pool) => ({
      ...pool,
      subjects: collapseDuplicateCombatants(filterCombatantsForTournamentPool(eligibleCombatants, pool, template)),
    }))
    .filter((pool) => pool.subjects.length >= participantCount);
  const selectedPool = selectWeightedTournamentPool(availablePools, random) || {
    key: 'all',
    label: 'All Combatants',
    selector: 'all',
    weight: 1,
    subjects: eligibleCombatants,
  };
  const balancedSelection = selectBalancedCombatants(
    selectedPool.subjects,
    participantCount,
    template,
    selectedPool,
    random,
  );
  const selectedSubjects = balancedSelection.selected_subjects;
  const renderSpritePlans = await selectTournamentRenderSpritePlans(
    selectedSubjects,
    template,
    random,
  );
  const participants = await Promise.all(renderSpritePlans.map(async ({ subject, render_path, shiny_animated_path, uses_shiny_render_sprite }, index) => (
    buildParticipantRecord(
      subject,
      render_path,
      await resolveTournamentCryPath(subject),
      index,
      {
        shiny_animated_sprite_path: shiny_animated_path,
        uses_shiny_render_sprite,
      },
    )
  )));

  const semiFinalOne = buildMatchRecord({
    matchId: 'semi-final-1',
    roundKey: 'semi_final',
    roundLabel: 'Semi Final 1',
    left: participants[0],
    right: participants[1],
    template,
    random,
  });
  const semiFinalTwo = buildMatchRecord({
    matchId: 'semi-final-2',
    roundKey: 'semi_final',
    roundLabel: 'Semi Final 2',
    left: participants[2],
    right: participants[3],
    template,
    random,
  });
  const finalMatch = buildMatchRecord({
    matchId: 'final',
    roundKey: 'final',
    roundLabel: 'Final',
    left: semiFinalOne.winner,
    right: semiFinalTwo.winner,
    template,
    random,
  });
  const matches = [semiFinalOne, semiFinalTwo, finalMatch];
  const champion = finalMatch.winner;
  const hookText = pickSeededQuestionText(
    template?.question_contract?.hook_text,
    template?.question_contract?.hook_text_variants,
    random,
  );
  const championText = pickSeededQuestionText(
    template?.question_contract?.champion_text,
    template?.question_contract?.champion_text_variants,
    random,
    { champion_name: champion.display_name },
  );
  const tournamentBackgroundPool = (
    Array.isArray(inventory?.battle_backgrounds) && inventory.battle_backgrounds.length > 0
      ? inventory.battle_backgrounds
      : inventory.backgrounds
  );
  const tournamentBackgroundDirectory = (
    Array.isArray(inventory?.battle_backgrounds) && inventory.battle_backgrounds.length > 0
      ? POKE_QUIZZ_ASSET_LAYOUT.battleBackgrounds
      : POKE_QUIZZ_ASSET_LAYOUT.backgrounds
  );
  const selectedBackgroundPath = selectBackground(
    tournamentBackgroundPool,
    random,
    normalizedSelectionState,
  );
  const introPokeballOverlayPath = (
    inventory?.overlay_presets?.pokeball_primary
    || inventory?.overlay_presets?.pokeball_open_close
    || null
  );
  const disappearOverlayPath = inventory?.overlay_presets?.disappear || null;
  const grassPlateauOverlayPath = inventory?.overlay_presets?.grass_plateau || null;
  const versusOverlayPath = inventory?.overlay_presets?.versus || null;
  const introSlotRevealSoundPath = selectIntroSlotRevealSoundPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.intro_slot_reveal || {},
  );
  const winnerRevealSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.winner_reveal || {},
  );
  const statsRevealSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.stats_reveal || {},
    inventory?.sound_effects?.stats_reveal || null,
  );
  const bracketProgressSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.bracket_progress || {},
    null,
  );
  const disappearSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.disappear || {},
    inventory?.sound_effects?.disappear || null,
  );

  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('background_missing');
  if (!inventory.music.length) requiredAssetGaps.push('battle_intro_music_missing');
  if (
    template?.audio?.sound_effects?.intro_slot_reveal?.enabled !== false
    && !introSlotRevealSoundPath
  ) {
    requiredAssetGaps.push('intro_slot_reveal_sfx_missing');
  }
  if (
    template?.audio?.sound_effects?.winner_reveal?.enabled !== false
    && !winnerRevealSoundPath
  ) {
    requiredAssetGaps.push('winner_reveal_sfx_missing');
  }
  if (
    template?.audio?.sound_effects?.stats_reveal?.enabled !== false
    && !statsRevealSoundPath
  ) {
    requiredAssetGaps.push('stats_reveal_sfx_missing');
  }
  if (
    template?.audio?.sound_effects?.bracket_progress?.enabled !== false
    && !bracketProgressSoundPath
  ) {
    requiredAssetGaps.push('bracket_progress_sfx_missing');
  }
  if (
    template?.audio?.sound_effects?.disappear?.enabled !== false
    && !disappearSoundPath
  ) {
    requiredAssetGaps.push('disappear_sfx_missing');
  }
  if (!disappearOverlayPath) {
    requiredAssetGaps.push('disappear_overlay_missing');
  }
  if (!participants.every((participant) => participant.render_sprite_path || participant.sprite_path)) {
    requiredAssetGaps.push('pokemon_sprite_local_assets_missing');
  }
  if (!participants.every((participant) => String(participant.cry_path || '').trim())) {
    requiredAssetGaps.push('pokemon_cries_missing');
  }

  return {
    schema_version: 'poke-quizz-tournament-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_tournament',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'single_elimination_bracket').trim().toLowerCase() || 'single_elimination_bracket',
      participant_count: participants.length,
      round_count: matches.length,
      pool_key: selectedPool.key,
      pool_label: selectedPool.label,
      pool_selector: selectedPool.selector,
      animated_shiny_participant_count: participants.filter((participant) => participant.uses_shiny_render_sprite).length,
      balance: {
        base_stat_total_spread: balancedSelection.metrics?.spread ?? null,
        max_matchup_base_stat_total_delta: balancedSelection.metrics?.maxPairDelta ?? null,
        total_pair_delta: balancedSelection.metrics?.totalPairDelta ?? null,
      },
      selected_subject_count: participants.length,
      selected_subjects: participants.map((participant) => ({
        pokedex_id: participant.pokedex_id,
        national_dex_number: participant.national_dex_number,
        name: participant.name,
        generation: participant.generation,
        region: participant.region,
        types: participant.types,
        base_stat_total: participant.base_stat_total,
        uses_shiny_render_sprite: participant.uses_shiny_render_sprite,
      })),
    },
    tournament: {
      participants,
      matches,
      champion,
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: buildNarrationLines(template, hookText, matches, champion, random),
    },
    timeline: buildTimeline(template, hookText, matches, championText),
    assets: {
      background: {
        expected_directory: tournamentBackgroundDirectory,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        available_paths: inventory?.overlays || [],
        selected_intro_pokeball_path: introPokeballOverlayPath,
        selected_disappear_path: disappearOverlayPath,
        selected_grass_plateau_path: grassPlateauOverlayPath,
        selected_versus_path: versusOverlayPath,
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        cries_directory: POKE_QUIZZ_ASSET_LAYOUT.cries,
        selected_battle_intro_music_path: selectSeededFile(inventory?.music || [], random),
        selected_sound_effects: {
          ...(inventory?.sound_effects || {}),
          intro_slot_reveal: introSlotRevealSoundPath,
          bracket_progress: bracketProgressSoundPath,
          winner_reveal: winnerRevealSoundPath,
          stats_reveal: statsRevealSoundPath,
          disappear: disappearSoundPath,
        },
      },
      outputs: {
        previews_directory: buildPokeQuizzPreviewDirectory(template),
        masters_directory: POKE_QUIZZ_ASSET_LAYOUT.masters,
      },
    },
    selection_state: {
      last_background_path: selectedBackgroundPath || null,
    },
    asset_inventory_snapshot: inventory,
    required_asset_gaps: [...new Set(requiredAssetGaps)],
  };
}
