import { access } from 'node:fs/promises';
import { createTypePairKey, DISALLOWED_TYPE_PAIR_KEYS, normalizeTypePair } from '../../../../pokemon-type-pairs.mjs';
import {
  buildPokeQuizzPreviewDirectory,
  buildPokeQuizzMirroredSpritePath,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../../../poke-quizz-asset-layout.mjs';
import {
  createPokeQuizzVideoSignatureKey,
  normalizePokeQuizzSelectionState,
} from '../../../../poke-quizz-selection-state.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
} from '../../../../poke-quizz-asset-inventory.mjs';

const TYPE_THEMED_BACKGROUND_FOLDER_HINTS = Object.freeze({
  fire: ['fire-backgrounds'],
  ground: ['cave-backgrounds'],
  ice: ['ice-backgrounds'],
  rock: ['cave-backgrounds'],
  water: ['beach-backgrounds'],
});
const TYPE_THEMED_BACKGROUND_PRIORITY = Object.freeze([
  'ice',
  'ground',
  'rock',
  'fire',
  'water',
]);
const DEFAULT_SPARKLE_DURATION_SECONDS = 0.9;
const DEFAULT_SPARKLE_SCALE_MULTIPLIER = 1.35;
const DEFAULT_SPRITE_SCALE_MULTIPLIER = 1.08;
const DEFAULT_MIN_ITEM_SIZE_PX = 148;
const HP_BAR_TIMER_DISPLAY_MODE = 'hp_bar_depletion';
const NUMERIC_TIMER_DISPLAY_MODE = 'numeric_with_small_ring';
const DEFAULT_POKEBALL_WIGGLE_WINDOW_START_RATIO = 0.12;
const DEFAULT_POKEBALL_WIGGLE_WINDOW_END_RATIO = 0.76;
const DEFAULT_POKEBALL_INTRO_DURATION_SECONDS = 0.56;
const DEFAULT_POKEBALL_INTRO_STAGGER_SECONDS = 0.32;
const mirroredSpriteAvailabilityCache = new Map();

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

async function resolveFindTheShinySpritePath(spritePath) {
  const normalizedPath = String(spritePath || '').trim();
  if (!normalizedPath) {
    return normalizedPath;
  }
  const mirrorPath = buildPokeQuizzMirroredSpritePath(normalizedPath);
  if (!mirrorPath) {
    return normalizedPath;
  }
  return (await canAccessPath(mirrorPath)) ? mirrorPath : normalizedPath;
}

function isBeachBackgroundPath(backgroundPath) {
  return String(backgroundPath || '').toLowerCase().includes('/beach-backgrounds/');
}

function isFireBackgroundPath(backgroundPath) {
  return String(backgroundPath || '').toLowerCase().includes('/fire-backgrounds/');
}

function isCaveBackgroundPath(backgroundPath) {
  return String(backgroundPath || '').toLowerCase().includes('/cave-backgrounds/');
}

function isIceBackgroundPath(backgroundPath) {
  return String(backgroundPath || '').toLowerCase().includes('/ice-backgrounds/');
}

function isArchivedBackgroundPath(backgroundPath) {
  return String(backgroundPath || '').toLowerCase().includes('/archived-backgrounds/');
}

function isThemedBackgroundPath(backgroundPath) {
  return isBeachBackgroundPath(backgroundPath)
    || isCaveBackgroundPath(backgroundPath)
    || isIceBackgroundPath(backgroundPath)
    || isFireBackgroundPath(backgroundPath);
}

function resolveThemedBackgroundPriority(normalizedTypes = []) {
  const selectedTypes = new Set(normalizedTypes);
  if (selectedTypes.has('ice')) {
    return [
      'ice',
      ...TYPE_THEMED_BACKGROUND_PRIORITY.filter((typeName) => typeName !== 'ice' && selectedTypes.has(typeName)),
    ];
  }
  const prioritizedTypes = TYPE_THEMED_BACKGROUND_PRIORITY
    .filter((typeName) => selectedTypes.has(typeName));

  if (selectedTypes.has('fire') && (selectedTypes.has('ground') || selectedTypes.has('rock'))) {
    return [
      'fire',
      ...prioritizedTypes.filter((typeName) => typeName !== 'fire'),
    ];
  }

  return prioritizedTypes;
}

