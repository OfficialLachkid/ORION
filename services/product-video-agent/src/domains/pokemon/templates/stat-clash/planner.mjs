import { access, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
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
import { normalizeBaseStats } from '../tournament/battle-logic.mjs';

const DEFAULT_ROUND_COUNT = 3;
const DEFAULT_CANDIDATE_COUNT = 4;
const DEFAULT_REVEAL_HOLD_SECONDS = 1.2;
const DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS = 0.18;
const DEFAULT_TRANSITION_DURATION_SECONDS = 0.42;
const DEFAULT_FINAL_HOLD_SECONDS = 1;
const DEFAULT_SAMPLING_ATTEMPTS = 180;
const DEFAULT_MIN_STAT_VALUE = 35;
const DEFAULT_MIN_WINNER_MARGIN = 6;
const DEFAULT_MAX_WINNER_MARGIN = 28;
const DEFAULT_MAX_STAT_SPREAD = 42;
const STAT_LABELS = Object.freeze({
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  special_attack: 'Sp. Atk',
  special_defense: 'Sp. Def',
  speed: 'Speed',
});
const STAT_SPOKEN_LABELS = Object.freeze({
  hp: 'HP',
  attack: 'Attack',
  defense: 'Defense',
  special_attack: 'Special Attack',
  special_defense: 'Special Defense',
  speed: 'Speed',
});

const readablePathAvailabilityCache = new Map();
const cryDownloadCache = new Map();
const crySourceUrlCache = new Map();

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'stat-clash')) {
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

function readSubjectPokemonApiMetadata(subject, key) {
  const pokemonApi = subject?.metadata?.pokemon_api && typeof subject.metadata.pokemon_api === 'object'
    ? subject.metadata.pokemon_api
    : {};
  return pokemonApi[key];
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

async function resolveStatClashCrySourceUrl(subject = {}) {
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

function pickSeededQuestionText(primaryText, variants, random) {
  const options = normalizeQuestionTextOptions(primaryText, variants);
  if (options.length === 0) {
    return '';
  }
  return options[Math.floor(random() * options.length)] || options[0];
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

function buildRoundCountDifficultyCatalog(template) {
  const configuredLevels = template?.selection_rules?.round_count_levels || {};
  const difficultyWeights = template?.selection_rules?.round_count_weights || {};
  return Object.entries(configuredLevels)
    .map(([difficultyId, entry]) => ({
      id: String(difficultyId || '').trim(),
      round_count: ensurePositiveInteger(entry?.round_count, 0),
      weight: Math.max(1, ensurePositiveInteger(difficultyWeights[difficultyId], 1)),
    }))
    .filter((entry) => entry.id && entry.round_count > 0);
}

function chooseRoundCountDifficulty(difficultyCatalog, random) {
  if (!Array.isArray(difficultyCatalog) || difficultyCatalog.length === 0) {
    return null;
  }
  const weightedPool = difficultyCatalog.flatMap((entry) => (
    Array.from({ length: entry.weight }, () => entry)
  ));
  return weightedPool[Math.floor(random() * weightedPool.length)] || difficultyCatalog[0];
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
    .filter((row) => {
      const stats = normalizeBaseStats(row?.metadata?.base_stats || row?.base_stats || {});
      return Object.values(stats).every((value) => Number.isFinite(value) && value > 0);
    })
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

function buildTypeDisplay(types = []) {
  return (Array.isArray(types) ? types : [])
    .map((type) => String(type || '').trim())
    .filter(Boolean);
}

function titleCase(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatPrompt(templateText, statLabel) {
  return String(templateText || '').replaceAll('{stat}', statLabel);
}

function formatReveal(templateText, statLabel, winnerName) {
  return String(templateText || '')
    .replaceAll('{stat}', statLabel)
    .replaceAll('{winner_name}', winnerName);
}

function resolveSpokenStatLabel(statKey) {
  return STAT_SPOKEN_LABELS[statKey] || titleCase(String(statKey || '').replaceAll('_', ' '));
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

async function resolveRenderSpritePath(subject) {
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
    || await resolveStatClashCrySourceUrl(subject)
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

function statValueFor(subject, statKey) {
  return normalizeBaseStats(subject?.metadata?.base_stats || subject?.base_stats || {})[statKey] || 0;
}

function sanitizeSubject(subject, renderSpritePath, cryPath) {
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
    render_sprite_path: renderSpritePath,
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

function buildStatPool(template, roundCount, random) {
  const configuredPool = (Array.isArray(template?.selection_rules?.stat_pool)
    ? template.selection_rules.stat_pool
    : []
  )
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => Object.hasOwn(STAT_LABELS, value));
  const pool = configuredPool.length > 0 ? configuredPool : Object.keys(STAT_LABELS);
  const shuffled = shuffle(pool, random);
  const selected = [];
  while (selected.length < roundCount) {
    selected.push(shuffled[selected.length % shuffled.length]);
  }
  return selected;
}

function chooseSamplePool(subjects, usedSubjectIds, candidateCount) {
  const freshPool = subjects.filter((subject) => !usedSubjectIds.has(subject.id));
  return freshPool.length >= candidateCount ? freshPool : subjects;
}

function scoreCandidateSet(candidateSubjects, statKey, rules) {
  const statValues = candidateSubjects.map((subject) => statValueFor(subject, statKey));
  const sortedValues = [...statValues].sort((left, right) => right - left);
  const highest = sortedValues[0] || 0;
  const secondHighest = sortedValues[1] || 0;
  const lowest = sortedValues.at(-1) || 0;
  const winnerMargin = highest - secondHighest;
  const spread = highest - lowest;
  const passesMinValue = statValues.every((value) => value >= rules.minStatValue);
  const uniqueWinner = candidateSubjects.filter((subject) => (
    statValueFor(subject, statKey) === highest
  )).length === 1;
  const exact = (
    passesMinValue
    && uniqueWinner
    && winnerMargin >= rules.minWinnerMargin
    && winnerMargin <= rules.maxWinnerMargin
    && spread <= rules.maxStatSpread
  );
  const penalty = (
    Math.max(0, rules.minWinnerMargin - winnerMargin)
    + Math.max(0, winnerMargin - rules.maxWinnerMargin)
    + Math.max(0, spread - rules.maxStatSpread)
    + (passesMinValue ? 0 : 40)
    + (uniqueWinner ? 0 : 80)
  );
  return {
    exact,
    penalty,
    highest,
    winnerMargin,
    spread,
  };
}

function selectRoundCandidates({
  subjects,
  statKey,
  candidateCount,
  attempts,
  random,
  rules,
  usedSubjectIds,
}) {
  let best = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const samplePool = chooseSamplePool(subjects, usedSubjectIds, candidateCount);
    const sample = shuffle(samplePool, random).slice(0, candidateCount);
    if (sample.length < candidateCount) {
      break;
    }
    const score = scoreCandidateSet(sample, statKey, rules);
    if (!best || score.penalty < best.score.penalty) {
      best = { sample, score };
    }
    if (score.exact) {
      break;
    }
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
    timeline.push({
      phase: `round_${round.round_number}_reveal`,
      duration_seconds: round.reveal_hold_seconds,
      spoken_text: '',
      on_screen_text: round.reveal_text,
    });
  }
  return timeline;
}

export async function planPokemonStatClashChallenge({
  template,
  pokedexRows,
  seed = 'stat-clash',
  assetInventory = null,
  selectionState = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const roundCountDifficultyCatalog = buildRoundCountDifficultyCatalog(template);
  const selectedRoundCountDifficulty = chooseRoundCountDifficulty(roundCountDifficultyCatalog, random);
  const roundCount = selectedRoundCountDifficulty?.round_count
    ?? ensurePositiveInteger(template?.selection_rules?.round_count, DEFAULT_ROUND_COUNT);
  const candidateCount = ensurePositiveInteger(
    template?.selection_rules?.candidate_count,
    DEFAULT_CANDIDATE_COUNT,
  );
  const countdownFrom = ensurePositiveInteger(template?.layout?.timer?.countdown_from, 4);
  const countdownTo = Number.parseInt(String(template?.layout?.timer?.countdown_to ?? 0), 10);
  const rules = {
    minStatValue: ensureFiniteNumber(template?.selection_rules?.min_stat_value, DEFAULT_MIN_STAT_VALUE),
    minWinnerMargin: ensureFiniteNumber(template?.selection_rules?.min_winner_margin, DEFAULT_MIN_WINNER_MARGIN),
    maxWinnerMargin: ensureFiniteNumber(template?.selection_rules?.max_winner_margin, DEFAULT_MAX_WINNER_MARGIN),
    maxStatSpread: ensureFiniteNumber(template?.selection_rules?.max_stat_spread, DEFAULT_MAX_STAT_SPREAD),
  };
  const eligibleSubjects = collapseDuplicateSubjects(
    selectEligibleSubjects(pokedexRows, template?.selection_rules?.generation_scope || []),
  );
  if (eligibleSubjects.length < candidateCount) {
    throw new Error(`Stat Clash requires at least ${candidateCount} Pokemon with local sprites and base stats, found ${eligibleSubjects.length}.`);
  }

  const selectedBackgroundPath = selectBackground(
    inventory.backgrounds,
    random,
    normalizedSelectionState,
  );
  const selectedTimerEndSoundPath = selectTemplateScopedSound(template, inventory, 'timer_end', 'timer_end');
  const selectedIntroRevealSoundPath = selectTemplateScopedSound(template, inventory, 'intro_slot_reveal', 'pokeball_intro');
  const promptTemplate = pickSeededQuestionText(
    template?.question_contract?.prompt_text,
    template?.question_contract?.prompt_text_variants,
    random,
  );
  const revealTemplate = pickSeededQuestionText(
    template?.question_contract?.reveal_text,
    template?.question_contract?.reveal_text_variants,
    random,
  );
  const revealHoldSeconds = Number(template?.layout?.rounds?.reveal_hold_seconds ?? DEFAULT_REVEAL_HOLD_SECONDS);
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
  const sceneLeadSeconds = Number((
    introInitialDelaySeconds
    + Math.max(0, candidateCount - 1) * introStaggerSeconds
    + introPokeballLeadSeconds
    + introDurationSeconds
    + preCountdownHoldSeconds
  ).toFixed(3));
  const statPool = buildStatPool(template, roundCount, random);
  const samplingAttempts = ensurePositiveInteger(
    template?.selection_rules?.sampling_attempts_per_round,
    DEFAULT_SAMPLING_ATTEMPTS,
  );
  const usedSubjectIds = new Set();
  const rounds = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const statKey = statPool[roundIndex];
    const selection = selectRoundCandidates({
      subjects: eligibleSubjects,
      statKey,
      candidateCount,
      attempts: samplingAttempts,
      random,
      rules,
      usedSubjectIds,
    });
    if (!selection || !Array.isArray(selection.sample) || selection.sample.length < candidateCount) {
      throw new Error(`Stat Clash could not find ${candidateCount} Pokemon for ${statKey}.`);
    }

    const candidateRevealOrder = shuffle(
      Array.from({ length: candidateCount }, (_, index) => index),
      random,
    );
    const resolvedSubjects = await Promise.all(selection.sample.map(async (subject) => {
      const [renderSpritePath, cryPath] = await Promise.all([
        resolveRenderSpritePath(subject),
        resolveCryPath(subject),
      ]);
      return sanitizeSubject(subject, renderSpritePath, cryPath);
    }));
    resolvedSubjects.forEach((subject) => usedSubjectIds.add(subject.id));

    const statLabel = STAT_LABELS[statKey] || titleCase(statKey.replaceAll('_', ' '));
    const spokenStatLabel = resolveSpokenStatLabel(statKey);
    const promptText = formatPrompt(promptTemplate, statLabel);
    const spokenPromptText = formatPrompt(promptTemplate, spokenStatLabel);
    const sortedByStat = [...resolvedSubjects]
      .sort((left, right) => statValueFor(right, statKey) - statValueFor(left, statKey));
    const winner = sortedByStat[0];
    const highestStatValue = statValueFor(winner, statKey);
    const correctCandidateIndex = resolvedSubjects.findIndex((subject) => subject.id === winner.id);
    const revealText = formatReveal(revealTemplate, statLabel, winner.name);
    const candidates = resolvedSubjects.map((subject, index) => ({
      index,
      label: String.fromCharCode(65 + index),
      is_correct: index === correctCandidateIndex,
      stat_value: statValueFor(subject, statKey),
      subject,
    }));

    rounds.push({
      round_number: roundIndex + 1,
      round_label: `${roundIndex + 1}/${roundCount}`,
      stat_key: statKey,
      stat_label: statLabel,
      spoken_stat_label: spokenStatLabel,
      prompt_text: promptText,
      spoken_prompt_text: spokenPromptText,
      reveal_text: revealText,
      scene_lead_seconds: sceneLeadSeconds,
      countdown_from: countdownFrom,
      countdown_to: countdownTo,
      countdown_duration_seconds: countdownFrom,
      reveal_hold_seconds: revealHoldSeconds,
      transition_duration_seconds: roundIndex === roundCount - 1 ? 0 : transitionDurationSeconds,
      final_hold_seconds: roundIndex === roundCount - 1 ? finalHoldSeconds : 0,
      correct_candidate_index: correctCandidateIndex,
      winner_subject_id: winner.id,
      highest_stat_value: highestStatValue,
      candidate_reveal_order: candidateRevealOrder,
      selection_score: {
        winner_margin: selection.score.winnerMargin,
        spread: selection.score.spread,
        exact: selection.score.exact,
        penalty: selection.score.penalty,
      },
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
  if (!selectedIntroRevealSoundPath) requiredAssetGaps.push('intro_slot_reveal_sfx_missing');
  if (!inventory?.overlay_presets?.grass_plateau) requiredAssetGaps.push('grass_plateau_overlay_missing');
  if (!inventory?.overlay_presets?.pokeball_primary) requiredAssetGaps.push('intro_pokeball_overlay_missing');

  return {
    schema_version: 'poke-quizz-stat-clash-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_stat_clash',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'highest_stat').trim().toLowerCase() || 'highest_stat',
      difficulty_id: selectedRoundCountDifficulty?.id || null,
      round_count: roundCount,
      primary_stat_key: rounds[0]?.stat_key || statPool[0] || 'hp',
      stat_keys: rounds.map((round) => round.stat_key),
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
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_grass_plateau_path: inventory?.overlay_presets?.grass_plateau || null,
        selected_intro_pokeball_path: inventory?.overlay_presets?.pokeball_primary || null,
        available_paths: inventory?.overlays || [],
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
          intro_slot_reveal: selectedIntroRevealSoundPath,
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
