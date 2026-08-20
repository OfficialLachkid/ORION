import {
  buildPokeQuizzPreviewDirectory,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../../../poke-quizz-asset-layout.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';
import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
} from '../../../../poke-quizz-asset-inventory.mjs';

const DEFAULT_ROUND_COUNT = 3;
const DEFAULT_REVEAL_HOLD_SECONDS = 1.05;
const DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS = 0.24;
const DEFAULT_HOOK_HOLD_SECONDS = 1.1;
const DEFAULT_TRANSITION_DURATION_SECONDS = 0.42;
const DEFAULT_FINAL_HOLD_SECONDS = 1.0;
const DEFAULT_SHINY_SPARKLE_DURATION_SECONDS = 0.9;
const DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER = 1.35;
const DECOY_COLOR_PROFILES = Object.freeze([
  Object.freeze({ id: 'warm_shift', hue_degrees: 32, saturation: 1.32, brightness: 0.09, contrast: 1.14 }),
  Object.freeze({ id: 'cool_shift', hue_degrees: -38, saturation: 1.4, brightness: -0.06, contrast: 1.16 }),
  Object.freeze({ id: 'mint_shift', hue_degrees: 82, saturation: 1.28, brightness: 0.08, contrast: 1.12 }),
  Object.freeze({ id: 'violet_shift', hue_degrees: -104, saturation: 1.42, brightness: 0.03, contrast: 1.18 }),
  Object.freeze({ id: 'amber_shift', hue_degrees: 132, saturation: 1.22, brightness: 0.11, contrast: 1.15 }),
  Object.freeze({ id: 'rose_shift', hue_degrees: -148, saturation: 1.48, brightness: -0.05, contrast: 1.19 }),
]);

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'know-your-shiny')) {
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

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
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
    .filter((row) => String(row.shiny_sprite_path || '').trim())
    .filter((row) => (
      generationFilter.size === 0
      || generationFilter.has(Number.parseInt(String(row.generation || ''), 10))
    ))
    .filter((row) => !String(row.shiny_sprite_path || '').toLowerCase().includes('/placeholder/'));
}

