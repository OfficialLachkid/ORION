import { access } from 'node:fs/promises';
import {
  buildPokeQuizzPreviewDirectory,
  POKE_QUIZZ_ASSET_LAYOUT,
} from '../../../../poke-quizz-asset-layout.mjs';
import { scanPokeQuizzAssetInventory, selectSeededFile } from '../../../../poke-quizz-asset-inventory.mjs';
import { normalizePokeQuizzSelectionState } from '../../../../poke-quizz-selection-state.mjs';
import {
  calculateOpaqueRevealCompletionProgress,
  normalizeProgressiveRevealMethod,
  PROGRESSIVE_REVEAL_METHODS,
} from '../shared/render/progressive-reveal-engine.mjs';

const DEFAULT_ROUND_COUNT = 3;
const DEFAULT_REVEAL_DURATION_SECONDS = 8.5;
const DEFAULT_ANSWER_HOLD_SECONDS = 1.45;
const DEFAULT_HOOK_HOLD_SECONDS = 1.55;
const DEFAULT_PRE_REVEAL_HOLD_SECONDS = 0.18;
const DEFAULT_TRANSITION_DURATION_SECONDS = 0.42;
const DEFAULT_FINAL_HOLD_SECONDS = 0.6;
const DEFAULT_TARGET_OPAQUE_FRACTION = 0.6;
const MIN_VISIBLE_ALPHA = 8;
const MAX_OPAQUE_ANALYSIS_POINTS = 18000;
const spriteAvailabilityCache = new Map();
const spriteOpaquePointsCache = new Map();
let sharpModulePromise = null;

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'progressive-reveal')) {
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

function ensurePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

async function loadSharp() {
  if (!sharpModulePromise) {
    sharpModulePromise = import('sharp')
      .then((module) => module.default || module)
      .catch(() => null);
  }
  return sharpModulePromise;
}

function resolveChannelIdentity(channelProfile = {}) {
  const name = String(channelProfile?.name || 'Poke Quizz').trim() || 'Poke Quizz';
  const configuredHandle = String(
    channelProfile?.metadata?.youtube_handle
      || channelProfile?.metadata?.channel_handle
      || '',
  ).trim();
  const fallbackHandle = `@${name.replace(/[^a-z0-9]+/giu, '')}`;
  const handle = configuredHandle
    ? `@${configuredHandle.replace(/^@+/u, '')}`
    : fallbackHandle;
  return {
    id: String(channelProfile?.id || 'poke-quizz').trim() || 'poke-quizz',
    name,
    account_key: String(channelProfile?.account_key || 'poke-quizz-youtube').trim()
      || 'poke-quizz-youtube',
    niche: String(channelProfile?.niche || 'pokemon_quiz').trim() || 'pokemon_quiz',
    content_lane: 'pokemon_progressive_reveal',
    handle,
  };
}

function shuffle(values, random) {
  const items = [...values];
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function normalizeTextOptions(primaryText, variants = []) {
  return [...new Set([
    String(primaryText || '').trim(),
    ...(Array.isArray(variants) ? variants : []).map((value) => String(value || '').trim()),
  ].filter(Boolean))];
}

function pickSeededText(primaryText, variants, random) {
  const options = normalizeTextOptions(primaryText, variants);
  return options[Math.floor(random() * options.length)] || options[0] || '';
}

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/gu, '-');
}

function selectEligibleSubjects(pokedexRows = [], generationScope = []) {
  const allowedGenerations = new Set(
    (Array.isArray(generationScope) ? generationScope : [])
      .map((value) => Number.parseInt(String(value), 10))
      .filter(Number.isFinite),
  );
  return (Array.isArray(pokedexRows) ? pokedexRows : [])
    .filter((row) => row && typeof row === 'object')
    .filter((row) => Number.parseInt(String(row.national_dex_number || 0), 10) > 0)
    .filter((row) => String(row.name || '').trim())
    .filter((row) => String(row.sprite_path || '').trim())
    .filter((row) => !String(row.sprite_path || '').toLowerCase().includes('/placeholder/'))
    .filter((row) => allowedGenerations.size === 0 || allowedGenerations.has(Number(row.generation)));
}

