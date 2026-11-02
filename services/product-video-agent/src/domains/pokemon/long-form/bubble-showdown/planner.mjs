import { BUBBLE_SURVIVAL_CATEGORIES } from '../../templates/bubble-survival/category-resolver.mjs';
import {
  BUBBLE_SURVIVAL_ARENA_SHAPES,
  normalizeBubbleSurvivalArenaShape,
} from '../../templates/bubble-survival/arena-geometry.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'pokemon-long-bubble-showdown')) {
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

function numberOr(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positiveInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizePoolVariants(poolVariants = []) {
  const configured = Array.isArray(poolVariants) && poolVariants.length > 0
    ? poolVariants
    : BUBBLE_SURVIVAL_CATEGORIES.map((category) => ({ category, weight: 1 }));
  return configured
    .map((pool) => ({
      category: String(pool?.category || pool?.key || '').trim(),
      weight: Math.max(0.01, numberOr(pool?.weight, 1)),
    }))
    .filter((pool) => BUBBLE_SURVIVAL_CATEGORIES.includes(pool.category));
}

function weightedPickIndex(values, random) {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  let cursor = random() * totalWeight;
  for (let index = 0; index < values.length; index += 1) {
    cursor -= values[index].weight;
    if (cursor <= 0) return index;
  }
  return values.length - 1;
}

export function selectBubbleShowdownCategoryOrder({
  poolVariants = [],
  seed = '',
  maximumRounds = 12,
  previousCategory = '',
} = {}) {
  const pools = normalizePoolVariants(poolVariants);
  if (pools.length === 0) throw new Error('Bubble Showdown long-form has no eligible Pokemon pools.');
  const random = createPrng(`${seed}:pool-order`);
  const result = [];
  let bag = [...pools];
  while (result.length < Math.max(1, positiveInteger(maximumRounds, 12))) {
    if (bag.length === 0) bag = [...pools];
    let index = weightedPickIndex(bag, random);
    const lastCategory = result.at(-1) || String(previousCategory || '');
    if (bag.length > 1 && bag[index].category === lastCategory) {
      index = (index + 1) % bag.length;
    }
    result.push(bag[index].category);
    bag.splice(index, 1);
  }
  return result;
}

export function selectBubbleShowdownArenaShapeOrder({
  shapes = [],
  seed = '',
  maximumRounds = 12,
  previousShape = '',
} = {}) {
  const configured = (Array.isArray(shapes) && shapes.length > 0
    ? shapes
    : BUBBLE_SURVIVAL_ARENA_SHAPES)
    .map(normalizeBubbleSurvivalArenaShape)
    .filter((shape, index, values) => values.indexOf(shape) === index);
  const random = createPrng(`${seed}:arena-shape-order`);
  const result = [];
  let bag = [...configured];
  while (result.length < Math.max(1, positiveInteger(maximumRounds, 12))) {
    if (bag.length === 0) bag = [...configured];
    let index = Math.floor(random() * bag.length);
    const lastShape = result.at(-1) || normalizeBubbleSurvivalArenaShape(previousShape);
    if (bag.length > 1 && bag[index] === lastShape) index = (index + 1) % bag.length;
    result.push(bag[index]);
    bag.splice(index, 1);
  }
  return result;
}

export function resolveBubbleShowdownDurationConfig(template = {}) {
  const minimum = Math.max(60, numberOr(template?.episode?.minimum_duration_seconds, 240));
  const maximum = Math.max(minimum, numberOr(template?.episode?.maximum_duration_seconds, 360));
  const target = Math.min(
    maximum,
    Math.max(minimum, numberOr(template?.episode?.target_duration_seconds, 300)),
  );
  return {
    minimum_seconds: minimum,
    target_seconds: target,
    maximum_seconds: maximum,
    minimum_rounds: positiveInteger(template?.episode?.minimum_rounds, 8),
    target_rounds: positiveInteger(template?.episode?.target_rounds, 10),
    maximum_rounds: positiveInteger(template?.episode?.maximum_rounds, 12),
    intro_seconds: Math.max(0, numberOr(template?.episode?.intro_duration_seconds, 5)),
    outro_seconds: Math.max(0, numberOr(template?.episode?.outro_duration_seconds, 6)),
  };
}

export function shouldAppendBubbleShowdownRound({
  currentDurationSeconds = 0,
  nextRoundDurationSeconds = 0,
  currentRoundCount = 0,
  template = {},
} = {}) {
  const duration = resolveBubbleShowdownDurationConfig(template);
  if (currentRoundCount < duration.minimum_rounds) return true;
  if (currentRoundCount >= duration.maximum_rounds) return false;
  if (currentRoundCount < duration.target_rounds) {
    return currentDurationSeconds + nextRoundDurationSeconds <= duration.maximum_seconds;
  }
  if (currentDurationSeconds >= duration.target_seconds) return false;
  return currentDurationSeconds + nextRoundDurationSeconds <= duration.maximum_seconds;
}

export function bubbleShowdownSubjectKey(subject = {}) {
  return String(
    subject?.metadata?.pokemon_api?.pokemon_id
      || subject?.pokemon_id
      || subject?.id
      || subject?.national_dex_number
      || subject?.slug
      || subject?.name
      || subject?.sprite_path
      || '',
  ).trim().toLowerCase();
}

export function filterUnusedBubbleShowdownSubjects(rows = [], usedSubjectKeys = [], minimumCount = 9) {
  const used = usedSubjectKeys instanceof Set
    ? usedSubjectKeys
    : new Set((Array.isArray(usedSubjectKeys) ? usedSubjectKeys : []).map(String));
  const fresh = (Array.isArray(rows) ? rows : []).filter(
    (subject) => !used.has(bubbleShowdownSubjectKey(subject)),
  );
  return fresh.length >= Math.max(1, positiveInteger(minimumCount, 9)) ? fresh : rows;
}

export function adaptBubbleSurvivalTemplateToLandscape({
  shortTemplate = {},
  longTemplate = {},
  category,
  arenaShape = 'circle',
} = {}) {
  const landscape = longTemplate?.round_layout || {};
  return {
    ...structuredClone(shortTemplate),
    template_id: `${String(shortTemplate.template_id || 'pokemon.bubble-survival.v1')}.landscape`,
    selection_rules: {
      ...(shortTemplate.selection_rules || {}),
      category,
    },
    video: {
      ...(shortTemplate.video || {}),
      aspect_ratio: '16:9',
      resolution: [
        numberOr(longTemplate?.canvas?.width, 1920),
        numberOr(longTemplate?.canvas?.height, 1080),
      ],
      fps: numberOr(longTemplate?.canvas?.fps, 30),
    },
    render: {
      ...(shortTemplate.render || {}),
      frame_width: numberOr(landscape.frame_width, 960),
      frame_height: numberOr(landscape.frame_height, 540),
      frame_fps: numberOr(longTemplate?.canvas?.fps, 30),
    },
    arena: {
      ...(shortTemplate.arena || {}),
      center_x: numberOr(landscape.arena_center_x, 480),
      center_y: numberOr(landscape.arena_center_y, 300),
      radius: numberOr(landscape.arena_radius, 220),
      shape: normalizeBubbleSurvivalArenaShape(arenaShape),
    },
    bubbles: {
      ...(shortTemplate.bubbles || {}),
      radius: numberOr(landscape.bubble_radius, 35),
    },
    audio: {
      ...(shortTemplate.audio || {}),
      music_volume: 0,
    },
    presentation: {
      ...(shortTemplate.presentation || {}),
      long_form_round: true,
      title: {
        font_size: numberOr(landscape.title_font_size, 30),
        y: numberOr(landscape.title_y, 52),
        side_margin: numberOr(landscape.title_side_margin, 60),
      },
      showdown_title_animation: {
        enabled: longTemplate?.presentation?.showdown_title_animation?.enabled !== false,
        start_seconds: numberOr(longTemplate?.presentation?.showdown_title_animation?.start_seconds, 0.08),
        letter_interval_seconds: numberOr(longTemplate?.presentation?.showdown_title_animation?.letter_interval_seconds, 0.085),
        letter_pop_seconds: numberOr(longTemplate?.presentation?.showdown_title_animation?.letter_pop_seconds, 0.12),
        wobble_enabled: longTemplate?.presentation?.showdown_title_animation?.wobble_enabled === true,
        wobble_amplitude_px: numberOr(longTemplate?.presentation?.showdown_title_animation?.wobble_amplitude_px, 3.5),
        wobble_rotation_degrees: numberOr(longTemplate?.presentation?.showdown_title_animation?.wobble_rotation_degrees, 2.4),
        wobble_scale_amplitude: numberOr(longTemplate?.presentation?.showdown_title_animation?.wobble_scale_amplitude, 0.025),
        wobble_period_seconds: numberOr(longTemplate?.presentation?.showdown_title_animation?.wobble_period_seconds, 1.25),
        wobble_phase_step_radians: numberOr(longTemplate?.presentation?.showdown_title_animation?.wobble_phase_step_radians, 0.7),
      },
      round_label: structuredClone(longTemplate?.presentation?.round_label || {}),
    },
  };
}

function seededVariant(values, seed, fallback) {
  const candidates = (Array.isArray(values) ? values : []).map(String).filter(Boolean);
  if (candidates.length === 0) return fallback;
  return candidates[hashSeed(seed) % candidates.length];
}

function interpolate(value, variables = {}) {
  return String(value || '').replace(/\{([a-z_]+)\}/giu, (match, key) => (
    Object.hasOwn(variables, key) ? String(variables[key]) : match
  ));
}

export function buildBubbleShowdownLongFormPlan({
  template = {},
  seed = '',
  channelProfile = {},
  rounds = [],
  musicSchedule = [],
  selectionState = {},
} = {}) {
  const duration = resolveBubbleShowdownDurationConfig(template);
  const roundsDuration = Number(rounds.reduce(
    (sum, round) => sum + Math.max(0, numberOr(round?.duration_seconds, 0)),
    0,
  ).toFixed(3));
  const totalDuration = Number((duration.intro_seconds + roundsDuration + duration.outro_seconds).toFixed(3));
  const variables = { round_count: rounds.length };
  const title = interpolate(seededVariant(
    template?.publication?.title_variants,
    `${seed}:title`,
    '{round_count} Pokemon Showdowns - Who Wins Each Round?',
  ), variables);
  const description = interpolate(seededVariant(
    template?.publication?.description_variants,
    `${seed}:description`,
    'No stats or type advantage, just physics. Pick a winner before every round.',
  ), variables);
  const selectedSubjects = [];
  const seenSubjects = new Set();
  for (const round of rounds) {
    for (const subject of round.selected_subjects || []) {
      const key = bubbleShowdownSubjectKey(subject);
      if (!key || seenSubjects.has(key)) continue;
      seenSubjects.add(key);
      selectedSubjects.push(subject);
    }
  }
  return {
    schema_version: 'pokemon-long-form-bubble-showdown-plan-v1',
    channel: {
      id: String(channelProfile?.id || ''),
      name: String(channelProfile?.name || 'Poke Quizz'),
      account_key: String(channelProfile?.account_key || ''),
      niche: String(channelProfile?.niche || 'pokemon_quiz'),
      content_lane: 'pokemon_long_form_bubble_showdown',
    },
    template_id: String(template.template_id || 'pokemon.long.bubble-showdown.v1'),
    template_key: String(template.template_key || 'long-bubble-showdown'),
    seed: String(seed),
    content_format: 'long_form',
    content_surface: 'youtube_watch',
    media_profile: {
      width: numberOr(template?.canvas?.width, 1920),
      height: numberOr(template?.canvas?.height, 1080),
      fps: numberOr(template?.canvas?.fps, 30),
      aspect_ratio: '16:9',
    },
    selection: {
      mode: 'multi_round_bubble_showdown',
      round_count: rounds.length,
      categories: rounds.map((round) => round.category),
      winner_ids: rounds.map((round) => round.winner?.id).filter(Boolean),
      selected_subject_count: selectedSubjects.length,
      selected_subjects: selectedSubjects,
    },
    rounds,
    sections: rounds,
    timing: {
      minimum_duration_seconds: duration.minimum_seconds,
      target_duration_seconds: duration.target_seconds,
      maximum_duration_seconds: duration.maximum_seconds,
      rounds_duration_seconds: roundsDuration,
      intro_duration_seconds: duration.intro_seconds,
      outro_duration_seconds: duration.outro_seconds,
      total_duration_seconds: totalDuration,
    },
    assets: {
      audio: { music_schedule: musicSchedule },
      outputs: { previews_directory: '' },
    },
    narration: { local_model_required: false, tts_provider: 'kokoro', lines: [] },
    publication: {
      title,
      description,
      hashtags: Array.isArray(template?.publication?.hashtags)
        ? template.publication.hashtags
        : ['#pokemon', '#pokemonchallenge', '#pokemongame'],
    },
    publication_policy: {
      manual_review_required: true,
      night_shift_enabled: false,
      related_video_enabled: false,
      auto_comment_enabled: false,
      ...(template?.publication_policy || {}),
      watermark_enabled: false,
    },
    selection_state: selectionState,
  };
}
