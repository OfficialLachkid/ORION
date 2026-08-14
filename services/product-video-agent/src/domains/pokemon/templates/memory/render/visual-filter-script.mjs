import {
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  buildCountdownNumberAlphaExpression,
  buildCountdownNumberYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_TEXT_BORDER,
  DEFAULT_TIMER_NUMBER_SIZE,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
} from '../../dual-type-reveal/render/constants.mjs';

function overlayRange(startSeconds, endSeconds) {
  return formatEnableBetween(startSeconds, endSeconds);
}

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'memory-render')) {
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

function buildShuffledIndices(count, seedInput) {
  const random = createPrng(seedInput);
  const indices = Array.from({ length: Math.max(0, count) }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}

function buildHoldThenLerpExpression(startValue, endValue, startSeconds, endSeconds) {
  const from = Number(ensureNumber(startValue, 0).toFixed(3));
  const to = Number(ensureNumber(endValue, from).toFixed(3));
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(ensureNumber(endSeconds, start).toFixed(3));
  const duration = Number(Math.max(0, end - start).toFixed(3));
  if (duration <= 0 || from === to) {
    return `${to}`;
  }
  return `if(lt(t,${start}),${from},if(lt(t,${end}),${from}+(${to}-${from})*((t-${start})/${duration}),${to}))`;
}

function buildFadeFilter(type, startSeconds, durationSeconds) {
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const duration = Number(Math.max(0, ensureNumber(durationSeconds, 0)).toFixed(3));
  if (duration <= 0) {
    return null;
  }
  return `fade=t=${type}:st=${start}:d=${duration}:alpha=1`;
}

function buildOffsetExpression(baseValue, offsetValue) {
  const offset = Number(ensureNumber(offsetValue, 0).toFixed(3));
  if (typeof baseValue === 'number') {
    return Number((baseValue + offset).toFixed(3));
  }
  return `(${baseValue})+${offset}`;
}

function buildBobbingYOffsetExpression({
  baseExpression,
  startSeconds,
  endSeconds,
  amplitudePx,
  frequencyHz,
}) {
  const amplitude = Number(Math.max(0, ensureNumber(amplitudePx, 0)).toFixed(3));
  if (amplitude <= 0) {
    return baseExpression;
  }
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(Math.max(start, ensureNumber(endSeconds, start)).toFixed(3));
  const radians = Number((Math.max(0.4, ensureNumber(frequencyHz, 2.1)) * 6.283185307).toFixed(3));
  return `(${baseExpression})-if(lt(t,${start}),0,if(lt(t,${end}),sin((t-${start})*${radians})*${amplitude},0))`;
}

function resolvePlatformLayout(template, variant) {
  const config = template?.layout?.sprite_platform || {};
  const defaultEnabled = config.enabled !== false;
  const defaultWidthMultiplier = ensureNumber(config.width_multiplier, 0.9);
  return {
    enabled: config[`${variant}_enabled`] !== undefined
      ? config[`${variant}_enabled`] !== false
      : defaultEnabled,
    width_multiplier: ensureNumber(
      config[`${variant}_width_multiplier`],
      defaultWidthMultiplier,
    ),
    center_y_offset_multiplier: ensureNumber(config.center_y_offset_multiplier, 0.34),
    center_y_offset_px: ensureNumber(
      config[`${variant}_center_y_offset_px`],
      ensureNumber(config.center_y_offset_px, 0),
    ),
  };
}

function appendPlatformAndSprite({
  filters,
  currentVideoLabel,
  inputRefs,
  spriteInputIndex,
  spriteLabel,
  outputLabel,
  platformLabelPrefix,
  platformVariant,
  spriteSize,
  centerX,
  centerY,
  platformCenterY = null,
  enableExpression,
  fps,
  spriteScaleFilter = null,
  spriteStreamFilters = [],
  platformStreamFilters = [],
  template,
}) {
  let baseVideoLabel = currentVideoLabel;
  const platformLayout = resolvePlatformLayout(template, platformVariant);
  if (inputRefs.grassPlatform != null && platformLayout.enabled) {
    const platformWidth = Number((spriteSize * platformLayout.width_multiplier).toFixed(3));
    const platformOverlayCenterY = buildOffsetExpression(
      platformCenterY ?? centerY,
      (spriteSize * platformLayout.center_y_offset_multiplier) + platformLayout.center_y_offset_px,
    );
    const platformLabel = `${platformLabelPrefix}platform`;
    const platformVideoLabel = `${platformLabelPrefix}platformv`;
    const platformFilterParts = [
      `fps=${fps}`,
      `scale=${platformWidth}:-1`,
      'format=rgba',
      'setsar=1',
      ...platformStreamFilters.filter(Boolean),
    ];
    filters.push(
      `[${inputRefs.grassPlatform}:v]${platformFilterParts.join(',')}[${platformLabel}]`,
    );
    filters.push(
      `[${baseVideoLabel}][${platformLabel}]overlay=x='${centerX}-w/2':y='${platformOverlayCenterY}-h/2':enable='${enableExpression}'[${platformVideoLabel}]`,
    );
    baseVideoLabel = platformVideoLabel;
  }

  const spriteFilterParts = [
    `fps=${fps}`,
    spriteScaleFilter || `scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease`,
    'format=rgba',
    'setsar=1',
    ...spriteStreamFilters.filter(Boolean),
  ];
  filters.push(
    `[${spriteInputIndex}:v]${spriteFilterParts.join(',')}[${spriteLabel}]`,
  );
  filters.push(
    `[${baseVideoLabel}][${spriteLabel}]overlay=x='${centerX}-w/2':y='${centerY}-h/2':enable='${enableExpression}'[${outputLabel}]`,
  );
  return outputLabel;
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const questionStart = ensureNumber(renderPlan.phases.question?.start_seconds, 0);
  const countdownStart = ensureNumber(renderPlan.phases.countdown?.start_seconds, questionStart);
  const revealStart = ensureNumber(renderPlan.phases.reveal?.start_seconds, countdownStart);
  const revealVisualStart = ensureNumber(renderPlan.audio_cues?.reveal_visual_start_seconds, revealStart);
  const revealMoveDuration = Math.max(0.2, ensureNumber(template?.renderer?.reveal_move_duration_seconds, 0.35));
  const revealMoveEnd = Math.min(
    renderPlan.total_duration_seconds,
    Number((revealVisualStart + revealMoveDuration).toFixed(3)),
  );
  const revealFadeDuration = Math.max(0, Number((revealVisualStart - revealStart).toFixed(3)));
  const hookStart = ensureNumber(renderPlan.phases.hook?.start_seconds, 0);
  const memorizeVisibleEnd = questionStart;
  const gridLayout = renderPlan.grid || { cells: [] };
  const optionGridLayout = renderPlan.option_grid || { cells: [] };
  const revealTargetCenterX = ensureNumber(renderPlan.reveal_sprite?.center_x, width / 2);
  const revealTargetCenterY = ensureNumber(renderPlan.reveal_sprite?.center_y, 920);
  const correctOptionIndex = Number.isInteger(plan.question?.correct_option_index)
    ? plan.question.correct_option_index
    : -1;
  const correctOptionCell = optionGridLayout.cells[correctOptionIndex] || null;
  const revealStartCenterX = ensureNumber(correctOptionCell?.center_x, revealTargetCenterX);
  const revealStartCenterY = ensureNumber(correctOptionCell?.center_y, revealTargetCenterY);
  const revealCenterXExpression = buildHoldThenLerpExpression(
    revealStartCenterX,
    revealTargetCenterX,
    revealVisualStart,
    revealMoveEnd,
  );
  const revealCenterYExpression = buildHoldThenLerpExpression(
    revealStartCenterY,
    revealTargetCenterY,
    revealVisualStart,
    revealMoveEnd,
  );
  const introInitialDelay = Math.max(0, ensureNumber(template?.renderer?.intro_sprite_initial_delay_seconds, 0.08));
  const introStaggerSeconds = Math.max(0.05, ensureNumber(template?.renderer?.intro_sprite_stagger_seconds, 0.18));
  const introFadeDuration = Math.max(0.12, ensureNumber(template?.renderer?.intro_sprite_fade_duration_seconds, 0.22));
  const introYOffset = ensureNumber(template?.renderer?.intro_sprite_y_offset_px, 54);
  const introOrder = buildShuffledIndices(Math.min((inputRefs.sprites || []).length, gridLayout.cells.length), `${plan.seed}:memory-intro`);
  const introSequenceByIndex = new Map(introOrder.map((spriteIndex, orderIndex) => [spriteIndex, orderIndex]));
  const optionInitialDelay = Math.max(0, ensureNumber(template?.renderer?.option_sprite_initial_delay_seconds, 0.04));
  const optionStaggerSeconds = Math.max(0, ensureNumber(template?.renderer?.option_sprite_stagger_seconds, 0.09));
  const optionFadeDuration = Math.max(0.12, ensureNumber(template?.renderer?.option_sprite_fade_duration_seconds, 0.2));
  const optionYOffset = ensureNumber(template?.renderer?.option_sprite_y_offset_px, 42);
  const optionFloatStartDelay = Math.max(0, ensureNumber(template?.renderer?.option_sprite_float_start_delay_seconds, 0.04));
  const optionFloatAmplitude = ensureNumber(template?.renderer?.option_sprite_float_amplitude_px, 18);
  const optionFloatFrequency = Math.max(
    0.4,
    ensureNumber(template?.renderer?.option_sprite_float_frequency_hz, 2.1)
      * Math.max(0.1, ensureNumber(template?.renderer?.option_sprite_float_speed_multiplier, 1)),
  );
  const introDisappearDuration = Math.max(0.12, ensureNumber(template?.renderer?.intro_disappear_duration_seconds, 0.42));
  const introSpriteShrinkDuration = Math.max(0.06, ensureNumber(template?.renderer?.intro_sprite_shrink_duration_seconds, 0.14));
  const introPokeballClosedFrameIndex = Math.max(
    0,
    Math.trunc(ensureNumber(template?.renderer?.intro_pokeball_closed_frame_number, 10)) - 1,
  );
  const introPokeballOpenFrameIndex = Math.max(
    0,
    Math.trunc(ensureNumber(template?.renderer?.intro_pokeball_open_frame_number, 2)) - 1,
  );
  const introPokeballOpenHoldSeconds = Math.max(
    0.06,
    ensureNumber(template?.renderer?.intro_pokeball_open_hold_seconds, 0.16),
  );
  const introPokeballOpenLeadSeconds = Math.max(
    0,
    ensureNumber(template?.renderer?.intro_pokeball_open_lead_seconds, 0.12),
  );
  const introPokeballScaleMultiplier = Math.max(
    0.1,
    ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.02),
  );
  const optionOrder = buildShuffledIndices(Math.min((inputRefs.optionSprites || []).length, optionGridLayout.cells.length), `${plan.seed}:memory-options`);
  const optionSequenceByIndex = new Map(optionOrder.map((spriteIndex, orderIndex) => [spriteIndex, orderIndex]));
  const backgroundBlurSigma = Math.max(0, ensureNumber(template?.layout?.background?.blur_sigma, 0));
  const backgroundBlurPart = backgroundBlurSigma > 0
    ? `,gblur=sigma=${Number(backgroundBlurSigma.toFixed(3))}:steps=1`
    : '';
  const useHpBarCountdown = String(renderPlan?.timer_layout?.mode || '').trim().toLowerCase() === 'hp_bar_depletion'
    && inputRefs.timerHpBar != null;
  const hpBarUsesGreenscreen = String(plan.assets.overlays?.selected_timer_hp_bar_path || '').toLowerCase().includes('greenscreen');

  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${backgroundBlurPart},fps=${fps},setsar=1[v0]`);
  let currentVideoLabel = 'v0';

  if (inputRefs.introPokeball != null && gridLayout.cells.length > 0) {
    const introPokeballCount = Math.min((inputRefs.sprites || []).length, gridLayout.cells.length);
    const pokeballSize = Number((
      ensureNumber(gridLayout.item_size_px, 220)
      * ensureNumber(gridLayout.placeholder_scale_multiplier, 0.92)
      * introPokeballScaleMultiplier
    ).toFixed(3));
    for (let index = 0; index < introPokeballCount; index += 1) {
      const cell = gridLayout.cells[index];
      const introOrderIndex = introSequenceByIndex.get(index) ?? index;
      const introStart = Number((hookStart + introInitialDelay + (introOrderIndex * introStaggerSeconds)).toFixed(3));
      const introEnd = Number((introStart + introFadeDuration).toFixed(3));
      const openStart = Number(Math.max(hookStart, introStart - introPokeballOpenLeadSeconds).toFixed(3));
      const openEnd = Number(Math.min(introEnd, introStart + introPokeballOpenHoldSeconds).toFixed(3));
      const closedLabel = `mempokeballclosed${index}`;
      const openLabel = `mempokeballopen${index}`;
      const withClosedLabel = `mempokeballclosedv${index}`;
      const withOpenLabel = `mempokeballopenv${index}`;
      filters.push(
        `[${inputRefs.introPokeball}:v]fps=${fps},select='eq(n,${introPokeballClosedFrameIndex})',setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${renderPlan.total_duration_seconds},scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${closedLabel}]`,
      );
      filters.push(
        `[${inputRefs.introPokeball}:v]fps=${fps},select='eq(n,${introPokeballOpenFrameIndex})',setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${renderPlan.total_duration_seconds},scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${openLabel}]`,
      );
      filters.push(
        `[${currentVideoLabel}][${closedLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${overlayRange(hookStart, openStart)}'[${withClosedLabel}]`,
      );
      filters.push(
        `[${withClosedLabel}][${openLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${overlayRange(openStart, openEnd)}'[${withOpenLabel}]`,
      );
      currentVideoLabel = withOpenLabel;
    }
  }

  for (let index = 0; index < (inputRefs.sprites || []).length && index < gridLayout.cells.length; index += 1) {
    const pokemon = plan.assets.pokemon[index] || {};
    const cell = gridLayout.cells[index];
    const introOrderIndex = introSequenceByIndex.get(index) ?? index;
    const introStart = Number((hookStart + introInitialDelay + (introOrderIndex * introStaggerSeconds)).toFixed(3));
    const introEnd = Number((introStart + introFadeDuration).toFixed(3));
    const disappearStart = Number(Math.max(introEnd, memorizeVisibleEnd - introDisappearDuration).toFixed(3));
    const shrinkStart = Number(Math.max(introEnd, disappearStart - introSpriteShrinkDuration).toFixed(3));
    const spriteSize = Number((
      ensureNumber(gridLayout.item_size_px, 220)
      * ensureNumber(gridLayout.sprite_scale_multiplier, 1.18)
      * ensureNumber(pokemon.sprite_display_scale_multiplier, 1)
    ).toFixed(3));
    const spriteLabel = `memsprite${index}`;
    const memorizeLabel = `memshow${index}`;
    currentVideoLabel = appendPlatformAndSprite({
      filters,
      currentVideoLabel,
      inputRefs,
      spriteInputIndex: inputRefs.sprites[index],
      spriteLabel,
      outputLabel: memorizeLabel,
      platformLabelPrefix: `memstudy${index}`,
      platformVariant: 'study',
      spriteSize,
      centerX: cell.center_x,
      centerY: buildHoldThenLerpExpression(
        cell.center_y + introYOffset,
        cell.center_y,
        introStart,
        introEnd,
      ),
      enableExpression: overlayRange(introStart, disappearStart),
      fps,
      spriteScaleFilter: `scale=w='${spriteSize}*(${buildHoldThenLerpExpression(1, 0.08, shrinkStart, disappearStart)})':h='${spriteSize}*(${buildHoldThenLerpExpression(1, 0.08, shrinkStart, disappearStart)})':eval=frame:force_original_aspect_ratio=decrease`,
      spriteStreamFilters: [
        buildFadeFilter('in', introStart, introFadeDuration),
      ],
      template,
    });
  }

  if (inputRefs.introDisappear != null && gridLayout.cells.length > 0) {
    const introDisappearCount = Math.min((inputRefs.sprites || []).length, gridLayout.cells.length);
    const disappearLabels = Array.from({ length: introDisappearCount }, (_, index) => `memdisappearsrc${index}`);
    filters.push(
      `[${inputRefs.introDisappear}:v]split=${introDisappearCount}${disappearLabels.map((label) => `[${label}]`).join('')}`,
    );
    for (let index = 0; index < introDisappearCount; index += 1) {
      const pokemon = plan.assets.pokemon[index] || {};
      const cell = gridLayout.cells[index];
      const introOrderIndex = introSequenceByIndex.get(index) ?? index;
      const introStart = Number((hookStart + introInitialDelay + (introOrderIndex * introStaggerSeconds)).toFixed(3));
      const introEnd = Number((introStart + introFadeDuration).toFixed(3));
      const disappearStart = Number(Math.max(introEnd, memorizeVisibleEnd - introDisappearDuration).toFixed(3));
      const spriteSize = Number((
        ensureNumber(gridLayout.item_size_px, 220)
        * ensureNumber(gridLayout.sprite_scale_multiplier, 1.18)
        * ensureNumber(pokemon.sprite_display_scale_multiplier, 1)
        * 1.08
      ).toFixed(3));
      const disappearLabel = `memdisappear${index}`;
      const disappearVideoLabel = `memdisappearv${index}`;
      filters.push(
        `[${disappearLabels[index]}]fps=${fps},trim=duration=${introDisappearDuration},setpts=PTS-STARTPTS+${disappearStart}/TB,scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${disappearLabel}]`,
      );
      filters.push(
        `[${currentVideoLabel}][${disappearLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${overlayRange(disappearStart, memorizeVisibleEnd)}'[${disappearVideoLabel}]`,
      );
      currentVideoLabel = disappearVideoLabel;
    }
  }

  if ((inputRefs.optionSprites || []).length > 0) {
    for (let index = 0; index < inputRefs.optionSprites.length && index < optionGridLayout.cells.length; index += 1) {
      const option = plan.question?.options?.[index] || {};
      const cell = optionGridLayout.cells[index];
      const optionOrderIndex = optionSequenceByIndex.get(index) ?? index;
      const optionAppearStart = Number((questionStart + optionInitialDelay + (optionOrderIndex * optionStaggerSeconds)).toFixed(3));
      const optionAppearEnd = Number((optionAppearStart + optionFadeDuration).toFixed(3));
      const spriteSize = Number((
        ensureNumber(optionGridLayout.item_size_px, 196)
        * ensureNumber(optionGridLayout.sprite_scale_multiplier, 1)
        * ensureNumber(option.sprite_display_scale_multiplier, 1)
      ).toFixed(3));
      const optionSpriteFadeFilters = [
        buildFadeFilter('in', optionAppearStart, optionFadeDuration),
      ];
      const optionPlatformFadeFilters = [
        buildFadeFilter('in', optionAppearStart, optionFadeDuration),
      ];
      if (!option.is_correct) {
        optionSpriteFadeFilters.push(buildFadeFilter('out', revealStart, revealFadeDuration));
        optionPlatformFadeFilters.push(buildFadeFilter('out', revealStart, revealFadeDuration));
      } else {
        optionPlatformFadeFilters.push(buildFadeFilter('out', revealStart, revealFadeDuration));
      }
      const optionSpriteLabel = `memoption${index}`;
      const optionVideoLabel = `memoptionv${index}`;
      const optionCenterY = buildHoldThenLerpExpression(
        cell.center_y + optionYOffset,
        cell.center_y,
        optionAppearStart,
        optionAppearEnd,
      );
      const optionWobbleStart = Number(Math.max(optionAppearEnd, countdownStart + optionFloatStartDelay).toFixed(3));
      currentVideoLabel = appendPlatformAndSprite({
        filters,
        currentVideoLabel,
        inputRefs,
        spriteInputIndex: inputRefs.optionSprites[index],
        spriteLabel: optionSpriteLabel,
        outputLabel: optionVideoLabel,
        platformLabelPrefix: `memoption${index}`,
        platformVariant: 'option',
        spriteSize,
        centerX: cell.center_x,
        centerY: buildBobbingYOffsetExpression({
          baseExpression: optionCenterY,
          startSeconds: optionWobbleStart,
          endSeconds: revealStart,
          amplitudePx: optionFloatAmplitude,
          frequencyHz: optionFloatFrequency,
        }),
        platformCenterY: cell.center_y,
        enableExpression: overlayRange(questionStart, revealVisualStart),
        fps,
        spriteStreamFilters: optionSpriteFadeFilters,
        platformStreamFilters: optionPlatformFadeFilters,
        template,
      });
    }
  }

  if (inputRefs.revealSprite != null) {
    const correctOption = correctOptionIndex >= 0 ? plan.question?.options?.[correctOptionIndex] : null;
    const revealOptionSpriteSize = Number((
      ensureNumber(optionGridLayout.item_size_px, 196)
      * ensureNumber(optionGridLayout.sprite_scale_multiplier, 1)
      * ensureNumber(correctOption?.sprite_display_scale_multiplier, 1)
    ).toFixed(3));
    const configuredRevealSpriteSize = Number((
      ensureNumber(renderPlan.reveal_sprite?.item_size_px, 320)
      * ensureNumber(renderPlan.reveal_sprite?.sprite_scale_multiplier, 1)
      * ensureNumber(plan.assets.reveal_pokemon?.sprite_display_scale_multiplier, 1)
    ).toFixed(3));
    const spriteSize = revealOptionSpriteSize > 0
      ? revealOptionSpriteSize
      : configuredRevealSpriteSize;
    const revealSpriteLabel = 'memrevealsprite';
    const revealVideoLabel = 'memrevealvideo';
    currentVideoLabel = appendPlatformAndSprite({
      filters,
      currentVideoLabel,
      inputRefs,
      spriteInputIndex: inputRefs.revealSprite,
      spriteLabel: revealSpriteLabel,
      outputLabel: revealVideoLabel,
      platformLabelPrefix: 'memreveal',
      platformVariant: 'reveal',
      spriteSize,
      centerX: revealCenterXExpression,
      centerY: revealCenterYExpression,
      enableExpression: overlayRange(revealVisualStart, renderPlan.total_duration_seconds),
      fps,
      template,
    });
  }

  const timerSourceDuration = Math.max(
    0.12,
    ensureNumber(
      useHpBarCountdown
        ? plan.assets.overlays?.selected_timer_hp_bar_duration_seconds
        : plan.assets.overlays?.selected_timer_countdown_duration_seconds,
      plan.assets.overlays?.selected_timer_duration_seconds ?? (renderPlan.phases.countdown?.duration_seconds || 0),
    ),
  );
  const timerSetpts = timerSourceDuration > 0
    ? `(PTS-STARTPTS)*${Number(((renderPlan.phases.countdown?.duration_seconds || 0) / timerSourceDuration).toFixed(3))}+${countdownStart}/TB`
    : `PTS-STARTPTS+${countdownStart}/TB`;

  if (useHpBarCountdown) {
    if (inputRefs.timerHpBarFrame != null) {
      filters.push(
        `[${inputRefs.timerHpBarFrame}:v]fps=${fps},scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba,alphaextract[timerhpbarmask]`,
      );
      filters.push(
        `[${inputRefs.timerHpBar}:v]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba[timerhpbarvideo]`,
      );
      filters.push(
        `[timerhpbarvideo][timerhpbarmask]alphamerge,setsar=1[timerhpbar]`,
      );
    } else {
      filters.push(
        `[${inputRefs.timerHpBar}:v]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},scale=${renderPlan.timer_layout.width}:${renderPlan.timer_layout.height}:force_original_aspect_ratio=decrease,format=rgba${hpBarUsesGreenscreen ? ',colorkey=0x00FF00:0.22:0.08' : ''},fade=t=in:st=${countdownStart}:d=0.18:alpha=1,setsar=1[timerhpbar]`,
      );
    }
    const timerVideoLabel = `${currentVideoLabel}hb`;
    filters.push(
      `[${currentVideoLabel}][timerhpbar]overlay=x='${renderPlan.timer_layout.x}+((` +
      `${renderPlan.timer_layout.width}-w)/2)':y='${buildAnimatedTextYExpression(
        `${renderPlan.timer_layout.y}+((` +
        `${renderPlan.timer_layout.height}-h)/2)`,
        countdownStart,
      )}':enable='${overlayRange(countdownStart, revealStart)}'[${timerVideoLabel}]`,
    );
    currentVideoLabel = timerVideoLabel;
  } else if (inputRefs.timerCountdown != null) {
    const timerWidth = ensureNumber(renderPlan.timer_layout.width, 268);
    const timerHeight = ensureNumber(renderPlan.timer_layout.height, 268);
    const timerLabel = 'timercountdown';
    filters.push(
      `[${inputRefs.timerCountdown}:v]fps=${fps},trim=duration=${Math.max(0.5, renderPlan.phases.countdown?.duration_seconds || 0)},setpts=PTS-STARTPTS+${countdownStart}/TB,crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=${timerWidth}:${timerHeight}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[${timerLabel}]`,
    );
    const timerVideoLabel = `${currentVideoLabel}t`;
    filters.push(
      `[${currentVideoLabel}][${timerLabel}]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${overlayRange(countdownStart, revealStart)}'[${timerVideoLabel}]`,
    );
    currentVideoLabel = timerVideoLabel;
  }

  const drawtextParts = [];
  const fontPart = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
  const hookSegments = textArtifacts.hook?.segments || [];
  const questionSegments = textArtifacts.question?.segments || [];
  const optionSegments = textArtifacts.options?.segments || [];
  const revealSegments = textArtifacts.reveal?.segments || [];

  for (const line of hookSegments) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, 132)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, line.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(line.start_seconds, line.end_seconds)}':enable='${overlayRange(line.start_seconds, line.end_seconds)}'`,
    );
  }
  for (const line of questionSegments) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, 88)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, line.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(line.start_seconds, line.end_seconds)}':enable='${overlayRange(line.start_seconds, line.end_seconds)}'`,
    );
  }
  for (const line of optionSegments) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, 78)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${line.x_expression || ensureNumber(line.x, 136)}:y=${ensureNumber(line.y, 1220)}:enable='${overlayRange(line.start_seconds, line.end_seconds)}'`,
    );
  }
  for (const line of revealSegments) {
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, 110)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, line.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(line.start_seconds, line.end_seconds)}':enable='${overlayRange(line.start_seconds, line.end_seconds)}'`,
    );
  }
  if (!useHpBarCountdown) {
    for (const countdown of renderPlan.countdown_numbers || []) {
      drawtextParts.push(
        `drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_TIMER_NUMBER_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y='${buildCountdownNumberYExpression(renderPlan.timer_layout.number_center_y, countdown.start_seconds, countdown.end_seconds)}-text_h/2':alpha='${buildCountdownNumberAlphaExpression(countdown.start_seconds, countdown.end_seconds)}':enable='${overlayRange(countdown.start_seconds, countdown.end_seconds)}'`,
      );
    }
  }

  filters.push(`[${currentVideoLabel}]${drawtextParts.join(',')},trim=duration=${renderPlan.total_duration_seconds}[vout]`);
  return {
    script: `${filters.join(';\n')}\n`,
    outputLabel: 'vout',
  };
}
