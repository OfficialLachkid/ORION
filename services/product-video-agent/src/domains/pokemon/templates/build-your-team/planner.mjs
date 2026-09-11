import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  buildPokeQuizzAnimatedShinySpritePath,
  buildPokeQuizzAnimatedSpritePath,
  buildPokeQuizzCryPath,
  buildPokeQuizzMirroredSpritePath,
  buildPokeQuizzPreviewDirectory,
  buildPokeQuizzShinySpritePath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../../../poke-quizz-asset-layout.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
} from '../../../../poke-quizz-asset-inventory.mjs';
import { normalizeBaseStats } from '../tournament/battle-logic.mjs';

const DEFAULT_ROUND_COUNT = 6;
const DEFAULT_CANDIDATE_COUNT = 4;
const DEFAULT_REVEAL_HOLD_SECONDS = 0.75;
const DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS = 0.18;
const DEFAULT_TRANSITION_DURATION_SECONDS = 0.42;
const DEFAULT_FINAL_HOLD_SECONDS = 1;
const DEFAULT_SAMPLING_ATTEMPTS = 120;
const DEFAULT_SHINY_CHANCE_PER_CANDIDATE = 0;
const DEFAULT_MAX_SHINY_PER_ROUND = 1;

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

const STARTER_POKEMON_SPECIES_SLUGS = new Set([
  'bulbasaur',
  'charmander',
  'squirtle',
  'chikorita',
  'cyndaquil',
  'totodile',
  'treecko',
  'torchic',
  'mudkip',
  'turtwig',
  'chimchar',
  'piplup',
  'snivy',
  'tepig',
  'oshawott',
  'chespin',
  'fennekin',
  'froakie',
  'rowlet',
  'litten',
  'popplio',
  'grookey',
  'scorbunny',
  'sobble',
  'sprigatito',
  'fuecoco',
  'quaxly',
]);

const readablePathAvailabilityCache = new Map();
const cryDownloadCache = new Map();
const crySourceUrlCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'build-your-team')) {
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

function ensureFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensurePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

async function canAccessPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) {
    return false;
  }
  if (!readablePathAvailabilityCache.has(normalizedPath)) {
    readablePathAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath)
        .then(() => true)
        .catch(() => false),
    );
  }
  return readablePathAvailabilityCache.get(normalizedPath);
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeSubjectSlug(subject) {
  return String(
    readSubjectPokemonApiMetadata(subject, 'pokemon_name')
    || subject?.slug
    || subject?.name
    || '',
  ).trim().toLowerCase();
}

function normalizeSubjectSpeciesSlug(subject) {
  return normalizeSlug(
    readSubjectPokemonApiMetadata(subject, 'species_name')
    || subject?.species_slug
    || subject?.metadata?.species_slug
    || readSubjectPokemonApiMetadata(subject, 'pokemon_name')
    || subject?.slug
    || subject?.name
    || '',
  );
}

function readSubjectPokemonApiMetadata(subject, key) {
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
    if (subject?.[key] !== undefined) {
      return subject[key];
    }
    if (metadata[key] !== undefined) {
      return metadata[key];
    }
  }
  return undefined;
}

function isTruthyMetadataFlag(value) {
  if (value === true) return true;
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function readEvolutionStage(subject) {
  return String(readSubjectMetadataValue(subject, [
    'evolution_stage',
    'evolutionStage',
  ]) || '').trim().toLowerCase();
}

function readEvolutionPosition(subject) {
  const value = readSubjectMetadataValue(subject, [
    'evolution_chain_position',
    'evolutionChainPosition',
    'evolution_position',
    'evolutionPosition',
    'stage_index',
    'stageIndex',
  ]) ?? readSubjectPokemonApiMetadata(subject, 'evolution_chain_position');
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

function isStarterLikeSubject(subject) {
  return STARTER_POKEMON_SPECIES_SLUGS.has(normalizeSubjectSpeciesSlug(subject));
}

function isMegaLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_mega',
    'mega',
    'isMega',
  ]))) {
    return true;
  }
  if (readSubjectPokemonApiMetadata(subject, 'is_mega') === true) {
    return true;
  }
  const slug = normalizeSubjectSlug(subject);
  const formName = String(readSubjectPokemonApiMetadata(subject, 'form_name') || '').trim().toLowerCase();
  return slug.includes('-mega')
    || slug.includes('mega-')
    || slug.startsWith('mega-')
    || formName.includes('mega');
}