function collapseDuplicateSubjects(subjects = []) {
  const unique = new Map();
  for (const subject of subjects) {
    const key = normalizeSlug(subject.slug || subject.name || subject.id);
    if (key && !unique.has(key)) {
      unique.set(key, subject);
    }
  }
  return [...unique.values()];
}

async function canAccessPath(filePath) {
  const normalizedPath = String(filePath || '').trim();
  if (!normalizedPath) return false;
  if (!spriteAvailabilityCache.has(normalizedPath)) {
    spriteAvailabilityCache.set(
      normalizedPath,
      access(normalizedPath).then(() => true).catch(() => false),
    );
  }
  return spriteAvailabilityCache.get(normalizedPath);
}

async function resolveRenderSpritePath(subject) {
  const animatedPath = String(subject?.animated_sprite_path || '').trim();
  if (animatedPath && await canAccessPath(animatedPath)) {
    return animatedPath;
  }
  return String(subject?.sprite_path || '').trim();
}

function resolveRevealAnalysisLayout(template) {
  const box = template?.layout?.reveal_box || {};
  const width = Math.max(320, Math.round(ensurePositiveNumber(box.width_px, 760)));
  const height = Math.max(320, Math.round(ensurePositiveNumber(box.height_px, 760)));
  const border = Math.max(0, Math.round(Number(box.border_width_px) || 0));
  return {
    width: Math.max(2, width - (border * 2)),
    height: Math.max(2, height - (border * 2)),
    spriteSize: Math.max(240, Math.round(ensurePositiveNumber(box.sprite_size_px, 650))),
  };
}