function normalizeAssetPath(assetPath) {
  return String(assetPath || '').trim().replaceAll('\\', '/').toLowerCase();
}

function resolveTimerDisplayMode(template) {
  const normalizedMode = String(template?.layout?.timer?.display_mode || '')
    .trim()
    .toLowerCase();
  return normalizedMode === HP_BAR_TIMER_DISPLAY_MODE
    ? HP_BAR_TIMER_DISPLAY_MODE
    : NUMERIC_TIMER_DISPLAY_MODE;
}

function selectHpBarTimerOverlay(inventory) {
  return inventory?.overlay_presets?.long_hp_bar
    || inventory?.overlay_presets?.hp_bar
    || null;
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function roundRatio(value) {
  return Number(Number(value || 0).toFixed(4));
}

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-default-seed')) {
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

function sampleArray(values, count, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items.slice(0, count);
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

function pickSeededQuestionText(primaryText, variants, random) {
  const options = normalizeQuestionTextOptions(primaryText, variants);
  if (!options.length) {
    return '';
  }
  return options[Math.floor(random() * options.length)];
}

function buildSpreadOffsetRatios(count, random) {
  const safeCount = Math.max(1, ensurePositiveInteger(count, 1));
  const stratifiedOffsets = Array.from({ length: safeCount }, (_, index) => roundRatio(
    (index + 0.2 + (random() * 0.6)) / safeCount,
  ));
  return sampleArray(stratifiedOffsets, safeCount, random);
}

function resolveQuestionContractTexts(template, random) {
  const questionContract = template?.question_contract && typeof template.question_contract === 'object'
    ? template.question_contract
    : {};
  return {
    hook: pickSeededQuestionText(
      questionContract.hook_text,
      questionContract.hook_text_variants,
      random,
    ),
    prompt: pickSeededQuestionText(
      questionContract.type_prompt_text,
      questionContract.type_prompt_text_variants,
      random,
    ),
    reveal: pickSeededQuestionText(
      questionContract.reveal_text,
      questionContract.reveal_text_variants,
      random,
    ),
  };
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

  const evolutionStage = String(readSubjectMetadataValue(subject, [
    'evolution_stage',
    'evolutionStage',
  ]) || '').trim().toLowerCase();
  return evolutionStage === 'final' || evolutionStage === 'fully_evolved';
}

function normalizeSubjectSlug(subject) {
  return String(
    readSubjectPokemonApiMetadata(subject, 'pokemon_name')
    || subject?.slug
    || '',
  ).trim().toLowerCase();
}

function isMegaLikeSubject(subject) {
  if (isTruthyMetadataFlag(readSubjectMetadataValue(subject, [
    'is_mega',
    'isMega',
  ]))) {
    return true;
  }
  if (readSubjectPokemonApiMetadata(subject, 'is_mega') === true) {
    return true;
  }
  return normalizeSubjectSlug(subject).includes('-mega');
}

function isGigantamaxLikeSubject(subject) {
  const formName = String(
    readSubjectPokemonApiMetadata(subject, 'form_name')
    || readSubjectMetadataValue(subject, ['form_name', 'formName'])
    || '',
  ).trim().toLowerCase();
  return formName === 'gigantamax' || normalizeSubjectSlug(subject).endsWith('-gmax');
}

function isDefaultFormLikeSubject(subject) {
  if (subject?.is_default_form === true) {
    return true;
  }
  return readSubjectPokemonApiMetadata(subject, 'is_default_form') === true;
}

function isBattleOnlyLikeSubject(subject) {
  return readSubjectPokemonApiMetadata(subject, 'is_battle_only') === true;
}

function subjectVariantPriority(subject) {
  if (isMegaLikeSubject(subject)) {
    return 0;
  }
  if (isDefaultFormLikeSubject(subject) && !isGigantamaxLikeSubject(subject)) {
    return 1;
  }
  if (!isBattleOnlyLikeSubject(subject) && !isGigantamaxLikeSubject(subject)) {
    return 2;
  }
  if (isGigantamaxLikeSubject(subject)) {
    return 3;
  }
  if (isBattleOnlyLikeSubject(subject)) {
    return 4;
  }
  return 5;
}

function comparePreferredSubjectVariant(left, right) {
  const variantPriority = subjectVariantPriority(left) - subjectVariantPriority(right);
  if (variantPriority !== 0) {
    return variantPriority;
  }

  const leftOrder = Number(readSubjectPokemonApiMetadata(left, 'order') || Number.MAX_SAFE_INTEGER);
  const rightOrder = Number(readSubjectPokemonApiMetadata(right, 'order') || Number.MAX_SAFE_INTEGER);
  if (leftOrder !== rightOrder) {
    return leftOrder - rightOrder;
  }

  const leftFormOrder = Number(readSubjectPokemonApiMetadata(left, 'form_order') || Number.MAX_SAFE_INTEGER);
  const rightFormOrder = Number(readSubjectPokemonApiMetadata(right, 'form_order') || Number.MAX_SAFE_INTEGER);
  if (leftFormOrder !== rightFormOrder) {
    return leftFormOrder - rightFormOrder;
  }

  return String(left.slug || '').localeCompare(String(right.slug || ''));
}

function collapseSubjectVariants(subjects = []) {
  const groupedSubjects = new Map();

  for (const subject of subjects || []) {
    const groupKey = String(subject?.national_dex_number || subject?.id || '').trim();
    if (!groupKey) {
      continue;
    }
    if (!groupedSubjects.has(groupKey)) {
      groupedSubjects.set(groupKey, []);
    }
    groupedSubjects.get(groupKey).push(subject);
  }

  return [...groupedSubjects.values()]
    .map((variants) => [...variants].sort(comparePreferredSubjectVariant)[0])
    .sort((left, right) => (
      (left.national_dex_number - right.national_dex_number)
      || String(left.slug || '').localeCompare(String(right.slug || ''))
    ));
}

function subjectSelectionPriority(subject) {
  if (isLegendaryLikeSubject(subject)) {
    return 0;
  }
  if (isFinalEvolutionLikeSubject(subject)) {
    return 1;
  }
  return 2;
}

function prioritizeSelectableSubjects(subjects, random) {
  const buckets = [[], [], []];
  for (const subject of subjects || []) {
    buckets[subjectSelectionPriority(subject)].push(subject);
  }
  return buckets.flatMap((bucket) => sampleArray(bucket, bucket.length, random));
}

function buildDifficultyCatalog(template) {
  const configuredLevels = template?.layout?.sprite_grid?.difficulty_levels || {};
  const difficultyWeights = template?.layout?.sprite_grid?.difficulty_weights || {};
  return Object.entries(configuredLevels)
    .map(([difficultyId, entry]) => {
      const rows = ensurePositiveInteger(entry?.rows, 0);
      const columns = ensurePositiveInteger(entry?.columns, 0);
      const spriteCount = ensurePositiveInteger(entry?.sprite_count, rows * columns);
      return {
        id: difficultyId,
        rows,
        columns,
        sprite_count: spriteCount,
        weight: Math.max(1, ensurePositiveInteger(difficultyWeights[difficultyId], 1)),
      };
    })
    .filter((entry) => entry.rows > 0 && entry.columns > 0 && entry.sprite_count > 0);
}

function chooseDifficulty(difficultyCatalog, random) {
  if (!Array.isArray(difficultyCatalog) || difficultyCatalog.length === 0) {
    throw new Error('Find the Shiny requires at least one configured sprite-grid difficulty level.');
  }

  const weightedDifficultyPool = difficultyCatalog.flatMap((entry) => (
    Array.from({ length: entry.weight }, () => entry)
  ));
  return weightedDifficultyPool[Math.floor(random() * weightedDifficultyPool.length)] || difficultyCatalog[0];
}

function getTemplateSelectionConfig(template) {
  const typePairPolicy = template.selection_rules?.type_pair_policy || {};
  const configuredGenerationScope = Array.isArray(template.selection_rules?.generation_scope)
    ? template.selection_rules.generation_scope
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  return {
    generationScope: configuredGenerationScope.length > 0 ? configuredGenerationScope : null,
    disallowedPairs: new Set(
      (typePairPolicy.disallowed_type_pairs || [])
        .map((pair) => createTypePairKey(pair)),
    ),
    minCatalogMatches: Number(typePairPolicy.min_catalog_matches || 1),
    difficultyCatalog: buildDifficultyCatalog(template),
  };
}

function buildPairCatalog(rows, config) {
  const pairCatalog = new Map();

  for (const row of rows) {
    if (Array.isArray(config.generationScope) && !config.generationScope.includes(row.generation)) continue;
    if (!row.national_dex_number || !row.name || !Array.isArray(row.types)) continue;
    if (row.types.length !== 2) continue;
    if (!row.sprite_path || !row.shiny_sprite_path) continue;

    const pair = normalizeTypePair(row.types);
    const pairKey = createTypePairKey(pair);
    if (DISALLOWED_TYPE_PAIR_KEYS.has(pairKey) || config.disallowedPairs.has(pairKey)) {
      continue;
    }

    const existing = pairCatalog.get(pairKey) || { pair, matches: [] };
    existing.matches.push(row);
    pairCatalog.set(pairKey, existing);
  }

  return [...pairCatalog.values()]
    .filter((entry) => entry.matches.length >= config.minCatalogMatches)
    .sort((left, right) => left.pair.join('|').localeCompare(right.pair.join('|')));
}

function pickPair(pairCatalog, forcedTypePair, random, selectionState) {
  if (forcedTypePair) {
    const pairKey = createTypePairKey(forcedTypePair);
    const forced = pairCatalog.find((entry) => createTypePairKey(entry.pair) === pairKey);
    if (!forced) {
      throw new Error(`No eligible Pokemon with local normal and shiny sprites match the requested type pair: ${forcedTypePair.join(' / ')}.`);
    }
    return forced;
  }

  if (pairCatalog.length === 0) {
    throw new Error('No eligible Pokemon type pairs with local normal and shiny sprites were found in the grounded Pokedex catalog.');
  }

  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const lastTypePairKey = normalizedSelectionState.last_type_pair_key;
  const typePairUsageCounts = normalizedSelectionState.type_pair_usage_counts || {};
  const pairUsageEntries = pairCatalog.map((entry) => {
    const pairKey = createTypePairKey(entry.pair);
    return {
      entry,
      pairKey,
      usageCount: Number(typePairUsageCounts[pairKey] || 0),
    };
  });
  const usageLevels = [...new Set(pairUsageEntries.map((entry) => entry.usageCount))]
    .sort((left, right) => left - right);

  for (const usageCount of usageLevels) {
    const levelEntries = pairUsageEntries.filter((entry) => entry.usageCount === usageCount);
    if (lastTypePairKey && pairCatalog.length > 1) {
      const nonRepeatedEntries = levelEntries.filter((entry) => entry.pairKey !== lastTypePairKey);
      if (nonRepeatedEntries.length > 0) {
        return nonRepeatedEntries[Math.floor(random() * nonRepeatedEntries.length)].entry;
      }
      continue;
    }
    return levelEntries[Math.floor(random() * levelEntries.length)].entry;
  }

  return pairUsageEntries[Math.floor(random() * pairUsageEntries.length)].entry;
}

function selectSeededFileAvoidingPrevious(files, random, previousPath) {
  if (!Array.isArray(files) || files.length === 0) {
    return null;
  }
  if (!previousPath || files.length <= 1) {
    return selectSeededFile(files, random);
  }

  const normalizedPreviousPath = normalizeAssetPath(previousPath);
  const eligibleFiles = files.filter((filePath) => normalizeAssetPath(filePath) !== normalizedPreviousPath);
  return selectSeededFile(eligibleFiles.length > 0 ? eligibleFiles : files, random);
}

function selectBackgroundCandidatesForTypePair(backgrounds, typePair = []) {
  const allBackgrounds = (Array.isArray(backgrounds) ? backgrounds : [])
    .filter((backgroundPath) => !isArchivedBackgroundPath(backgroundPath));
  if (allBackgrounds.length === 0) {
    return [];
  }

  const normalizedTypes = typePair.map((typeName) => String(typeName || '').trim().toLowerCase());
  const prioritizedThemedTypes = resolveThemedBackgroundPriority(normalizedTypes);

  for (const typeName of prioritizedThemedTypes) {
    const folderHints = TYPE_THEMED_BACKGROUND_FOLDER_HINTS[typeName] || [];
    const themedCandidates = allBackgrounds.filter((backgroundPath) => (
      folderHints.some((folderHint) => backgroundPath.toLowerCase().includes(`/${folderHint.toLowerCase()}/`))
    ));
    if (themedCandidates.length > 0) {
      return [...new Set(themedCandidates)];
    }
  }

  return allBackgrounds.filter((backgroundPath) => !isThemedBackgroundPath(backgroundPath));
}

function selectBackgroundForTypePair(backgrounds, typePair, random, selectionState) {
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const backgroundCandidates = selectBackgroundCandidatesForTypePair(backgrounds, typePair);
  if (backgroundCandidates.length === 0) {
    return null;
  }

  return selectSeededFileAvoidingPrevious(
    backgroundCandidates,
    random,
    normalizedSelectionState.last_background_path,
  );
}

function buildSubjectAssetRecord(subject, renderSpritePath) {
  return {
    pokedex_id: subject.id,
    national_dex_number: subject.national_dex_number,
    name: subject.name,
    sprite_path: subject.sprite_path,
    render_sprite_path: renderSpritePath,
    shiny_sprite_path: subject.shiny_sprite_path,
    silhouette_path: subject.silhouette_path,
    cry_path: subject.cry_path,
    sprite_source_url: subject.sprite_source_url,
    shiny_sprite_source_url: subject.shiny_sprite_source_url,
    silhouette_source_url: subject.silhouette_source_url,
    cry_source_url: subject.cry_source_url,
    reveal_variant: 'shiny',
    is_shiny_reveal: true,
  };
}

function buildFindTheShinyLayout(template, difficulty, random) {
  const gridConfig = template?.layout?.sprite_grid || {};
  const pokeballGridConfig = template?.layout?.pokeball_grid || {};
  const safeZone = template?.canvas?.safe_zone || {};
  const canvasWidth = Number(template?.canvas?.width || 1080);
  const canvasHeight = Number(template?.canvas?.height || 1920);
  const stageBounds = gridConfig.stage_bounds_px || {};
  const stageLeft = Number(stageBounds.left ?? safeZone.left ?? 100);
  const stageTop = Number(stageBounds.top ?? 640);
  const stageWidth = Number(stageBounds.width ?? (canvasWidth - stageLeft - Number(safeZone.right ?? 100)));
  const stageHeight = Number(stageBounds.height ?? (canvasHeight - stageTop - Number(safeZone.bottom ?? 260)));
  const baseItemSize = Number(gridConfig.item_size_px || 220);
  const minItemSize = Number(gridConfig.min_item_size_px || DEFAULT_MIN_ITEM_SIZE_PX);
  const columnGap = Number(gridConfig.column_gap_px || 26);
  const rowGap = Number(gridConfig.row_gap_px || 38);
  const columns = Number(difficulty.columns || 0);
  const rows = Number(difficulty.rows || 0);
  const fitWidth = Math.floor((stageWidth - ((columns - 1) * columnGap)) / columns);
  const fitHeight = Math.floor((stageHeight - ((rows - 1) * rowGap)) / rows);
  const itemSize = Math.max(
    minItemSize,
    Math.min(baseItemSize, fitWidth, fitHeight),
  );
  const gridWidth = (columns * itemSize) + ((columns - 1) * columnGap);
  const gridHeight = (rows * itemSize) + ((rows - 1) * rowGap);
  const originX = stageLeft + Math.max(0, Math.floor((stageWidth - gridWidth) / 2));
  const originY = stageTop + Math.max(0, Math.floor((stageHeight - gridHeight) / 2));
  const wiggleWindowStartRatio = Math.min(
    0.92,
    Math.max(0, Number(
      pokeballGridConfig.wiggle_window_start_ratio ?? DEFAULT_POKEBALL_WIGGLE_WINDOW_START_RATIO,
    )),
  );
  const wiggleWindowEndRatio = Math.min(
    0.96,
    Math.max(
      wiggleWindowStartRatio + 0.04,
      Number(pokeballGridConfig.wiggle_window_end_ratio ?? DEFAULT_POKEBALL_WIGGLE_WINDOW_END_RATIO),
    ),
  );
  const introStaggerSeconds = Math.max(
    0,
    Number(pokeballGridConfig.intro_stagger_seconds ?? DEFAULT_POKEBALL_INTRO_STAGGER_SECONDS),
  );
  const introOffsetRatios = buildSpreadOffsetRatios(difficulty.sprite_count, random);
  const replayOffsetRatios = buildSpreadOffsetRatios(difficulty.sprite_count, random);
  const cells = [];

  for (let index = 0; index < difficulty.sprite_count; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = originX + (column * (itemSize + columnGap));
    const y = originY + (row * (itemSize + rowGap));
    cells.push({
      index,
      row,
      column,
      x,
      y,
      width: itemSize,
      height: itemSize,
      center_x: x + Math.floor(itemSize / 2),
      center_y: y + Math.floor(itemSize / 2),
      pokeball_intro_offset_ratio: introOffsetRatios[index],
      pokeball_wiggle_offset_ratio: roundRatio(random()),
      pokeball_replay_offset_ratio: replayOffsetRatios[index],
    });
  }

  return {
    difficulty_id: difficulty.id,
    sprite_count: difficulty.sprite_count,
    rows,
    columns,
    stage_bounds_px: {
      left: stageLeft,
      top: stageTop,
      width: stageWidth,
      height: stageHeight,
    },
    centered_from_middle: true,
    item_size_px: itemSize,
    min_item_size_px: minItemSize,
    column_gap_px: columnGap,
    row_gap_px: rowGap,
    sprite_scale_multiplier: Number(gridConfig.sprite_scale_multiplier ?? DEFAULT_SPRITE_SCALE_MULTIPLIER),
    pokeball_intro_duration_seconds: Number(
      pokeballGridConfig.intro_duration_seconds ?? DEFAULT_POKEBALL_INTRO_DURATION_SECONDS
    ),
    pokeball_intro_stagger_seconds: introStaggerSeconds,
    pokeball_wiggle_window_start_ratio: wiggleWindowStartRatio,
    pokeball_wiggle_window_end_ratio: wiggleWindowEndRatio,
    cells,
  };
}

function buildShinyRevealState({
  template,
  inventory,
  selectedSubject,
  gridLayout,
  random,
}) {
  const configured = template?.reveal?.shiny && typeof template.reveal.shiny === 'object'
    ? template.reveal.shiny
    : {};
  return {
    enabled: configured.enabled !== false,
    active: true,
    max_per_video: 1,
    selected_subject_index: 0,
    selected_cell_index: Math.floor(random() * Math.max(1, gridLayout.cells.length)),
    selected_pokedex_id: selectedSubject.id,
    selected_national_dex_number: selectedSubject.national_dex_number,
    selected_name: selectedSubject.name,
    selected_sprite_path: selectedSubject.shiny_sprite_path,
    sparkle_overlay_path: inventory?.overlay_presets?.shiny_sparkle || null,
    sound_effect_path: inventory?.sound_effects?.shiny || null,
    sparkle_duration_seconds: Number(
      configured.sparkle_duration_seconds ?? DEFAULT_SPARKLE_DURATION_SECONDS,
    ),
    sparkle_scale_multiplier: Number(
      configured.sparkle_scale_multiplier ?? DEFAULT_SPARKLE_SCALE_MULTIPLIER,
    ),
  };
}

export async function planFindTheShinyChallenge({
  template,
  pokedexRows,
  seed = 'poke-quizz',
  forcedTypePair = null,
  assetInventory = null,
  selectionState = null,
}) {
  const config = getTemplateSelectionConfig(template);
  const random = createPrng(seed);
  const pairCatalog = buildPairCatalog(pokedexRows, config);
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const selectedPair = pickPair(pairCatalog, forcedTypePair, random, normalizedSelectionState);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const preferredTimerDisplayMode = resolveTimerDisplayMode(template);
  const hpBarTimerOverlayPath = selectHpBarTimerOverlay(inventory);
  const useHpBarTimer = preferredTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE && Boolean(hpBarTimerOverlayPath);
  const resolvedTimerDisplayMode = useHpBarTimer
    ? HP_BAR_TIMER_DISPLAY_MODE
    : NUMERIC_TIMER_DISPLAY_MODE;
  const fallbackTimerPath = inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null;
  const selectableSubjects = collapseSubjectVariants(selectedPair.matches);
  const prioritizedSelectableSubjects = prioritizeSelectableSubjects(selectableSubjects, random);
  const selectedSubject = prioritizedSelectableSubjects[0] || null;
  if (!selectedSubject) {
    throw new Error(`No localized Pokemon with normal and shiny sprites are available for ${selectedPair.pair.join(' / ')}.`);
  }
  const selectedRenderSpritePath = await resolveFindTheShinySpritePath(selectedSubject.sprite_path);

  const selectedDifficulty = chooseDifficulty(config.difficultyCatalog, random);
  const spriteGridLayout = buildFindTheShinyLayout(template, selectedDifficulty, random);
  const questionContractTexts = resolveQuestionContractTexts(template, random);
  const shinyReveal = buildShinyRevealState({
    template,
    inventory,
    selectedSubject,
    gridLayout: spriteGridLayout,
    random,
  });
  const selectedBackgroundPath = selectBackgroundForTypePair(
    inventory.backgrounds,
    selectedPair.pair,
    random,
    normalizedSelectionState,
  );
  const selectedVideoSignature = createPokeQuizzVideoSignatureKey(
    selectedPair.pair,
    selectedBackgroundPath,
  );
  const usedVideoSignatures = [
    selectedVideoSignature,
    ...normalizedSelectionState.used_video_signatures.filter((signature) => signature !== selectedVideoSignature),
  ].filter(Boolean);
  const selectedTypePairKey = createTypePairKey(selectedPair.pair);
  const typePairUsageCounts = {
    ...(normalizedSelectionState.type_pair_usage_counts || {}),
    [selectedTypePairKey]: Number(normalizedSelectionState.type_pair_usage_counts?.[selectedTypePairKey] || 0),
  };
  typePairUsageCounts[selectedTypePairKey] += 1;

  const requiredAssetGaps = [];
  if (!selectedSubject.sprite_path) requiredAssetGaps.push('pokemon_normal_sprite_local_asset_missing');
  if (!selectedSubject.shiny_sprite_path) requiredAssetGaps.push('pokemon_shiny_sprite_local_asset_missing');
  if (!inventory.backgrounds.length) requiredAssetGaps.push('background_missing');
  if (!inventory.sound_effects.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!inventory.sound_effects.timer_end) requiredAssetGaps.push('timer_end_sfx_missing');
  if (!inventory.sound_effects.pokeball_intro) requiredAssetGaps.push('pokeball_intro_sfx_missing');
  if (!inventory.sound_effects.shiny) requiredAssetGaps.push('shiny_sfx_missing');
  if (!inventory.overlay_presets?.pokeball_primary) requiredAssetGaps.push('pokeball_overlay_missing');
  if (preferredTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE && !hpBarTimerOverlayPath) {
    requiredAssetGaps.push('timer_hp_bar_overlay_missing');
  }
  if (!useHpBarTimer && !fallbackTimerPath) requiredAssetGaps.push('timer_overlay_missing');
  if (!useHpBarTimer && !inventory.overlay_presets?.timer_alarm) requiredAssetGaps.push('timer_alarm_overlay_missing');
  if (!inventory.overlay_presets?.shiny_sparkle) requiredAssetGaps.push('shiny_sparkle_overlay_missing');

  return {
    schema_version: 'poke-quizz-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_find_the_shiny',
    },
    template_id: template.template_id,
    generation_scope: config.generationScope || [],
    seed: String(seed),
    selection: {
      type_pair: selectedPair.pair,
      catalog_match_count: selectedPair.matches.length,
      compatible_display_count: spriteGridLayout.sprite_count,
      display_subject_count: spriteGridLayout.sprite_count,
      selected_subject_count: 1,
      selected_subjects: [
        {
          pokedex_id: selectedSubject.id,
          national_dex_number: selectedSubject.national_dex_number,
          name: selectedSubject.name,
          generation: selectedSubject.generation,
          region: selectedSubject.region,
          types: selectedSubject.types,
          reveal_variant: 'shiny',
          is_shiny_reveal: true,
        },
      ],
      grid: {
        difficulty_id: spriteGridLayout.difficulty_id,
        sprite_count: spriteGridLayout.sprite_count,
        rows: spriteGridLayout.rows,
        columns: spriteGridLayout.columns,
        shiny_cell_index: shinyReveal.selected_cell_index,
      },
    },
    shiny_reveal: shinyReveal,
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [
        { role: 'hook', text: questionContractTexts.hook },
        { role: 'prompt', text: questionContractTexts.prompt },
        { role: 'reveal', text: questionContractTexts.reveal },
      ],
    },
    timeline: [
      {
        phase: 'hook',
        duration_seconds: 1.2,
        spoken_text: questionContractTexts.hook,
        on_screen_text: questionContractTexts.hook,
      },
      {
        phase: 'type_prompt',
        duration_seconds: 1.4,
        spoken_text: questionContractTexts.prompt,
        on_screen_text: questionContractTexts.prompt,
      },
      {
        phase: 'countdown',
        duration_seconds: template.layout.timer.countdown_from,
        countdown_from: template.layout.timer.countdown_from,
        countdown_to: template.layout.timer.countdown_to,
      },
      {
        phase: 'reveal',
        duration_seconds: 2.4,
        spoken_text: questionContractTexts.reveal,
        reveal_mode: 'swap_one_grid_cell_to_shiny_and_play_sparkle',
      },
    ],
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      type_icons: [],
      pokemon: [
        buildSubjectAssetRecord(selectedSubject, selectedRenderSpritePath),
      ],
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_primary_pokeball_overlay_path: inventory.overlay_presets?.pokeball_primary || null,
        timer_display_mode: resolvedTimerDisplayMode,
        selected_timer_path: useHpBarTimer ? null : fallbackTimerPath,
        selected_timer_countdown_path: useHpBarTimer ? null : fallbackTimerPath,
        selected_timer_alarm_path: useHpBarTimer ? null : inventory.overlay_presets?.timer_alarm || null,
        selected_timer_hp_bar_path: useHpBarTimer ? hpBarTimerOverlayPath : null,
        selected_shiny_sparkle_path: inventory.overlay_presets?.shiny_sparkle || null,
        sprite_grid: spriteGridLayout,
        available_paths: inventory.overlays,
      },
      transitions: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.transitions,
        available_paths: inventory.transitions,
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        selected_battle_intro_music_path: selectSeededFile(inventory.music, random),
        selected_sound_effects: {
          ...(inventory.sound_effects || {}),
          pokeball_intro: inventory.sound_effects?.pokeball_intro || null,
          shiny: inventory.sound_effects?.shiny || null,
        },
      },
      outputs: {
        previews_directory: buildPokeQuizzPreviewDirectory(template),
        masters_directory: POKE_QUIZZ_ASSET_LAYOUT.masters,
      },
    },
    selection_state: {
      last_type_pair_key: selectedTypePairKey,
      last_background_path: selectedBackgroundPath,
      used_video_signatures: usedVideoSignatures,
      type_pair_usage_counts: typePairUsageCounts,
    },
    asset_inventory_snapshot: inventory,
    required_asset_gaps: [...new Set(requiredAssetGaps)],
  };
}