function isFirstStageLikeSubject(subject) {
  if (isBabyLikeSubject(subject)) {
    return false;
  }
  const evolutionStage = readEvolutionStage(subject);
  if ([
    'base',
    'basic',
    'first',
    'first_stage',
    'stage_1',
    'stage1',
    'initial',
    'unevolved',
  ].includes(evolutionStage)) {
    return true;
  }
  return readEvolutionPosition(subject) === 1;
}

function isMiddleStageLikeSubject(subject) {
  const evolutionStage = readEvolutionStage(subject);
  if ([
    'middle',
    'mid',
    'second',
    'second_stage',
    'stage_2',
    'stage2',
  ].includes(evolutionStage)) {
    return true;
  }
  return readEvolutionPosition(subject) === 2
    && !isFinalEvolutionLikeSubject(subject);
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
  const evolutionStage = readEvolutionStage(subject);
  return evolutionStage === 'final' || evolutionStage === 'fully_evolved';
}

function isLegendaryOrMythicalLikeSubject(subject) {
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
  const formName = String(readSubjectPokemonApiMetadata(subject, 'form_name') || '').trim().toLowerCase();
  const slug = normalizeSubjectSlug(subject);
  return formName === 'dynamax'
    || formName === 'gigantamax'
    || slug.includes('dynamax')
    || slug.includes('gigantamax')
    || slug.endsWith('-gmax');
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
  const templateText = options.length > 0
    ? (options[Math.floor(random() * options.length)] || options[0])
    : '';
  return Object.entries(replacements).reduce(
    (text, [token, value]) => text.replaceAll(`{${token}}`, String(value || '').trim()),
    templateText,
  );
}

function selectEligibleSubjects(pokedexRows = [], generationScope = []) {
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
    .filter((row) => (
      generationFilter.size === 0
      || generationFilter.has(Number.parseInt(String(row.generation || ''), 10))
    ));
}

function collapseDuplicateSubjects(subjects = []) {
  const seen = new Set();
  const unique = [];
  for (const subject of subjects) {
    const key = normalizeSlug(subject.slug || subject.name || subject.id || subject.sprite_path);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(subject);
  }
  return unique;
}

function resolveBuildYourTeamPoolVariants(template = {}) {
  const configuredVariants = Array.isArray(template?.selection_rules?.pool_variants)
    ? template.selection_rules.pool_variants
    : [];
  return configuredVariants
    .map((variant, index) => ({
      key: String(variant?.key || `pool-${index + 1}`).trim().toLowerCase(),
      label: String(variant?.label || variant?.key || `Pool ${index + 1}`).trim(),
      selector: String(variant?.selector || variant?.key || 'all').trim().toLowerCase(),
      weight: Math.max(1, ensurePositiveInteger(variant?.weight, 1)),
    }))
    .filter((variant) => variant.key);
}