async function loadOpaqueSpriteAnalysis(spritePath, template) {
  const normalizedPath = String(spritePath || '').trim();
  const layout = resolveRevealAnalysisLayout(template);
  if (!normalizedPath) {
    return { ...layout, opaquePoints: [] };
  }
  const cacheKey = `${normalizedPath}:${layout.width}:${layout.height}:${layout.spriteSize}`;
  if (spriteOpaquePointsCache.has(cacheKey)) {
    return spriteOpaquePointsCache.get(cacheKey);
  }
  const analysisPromise = (async () => {
    const sharp = await loadSharp();
    if (!sharp) return { ...layout, opaquePoints: [] };
    try {
      const { data, info } = await sharp(normalizedPath, { page: 0 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const sourceWidth = Number(info?.width || 0);
      const sourceHeight = Number(info?.pageHeight || info?.height || 0);
      const channels = Number(info?.channels || 4);
      if (sourceWidth <= 0 || sourceHeight <= 0 || channels < 4 || !data?.length) {
        return { ...layout, opaquePoints: [] };
      }
      const displayScale = Math.min(
        layout.spriteSize / sourceWidth,
        layout.spriteSize / sourceHeight,
      );
      const displayWidth = sourceWidth * displayScale;
      const displayHeight = sourceHeight * displayScale;
      const offsetX = (layout.width - displayWidth) / 2;
      const offsetY = (layout.height - displayHeight) / 2;
      const sampleStride = Math.max(
        1,
        Math.ceil(Math.sqrt((sourceWidth * sourceHeight) / MAX_OPAQUE_ANALYSIS_POINTS)),
      );
      const opaquePoints = [];
      for (let y = 0; y < sourceHeight; y += sampleStride) {
        for (let x = 0; x < sourceWidth; x += sampleStride) {
          const alphaIndex = ((y * sourceWidth) + x) * channels + 3;
          if ((data[alphaIndex] || 0) < MIN_VISIBLE_ALPHA) continue;
          opaquePoints.push({
            x: offsetX + ((x + 0.5) * displayScale),
            y: offsetY + ((y + 0.5) * displayScale),
          });
        }
      }
      return { ...layout, opaquePoints };
    } catch {
      return { ...layout, opaquePoints: [] };
    }
  })();
  spriteOpaquePointsCache.set(cacheKey, analysisPromise);
  return analysisPromise;
}

function selectBackground(backgrounds, random, selectionState) {
  const candidates = (Array.isArray(backgrounds) ? backgrounds : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => !value.toLowerCase().includes('/archived-backgrounds/'));
  const previous = String(selectionState?.last_background_path || '').trim().toLowerCase();
  const freshCandidates = candidates.filter((value) => value.toLowerCase() !== previous);
  const pool = freshCandidates.length > 0 ? freshCandidates : candidates;
  return pool[Math.floor(random() * pool.length)] || null;
}

function resolveBackgroundPool(inventory = {}) {
  const pixelBackgrounds = Array.isArray(inventory.pixel_backgrounds)
    ? inventory.pixel_backgrounds
    : [];
  if (pixelBackgrounds.length > 0) {
    return {
      backgrounds: pixelBackgrounds,
      expected_directory: POKE_QUIZZ_ASSET_LAYOUT.pixelBackgrounds,
    };
  }
  return {
    backgrounds: inventory.backgrounds || [],
    expected_directory: POKE_QUIZZ_ASSET_LAYOUT.backgrounds,
  };
}

function resolveRevealMethods(template) {
  const configured = Array.isArray(template?.reveal?.methods)
    ? template.reveal.methods
    : PROGRESSIVE_REVEAL_METHODS;
  const methods = [...new Set(configured
    .map((value) => normalizeProgressiveRevealMethod(value, ''))
    .filter((value) => PROGRESSIVE_REVEAL_METHODS.includes(value)))];
  return methods.length > 0 ? methods : [...PROGRESSIVE_REVEAL_METHODS];
}

function selectRoundMethods(template, roundCount, random) {
  const methods = resolveRevealMethods(template);
  const mode = String(template?.reveal?.mode || 'random_per_round').trim().toLowerCase();
  const fixedMethod = normalizeProgressiveRevealMethod(template?.reveal?.method, methods[0]);
  if (mode === 'fixed' || mode === 'fixed_video' || mode === 'one_per_video') {
    return Array.from({ length: roundCount }, () => fixedMethod);
  }
  const selected = [];
  for (let index = 0; index < roundCount; index += 1) {
    const pool = methods.length > 1
      ? methods.filter((method) => method !== selected.at(-1))
      : methods;
    selected.push(pool[Math.floor(random() * pool.length)] || methods[0]);
  }
  return selected;
}

function resolveMethodConfig(template, method, random) {
  const baseConfig = template?.reveal?.method_config?.[method] || {};
  if (method === 'wipe') {
    const directions = Array.isArray(template?.reveal?.directions)
      ? template.reveal.directions
      : ['top_to_bottom', 'bottom_to_top', 'left_to_right', 'right_to_left'];
    return {
      ...baseConfig,
      direction: directions[Math.floor(random() * directions.length)] || 'top_to_bottom',
    };
  }
  if (method === 'strips') {
    const orientations = Array.isArray(baseConfig.orientations)
      ? baseConfig.orientations
      : ['horizontal', 'vertical'];
    return {
      ...baseConfig,
      orientation: orientations[Math.floor(random() * orientations.length)] || 'horizontal',
    };
  }
  if (method === 'diagonal') {
    const directions = Array.isArray(baseConfig.directions)
      ? baseConfig.directions
      : [
        'top_left_to_bottom_right',
        'bottom_right_to_top_left',
        'top_right_to_bottom_left',
        'bottom_left_to_top_right',
      ];
    return {
      ...baseConfig,
      direction: directions[Math.floor(random() * directions.length)] || 'top_left_to_bottom_right',
    };
  }
  return { ...baseConfig };
}

function buildSubjectRecord(subject, renderSpritePath) {
  return {
    pokedex_id: subject.id,
    national_dex_number: subject.national_dex_number,
    slug: subject.slug,
    name: subject.name,
    generation: subject.generation,
    region: subject.region,
    types: subject.types,
    sprite_path: subject.sprite_path,
    animated_sprite_path: subject.animated_sprite_path || null,
    render_sprite_path: renderSpritePath,
    sprite_source_url: subject.sprite_source_url || null,
  };
}

function buildTimeline(hookText, rounds) {
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
      phase: `round_${round.round_number}_progressive_reveal`,
      duration_seconds: round.reveal_duration_seconds,
      spoken_text: '',
      on_screen_text: '',
    });
    timeline.push({
      phase: `round_${round.round_number}_answer`,
      duration_seconds: round.answer_hold_seconds,
      spoken_text: '',
      on_screen_text: round.answer_text,
    });
  }
  return timeline;
}

