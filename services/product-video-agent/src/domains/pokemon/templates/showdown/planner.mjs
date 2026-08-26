import { access } from 'node:fs/promises';
import {
  buildPokeQuizzAnimatedSpritePath,
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
  resolveShowdownBattle,
  sumBaseStats,
} from './battle-logic.mjs';

const DEFAULT_PARTICIPANT_COUNT = 4;
const mirroredSpriteAvailabilityCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-showdown')) {
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

async function resolveShowdownSpritePath(subject = {}) {
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

function buildParticipantRecord(subject, renderSpritePath, bracketSeedIndex) {
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
    animated_sprite_path: String(subject.animated_sprite_path || '').trim(),
    render_sprite_path: String(renderSpritePath || subject.sprite_path || '').trim(),
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
  const battle = resolveShowdownBattle({
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
      { role: `${match.match_id}-intro`, text: match.commentary_text },
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
      spoken_text: `${match.commentary_text} ${match.winner_line_text}`.trim(),
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

export async function planPokemonShowdownChallenge({
  template,
  pokedexRows,
  seed = 'pokemon-showdown',
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
    throw new Error(`Showdown requires at least ${participantCount} Pokemon with local sprites and base stats, found ${eligibleCombatants.length}.`);
  }

  const selectedSubjects = shuffle(eligibleCombatants, random).slice(0, participantCount);
  const participants = await Promise.all(selectedSubjects.map(async (subject, index) => (
    buildParticipantRecord(
      subject,
      await resolveShowdownSpritePath(subject),
      index,
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
  const selectedBackgroundPath = selectBackground(
    inventory.backgrounds,
    random,
    normalizedSelectionState,
  );
  const introPokeballOverlayPath = (
    inventory?.overlay_presets?.pokeball_primary
    || inventory?.overlay_presets?.pokeball_open_close
    || null
  );
  const introSlotRevealSoundPath = selectIntroSlotRevealSoundPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.intro_slot_reveal || {},
  );
  const winnerRevealSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.winner_reveal || {},
  );
  const bracketProgressSoundPath = selectPreferredSoundEffectPath(
    inventory?.sound_effects || {},
    template?.audio?.sound_effects?.bracket_progress || {},
    null,
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
    template?.audio?.sound_effects?.bracket_progress?.enabled !== false
    && !bracketProgressSoundPath
  ) {
    requiredAssetGaps.push('bracket_progress_sfx_missing');
  }
  if (!participants.every((participant) => participant.render_sprite_path || participant.sprite_path)) {
    requiredAssetGaps.push('pokemon_sprite_local_assets_missing');
  }

  return {
    schema_version: 'poke-quizz-showdown-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_showdown',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'single_elimination_bracket').trim().toLowerCase() || 'single_elimination_bracket',
      participant_count: participants.length,
      round_count: matches.length,
      selected_subject_count: participants.length,
      selected_subjects: participants.map((participant) => ({
        pokedex_id: participant.pokedex_id,
        national_dex_number: participant.national_dex_number,
        name: participant.name,
        generation: participant.generation,
        region: participant.region,
        types: participant.types,
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
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        available_paths: inventory?.overlays || [],
        selected_intro_pokeball_path: introPokeballOverlayPath,
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        selected_battle_intro_music_path: selectSeededFile(inventory?.music || [], random),
        selected_sound_effects: {
          ...(inventory?.sound_effects || {}),
          intro_slot_reveal: introSlotRevealSoundPath,
          bracket_progress: bracketProgressSoundPath,
          winner_reveal: winnerRevealSoundPath,
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