function filterSubjectsForBuildYourTeamPool(subjects = [], pool = {}) {
  const selector = String(pool?.selector || 'all').trim().toLowerCase();
  switch (selector) {
    case 'baby':
    case 'baby_only':
    case 'baby_pokemon':
      return subjects.filter((subject) => isBabyLikeSubject(subject));
    case 'first_stage':
    case 'first_stage_only':
    case 'first_stage_evolutions':
      return subjects.filter((subject) => (
        !isLegendaryOrMythicalLikeSubject(subject)
        && !isMegaLikeSubject(subject)
        && !isDynamaxLikeSubject(subject)
        && !isStarterLikeSubject(subject)
        && isFirstStageLikeSubject(subject)
      ));
    case 'starter':
    case 'starter_only':
    case 'starter_pokemon':
      return subjects.filter((subject) => (
        !isMegaLikeSubject(subject)
        && !isDynamaxLikeSubject(subject)
        && isStarterLikeSubject(subject)
      ));
    case 'middle_stage':
    case 'middle_stage_only':
    case 'middle_stage_evolutions':
      return subjects.filter((subject) => (
        !isLegendaryOrMythicalLikeSubject(subject)
        && !isMegaLikeSubject(subject)
        && !isDynamaxLikeSubject(subject)
        && isMiddleStageLikeSubject(subject)
      ));
    case 'final_stage':
    case 'final_stage_only':
    case 'final_stage_evolutions':
      return subjects.filter((subject) => (
        !isLegendaryOrMythicalLikeSubject(subject)
        && !isMegaLikeSubject(subject)
        && !isDynamaxLikeSubject(subject)
        && isFinalEvolutionLikeSubject(subject)
      ));
    case 'legendary_mythical':
    case 'legendary_or_mythical':
      return subjects.filter((subject) => isLegendaryOrMythicalLikeSubject(subject));
    case 'dynamax':
    case 'dynamax_pokemon':
    case 'gigantamax':
      return subjects.filter((subject) => isDynamaxLikeSubject(subject));
    case 'all':
    default:
      return [...subjects];
  }
}

function buildRoundPoolSequence(template, eligibleSubjects, candidateCount, roundCount, random) {
  const configuredPools = resolveBuildYourTeamPoolVariants(template);
  const viablePools = configuredPools.map((pool) => {
    const subjects = collapseDuplicateSubjects(filterSubjectsForBuildYourTeamPool(eligibleSubjects, pool));
    return subjects.length >= candidateCount
      ? { ...pool, subjects, fallback: false }
      : {
        ...pool,
        subjects: eligibleSubjects,
        fallback: true,
        fallback_subject_count: subjects.length,
      };
  });
  const pools = viablePools.length > 0
    ? viablePools
    : [{
      key: 'all',
      label: 'All Pokemon',
      selector: 'all',
      weight: 1,
      subjects: eligibleSubjects,
      fallback: false,
    }];
  const shuffledPools = shuffle(pools, random);
  const sequence = [];
  while (sequence.length < roundCount) {
    sequence.push(shuffledPools[sequence.length % shuffledPools.length]);
  }
  return sequence;
}