export async function planPokemonProgressiveRevealChallenge({
  template,
  pokedexRows,
  seed = 'progressive-reveal',
  assetInventory = null,
  selectionState = null,
  channelProfile = null,
}) {
  const random = createPrng(seed);
  const inventory = assetInventory || await scanPokeQuizzAssetInventory();
  const normalizedSelectionState = normalizePokeQuizzSelectionState(selectionState);
  const roundCount = ensurePositiveInteger(template?.selection_rules?.round_count, DEFAULT_ROUND_COUNT);
  const eligibleSubjects = collapseDuplicateSubjects(selectEligibleSubjects(
    pokedexRows,
    template?.selection_rules?.generation_scope,
  ));
  if (eligibleSubjects.length < roundCount) {
    throw new Error(`Progressive Reveal requires at least ${roundCount} Pokemon with local sprites, found ${eligibleSubjects.length}.`);
  }

  const selectedSubjects = shuffle(eligibleSubjects, random).slice(0, roundCount);
  const renderedSubjects = await Promise.all(selectedSubjects.map(async (subject) => (
    buildSubjectRecord(subject, await resolveRenderSpritePath(subject))
  )));
  const backgroundPool = resolveBackgroundPool(inventory);
  const selectedBackgroundPath = selectBackground(
    backgroundPool.backgrounds,
    random,
    normalizedSelectionState,
  );
  const selectedMethods = selectRoundMethods(template, roundCount, random);
  const hookText = pickSeededText(
    template?.question_contract?.hook_text,
    template?.question_contract?.hook_text_variants,
    random,
  );
  const answerTemplate = pickSeededText(
    template?.question_contract?.answer_text,
    template?.question_contract?.answer_text_variants,
    random,
  ) || '{pokemon}';
  const fullRevealDurationSeconds = ensurePositiveNumber(
    template?.reveal?.duration_seconds,
    DEFAULT_REVEAL_DURATION_SECONDS,
  );
  const targetOpaqueFraction = clamp(
    ensurePositiveNumber(
      template?.reveal?.target_opaque_fraction,
      DEFAULT_TARGET_OPAQUE_FRACTION,
    ),
    0.05,
    0.98,
  );
  const answerHoldSeconds = ensurePositiveNumber(
    template?.layout?.rounds?.answer_hold_seconds,
    DEFAULT_ANSWER_HOLD_SECONDS,
  );
  const hookHoldSeconds = ensurePositiveNumber(
    template?.layout?.rounds?.hook_hold_seconds,
    DEFAULT_HOOK_HOLD_SECONDS,
  );
  const preRevealHoldSeconds = ensurePositiveNumber(
    template?.layout?.rounds?.pre_reveal_hold_seconds,
    DEFAULT_PRE_REVEAL_HOLD_SECONDS,
  );
  const transitionDurationSeconds = ensurePositiveNumber(
    template?.layout?.rounds?.transition_duration_seconds,
    DEFAULT_TRANSITION_DURATION_SECONDS,
  );
  const finalHoldSeconds = ensurePositiveNumber(
    template?.layout?.rounds?.final_hold_seconds,
    DEFAULT_FINAL_HOLD_SECONDS,
  );
  const difficulty = String(template?.reveal?.difficulty || 'normal').trim().toLowerCase() || 'normal';

  const roundBlueprints = renderedSubjects.map((subject, index) => {
    const method = selectedMethods[index];
    const revealSeed = `${seed}:round-${index + 1}:${subject.pokedex_id || subject.name}:${method}`;
    const revealConfig = resolveMethodConfig(template, method, random);
    return { subject, index, method, revealSeed, revealConfig };
  });
  const rounds = await Promise.all(roundBlueprints.map(async ({
    subject,
    index,
    method,
    revealSeed,
    revealConfig,
  }) => {
    let opaqueAnalysis = await loadOpaqueSpriteAnalysis(subject.sprite_path, template);
    if (
      opaqueAnalysis.opaquePoints.length === 0
      && subject.render_sprite_path
      && subject.render_sprite_path !== subject.sprite_path
    ) {
      opaqueAnalysis = await loadOpaqueSpriteAnalysis(subject.render_sprite_path, template);
    }
    const coverage = calculateOpaqueRevealCompletionProgress({
      method,
      seed: revealSeed,
      config: {
        ...revealConfig,
        reveal_duration_seconds: fullRevealDurationSeconds,
      },
      opaquePoints: opaqueAnalysis.opaquePoints,
      width: opaqueAnalysis.width,
      height: opaqueAnalysis.height,
      targetOpaqueFraction,
    });
    const revealDurationSeconds = Number((
      fullRevealDurationSeconds * targetOpaqueFraction
    ).toFixed(3));
    return {
      round_number: index + 1,
      round_label: `${index + 1}/${roundCount}`,
      subject,
      scene_lead_seconds: index === 0
        ? hookHoldSeconds
        : transitionDurationSeconds + preRevealHoldSeconds,
      reveal_duration_seconds: revealDurationSeconds,
      full_reveal_duration_seconds: fullRevealDurationSeconds,
      reveal_completion_progress: targetOpaqueFraction,
      reveal_target_opaque_fraction: targetOpaqueFraction,
      reveal_estimated_opaque_fraction: coverage.estimatedOpaqueFraction,
      reveal_mask_progress_at_completion: coverage.maskProgressAtCompletion,
      reveal_sampled_opaque_pixel_count: coverage.sampledOpaquePixelCount,
      answer_hold_seconds: answerHoldSeconds,
      transition_duration_seconds: index === roundCount - 1 ? 0 : transitionDurationSeconds,
      final_hold_seconds: index === roundCount - 1 ? finalHoldSeconds : 0,
      reveal_method: method,
      reveal_seed: revealSeed,
      reveal_difficulty: difficulty,
      reveal_config: {
        ...revealConfig,
        progress_scale: coverage.progressScale,
      },
      answer_text: answerTemplate.replaceAll('{pokemon}', subject.name),
    };
  }));

  const revealSoundPath = inventory?.sound_effects?.reveal
    || inventory?.sound_effects?.timer_end
    || null;
  const requiredAssetGaps = [];
  if (!selectedBackgroundPath) requiredAssetGaps.push('background_missing');
  if (template?.audio?.sound_effects?.reveal?.enabled !== false && !revealSoundPath) {
    requiredAssetGaps.push('reveal_sfx_missing');
  }
  if (renderedSubjects.some((subject) => !subject.render_sprite_path)) {
    requiredAssetGaps.push('pokemon_sprite_local_assets_missing');
  }

  return {
    schema_version: 'poke-quizz-progressive-reveal-plan-v1',
    channel: resolveChannelIdentity(channelProfile),
    template_id: template.template_id,
    template_key: template.template_key,
    seed: String(seed),
    selection: {
      mode: String(template?.selection_rules?.mode || 'random').trim().toLowerCase() || 'random',
      difficulty_id: difficulty,
      round_count: roundCount,
      type_pair: [],
      selected_subject_count: renderedSubjects.length,
      display_subject_count: renderedSubjects.length,
      reveal_method_mode: String(template?.reveal?.mode || 'random_per_round'),
      reveal_target_opaque_fraction: targetOpaqueFraction,
      reveal_completion_progresses: rounds.map((round) => round.reveal_completion_progress),
      reveal_methods: selectedMethods,
      selected_subjects: renderedSubjects,
    },
    narration: {
      local_model_required: false,
      tts_provider: 'kokoro',
      lines: hookText ? [{ role: 'hook', text: hookText }] : [],
    },
    timeline: buildTimeline(hookText, rounds),
    rounds,
    assets: {
      background: {
        expected_directory: backgroundPool.expected_directory,
        selected_path: selectedBackgroundPath,
      },
      overlays: {
        expected_directory: POKE_QUIZZ_ASSET_LAYOUT.overlays,
        available_paths: inventory?.overlays || [],
      },
      audio: {
        battle_intro_music_directory: POKE_QUIZZ_ASSET_LAYOUT.battleIntroMusic,
        sound_effects_directory: POKE_QUIZZ_ASSET_LAYOUT.soundEffects,
        selected_battle_intro_music_path: selectSeededFile(inventory?.music || [], random),
        selected_sound_effects: {
          ...(inventory?.sound_effects || {}),
          reveal: revealSoundPath,
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