function collapseDuplicateSubjects(subjects = []) {
  const seen = new Set();
  const unique = [];
  for (const subject of subjects) {
    const key = normalizeSlug(subject.shiny_sprite_path || subject.slug || subject.name || subject.id);
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

function selectTemplateScopedTimerEndSound(template, inventory) {
  const soundEffects = inventory?.sound_effects || {};
  const fallbackPath = soundEffects.timer_end || null;
  const preferredKeywords = (Array.isArray(template?.audio?.sound_effects?.timer_end?.preferred_keywords)
    ? template.audio.sound_effects.timer_end.preferred_keywords
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

function resolveShinyRevealState(template, inventory) {
  const configured = template?.reveal?.shiny && typeof template.reveal.shiny === 'object'
    ? template.reveal.shiny
    : {};
  const sparkleOverlayPath = inventory?.overlay_presets?.shiny_sparkle || null;
  const shinySoundPath = inventory?.sound_effects?.shiny || null;
  const enabled = configured.enabled !== false;
  const activationBlockers = [];
  if (!sparkleOverlayPath) activationBlockers.push('shiny_sparkle_overlay_missing');
  if (!shinySoundPath) activationBlockers.push('shiny_sound_effect_missing');
  return {
    enabled,
    active: enabled && activationBlockers.length === 0,
    sparkle_overlay_path: sparkleOverlayPath,
    sound_effect_path: shinySoundPath,
    sparkle_duration_seconds: Number(
      configured.sparkle_duration_seconds ?? DEFAULT_SHINY_SPARKLE_DURATION_SECONDS,
    ),
    sparkle_scale_multiplier: Number(
      configured.sparkle_scale_multiplier ?? DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
    ),
    activation_blockers: activationBlockers,
  };
}

function buildCandidateSet(random) {
  const correctIndex = Math.floor(random() * 4);
  const decoyProfiles = shuffle(DECOY_COLOR_PROFILES, random).slice(0, 3);
  const candidates = [];
  let decoyIndex = 0;
  for (let index = 0; index < 4; index += 1) {
    if (index === correctIndex) {
      candidates.push({
        index,
        role: 'correct',
        label: String.fromCharCode(65 + index),
        is_correct: true,
        hue_degrees: 0,
        saturation: 1,
        brightness: 0,
        contrast: 1,
      });
      continue;
    }
    const decoy = decoyProfiles[decoyIndex] || DECOY_COLOR_PROFILES[0];
    candidates.push({
      index,
      role: decoy.id,
      label: String.fromCharCode(65 + index),
      is_correct: false,
      hue_degrees: decoy.hue_degrees,
      saturation: decoy.saturation,
      brightness: decoy.brightness,
      contrast: decoy.contrast,
    });
    decoyIndex += 1;
  }
  return {
    correctIndex,
    candidates,
  };
}

function buildTimeline({ hookText, rounds }) {
  const timeline = [];
  if (hookText) {
    timeline.push({
      phase: 'hook',
      duration_seconds: rounds[0]?.scene_lead_seconds || DEFAULT_HOOK_HOLD_SECONDS,
      spoken_text: hookText,
      on_screen_text: hookText,
    });
  }
  for (const round of rounds) {
    timeline.push({
      phase: `round_${round.round_number}_prompt`,
      duration_seconds: round.scene_lead_seconds,
      spoken_text: '',
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

export async function planKnowYourShinyChallenge({
  template,
  pokedexRows,
  seed = 'know-your-shiny',
  assetInventory = null,
  selectionState = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const roundCount = ensurePositiveInteger(template?.selection_rules?.round_count, DEFAULT_ROUND_COUNT);
  const countdownFrom = ensurePositiveInteger(template?.layout?.timer?.countdown_from, 3);
  const countdownTo = Number.parseInt(String(template?.layout?.timer?.countdown_to ?? 0), 10);
  const eligibleSubjects = collapseDuplicateSubjects(
    selectEligibleSubjects(pokedexRows, template?.selection_rules?.generation_scope || []),
  );
  if (eligibleSubjects.length < roundCount) {
    throw new Error(`Know your shiny requires at least ${roundCount} Pokemon with local shiny sprites, found ${eligibleSubjects.length}.`);
  }

  const selectedSubjects = shuffle(eligibleSubjects, random).slice(0, roundCount);
  const selectedBackgroundPath = selectBackground(
    inventory.backgrounds,
    random,
    normalizedSelectionState,
  );
  const selectedTimerPath = inventory?.overlay_presets?.timer_countdown || inventory?.overlay_presets?.timer || null;
  const selectedTimerEndSoundPath = selectTemplateScopedTimerEndSound(template, inventory);
  const shinyReveal = resolveShinyRevealState(template, inventory);
  const hookText = pickSeededQuestionText(
    template?.question_contract?.hook_text,
    template?.question_contract?.hook_text_variants,
    random,
  );
  const promptText = pickSeededQuestionText(
    template?.question_contract?.prompt_text,
    template?.question_contract?.prompt_text_variants,
    random,
  );
  const revealText = pickSeededQuestionText(
    template?.question_contract?.reveal_text,
    template?.question_contract?.reveal_text_variants,
    random,
  );

  const revealHoldSeconds = Number(template?.layout?.rounds?.reveal_hold_seconds ?? DEFAULT_REVEAL_HOLD_SECONDS);
  const preCountdownHoldSeconds = Number(template?.layout?.rounds?.pre_countdown_hold_seconds ?? DEFAULT_PRE_COUNTDOWN_HOLD_SECONDS);
  const hookHoldSeconds = Number(template?.layout?.rounds?.hook_hold_seconds ?? DEFAULT_HOOK_HOLD_SECONDS);
  const transitionDurationSeconds = Number(template?.layout?.rounds?.transition_duration_seconds ?? DEFAULT_TRANSITION_DURATION_SECONDS);
  const finalHoldSeconds = Number(template?.layout?.rounds?.final_hold_seconds ?? DEFAULT_FINAL_HOLD_SECONDS);

  const rounds = selectedSubjects.map((subject, index) => {
    const candidateSet = buildCandidateSet(random);
    const sceneLeadSeconds = index === 0
      ? hookHoldSeconds + preCountdownHoldSeconds
      : transitionDurationSeconds + preCountdownHoldSeconds;
    return {
      round_number: index + 1,
      round_label: `${index + 1}/${roundCount}`,
      subject: {
        pokedex_id: subject.id,
        national_dex_number: subject.national_dex_number,
        name: subject.name,
        generation: subject.generation,
        region: subject.region,
        sprite_path: subject.sprite_path,
        shiny_sprite_path: subject.shiny_sprite_path,
        render_sprite_path: subject.shiny_sprite_path,
        sprite_source_url: subject.sprite_source_url || null,
        shiny_sprite_source_url: subject.shiny_sprite_source_url || null,
        types: subject.types,
      },
      prompt_text: promptText,
      reveal_text: revealText,
      scene_lead_seconds: sceneLeadSeconds,
      countdown_from: countdownFrom,
      countdown_to: countdownTo,
      countdown_duration_seconds: countdownFrom,
      reveal_hold_seconds: revealHoldSeconds,
      transition_duration_seconds: index === roundCount - 1 ? 0 : transitionDurationSeconds,
      final_hold_seconds: index === roundCount - 1 ? finalHoldSeconds : 0,
      correct_candidate_index: candidateSet.correctIndex,
      candidates: candidateSet.candidates,
    };
  });

  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('background_missing');
  if (!inventory?.sound_effects?.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!selectedTimerEndSoundPath) requiredAssetGaps.push('timer_end_sfx_missing');
  requiredAssetGaps.push(...shinyReveal.activation_blockers);

  return {
    schema_version: 'poke-quizz-know-your-shiny-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_know_your_shiny',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'random').trim().toLowerCase() || 'random',
      round_count: roundCount,
      type_pair: [],
      selected_subject_count: selectedSubjects.length,
      display_subject_count: roundCount * 4,
      selected_subjects: rounds.map((round) => ({
        ...round.subject,
        reveal_variant: 'shiny',
      })),
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: hookText ? [{ role: 'hook', text: hookText }] : [],
    },
    timeline: buildTimeline({ hookText, rounds }),
    rounds,
    shiny_reveal: shinyReveal,
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_timer_path: selectedTimerPath,
        selected_timer_countdown_path: selectedTimerPath,
        selected_timer_alarm_path: inventory?.overlay_presets?.timer_alarm || null,
        selected_shiny_sparkle_path: shinyReveal.sparkle_overlay_path,
        available_paths: inventory?.overlays || [],
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        selected_battle_intro_music_path: selectSeededFile(inventory?.music || [], random),
        selected_sound_effects: {
          ...(inventory?.sound_effects || {}),
          countdown_tick: inventory?.sound_effects?.countdown_tick || null,
          timer_end: selectedTimerEndSoundPath,
          shiny: shinyReveal.sound_effect_path,
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