function buildTypeDisplay(types = []) {
  return (Array.isArray(types) ? types : [])
    .map((type) => String(type || '').trim())
    .filter(Boolean);
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

function resolveBackgroundPool(inventory = {}) {
  const pixelBackgrounds = Array.isArray(inventory.pixel_backgrounds)
    ? inventory.pixel_backgrounds
    : [];
  if (pixelBackgrounds.length > 0) {
    return {
      backgrounds: pixelBackgrounds,
      expected_directory: POKE_QUIZZ_ASSET_LAYOUT.pixelBackgrounds,
    };
  }
  return {
    backgrounds: inventory.backgrounds || [],
    expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
  };
}

function selectTemplateScopedSound(template, inventory, configKey, fallbackKey) {
  const entry = template?.audio?.sound_effects?.[configKey] || {};
  if (entry?.enabled === false) {
    return null;
  }
  const soundEffects = inventory?.sound_effects || {};
  const preferredKeywords = (Array.isArray(entry?.preferred_keywords) ? entry.preferred_keywords : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  const fallbackPath = soundEffects[fallbackKey] || null;
  if (preferredKeywords.length === 0) {
    return fallbackPath;
  }
  return (Array.isArray(soundEffects.all) ? soundEffects.all : [])
    .find((filePath) => {
      const normalizedPath = String(filePath || '').trim().toLowerCase();
      return preferredKeywords.every((keyword) => normalizedPath.includes(keyword));
    }) || fallbackPath;
}

function shouldUseStaticPokeballSprites(template) {
  return String(template?.renderer?.held_pokeball_source || '')
    .trim()
    .toLowerCase() === 'random_static_sprite';
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

async function resolveBuildYourTeamCrySourceUrl(subject = {}) {
  const explicitCrySourceUrl = String(subject?.cry_source_url || '').trim();
  if (explicitCrySourceUrl) {
    return explicitCrySourceUrl;
  }

  const lookupKey = readSubjectPokemonApiMetadata(subject, 'pokemon_id')
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

async function resolveShinyRenderSpritePath(subject) {
  const explicitAnimatedPath = String(subject?.shiny_animated_sprite_path || '').trim();
  if (explicitAnimatedPath && await canAccessPath(explicitAnimatedPath)) {
    return explicitAnimatedPath;
  }

  const derivedAnimatedPath = buildPokeQuizzAnimatedShinySpritePath(subject);
  if (derivedAnimatedPath && await canAccessPath(derivedAnimatedPath)) {
    return derivedAnimatedPath;
  }

  const explicitSpritePath = String(subject?.shiny_sprite_path || '').trim();
  if (explicitSpritePath && await canAccessPath(explicitSpritePath)) {
    return explicitSpritePath;
  }

  const derivedSpritePath = buildPokeQuizzShinySpritePath(subject);
  if (derivedSpritePath && await canAccessPath(derivedSpritePath)) {
    return derivedSpritePath;
  }

  return '';
}

async function resolveNormalRenderSpritePath(subject) {
  const explicitAnimatedPath = String(subject?.animated_sprite_path || '').trim();
  if (explicitAnimatedPath && await canAccessPath(explicitAnimatedPath)) {
    return explicitAnimatedPath;
  }

  const derivedAnimatedPath = buildPokeQuizzAnimatedSpritePath(subject);
  if (derivedAnimatedPath && await canAccessPath(derivedAnimatedPath)) {
    return derivedAnimatedPath;
  }

  const mirroredSharpSpritePath = buildPokeQuizzMirroredSpritePath(subject?.sprite_path || '');
  if (mirroredSharpSpritePath && await canAccessPath(mirroredSharpSpritePath)) {
    return mirroredSharpSpritePath;
  }

  return String(subject?.sprite_path || '').trim();
}

async function resolveRenderSpriteAsset(subject, { shiny = false } = {}) {
  if (shiny) {
    const shinySpritePath = await resolveShinyRenderSpritePath(subject);
    if (shinySpritePath) {
      return {
        path: shinySpritePath,
        variant: 'shiny',
      };
    }
  }

  return {
    path: await resolveNormalRenderSpritePath(subject),
    variant: 'normal',
  };
}

async function resolveCryPath(subject) {
  const explicitCryPath = String(subject?.cry_path || '').trim();
  if (explicitCryPath && await canAccessPath(explicitCryPath)) {
    return explicitCryPath;
  }

  const derivedCryPath = buildPokeQuizzCryPath(subject);
  if (derivedCryPath && await canAccessPath(derivedCryPath)) {
    return derivedCryPath;
  }

  const crySourceUrl = String(
    subject?.cry_source_url
    || await resolveBuildYourTeamCrySourceUrl(subject)
    || '',
  ).trim();
  if (!crySourceUrl || !derivedCryPath) {
    return explicitCryPath || '';
  }

  if (!cryDownloadCache.has(derivedCryPath)) {
    cryDownloadCache.set(derivedCryPath, (async () => {
      try {
        await downloadCryToFile(crySourceUrl, derivedCryPath);
        readablePathAvailabilityCache.set(derivedCryPath, Promise.resolve(true));
        return derivedCryPath;
      } catch {
        return explicitCryPath || '';
      }
    })());
  }

  return cryDownloadCache.get(derivedCryPath);
}

function sanitizeSubject(subject, renderSpritePath, cryPath, {
  isShinyVariant = false,
} = {}) {
  const baseStats = normalizeBaseStats(subject?.metadata?.base_stats || subject?.base_stats || {});
  return {
    id: String(subject?.id || '').trim() || normalizeSlug(subject?.slug || subject?.name),
    pokedex_id: subject?.id || null,
    national_dex_number: subject?.national_dex_number,
    name: subject?.name,
    display_name: subject?.name,
    slug: subject?.slug || normalizeSlug(subject?.name),
    generation: subject?.generation,
    region: subject?.region || null,
    sprite_path: String(subject?.sprite_path || '').trim(),
    animated_sprite_path: String(subject?.animated_sprite_path || '').trim(),
    shiny_sprite_path: String(subject?.shiny_sprite_path || '').trim(),
    shiny_animated_sprite_path: String(subject?.shiny_animated_sprite_path || '').trim(),
    render_sprite_path: renderSpritePath,
    render_variant: isShinyVariant ? 'shiny' : 'normal',
    is_shiny_variant: isShinyVariant,
    sprite_source_url: subject?.sprite_source_url || null,
    types: buildTypeDisplay(subject?.types || []),
    base_stats: baseStats,
    cry_path: cryPath,
    cry_source_url: subject?.cry_source_url || null,
    metadata: {
      ...(subject?.metadata || {}),
      base_stats: baseStats,
    },
  };
}

function selectShinyCandidateIndexes({ candidateCount, template, random }) {
  const shinyChance = clampNumber(
    ensureFiniteNumber(
      template?.selection_rules?.shiny_chance_per_candidate,
      DEFAULT_SHINY_CHANCE_PER_CANDIDATE,
    ),
    0,
    1,
  );
  const maxShinyPerRound = Math.max(
    0,
    ensurePositiveInteger(
      template?.selection_rules?.max_shiny_per_round,
      DEFAULT_MAX_SHINY_PER_ROUND,
    ),
  );
  if (shinyChance <= 0 || maxShinyPerRound <= 0 || candidateCount <= 0) {
    return new Set();
  }

  const selectedIndexes = [];
  for (const candidateIndex of shuffle(
    Array.from({ length: candidateCount }, (_unused, index) => index),
    random,
  )) {
    if (random() >= shinyChance) {
      continue;
    }
    selectedIndexes.push(candidateIndex);
    if (selectedIndexes.length >= maxShinyPerRound) {
      break;
    }
  }
  return new Set(selectedIndexes);
}

function chooseSamplePool(subjects, usedSubjectIds, candidateCount) {
  const freshPool = subjects.filter((subject) => !usedSubjectIds.has(
    String(subject?.id || subject?.slug || subject?.name || '').trim(),
  ));
  return freshPool.length >= candidateCount ? freshPool : subjects;
}

function selectRoundCandidates({
  subjects,
  candidateCount,
  attempts,
  random,
  usedSubjectIds,
}) {
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const samplePool = chooseSamplePool(subjects, usedSubjectIds, candidateCount);
    const sample = shuffle(samplePool, random).slice(0, candidateCount);
    if (sample.length < candidateCount) {
      break;
    }
    best = { sample };
    break;
  }
  return best;
}

function buildTimeline(rounds) {
  const timeline = [];
  for (const round of rounds) {
    timeline.push({
      phase: `round_${round.round_number}_prompt`,
      duration_seconds: round.scene_lead_seconds,
      spoken_text: round.spoken_prompt_text || round.prompt_text,
      on_screen_text: round.prompt_text,
    });
    timeline.push({
      phase: `round_${round.round_number}_countdown`,
      duration_seconds: round.countdown_duration_seconds,
      countdown_from: round.countdown_from,
      countdown_to: round.countdown_to,
    });
  }
  return timeline;
}

export async function planPokemonBuildYourTeamChallenge({
  template,
  pokedexRows,
  seed = 'build-your-team',
  assetInventory = null,
  selectionState = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const roundCount = ensurePositiveInteger(
    template?.selection_rules?.round_count,
    DEFAULT_ROUND_COUNT,
  );
  const candidateCount = ensurePositiveInteger(
    template?.selection_rules?.candidate_count,
    DEFAULT_CANDIDATE_COUNT,
  );
  const countdownFrom = ensurePositiveNumber(template?.layout?.timer?.countdown_from, 4);
  const countdownTo = Number.parseInt(String(template?.layout?.timer?.countdown_to ?? 0), 10);
  const eligibleSubjects = collapseDuplicateSubjects(
    selectEligibleSubjects(pokedexRows, template?.selection_rules?.generation_scope || []),
  );
  if (eligibleSubjects.length < candidateCount) {
    throw new Error(`Build Your Team requires at least ${candidateCount} Pokemon with local sprites, found ${eligibleSubjects.length}.`);
  }

  const backgroundPool = resolveBackgroundPool(inventory);
  const selectedBackgroundPath = selectBackground(
    backgroundPool.backgrounds,
    random,
    normalizedSelectionState,
  );
  const selectedTimerEndSoundPath = selectTemplateScopedSound(template, inventory, 'timer_end', 'timer_end');
  const selectedPokeballIntroSoundPath = selectTemplateScopedSound(template, inventory, 'pokeball_intro', 'pokeball_intro');
  const selectedIntroRevealSoundPath = selectTemplateScopedSound(template, inventory, 'intro_slot_reveal', 'pokeball_intro');
  const staticPokeballSpritesRequested = shouldUseStaticPokeballSprites(template);
  const pokeballSpritePool = Array.isArray(inventory?.pokeball_sprites)
    ? inventory.pokeball_sprites
    : [];
  const shinyEffectConfig = template?.reveal?.shiny || {};
  const shinyEffectsRequested = shinyEffectConfig?.enabled !== false;
  const selectedShinySoundPath = shinyEffectsRequested
    ? selectTemplateScopedSound(
      template,
      inventory,
      shinyEffectConfig.sound_effect_role || 'shiny',
      'shiny',
    )
    : null;
  const selectedShinySparklePath = shinyEffectsRequested
    ? inventory?.overlay_presets?.[shinyEffectConfig.sparkle_overlay_role || 'shiny_sparkle'] || null
    : null;
  const configuredRevealHoldSeconds = Number(template?.layout?.rounds?.reveal_hold_seconds ?? DEFAULT_REVEAL_HOLD_SECONDS);
  const preCountdownHoldSeconds = Number(template?.layout?.rounds?.pre_countdown_hold_seconds ?? DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS);
  const transitionDurationSeconds = Number(template?.layout?.rounds?.transition_duration_seconds ?? DEFAULT_TRANSITION_DURATION_SECONDS);
  const finalHoldSeconds = Number(template?.layout?.rounds?.final_hold_seconds ?? DEFAULT_FINAL_HOLD_SECONDS);
  const introInitialDelaySeconds = ensureFiniteNumber(
    template?.renderer?.candidate_intro_initial_delay_seconds,
    0.1,
  );
  const introStaggerSeconds = ensureFiniteNumber(
    template?.renderer?.candidate_intro_stagger_seconds,
    0.16,
  );
  const introDurationSeconds = ensureFiniteNumber(
    template?.renderer?.candidate_intro_duration_seconds,
    0.22,
  );
  const introPokeballLeadSeconds = ensureFiniteNumber(
    template?.renderer?.intro_pokeball_lead_seconds,
    0.18,
  );
  const candidateIntroAnchor = String(template?.renderer?.candidate_intro_anchor || 'activation').trim().toLowerCase();
  const candidateIntroWindowSeconds = Number((
    introInitialDelaySeconds
    + Math.max(0, candidateCount - 1) * introStaggerSeconds
    + introPokeballLeadSeconds
    + introDurationSeconds
  ).toFixed(3));
  const sceneLeadSeconds = Number((
    (candidateIntroAnchor === 'reveal' ? 0 : candidateIntroWindowSeconds)
    + preCountdownHoldSeconds
  ).toFixed(3));
  const revealHoldSeconds = Number(Math.max(
    configuredRevealHoldSeconds,
    candidateIntroAnchor === 'reveal' ? candidateIntroWindowSeconds + 1.05 : configuredRevealHoldSeconds,
  ).toFixed(3));
  const samplingAttempts = ensurePositiveInteger(
    template?.selection_rules?.sampling_attempts_per_round,
    DEFAULT_SAMPLING_ATTEMPTS,
  );
  const roundPools = buildRoundPoolSequence(template, eligibleSubjects, candidateCount, roundCount, random);
  const usedSubjectIds = new Set();
  const rounds = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const pool = roundPools[roundIndex] || roundPools[0];
    const selection = selectRoundCandidates({
      subjects: pool.subjects,
      candidateCount,
      attempts: samplingAttempts,
      random,
      usedSubjectIds,
    });
    if (!selection || !Array.isArray(selection.sample) || selection.sample.length < candidateCount) {
      throw new Error(`Build Your Team could not find ${candidateCount} Pokemon for ${pool.label}.`);
    }

    const candidateRevealOrder = shuffle(
      Array.from({ length: candidateCount }, (_unused, index) => index),
      random,
    );
    const shinyCandidateIndexes = selectShinyCandidateIndexes({
      candidateCount,
      template,
      random,
    });
    const resolvedSubjects = await Promise.all(selection.sample.map(async (subject, index) => {
      const [renderSpriteAsset, cryPath] = await Promise.all([
        resolveRenderSpriteAsset(subject, { shiny: shinyCandidateIndexes.has(index) }),
        resolveCryPath(subject),
      ]);
      return sanitizeSubject(subject, renderSpriteAsset.path, cryPath, {
        isShinyVariant: renderSpriteAsset.variant === 'shiny',
      });
    }));
    resolvedSubjects.forEach((subject) => usedSubjectIds.add(subject.id));

    const promptText = pickSeededQuestionText(
      template?.question_contract?.prompt_text,
      template?.question_contract?.prompt_text_variants,
      random,
      { pool_label: pool.label },
    );
    const spokenPromptText = promptText.replace(/\band\b/giu, 'and');
    const finalPromptText = roundIndex === roundCount - 1
      ? pickSeededQuestionText(
        template?.question_contract?.final_prompt_text,
        template?.question_contract?.final_prompt_text_variants,
        random,
      )
      : '';
    const candidates = resolvedSubjects.map((subject, index) => ({
      index,
      label: String.fromCharCode(65 + index),
      is_correct: false,
      subject,
      pokeball_sprite_path: staticPokeballSpritesRequested
        ? selectSeededFile(pokeballSpritePool, random)
        : null,
    }));

    rounds.push({
      round_number: roundIndex + 1,
      round_label: `${roundIndex + 1}/${roundCount}`,
      pool_key: pool.key,
      pool_label: pool.label,
      pool_selector: pool.selector,
      pool_fallback: pool.fallback === true,
      pool_original_subject_count: pool.fallback_subject_count ?? pool.subjects.length,
      prompt_text: promptText,
      spoken_prompt_text: spokenPromptText,
      reveal_text: finalPromptText,
      scene_lead_seconds: sceneLeadSeconds,
      countdown_from: countdownFrom,
      countdown_to: countdownTo,
      countdown_duration_seconds: countdownFrom,
      reveal_hold_seconds: revealHoldSeconds,
      transition_duration_seconds: roundIndex === roundCount - 1 ? 0 : transitionDurationSeconds,
      final_hold_seconds: roundIndex === roundCount - 1 ? finalHoldSeconds : 0,
      candidate_reveal_order: candidateRevealOrder,
      candidates,
    });
  }

  const uniqueSelectedSubjects = [];
  const seenSelectedSubjectIds = new Set();
  for (const round of rounds) {
    for (const candidate of round.candidates) {
      if (seenSelectedSubjectIds.has(candidate.subject.id)) {
        continue;
      }
      seenSelectedSubjectIds.add(candidate.subject.id);
      uniqueSelectedSubjects.push(candidate.subject);
    }
  }

  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('background_missing');
  if (!inventory?.sound_effects?.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!selectedTimerEndSoundPath) requiredAssetGaps.push('timer_end_sfx_missing');
  if (!selectedPokeballIntroSoundPath) requiredAssetGaps.push('pokeball_intro_sfx_missing');
  if (!selectedIntroRevealSoundPath) requiredAssetGaps.push('intro_slot_reveal_sfx_missing');
  if (!inventory?.overlay_presets?.grass_plateau) requiredAssetGaps.push('grass_plateau_overlay_missing');
  if (!inventory?.overlay_presets?.pokeball_primary) requiredAssetGaps.push('intro_pokeball_overlay_missing');
  if (staticPokeballSpritesRequested && pokeballSpritePool.length === 0) {
    requiredAssetGaps.push('pokeball_sprite_overlays_missing');
  }
  const shinyCandidateCount = rounds.reduce((count, round) => (
    count + round.candidates.filter((candidate) => candidate.subject.is_shiny_variant).length
  ), 0);
  const shinyEffectsActive = shinyEffectsRequested && shinyCandidateCount > 0;
  if (shinyEffectsActive && !selectedShinySparklePath) requiredAssetGaps.push('shiny_sparkle_overlay_missing');
  if (shinyEffectsActive && !selectedShinySoundPath) requiredAssetGaps.push('shiny_sfx_missing');

  return {
    schema_version: 'poke-quizz-build-your-team-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_build_your_team',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'team_builder').trim().toLowerCase() || 'team_builder',
      round_count: roundCount,
      candidate_count: candidateCount,
      pool_order_mode: String(template?.selection_rules?.pool_order_mode || 'shuffle_each_once').trim(),
      pool_keys: rounds.map((round) => round.pool_key),
      pool_labels: rounds.map((round) => round.pool_label),
      pool_fallback_count: rounds.filter((round) => round.pool_fallback).length,
      selected_subject_count: uniqueSelectedSubjects.length,
      display_subject_count: roundCount * candidateCount,
      selected_subjects: uniqueSelectedSubjects,
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: rounds.map((round) => ({
        role: `round-${round.round_number}-prompt`,
        text: round.spoken_prompt_text || round.prompt_text,
      })),
    },
    timeline: buildTimeline(rounds),
    rounds,
    shiny_reveal: {
      active: shinyEffectsActive,
      mode: 'candidate_spawn',
      shiny_candidate_count: shinyCandidateCount,
      sparkle_overlay_path: selectedShinySparklePath,
      sound_effect_path: selectedShinySoundPath,
      sparkle_duration_seconds: ensurePositiveNumber(
        shinyEffectConfig.sparkle_duration_seconds,
        0.9,
      ),
      sparkle_scale_multiplier: ensurePositiveNumber(
        shinyEffectConfig.sparkle_scale_multiplier,
        1.35,
      ),
      sound_volume_multiplier: ensurePositiveNumber(
        shinyEffectConfig.sound_volume_multiplier,
        1,
      ),
    },
    assets: {
      background: {
        expected_directory: backgroundPool.expected_directory,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        pokeball_sprites_expected_directory: POKE_QUIZZ_ASSET_LAYOUT.pokeballSprites,
        selected_grass_plateau_path: inventory?.overlay_presets?.grass_plateau || null,
        selected_intro_pokeball_path: inventory?.overlay_presets?.pokeball_primary || null,
        selected_shiny_sparkle_path: selectedShinySparklePath,
        selected_pokeball_sprite_paths: [...new Set(rounds.flatMap((round) => (
          round.candidates
            .map((candidate) => candidate.pokeball_sprite_path)
            .filter(Boolean)
        )))],
        available_paths: inventory?.overlays || [],
        available_pokeball_sprite_paths: pokeballSpritePool,
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        cries_directory: POKE_QUIZZ_ASSET_LAYOUT.cries,
        selected_battle_intro_music_path: selectSeededFile(inventory?.music || [], random),
        selected_sound_effects: {
          ...(inventory?.sound_effects || {}),
          countdown_tick: inventory?.sound_effects?.countdown_tick || null,
          timer_end: selectedTimerEndSoundPath,
          pokeball_intro: selectedPokeballIntroSoundPath,
          intro_slot_reveal: selectedIntroRevealSoundPath,
          shiny: selectedShinySoundPath,
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
