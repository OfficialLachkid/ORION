import { access } from 'node:fs/promises';
import { createTypePairKey, DISALLOWED_TYPE_PAIR_KEYS, normalizeTypePair } from '../../../../pokemon-type-pairs.mjs';
import {
  buildPokeQuizzMirroredSpritePath,
  buildPokeQuizzPreviewDirectory,
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
const ANSWER_LABELS = Object.freeze(['A', 'B', 'C', 'D']);
const HP_BAR_TIMER_DISPLAY_MODE = 'hp_bar_depletion';
const NUMERIC_TIMER_DISPLAY_MODE = 'numeric_with_small_ring';
const mirroredSpriteAvailabilityCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-memory')) {
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

function roundRatio(value) {
  return Number(Number(value || 0).toFixed(4));
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeAssetPath(assetPath) {
  return String(assetPath || '').trim().replaceAll('\\', '/').toLowerCase();
}

function normalizeSoundKeywords(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function selectTemplateScopedTimerEndSound(template, inventory) {
  const soundEffects = inventory?.sound_effects || {};
  const fallbackPath = soundEffects.timer_end || null;
  const preferredKeywords = normalizeSoundKeywords(
    template?.audio?.sound_effects?.timer_end?.preferred_keywords,
  );
  if (preferredKeywords.length === 0) {
    return fallbackPath;
  }

  const preferredMatch = (Array.isArray(soundEffects.all) ? soundEffects.all : [])
    .find((filePath) => {
      const normalizedPath = String(filePath || '').trim().toLowerCase();
      return preferredKeywords.every((keyword) => normalizedPath.includes(keyword));
    });
  return preferredMatch || fallbackPath;
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

function selectHpBarTimerFrame(inventory, overlayPath) {
  if (String(overlayPath || '').toLowerCase().includes('greenscreen')) {
    return null;
  }
  return inventory?.overlay_presets?.long_hp_bar_frame
    || inventory?.overlay_presets?.hp_bar_frame
    || null;
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
  return options[Math.floor(random() * options.length)] || options[0];
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

async function resolveMemorySpritePath(spritePath) {
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

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function sampleArray(values, count, random) {
  return shuffle(values, random).slice(0, count);
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
        stage_bounds_px: entry?.stage_bounds_px && typeof entry.stage_bounds_px === 'object'
          ? { ...entry.stage_bounds_px }
          : null,
      };
    })
    .filter((entry) => entry.rows > 0 && entry.columns > 0 && entry.sprite_count >= 4);
}

function chooseDifficulty(difficultyCatalog, selectableCount, random) {
  const eligible = (Array.isArray(difficultyCatalog) ? difficultyCatalog : [])
    .filter((entry) => selectableCount >= (entry.sprite_count + 1));
  if (eligible.length === 0) {
    throw new Error('Memory template requires at least one grid configuration with enough Pokemon to hide one answer.');
  }
  const weightedPool = eligible.flatMap((entry) => Array.from({ length: entry.weight }, () => entry));
  return weightedPool[Math.floor(random() * weightedPool.length)] || eligible[0];
}

function buildMemoryGridLayout(template, difficulty) {
  const gridConfig = template?.layout?.sprite_grid || {};
  const safeZone = template?.canvas?.safe_zone || {};
  const canvasWidth = Number(template?.canvas?.width || 1080);
  const canvasHeight = Number(template?.canvas?.height || 1920);
  const stageBounds = difficulty?.stage_bounds_px || gridConfig.stage_bounds_px || {};
  const stageLeft = Number(stageBounds.left ?? safeZone.left ?? 100);
  const stageTop = Number(stageBounds.top ?? 420);
  const stageWidth = Number(stageBounds.width ?? (canvasWidth - stageLeft - Number(safeZone.right ?? 100)));
  const stageHeight = Number(stageBounds.height ?? (canvasHeight - stageTop - Number(safeZone.bottom ?? 260)));
  const baseItemSize = Number(gridConfig.item_size_px || 220);
  const minItemSize = Number(gridConfig.min_item_size_px || 160);
  const columnGap = Number(gridConfig.column_gap_px || 36);
  const rowGap = Number(gridConfig.row_gap_px || 42);
  const fitWidth = Math.floor((stageWidth - ((difficulty.columns - 1) * columnGap)) / difficulty.columns);
  const fitHeight = Math.floor((stageHeight - ((difficulty.rows - 1) * rowGap)) / difficulty.rows);
  const itemSize = Math.max(minItemSize, Math.min(baseItemSize, fitWidth, fitHeight));
  const gridWidth = (difficulty.columns * itemSize) + ((difficulty.columns - 1) * columnGap);
  const gridHeight = (difficulty.rows * itemSize) + ((difficulty.rows - 1) * rowGap);
  const originX = stageLeft + Math.max(0, Math.floor((stageWidth - gridWidth) / 2));
  const originY = stageTop + Math.max(0, Math.floor((stageHeight - gridHeight) / 2));
  const cells = [];

  for (let index = 0; index < difficulty.sprite_count; index += 1) {
    const row = Math.floor(index / difficulty.columns);
    const column = index % difficulty.columns;
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
    });
  }

  return {
    difficulty_id: difficulty.id,
    sprite_count: difficulty.sprite_count,
    rows: difficulty.rows,
    columns: difficulty.columns,
    stage_bounds_px: {
      left: stageLeft,
      top: stageTop,
      width: stageWidth,
      height: stageHeight,
    },
    item_size_px: itemSize,
    column_gap_px: columnGap,
    row_gap_px: rowGap,
    sprite_scale_multiplier: Number(gridConfig.sprite_scale_multiplier ?? 1.18),
    placeholder_scale_multiplier: Number(gridConfig.placeholder_scale_multiplier ?? 0.92),
    cells,
  };
}

function getTemplateSelectionConfig(template) {
  const typePairPolicy = template.selection_rules?.type_pair_policy || {};
  const configuredGenerationScope = Array.isArray(template.selection_rules?.generation_scope)
    ? template.selection_rules.generation_scope
      .map((value) => Number.parseInt(String(value), 10))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const difficultyCatalog = buildDifficultyCatalog(template);
  return {
    generationScope: configuredGenerationScope.length > 0 ? configuredGenerationScope : null,
    disallowedPairs: new Set(
      (typePairPolicy.disallowed_type_pairs || [])
        .map((pair) => createTypePairKey(pair)),
    ),
    minCatalogMatches: Number(typePairPolicy.min_catalog_matches || 5),
    difficultyCatalog,
    minimumSelectableCount: difficultyCatalog.reduce((minimum, entry) => (
      Math.min(minimum, entry.sprite_count + 1)
    ), Number.POSITIVE_INFINITY),
  };
}

function buildPairCatalog(rows, config) {
  const pairCatalog = new Map();
  for (const row of rows) {
    if (Array.isArray(config.generationScope) && !config.generationScope.includes(row.generation)) continue;
    if (!row.national_dex_number || !row.name || !Array.isArray(row.types)) continue;
    if (row.types.length !== 2) continue;
    if (!row.sprite_path) continue;

    const pair = normalizeTypePair(row.types);
    const pairKey = createTypePairKey(pair);
    if (DISALLOWED_TYPE_PAIR_KEYS.has(pairKey) || config.disallowedPairs.has(pairKey)) {
      continue;
    }

    const existing = pairCatalog.get(pairKey) || {
      pair,
      matches: [],
      selectable_matches: [],
      selectable_count: 0,
    };
    existing.matches.push(row);
    pairCatalog.set(pairKey, existing);
  }

  return [...pairCatalog.values()]
    .map((entry) => {
      const selectableMatches = collapseSubjectVariants(entry.matches.filter((subject) => subject.sprite_path));
      return {
        ...entry,
        selectable_matches: selectableMatches,
        selectable_count: selectableMatches.length,
      };
    })
    .filter((entry) => (
      entry.matches.length >= config.minCatalogMatches
      && entry.selectable_count >= config.minimumSelectableCount
    ))
    .sort((left, right) => left.pair.join('|').localeCompare(right.pair.join('|')));
}

function pickPair(pairCatalog, forcedTypePair, random, selectionState) {
  if (forcedTypePair) {
    const pairKey = createTypePairKey(forcedTypePair);
    const forced = pairCatalog.find((entry) => createTypePairKey(entry.pair) === pairKey);
    if (!forced) {
      throw new Error(`No eligible Pokemon match the requested type pair: ${forcedTypePair.join(' / ')}.`);
    }
    return forced;
  }
  if (pairCatalog.length === 0) {
    throw new Error('No eligible Pokemon type pairs were found in the grounded Pokedex catalog.');
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

function titleCaseWord(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function buildQuestionTextBundle(template, random, answerName) {
  const hookText = pickSeededQuestionText(
    template?.question_contract?.hook_text,
    template?.question_contract?.hook_text_variants,
    random,
  );
  const questionText = pickSeededQuestionText(
    template?.question_contract?.question_text,
    template?.question_contract?.question_text_variants,
    random,
  );
  const revealTemplate = pickSeededQuestionText(
    template?.question_contract?.reveal_text,
    template?.question_contract?.reveal_text_variants,
    random,
  );
  return {
    hook: hookText,
    question: questionText,
    reveal: revealTemplate.replaceAll('{answer_name}', answerName),
  };
}

function buildQuestionState({
  displayedSubjects,
  hiddenSubject,
  displayedSubjectAssetsById,
  hiddenSubjectAsset,
  questionText,
  random,
}) {
  const distractors = sampleArray(displayedSubjects, 3, random);
  const optionEntries = shuffle([
    ...distractors.map((subject) => ({
      subject,
      asset: displayedSubjectAssetsById.get(subject.id),
      is_correct: false,
      appeared_on_screen: true,
    })),
    {
      subject: hiddenSubject,
      asset: hiddenSubjectAsset,
      is_correct: true,
      appeared_on_screen: false,
    },
  ], random).slice(0, 4);

  const options = optionEntries.map((entry, index) => ({
    label: ANSWER_LABELS[index] || String(index + 1),
    name: entry.subject.name,
    national_dex_number: entry.subject.national_dex_number,
    pokedex_id: entry.subject.id,
    is_correct: entry.is_correct,
    appeared_on_screen: entry.appeared_on_screen,
    sprite_path: entry.asset?.sprite_path || entry.subject.sprite_path,
    render_sprite_path: entry.asset?.render_sprite_path || entry.subject.sprite_path,
    sprite_display_scale_multiplier: Number(entry.asset?.sprite_display_scale_multiplier ?? 1),
  }));
  const correctOption = options.find((option) => option.is_correct) || options[0];

  return {
    mode: 'which_not_on_screen',
    question_text: questionText,
    hidden_subject: {
      pokedex_id: hiddenSubject.id,
      national_dex_number: hiddenSubject.national_dex_number,
      name: hiddenSubject.name,
      generation: hiddenSubject.generation,
      region: hiddenSubject.region,
      types: hiddenSubject.types,
      sprite_path: hiddenSubjectAsset?.sprite_path || hiddenSubject.sprite_path,
      render_sprite_path: hiddenSubjectAsset?.render_sprite_path || hiddenSubject.sprite_path,
    },
    option_count: options.length,
    correct_option_label: correctOption.label,
    correct_option_index: options.findIndex((option) => option.is_correct),
    options,
  };
}

function buildSubjectAssetRecord(subject, renderSpritePath, spriteDisplayScaleMultiplier = 1) {
  return {
    pokedex_id: subject.id,
    national_dex_number: subject.national_dex_number,
    name: subject.name,
    generation: subject.generation,
    region: subject.region,
    types: subject.types,
    sprite_path: subject.sprite_path,
    render_sprite_path: renderSpritePath,
    sprite_display_scale_multiplier: spriteDisplayScaleMultiplier,
    sprite_source_url: subject.sprite_source_url || null,
  };
}

export async function planPokemonMemoryChallenge({
  template,
  pokedexRows,
  seed = 'poke-quizz-memory',
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
  const hpBarTimerFramePath = selectHpBarTimerFrame(inventory, hpBarTimerOverlayPath);
  const useHpBarTimer = preferredTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE && Boolean(hpBarTimerOverlayPath);
  const resolvedTimerDisplayMode = useHpBarTimer
    ? HP_BAR_TIMER_DISPLAY_MODE
    : NUMERIC_TIMER_DISPLAY_MODE;
  const selectableSubjects = prioritizeSelectableSubjects(
    selectedPair.selectable_matches,
    random,
  );
  const selectedDifficulty = chooseDifficulty(config.difficultyCatalog, selectableSubjects.length, random);
  const displaySubjects = selectableSubjects.slice(0, selectedDifficulty.sprite_count);
  const hiddenSubject = selectableSubjects[selectedDifficulty.sprite_count];

  if (displaySubjects.length !== selectedDifficulty.sprite_count || !hiddenSubject) {
    throw new Error(`Not enough eligible Pokemon were available to build a ${selectedDifficulty.sprite_count}-card memory round for ${selectedPair.pair.join(' / ')}.`);
  }

  const gridLayout = buildMemoryGridLayout(template, selectedDifficulty);
  const questionTextBundle = buildQuestionTextBundle(template, random, hiddenSubject.name);
  const renderedPokemon = await Promise.all(displaySubjects.map(async (subject) => (
    buildSubjectAssetRecord(
      subject,
      await resolveMemorySpritePath(subject.sprite_path),
      1,
    )
  )));
  const hiddenSubjectAsset = buildSubjectAssetRecord(
    hiddenSubject,
    await resolveMemorySpritePath(hiddenSubject.sprite_path),
    1,
  );
  const displayedSubjectAssetsById = new Map(renderedPokemon.map((subject) => [subject.pokedex_id, subject]));
  const question = buildQuestionState({
    displayedSubjects: displaySubjects,
    hiddenSubject,
    displayedSubjectAssetsById,
    hiddenSubjectAsset,
    questionText: questionTextBundle.question,
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

  const countdownFrom = ensurePositiveInteger(template?.layout?.timer?.countdown_from, 3);
  const countdownTo = Number.parseInt(String(template?.layout?.timer?.countdown_to ?? 0), 10);
  const hookHoldSeconds = Number(template?.layout?.rounds?.hook_hold_seconds ?? 0.9);
  const memorizeHoldSeconds = Number(template?.layout?.rounds?.memorize_hold_seconds ?? 2);
  const questionLeadSeconds = Number(template?.layout?.rounds?.question_lead_seconds ?? 0.45);
  const revealHoldSeconds = Number(template?.layout?.rounds?.reveal_hold_seconds ?? 2.1);
  const selectedTimerEndSoundPath = selectTemplateScopedTimerEndSound(template, inventory);

  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('background_missing');
  if (!inventory.music.length) requiredAssetGaps.push('battle_intro_music_missing');
  if (!inventory.sound_effects?.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!selectedTimerEndSoundPath) requiredAssetGaps.push('timer_end_sfx_missing');
  if (preferredTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE && !hpBarTimerOverlayPath) {
    requiredAssetGaps.push('hp_bar_timer_overlay_missing');
  }
  if (
    resolvedTimerDisplayMode !== HP_BAR_TIMER_DISPLAY_MODE
    && !inventory.overlay_presets?.timer_countdown
    && !inventory.overlay_presets?.timer
  ) {
    requiredAssetGaps.push('timer_overlay_missing');
  }
  if (!inventory.overlay_presets?.grass_plateau) {
    requiredAssetGaps.push('grass_plateau_overlay_missing');
  }
  if (!renderedPokemon.every((subject) => subject.render_sprite_path || subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_sprite_local_assets_missing');
  }
  if (!(hiddenSubjectAsset.render_sprite_path || hiddenSubjectAsset.sprite_path)) {
    requiredAssetGaps.push('hidden_answer_sprite_missing');
  }

  return {
    schema_version: 'poke-quizz-memory-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_memory',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    generation_scope: config.generationScope || [],
    seed: String(seed),
    selection: {
      type_pair: selectedPair.pair,
      catalog_match_count: selectedPair.matches.length,
      compatible_display_count: gridLayout.sprite_count,
      display_subject_count: displaySubjects.length,
      selected_subject_count: displaySubjects.length,
      selected_subjects: renderedPokemon.map((subject) => ({
        pokedex_id: subject.pokedex_id,
        national_dex_number: subject.national_dex_number,
        name: subject.name,
        generation: subject.generation,
        region: subject.region,
        types: subject.types,
      })),
      grid: {
        difficulty_id: gridLayout.difficulty_id,
        sprite_count: gridLayout.sprite_count,
        rows: gridLayout.rows,
        columns: gridLayout.columns,
      },
    },
    question,
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [
        { role: 'hook', text: questionTextBundle.hook },
        { role: 'question', text: questionTextBundle.question },
        { role: 'reveal', text: questionTextBundle.reveal },
      ],
    },
    timeline: [
      {
        phase: 'hook',
        duration_seconds: hookHoldSeconds,
        spoken_text: questionTextBundle.hook,
        on_screen_text: questionTextBundle.hook,
      },
      {
        phase: 'memorize',
        duration_seconds: memorizeHoldSeconds,
      },
      {
        phase: 'question',
        duration_seconds: questionLeadSeconds,
        spoken_text: questionTextBundle.question,
        on_screen_text: questionTextBundle.question,
      },
      {
        phase: 'countdown',
        duration_seconds: countdownFrom,
        countdown_from: countdownFrom,
        countdown_to: countdownTo,
      },
      {
        phase: 'reveal',
        duration_seconds: revealHoldSeconds,
        spoken_text: questionTextBundle.reveal,
        on_screen_text: questionTextBundle.reveal,
      },
    ],
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      type_icons: [],
      pokemon: renderedPokemon,
      reveal_pokemon: hiddenSubjectAsset,
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        timer_display_mode: resolvedTimerDisplayMode,
        selected_timer_path: resolvedTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE
          ? null
          : (inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null),
        selected_timer_countdown_path: resolvedTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE
          ? null
          : (inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null),
        selected_timer_alarm_path: resolvedTimerDisplayMode === HP_BAR_TIMER_DISPLAY_MODE
          ? null
          : (inventory.overlay_presets?.timer_alarm || null),
        selected_timer_hp_bar_path: useHpBarTimer ? hpBarTimerOverlayPath : null,
        selected_timer_hp_bar_frame_path: useHpBarTimer ? hpBarTimerFramePath : null,
        selected_intro_disappear_path: inventory.overlay_presets?.disappear || null,
        selected_intro_pokeball_path: inventory.overlay_presets?.pokeball_primary || null,
        selected_grass_plateau_path: inventory.overlay_presets?.grass_plateau || null,
        sprite_grid: gridLayout,
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
          countdown_tick: inventory.sound_effects?.countdown_tick || null,
          timer_end: selectedTimerEndSoundPath,
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
