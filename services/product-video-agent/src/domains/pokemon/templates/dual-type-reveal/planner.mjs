import { createTypePairKey, DISALLOWED_TYPE_PAIR_KEYS, normalizeTypePair } from '../../../../pokemon-type-pairs.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../../../poke-quizz-asset-layout.mjs';
import {
  createPokeQuizzVideoSignatureKey,
  normalizePokeQuizzSelectionState,
} from '../../../../poke-quizz-selection-state.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
  selectTypeIconSet,
} from '../../../../poke-quizz-asset-inventory.mjs';

const TYPE_THEMED_BACKGROUND_FOLDER_HINTS = Object.freeze({
  fire: ['fire-backgrounds'],
  ground: ['cave-backgrounds'],
  ice: ['ice-backgrounds'],
  rock: ['cave-backgrounds'],
  water: ['beach-backgrounds'],
});

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

const TYPE_THEMED_BACKGROUND_PRIORITY = Object.freeze([
  'ice',
  'ground',
  'rock',
  'fire',
  'water',
]);
const DEFAULT_SHINY_ODDS_NUMERATOR = 1;
const DEFAULT_SHINY_ODDS_DENOMINATOR = 11;
const DEFAULT_SHINY_SPARKLE_DURATION_SECONDS = 0.9;
const DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER = 1.35;

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

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
    selectedSubjectsMin: Number(typePairPolicy.selected_subjects_min || 1),
    selectedSubjectsMax: Number(typePairPolicy.selected_subjects_max || 4),
  };
}

