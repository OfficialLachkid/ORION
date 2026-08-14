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
  enableExpression,
  fps,
  template,
}) {
  let baseVideoLabel = currentVideoLabel;
  const platformLayout = resolvePlatformLayout(template, platformVariant);
  if (inputRefs.grassPlatform != null && platformLayout.enabled) {
    const platformWidth = Number((spriteSize * platformLayout.width_multiplier).toFixed(3));
    const platformCenterY = Number((centerY + (spriteSize * platformLayout.center_y_offset_multiplier)).toFixed(3));
    const platformLabel = `${platformLabelPrefix}platform`;
    const platformVideoLabel = `${platformLabelPrefix}platformv`;
    filters.push(
      `[${inputRefs.grassPlatform}:v]fps=${fps},scale=${platformWidth}:-1,format=rgba,setsar=1[${platformLabel}]`,
    );
    filters.push(
      `[${baseVideoLabel}][${platformLabel}]overlay=x='${centerX}-w/2':y='${platformCenterY}-h/2':enable='${enableExpression}'[${platformVideoLabel}]`,
    );
    baseVideoLabel = platformVideoLabel;
  }

  filters.push(
    `[${spriteInputIndex}:v]fps=${fps},scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${spriteLabel}]`,
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
    revealStart,
    revealVisualStart,
  );
  const revealCenterYExpression = buildHoldThenLerpExpression(
    revealStartCenterY,
    revealTargetCenterY,
    revealStart,
    revealVisualStart,
  );

  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);
  let currentVideoLabel = 'v0';

  for (let index = 0; index < (inputRefs.sprites || []).length && index < gridLayout.cells.length; index += 1) {
    const pokemon = plan.assets.pokemon[index] || {};
    const cell = gridLayout.cells[index];
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
      centerY: cell.center_y,
      enableExpression: overlayRange(hookStart, memorizeVisibleEnd),
      fps,
      template,
    });
  }

  if ((inputRefs.optionSprites || []).length > 0) {
    for (let index = 0; index < inputRefs.optionSprites.length && index < optionGridLayout.cells.length; index += 1) {
      const option = plan.question?.options?.[index] || {};
      const cell = optionGridLayout.cells[index];
      const spriteSize = Number((
        ensureNumber(optionGridLayout.item_size_px, 196)
        * ensureNumber(optionGridLayout.sprite_scale_multiplier, 1)
        * ensureNumber(option.sprite_display_scale_multiplier, 1)
      ).toFixed(3));
      const optionSpriteLabel = `memoption${index}`;
      const optionVideoLabel = `memoptionv${index}`;
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
      centerY: cell.center_y,
        enableExpression: overlayRange(questionStart, revealStart),
        fps,
        template,
      });
    }
  }

  if (inputRefs.revealSprite != null) {
    const spriteSize = Number((
      ensureNumber(renderPlan.reveal_sprite?.item_size_px, 320)
      * ensureNumber(renderPlan.reveal_sprite?.sprite_scale_multiplier, 1)
      * ensureNumber(plan.assets.reveal_pokemon?.sprite_display_scale_multiplier, 1)
    ).toFixed(3));
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
      enableExpression: overlayRange(revealStart, renderPlan.total_duration_seconds),
      fps,
      template,
    });
  }

  if (inputRefs.timerCountdown != null) {
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
  for (const countdown of renderPlan.countdown_numbers || []) {
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_TIMER_NUMBER_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y='${buildCountdownNumberYExpression(renderPlan.timer_layout.number_center_y, countdown.start_seconds, countdown.end_seconds)}-text_h/2':alpha='${buildCountdownNumberAlphaExpression(countdown.start_seconds, countdown.end_seconds)}':enable='${overlayRange(countdown.start_seconds, countdown.end_seconds)}'`,
    );
  }

  filters.push(`[${currentVideoLabel}]${drawtextParts.join(',')},trim=duration=${renderPlan.total_duration_seconds}[vout]`);
  return {
    script: `${filters.join(';\n')}\n`,
    outputLabel: 'vout',
  };
}
