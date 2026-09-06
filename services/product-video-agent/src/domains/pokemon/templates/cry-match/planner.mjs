import { spawn } from 'node:child_process';
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
const DEFAULT_REVEAL_HOLD_SECONDS = 1.6;
const DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS = 0.18;
const DEFAULT_TRANSITION_DURATION_SECONDS = 0.42;
const DEFAULT_FINAL_HOLD_SECONDS = 1;
const DEFAULT_SAMPLING_ATTEMPTS = 180;
const DEFAULT_CRY_GAP_SECONDS = 1.0;
const DEFAULT_SHORT_CRY_REPLAY_THRESHOLD_SECONDS = 1.0;

const readablePathAvailabilityCache = new Map();
const cryDownloadCache = new Map();
const crySourceUrlCache = new Map();
const cryDurationCache = new Map();

// Fall-back duration for when ffprobe isn't available or the cry file
// couldn't be probed. Real Pokemon cries land in the 0.4-1.0s range —
// 0.9s is a conservative estimate that avoids overlapping the second
// play when probing fails.
const FALLBACK_CRY_DURATION_SECONDS = 0.9;

async function probeCryDurationSeconds(cryPath) {
  const normalizedPath = String(cryPath || '').trim();
  if (!normalizedPath) return 0;
  if (cryDurationCache.has(normalizedPath)) return cryDurationCache.get(normalizedPath);
  const durationPromise = new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      normalizedPath,
    ]);
    let stdout = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const parsed = Number.parseFloat(String(stdout || '').trim());
      resolve(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
    });
  });
  cryDurationCache.set(normalizedPath, durationPromise);
  return durationPromise;
}

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'cry-match')) {
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

async function resolveCryMatchCrySourceUrl(subject = {}) {
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
    || await resolveCryMatchCrySourceUrl(subject)
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

function chooseSamplePool(subjects, usedSubjectIds, candidateCount) {
  const freshPool = subjects.filter((subject) => !usedSubjectIds.has(subject.id));
  return freshPool.length >= candidateCount ? freshPool : subjects;
}

// Pick N unique candidates that all have real sprite paths (checked earlier).
// Deferred: cry-availability filtering runs AFTER selection because cry
// paths need an async access() to verify. Any candidate without a real
// cry file falls back to the download path (resolveCryPath) which handles
// the miss gracefully.
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
    timeline.push({
      phase: `round_${round.round_number}_reveal`,
      duration_seconds: round.reveal_hold_seconds,
      spoken_text: '',
      on_screen_text: round.reveal_text,
    });
  }
  return timeline;
}

