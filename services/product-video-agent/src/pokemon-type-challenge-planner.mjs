import { createTypePairKey, DISALLOWED_TYPE_PAIR_KEYS, normalizeTypePair } from './pokemon-type-pairs.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from './poke-quizz-asset-layout.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
  selectTypeIconSet,
} from './poke-quizz-asset-inventory.mjs';

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

function getTemplateSelectionConfig(template) {
  const typePairPolicy = template.selection_rules?.type_pair_policy || {};
  return {
    generationScope: template.selection_rules?.generation_scope || [1],
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
    if (!config.generationScope.includes(row.generation)) continue;
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

function pickPair(pairCatalog, forcedTypePair, random) {
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

  return pairCatalog[Math.floor(random() * pairCatalog.length)];
}

function buildTypeIconRecord(type, sourceUrl, localPath, style) {
  return {
    type,
    local_path: localPath,
    source_url: sourceUrl || null,
    style,
  };
}

function buildSubjectAssetRecord(subject) {
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
  const originY = stageTop + Math.max(0, Math.floor((stageHeight - gridHeight) / 2));

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
}) {
  const config = getTemplateSelectionConfig(template);
  const random = createPrng(seed);
  const pairCatalog = buildPairCatalog(pokedexRows, config);
  const selectedPair = pickPair(pairCatalog, forcedTypePair, random);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const selectedSubjectCount = Math.max(
    config.selectedSubjectsMin,
    Math.min(config.selectedSubjectsMax, selectedPair.matches.length),
  );
  const selectedSubjects = sampleArray(selectedPair.matches, selectedSubjectCount, random)
    .sort((left, right) => left.national_dex_number - right.national_dex_number);
  const compatibleDisplayCount = Math.min(selectedPair.matches.length, config.selectedSubjectsMax);
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

  return {
    schema_version: 'poke-quizz-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_type_challenge',
    },
    template_id: template.template_id,
    generation_scope: config.generationScope,
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
      })),
    },
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
        selected_path: selectSeededFile(inventory.backgrounds, random),
      },
      type_icons: typeIcons,
      pokemon: selectedSubjects.map((subject) => buildSubjectAssetRecord(subject)),
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_timer_path: inventory.overlay_presets?.timer || null,
        selected_primary_pokeball_overlay_path: inventory.overlay_presets?.pokeball_primary || null,
        pokeball_grid: {
          overlay_path: inventory.overlay_presets?.pokeball_primary || null,
          count_basis: 'compatible_catalog_match_count_capped_to_12',
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
        selected_sound_effects: inventory.sound_effects,
      },
      outputs: {
        previews_directory: POKE_QUIZZ_ASSET_LAYOUT.previews,
        masters_directory: POKE_QUIZZ_ASSET_LAYOUT.masters,
      },
    },
    asset_inventory_snapshot: inventory,
    required_asset_gaps: [...new Set(requiredAssetGaps)],
  };
}
