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

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const questionStart = ensureNumber(renderPlan.phases.question?.start_seconds, 0);
  const countdownStart = ensureNumber(renderPlan.phases.countdown?.start_seconds, questionStart);
  const revealStart = ensureNumber(renderPlan.phases.reveal?.start_seconds, countdownStart);
  const hookStart = ensureNumber(renderPlan.phases.hook?.start_seconds, 0);
  const memorizeVisibleEnd = questionStart;
  const gridLayout = renderPlan.grid || { cells: [] };

  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);
  let currentVideoLabel = 'v0';

  const placeholderSize = Number((
    ensureNumber(gridLayout.item_size_px, 220)
    * ensureNumber(gridLayout.placeholder_scale_multiplier, 0.92)
  ).toFixed(3));

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
    const revealLabel = `memreveal${index}`;
    filters.push(
      `[${inputRefs.sprites[index]}:v]fps=${fps},scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${spriteLabel}]`,
    );
    filters.push(
      `[${currentVideoLabel}][${spriteLabel}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${overlayRange(hookStart, memorizeVisibleEnd)}'[${memorizeLabel}]`,
    );
    filters.push(
      `[${memorizeLabel}][${spriteLabel}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${overlayRange(revealStart, renderPlan.total_duration_seconds)}'[${revealLabel}]`,
    );
    currentVideoLabel = revealLabel;
  }

  if (inputRefs.hiddenPlaceholder != null) {
    for (let index = 0; index < gridLayout.cells.length; index += 1) {
      const cell = gridLayout.cells[index];
      const placeholderLabel = `hiddenph${index}`;
      const hiddenVideoLabel = `hiddenv${index}`;
      filters.push(
        `[${inputRefs.hiddenPlaceholder}:v]fps=${fps},scale=${placeholderSize}:${placeholderSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${placeholderLabel}]`,
      );
      filters.push(
        `[${currentVideoLabel}][${placeholderLabel}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${overlayRange(questionStart, revealStart)}'[${hiddenVideoLabel}]`,
      );
      currentVideoLabel = hiddenVideoLabel;
    }
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
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, 82)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${ensureNumber(line.x, 136)}:y=${ensureNumber(line.y, 1220)}:enable='${overlayRange(line.start_seconds, line.end_seconds)}'`,
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