function buildPairCatalog(rows, config) {
  const pairCatalog = new Map();

  for (const row of rows) {
    if (Array.isArray(config.generationScope) && !config.generationScope.includes(row.generation)) continue;
    if (!row.national_dex_number || !row.name || !Array.isArray(row.types)) continue;
    if (row.types.length !== 2) continue;

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
      throw new Error(`No eligible Pokemon match the requested type pair: ${forcedTypePair.join(' / ')}.`);
    }
    return forced;
  }

  if (pairCatalog.length === 0) {
    throw new Error('No eligible Pokemon type pairs were found in the grounded Pokedex catalog.');
  }

  const localizedPairCatalog = pairCatalog.filter((entry) => entry.matches.some((subject) => subject.sprite_path));
  const renderablePairCatalog = localizedPairCatalog.length > 0
    ? localizedPairCatalog
    : pairCatalog;
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const lastTypePairKey = normalizedSelectionState.last_type_pair_key;
  const typePairUsageCounts = normalizedSelectionState.type_pair_usage_counts || {};
  const pairUsageEntries = renderablePairCatalog.map((entry) => {
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
    if (lastTypePairKey && renderablePairCatalog.length > 1) {
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

function buildTypeIconRecord(type, sourceUrl, localPath, style, styleVariant) {
  return {
    type,
    local_path: localPath,
    source_url: sourceUrl || null,
    style,
    style_variant: styleVariant || style,
  };
}

function buildSubjectAssetRecord(subject, shinyRevealState = null) {
  const isShinyReveal = Boolean(
    shinyRevealState?.active
    && shinyRevealState.selected_pokedex_id
    && shinyRevealState.selected_pokedex_id === subject.id,
  );
  const revealSpritePath = isShinyReveal
    ? subject.shiny_sprite_path || subject.sprite_path
    : subject.sprite_path;
  const revealSpriteSourceUrl = isShinyReveal
    ? subject.shiny_sprite_source_url || subject.sprite_source_url
    : subject.sprite_source_url;
  return {
    pokedex_id: subject.id,
    national_dex_number: subject.national_dex_number,
    name: subject.name,
    sprite_path: subject.sprite_path,
    shiny_sprite_path: subject.shiny_sprite_path,
    silhouette_path: subject.silhouette_path,
    cry_path: subject.cry_path,
    sprite_source_url: subject.sprite_source_url,
    shiny_sprite_source_url: subject.shiny_sprite_source_url,
    silhouette_source_url: subject.silhouette_source_url,
    cry_source_url: subject.cry_source_url,
    reveal_sprite_path: revealSpritePath,
    reveal_sprite_source_url: revealSpriteSourceUrl,
    reveal_variant: isShinyReveal ? 'shiny' : 'normal',
    is_shiny_reveal: isShinyReveal,
  };
}

function getShinyRevealConfig(template) {
  const configured = template?.reveal?.shiny && typeof template.reveal.shiny === 'object'
    ? template.reveal.shiny
    : {};
  const oddsNumerator = ensurePositiveInteger(
    configured.odds_numerator,
    DEFAULT_SHINY_ODDS_NUMERATOR,
  );
  const oddsDenominator = Math.max(
    oddsNumerator,
    ensurePositiveInteger(configured.odds_denominator, DEFAULT_SHINY_ODDS_DENOMINATOR),
  );
  return {
    enabled: configured.enabled !== false,
    odds_numerator: oddsNumerator,
    odds_denominator: oddsDenominator,
    max_per_video: 1,
    chance_percentage: Number((((oddsNumerator / oddsDenominator) * 100)).toFixed(6)),
    sparkle_duration_seconds: Number(
      configured.sparkle_duration_seconds ?? DEFAULT_SHINY_SPARKLE_DURATION_SECONDS,
    ),
    sparkle_scale_multiplier: Number(
      configured.sparkle_scale_multiplier ?? DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
    ),
  };
}

function resolveSingleShinyReveal({
  template,
  inventory,
  selectedSubjects,
  random,
}) {
  const config = getShinyRevealConfig(template);
  const eligibleSubjects = (selectedSubjects || [])
    .map((subject, index) => ({ subject, index }))
    .filter(({ subject }) => Boolean(subject?.shiny_sprite_path));
  const sparkleOverlayPath = inventory?.overlay_presets?.shiny_sparkle || null;
  const shinySoundPath = inventory?.sound_effects?.shiny || null;
  const activationBlockers = [];

  if (!config.enabled) activationBlockers.push('disabled');
  if (eligibleSubjects.length === 0) activationBlockers.push('no_localized_shiny_sprite');
  if (!sparkleOverlayPath) activationBlockers.push('shiny_sparkle_overlay_missing');
  if (!shinySoundPath) activationBlockers.push('shiny_sound_effect_missing');

  const rollOutcomes = eligibleSubjects.map(({ subject, index }) => ({
    subject,
    index,
    roll_value: 1 + Math.floor(random() * config.odds_denominator),
  })).map((outcome) => ({
    ...outcome,
    roll_hit: outcome.roll_value <= config.odds_numerator,
  }));
  const hitOutcomes = rollOutcomes.filter((outcome) => outcome.roll_hit);
  const active = activationBlockers.length === 0 && hitOutcomes.length > 0;
  const selectedOutcome = active
    ? hitOutcomes[Math.floor(random() * hitOutcomes.length)] || null
    : null;
  const effectiveVideoChancePercentage = Number((
    100 * (1 - Math.pow(
      (config.odds_denominator - config.odds_numerator) / config.odds_denominator,
      eligibleSubjects.length,
    ))
  ).toFixed(6));

  return {
    ...config,
    roll_mode: 'per_selected_subject',
    eligible_subject_count: eligibleSubjects.length,
    eligible_subject_dex_numbers: eligibleSubjects.map(({ subject }) => subject.national_dex_number),
    effective_video_chance_percentage: effectiveVideoChancePercentage,
    roll_value: selectedOutcome?.roll_value ?? rollOutcomes[0]?.roll_value ?? null,
    roll_values: rollOutcomes.map((outcome) => outcome.roll_value),
    roll_hit: hitOutcomes.length > 0,
    hit_subject_count: hitOutcomes.length,
    hit_subject_indexes: hitOutcomes.map((outcome) => outcome.index),
    roll_outcomes: rollOutcomes.map((outcome) => ({
      selected_subject_index: outcome.index,
      pokedex_id: outcome.subject?.id ?? null,
      national_dex_number: outcome.subject?.national_dex_number ?? null,
      name: outcome.subject?.name ?? null,
      roll_value: outcome.roll_value,
      roll_hit: outcome.roll_hit,
    })),
    active,
    inactive_reason: active
      ? null
      : activationBlockers[0] || 'roll_missed',
    activation_blockers: activationBlockers,
    selected_subject_index: selectedOutcome?.index ?? null,
    selected_pokedex_id: selectedOutcome?.subject?.id ?? null,
    selected_national_dex_number: selectedOutcome?.subject?.national_dex_number ?? null,
    selected_name: selectedOutcome?.subject?.name ?? null,
    selected_sprite_path: selectedOutcome?.subject?.shiny_sprite_path ?? null,
    sparkle_overlay_path: sparkleOverlayPath,
    sound_effect_path: shinySoundPath,
  };
}

function selectGridColumns(itemCount, maxColumns) {
  if (itemCount <= 0) return 0;
  return Math.min(maxColumns, Math.ceil(Math.sqrt(itemCount)));
}

function buildCenteredGridLayout(template, itemCount) {
  const gridConfig = template.layout?.pokeball_grid || {};
  const safeZone = template.canvas?.safe_zone || {};
  const canvasWidth = Number(template.canvas?.width || 1080);
  const canvasHeight = Number(template.canvas?.height || 1920);
  const stageBounds = gridConfig.stage_bounds_px || {};
  const itemSize = Number(gridConfig.item_size_px || 180);
  const columnGap = Number(gridConfig.column_gap_px || 28);
  const rowGap = Number(gridConfig.row_gap_px || 28);
  const maxColumns = Number(gridConfig.max_columns || 4);
  const maxItems = Number(gridConfig.max_items || maxColumns);
  const stageLeft = Number(stageBounds.left ?? safeZone.left ?? 100);
  const stageTop = Number(stageBounds.top ?? 520);
  const stageWidth = Number(stageBounds.width ?? (canvasWidth - stageLeft - Number(safeZone.right ?? 100)));
  const stageHeight = Number(stageBounds.height ?? 760);

  const cappedItemCount = Math.max(0, Math.min(itemCount, maxItems));
  const columns = selectGridColumns(cappedItemCount, maxColumns);
  const rows = columns > 0 ? Math.ceil(cappedItemCount / columns) : 0;
  const gridHeight = rows > 0 ? (rows * itemSize) + ((rows - 1) * rowGap) : 0;
  const sparseGridNudgeY = rows <= 1
    ? Math.min(120, Math.floor(stageHeight * 0.14))
    : rows === 2
      ? Math.min(60, Math.floor(stageHeight * 0.07))
      : 0;
  const originY = stageTop + Math.max(0, Math.floor((stageHeight - gridHeight) / 2) - sparseGridNudgeY);

  const cells = [];
  for (let index = 0; index < cappedItemCount; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const itemsInRow = Math.min(columns, cappedItemCount - (row * columns));
    const rowWidth = (itemsInRow * itemSize) + ((itemsInRow - 1) * columnGap);
    const rowOriginX = stageLeft + Math.max(0, Math.floor((stageWidth - rowWidth) / 2));
    const x = rowOriginX + (column * (itemSize + columnGap));
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
    centered_from_middle: true,
    stage_bounds_px: {
      left: stageLeft,
      top: stageTop,
      width: stageWidth,
      height: stageHeight,
    },
    item_count: cappedItemCount,
    columns,
    rows,
    item_size_px: itemSize,
    column_gap_px: columnGap,
    row_gap_px: rowGap,
    cells,
  };
}

export async function planPokemonTypeChallenge({
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
  const localizedMatches = selectedPair.matches.filter((subject) => subject.sprite_path);
  const selectableSubjects = collapseSubjectVariants(localizedMatches.length > 0
    ? localizedMatches
    : selectedPair.matches);
  const prioritizedSelectableSubjects = prioritizeSelectableSubjects(selectableSubjects, random);
  const selectedSubjectCount = Math.max(
    config.selectedSubjectsMin,
    Math.min(config.selectedSubjectsMax, selectableSubjects.length),
  );
  const selectedSubjects = prioritizedSelectableSubjects
    .slice(0, selectedSubjectCount)
    .sort((left, right) => (
      (left.national_dex_number - right.national_dex_number)
      || String(left.slug || '').localeCompare(String(right.slug || ''))
    ));
  const shinyReveal = resolveSingleShinyReveal({
    template,
    inventory,
    selectedSubjects,
    random,
  });
  const compatibleDisplayCount = Math.min(selectableSubjects.length, config.selectedSubjectsMax);
  const pokeballGridLayout = buildCenteredGridLayout(template, compatibleDisplayCount);

  const firstSubjectTypeIcons = selectedPair.matches[0]?.metadata?.type_icon_source_urls || [];
  const selectedTypeIconSet = selectTypeIconSet(selectedPair.pair, inventory);
  const selectedTypeIconPaths = new Set(
    selectedTypeIconSet.style === 'three_d'
      ? inventory.type_icons.three_d
      : inventory.type_icons.pixel,
  );
  const typeIcons = selectedPair.pair.map((type, index) => (
    buildTypeIconRecord(
      type,
      firstSubjectTypeIcons[index],
      selectedTypeIconSet.file_paths[index],
      selectedTypeIconSet.style,
      selectedTypeIconSet.style_variant,
    )
  ));

  const requiredAssetGaps = [];
  if (!selectedSubjects.every((subject) => subject.silhouette_path || subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_silhouette_or_sprite_local_assets_missing');
  }
  if (!selectedSubjects.every((subject) => subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_reveal_sprite_local_assets_missing');
  }
  if (!selectedTypeIconSet.file_paths.every((filePath) => selectedTypeIconPaths.has(filePath))) {
    requiredAssetGaps.push('type_icons_missing');
  }
  if (!inventory.backgrounds.length) requiredAssetGaps.push('background_missing');
  if (!inventory.music.length) requiredAssetGaps.push('battle_intro_music_missing');
  if (!inventory.sound_effects.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!inventory.sound_effects.timer_end) requiredAssetGaps.push('timer_end_sfx_missing');
  if (!inventory.sound_effects.reveal) requiredAssetGaps.push('reveal_sfx_missing');

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

  return {
    schema_version: 'poke-quizz-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_type_challenge',
    },
    template_id: template.template_id,
    generation_scope: config.generationScope || [],
    seed: String(seed),
    selection: {
      type_pair: selectedPair.pair,
      catalog_match_count: selectedPair.matches.length,
      compatible_display_count: compatibleDisplayCount,
      display_subject_count: selectedSubjects.length,
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects.map((subject) => ({
        pokedex_id: subject.id,
        national_dex_number: subject.national_dex_number,
        name: subject.name,
        generation: subject.generation,
        region: subject.region,
        types: subject.types,
        reveal_variant: shinyReveal.active && shinyReveal.selected_pokedex_id === subject.id
          ? 'shiny'
          : 'normal',
        is_shiny_reveal: shinyReveal.active && shinyReveal.selected_pokedex_id === subject.id,
      })),
    },
    shiny_reveal: shinyReveal,
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [
        { role: 'hook', text: template.question_contract.hook_text },
        { role: 'prompt', text: template.question_contract.type_prompt_text },
        { role: 'reveal', text: template.question_contract.reveal_text },
      ],
    },
    timeline: [
      {
        phase: 'hook',
        duration_seconds: 1.2,
        spoken_text: template.question_contract.hook_text,
        on_screen_text: template.question_contract.hook_text,
      },
      {
        phase: 'type_prompt',
        duration_seconds: 1.6,
        spoken_text: template.question_contract.type_prompt_text,
        on_screen_text: template.question_contract.type_prompt_text,
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
        spoken_text: template.question_contract.reveal_text,
        reveal_mode: 'swap_silhouette_sprites_for_colored_sprites_and_play_sound',
      },
    ],
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      type_icons: typeIcons,
      pokemon: selectedSubjects.map((subject) => buildSubjectAssetRecord(subject, shinyReveal)),
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_timer_path: inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null,
        selected_timer_countdown_path: inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null,
        selected_timer_alarm_path: inventory.overlay_presets?.timer_alarm || null,
        selected_shiny_sparkle_path: inventory.overlay_presets?.shiny_sparkle || null,
        selected_primary_pokeball_overlay_path: inventory.overlay_presets?.pokeball_primary || null,
        pokeball_grid: {
          overlay_path: inventory.overlay_presets?.pokeball_primary || null,
          count_basis: `compatible_catalog_match_count_capped_to_${template.layout?.pokeball_grid?.max_items || 9}`,
          ...pokeballGridLayout,
        },
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
          shiny: inventory.sound_effects?.shiny || null,
        },
      },
      outputs: {
        previews_directory: POKE_QUIZZ_ASSET_LAYOUT.previews,
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
