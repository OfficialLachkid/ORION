import {
  scanPokeQuizzAssetInventory,
  selectSeededFile,
  selectTypeIconSet,
} from '../../../../poke-quizz-asset-inventory.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../../../poke-quizz-asset-layout.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'poke-quizz-speed-quiz')) {
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

function titleCaseWord(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ensureNonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeTypeCardinalityMode(template = {}) {
  const raw = String(template?.selection_rules?.type_cardinality || 'any')
    .trim()
    .toLowerCase();
  if (['single', 'single-type-only'].includes(raw)) {
    return 'single';
  }
  if (['dual', 'dual-type-only'].includes(raw)) {
    return 'dual';
  }
  return 'any';
}

function matchesTypeCardinality(types = [], mode = 'any') {
  const count = Array.isArray(types) ? types.filter(Boolean).length : 0;
  if (mode === 'single') {
    return count === 1;
  }
  if (mode === 'dual') {
    return count >= 2;
  }
  return count >= 1;
}

function normalizeBackgroundPath(backgroundPath) {
  return String(backgroundPath || '')
    .trim()
    .replaceAll('\\', '/')
    .toLowerCase();
}

function selectHookText(template, random) {
  const variants = Array.isArray(template?.question_contract?.hook_text_variants)
    ? template.question_contract.hook_text_variants
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    : [];
  if (variants.length > 0) {
    return variants[Math.floor(random() * variants.length)] || variants[0];
  }
  return String(template?.question_contract?.hook_text || 'Can you get 5/5?').trim() || 'Can you get 5/5?';
}

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function selectGifBackground(gifBackgrounds, random, selectionState) {
  const candidates = (Array.isArray(gifBackgrounds) ? gifBackgrounds : []).filter(Boolean);
  if (candidates.length === 0) {
    return null;
  }

  const lastBackgroundPath = normalizeBackgroundPath(selectionState?.last_background_path);
  const filteredCandidates = candidates.filter((backgroundPath) => (
    normalizeBackgroundPath(backgroundPath) !== lastBackgroundPath
  ));
  return selectSeededFile(filteredCandidates.length > 0 ? filteredCandidates : candidates, random);
}

function buildTypeLabel(types = []) {
  return types.map((type) => titleCaseWord(type)).join(' / ');
}

function buildTypeIconRecord(type, localPath, iconSet) {
  return {
    type,
    local_path: localPath,
    style: iconSet.style,
    style_variant: iconSet.style_variant,
  };
}

function buildTimeline({ hookText, rounds }) {
  const timeline = [{
    phase: 'hook',
    duration_seconds: rounds[0]?.scene_lead_seconds || 0,
    spoken_text: hookText,
    on_screen_text: hookText,
  }];

  rounds.forEach((round) => {
    timeline.push(
      {
        phase: `round_${round.round_number}_countdown`,
        duration_seconds: round.countdown_duration_seconds,
        countdown_from: round.countdown_from,
        countdown_to: round.countdown_to,
      },
      {
        phase: `round_${round.round_number}_reveal`,
        duration_seconds: round.reveal_hold_seconds,
        on_screen_text: round.type_label,
      },
    );
    if (round.transition_duration_seconds > 0) {
      timeline.push({
        phase: `round_${round.round_number}_transition`,
        duration_seconds: round.transition_duration_seconds,
      });
    }
  });

  return timeline;
}

export async function planPokemonTypeSpeedQuizChallenge({
  template,
  pokedexRows,
  seed = 'poke-quizz-speed-quiz',
  assetInventory = null,
  selectionState = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const roundCount = ensurePositiveInteger(template?.selection_rules?.round_count, 5);
  const countdownFrom = ensurePositiveInteger(template?.layout?.timer?.countdown_from, 3);
  const countdownTo = Number.parseInt(String(template?.layout?.timer?.countdown_to ?? 0), 10);
  const typeCardinalityMode = normalizeTypeCardinalityMode(template);
  const transitionDurationSeconds = ensureNonNegativeNumber(
    template?.layout?.rounds?.transition_duration_seconds,
    0.42,
  );
  const revealHoldSeconds = ensureNonNegativeNumber(
    template?.layout?.rounds?.reveal_hold_seconds,
    0.92,
  );
  const preCountdownHoldSeconds = ensureNonNegativeNumber(
    template?.layout?.rounds?.pre_countdown_hold_seconds,
    0.18,
  );
  const hookHoldSeconds = ensureNonNegativeNumber(
    template?.layout?.rounds?.hook_hold_seconds,
    1.1,
  );
  const finalHoldSeconds = ensureNonNegativeNumber(
    template?.layout?.rounds?.final_hold_seconds,
    1.12,
  );

  const eligibleSubjects = (Array.isArray(pokedexRows) ? pokedexRows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => String(row.name || '').trim())
    .filter((row) => Array.isArray(row.types) && row.types.length > 0)
    .filter((row) => String(row.sprite_path || '').trim())
    .filter((row) => matchesTypeCardinality(row.types, typeCardinalityMode));
  if (eligibleSubjects.length < roundCount) {
    throw new Error(`No sufficient localized Pokemon rows are available for a ${typeCardinalityMode} speed quiz. Need ${roundCount}, found ${eligibleSubjects.length}.`);
  }

  const shuffledSubjects = shuffle(eligibleSubjects, random);
  const selectedSubjects = shuffledSubjects.slice(0, roundCount);
  const selectedBackgroundPath = selectGifBackground(
    inventory.gif_backgrounds,
    random,
    normalizedSelectionState,
  );
  const hookText = selectHookText(template, random);

  const rounds = selectedSubjects.map((subject, index) => {
    const subjectTypes = subject.types.map((type) => String(type || '').trim().toLowerCase()).filter(Boolean);
    const typeIconSet = selectTypeIconSet(subjectTypes, inventory);
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
        sprite_source_url: subject.sprite_source_url || null,
        types: subjectTypes,
        type_count: subjectTypes.length,
      },
      type_label: buildTypeLabel(subjectTypes),
      type_icons: subjectTypes.map((type, typeIndex) => buildTypeIconRecord(
        type,
        typeIconSet.file_paths[typeIndex],
        typeIconSet,
      )),
      scene_lead_seconds: sceneLeadSeconds,
      countdown_from: countdownFrom,
      countdown_to: countdownTo,
      countdown_duration_seconds: countdownFrom,
      reveal_hold_seconds: revealHoldSeconds,
      transition_duration_seconds: index === roundCount - 1 ? 0 : transitionDurationSeconds,
      final_hold_seconds: index === roundCount - 1 ? finalHoldSeconds : 0,
      type_cardinality_mode: typeCardinalityMode,
    };
  });

  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('gif_background_missing');
  if (!inventory.sound_effects?.countdown_tick) requiredAssetGaps.push('countdown_sfx_missing');
  if (!inventory.sound_effects?.timer_end) requiredAssetGaps.push('timer_end_sfx_missing');
  if (!inventory.overlay_presets?.timer_countdown && !inventory.overlay_presets?.timer) {
    requiredAssetGaps.push('timer_overlay_missing');
  }
  if (!selectedSubjects.every((subject) => subject.sprite_path)) {
    requiredAssetGaps.push('pokemon_reveal_sprite_local_assets_missing');
  }
  if (!rounds.every((round) => round.type_icons.every((icon) => icon.local_path))) {
    requiredAssetGaps.push('type_icons_missing');
  }

  return {
    schema_version: 'poke-quizz-speed-quiz-plan-v1',
    channel: {
      id: 'poke-quizz',
      name: 'Poke Quizz',
      niche: 'pokemon_quiz',
      content_lane: 'pokemon_type_speed_quiz',
    },
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'random').trim().toLowerCase() || 'random',
      type_cardinality: typeCardinalityMode,
      round_count: roundCount,
      selected_subject_count: selectedSubjects.length,
      display_subject_count: selectedSubjects.length,
      type_pair: [],
      selected_subjects: rounds.map((round) => ({
        ...round.subject,
        type_label: round.type_label,
      })),
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: [
        {
          role: 'hook',
          text: hookText,
        },
      ],
    },
    timeline: buildTimeline({
      hookText,
      rounds,
    }),
    rounds,
    assets: {
      background: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.gifBackgrounds,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        selected_timer_path: inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null,
        selected_timer_countdown_path: inventory.overlay_presets?.timer_countdown || inventory.overlay_presets?.timer || null,
        selected_timer_alarm_path: inventory.overlay_presets?.timer_alarm || null,
        available_paths: inventory.overlays,
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        selected_battle_intro_music_path: selectSeededFile(inventory.music, random),
        selected_sound_effects: {
          countdown_tick: inventory.sound_effects?.countdown_tick || null,
          timer_end: inventory.sound_effects?.timer_end || null,
        },
      },
      outputs: {
        previews_directory: POKE_QUIZZ_ASSET_LAYOUT.previews,
        masters_directory: POKE_QUIZZ_ASSET_LAYOUT.masters,
      },
    },
    selection_state: {
      last_background_path: selectedBackgroundPath,
    },
    asset_inventory_snapshot: inventory,
    required_asset_gaps: [...new Set(requiredAssetGaps)],
  };
}