export async function planPokemonCryMatchChallenge({
  template,
  pokedexRows,
  seed = 'cry-match',
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
  const eligibleSubjects = collapseDuplicateSubjects(
    selectEligibleSubjects(pokedexRows, template?.selection_rules?.generation_scope || []),
  );
  if (eligibleSubjects.length < candidateCount) {
    throw new Error(`Cry Match requires at least ${candidateCount} Pokemon with local sprites, found ${eligibleSubjects.length}.`);
  }

  const selectedBackgroundPath = selectBackground(
    inventory.backgrounds,
    random,
    normalizedSelectionState,
  );
  const selectedTimerEndSoundPath = selectTemplateScopedSound(template, inventory, 'timer_end', 'timer_end');
  const selectedIntroRevealSoundPath = selectTemplateScopedSound(template, inventory, 'intro_slot_reveal', 'pokeball_intro');
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
  const samplingAttempts = ensurePositiveInteger(
    template?.selection_rules?.sampling_attempts_per_round,
    DEFAULT_SAMPLING_ATTEMPTS,
  );
  const usedSubjectIds = new Set();
  const rounds = [];

  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const selection = selectRoundCandidates({
      subjects: eligibleSubjects,
      candidateCount,
      attempts: samplingAttempts,
      random,
      usedSubjectIds,
    });
    if (!selection || !Array.isArray(selection.sample) || selection.sample.length < candidateCount) {
      throw new Error(`Cry Match could not find ${candidateCount} Pokemon for round ${roundIndex + 1}.`);
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

    // Prefer a target whose cry file we've verified — falls back to the
    // first candidate if nothing resolved (still lets the plan render;
    // the audio layer will detect the missing cry_path and skip playback).
    const candidatesWithCry = resolvedSubjects
      .map((subject, index) => ({ subject, index }))
      .filter(({ subject }) => String(subject.cry_path || '').trim());
    const targetPick = candidatesWithCry.length > 0
      ? candidatesWithCry[Math.floor(random() * candidatesWithCry.length)]
      : { subject: resolvedSubjects[0], index: 0 };
    const target = targetPick.subject;
    const correctCandidateIndex = targetPick.index;

    // The hook ("Whose cry is this?") only appears on round 1 as an
    // opening prompt — subsequent rounds are just "here's another cry,
    // guess it". Falls back to prompt_text/prompt_text_variants for
    // backwards compat if a caller wired hook_* text into prompt_*
    // instead.
    const promptText = roundIndex === 0
      ? pickSeededQuestionText(
        template?.question_contract?.hook_text || template?.question_contract?.prompt_text,
        (template?.question_contract?.hook_text_variants?.length
          ? template.question_contract.hook_text_variants
          : template?.question_contract?.prompt_text_variants),
        random,
      )
      : '';
    const spokenPromptText = promptText;
    const revealText = String(revealTemplate || '').replaceAll('{winner_name}', target.name);
    const candidates = resolvedSubjects.map((subject, index) => ({
      index,
      label: String.fromCharCode(65 + index),
      is_correct: index === correctCandidateIndex,
      subject,
    }));

    // Cry playback schedule — LOCAL to the round (offsets from
    // countdown start). The visual equalizer envelope and the audio
    // cue timings both read from this single source of truth so
    // they stay in lockstep.
    //
    // Replay policy (operator ask 2026-09-06 late):
    //   - Short cries (probed duration < short_cry_replay_threshold_seconds,
    //     default 1s) play TWICE with a start-to-start gap of
    //     gap_between_plays_seconds (default 1s), so the viewer gets
    //     two chances to recognize a fast cry.
    //   - Long cries (>= threshold) play ONCE — a long cry already
    //     gives the viewer plenty of listening time.
    // repeat_count is derived here per-cry; the template no longer
    // carries a fixed repeat_count.
    const cryPlaybackConfig = template?.audio?.cry_playback || {};
    const gapSeconds = ensureFiniteNumber(cryPlaybackConfig.gap_between_plays_seconds, DEFAULT_CRY_GAP_SECONDS);
    const shortCryThresholdSeconds = ensureFiniteNumber(
      cryPlaybackConfig.short_cry_replay_threshold_seconds,
      DEFAULT_SHORT_CRY_REPLAY_THRESHOLD_SECONDS,
    );
    const probedDuration = await probeCryDurationSeconds(target.cry_path);
    const effectiveCryDurationSeconds = probedDuration > 0
      ? probedDuration
      : FALLBACK_CRY_DURATION_SECONDS;
    const repeatCount = effectiveCryDurationSeconds < shortCryThresholdSeconds ? 2 : 1;
    const cryPlaybackWindowsLocal = [];
    for (let playIndex = 0; playIndex < repeatCount; playIndex += 1) {
      // Start-to-start stride for short cries; only one play anyway
      // when the cry is long, so the stride value doesn't matter for
      // playIndex 0.
      const localStart = Number((playIndex * gapSeconds).toFixed(3));
      cryPlaybackWindowsLocal.push({
        start_offset_seconds: localStart,
        end_offset_seconds: Number((localStart + effectiveCryDurationSeconds).toFixed(3)),
      });
    }

    rounds.push({
      round_number: roundIndex + 1,
      round_label: `${roundIndex + 1}/${roundCount}`,
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
      winner_subject_id: target.id,
      target_cry_path: target.cry_path || '',
      cry_playback_windows_local: cryPlaybackWindowsLocal,
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
  if (!selectedIntroRevealSoundPath) requiredAssetGaps.push('intro_slot_reveal_sfx_missing');
  if (!inventory?.overlay_presets?.grass_plateau) requiredAssetGaps.push('grass_plateau_overlay_missing');
  if (!inventory?.overlay_presets?.pokeball_primary) requiredAssetGaps.push('intro_pokeball_overlay_missing');
  const roundsMissingCry = rounds.filter((round) => !round.target_cry_path).length;
  if (roundsMissingCry > 0) requiredAssetGaps.push(`target_cry_missing_${roundsMissingCry}_round(s)`);

  return {
    schema_version: 'poke-quizz-cry-match-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_cry_match',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'cry_target').trim().toLowerCase() || 'cry_target',
      difficulty_id: selectedRoundCountDifficulty?.id || null,
      round_count: roundCount,
      selected_subject_count: uniqueSelectedSubjects.length,
      display_subject_count: roundCount * candidateCount,
      selected_subjects: uniqueSelectedSubjects,
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      // Only emit a TTS line when the round actually has spoken text
      // (round 1 only, per the hook_text convention). Empty entries
      // would either be silent-generated audio wasting cache space or
      // produce a "no text" TTS error depending on the provider.
      lines: rounds
        .map((round) => ({
          role: `round-${round.round_number}-prompt`,
          text: round.spoken_prompt_text || round.prompt_text,
        }))
        .filter((line) => String(line.text || '').trim()),
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
