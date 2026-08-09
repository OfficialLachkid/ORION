import {
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  buildCountdownNumberAlphaExpression,
  buildCountdownNumberScaleMultiplierExpression,
  buildCountdownNumberYExpression,
  buildScaleFilterTimeExpression,
  buildTimerAlarmExitScaleExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_REVEAL_FONT_SIZE,
  DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
  DEFAULT_TEXT_BORDER,
  DEFAULT_TIMER_ALARM_EXIT_SECONDS,
  DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS,
  DEFAULT_TIMER_NUMBER_SIZE,
  DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const gridLayout = renderPlan.grid || { cells: [] };
  const spriteScaleMultiplier = Math.max(
    0.8,
    ensureNumber(gridLayout.sprite_scale_multiplier, 1.08),
  );
  const spriteSize = roundTime(gridLayout.item_size_px * spriteScaleMultiplier);
  const countdownDuration = Math.max(0.5, ensureNumber(renderPlan.phases.countdown?.duration_seconds, 0));
  const countdownStart = ensureNumber(renderPlan.phases.countdown?.start_seconds, 0);
  const revealVisualStart = ensureNumber(
    renderPlan.audio_cues?.reveal_visual_start_seconds,
    ensureNumber(renderPlan.phases.reveal?.start_seconds, 0),
  );
  const shinyPopDuration = ensureNumber(renderPlan.transitions?.shiny_pop_seconds, 0.32);
  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);

  const normalBaseLabel = 'normalspritebase';
  const normalLabels = gridLayout.cells.map((cell) => `normal${cell.index}`);
  filters.push(
    `[${inputRefs.normalSprite}:v]fps=${fps},trim=duration=${renderPlan.total_duration_seconds},setpts=PTS-STARTPTS,format=rgba,eq=contrast=1.04:saturation=1.03,scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease,setsar=1[${normalBaseLabel}]`,
  );
  filters.push(
    `[${normalBaseLabel}]split=${Math.max(1, normalLabels.length)}${normalLabels.map((label) => `[${label}]`).join('')}`,
  );

  let currentVideoLabel = 'v0';
  for (const cell of gridLayout.cells) {
    const nextVideoLabel = `grid${cell.index}`;
    filters.push(
      `[${currentVideoLabel}][normal${cell.index}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(0, renderPlan.total_duration_seconds)}'[${nextVideoLabel}]`,
    );
    currentVideoLabel = nextVideoLabel;
  }

  const timerVisualWidth = roundTime(renderPlan.timer_layout.width * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerVisualHeight = roundTime(renderPlan.timer_layout.height * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerSourceDuration = Math.max(
    0.12,
    ensureNumber(
      plan.assets.overlays?.selected_timer_countdown_duration_seconds,
      plan.assets.overlays?.selected_timer_duration_seconds ?? countdownDuration,
    ),
  );
  const timerSetpts = timerSourceDuration > 0
    ? `(PTS-STARTPTS)*${roundTime(countdownDuration / timerSourceDuration)}+${countdownStart}/TB`
    : `PTS-STARTPTS+${countdownStart}/TB`;
  filters.push(`[${inputRefs.timerCountdown}:v]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=${timerVisualWidth}:${timerVisualHeight}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[timercountdown]`);
  const timerVideoLabel = `${currentVideoLabel}t`;
  filters.push(
    `[${currentVideoLabel}][timercountdown]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, renderPlan.phases.reveal.start_seconds)}'[${timerVideoLabel}]`,
  );
  currentVideoLabel = timerVideoLabel;

  const timerAlarmDuration = ensureNumber(plan.assets.overlays?.selected_timer_alarm_duration_seconds, 0);
  if (inputRefs.timerAlarm != null && timerAlarmDuration > 0) {
    const timerAlarmLabel = 'timeralarm';
    const timerAlarmStart = renderPlan.phases.reveal.start_seconds;
    const timerAlarmVisibleEnd = roundTime(
      Math.min(
        renderPlan.total_duration_seconds,
        timerAlarmStart + timerAlarmDuration + DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS,
      ),
    );
    const timerAlarmExitStart = roundTime(
      Math.max(
        timerAlarmStart + Math.min(timerAlarmDuration, DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS * 0.35),
        timerAlarmVisibleEnd - DEFAULT_TIMER_ALARM_EXIT_SECONDS,
      ),
    );
    const timerAlarmScaleExpression = buildTimerAlarmExitScaleExpression(
      timerAlarmExitStart,
      timerAlarmVisibleEnd,
      buildScaleFilterTimeExpression({
        fps,
        streamStartSeconds: timerAlarmStart,
      }),
    );
    const timerAlarmHoldSeconds = roundTime(Math.max(
      0,
      timerAlarmVisibleEnd - (timerAlarmStart + timerAlarmDuration),
    ));
    const timerAlarmFadeDuration = roundTime(Math.max(
      0.18,
      timerAlarmVisibleEnd - timerAlarmExitStart,
    ));
    filters.push(
      `[${inputRefs.timerAlarm}:v]fps=${fps},trim=duration=${timerAlarmDuration},tpad=stop_mode=clone:stop_duration=${timerAlarmHoldSeconds},setpts=PTS-STARTPTS+${timerAlarmStart}/TB,crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=w='${timerVisualWidth}*(${timerAlarmScaleExpression})':h='${timerVisualHeight}*(${timerAlarmScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,fade=t=out:st=${timerAlarmExitStart}:d=${timerAlarmFadeDuration}:alpha=1,setsar=1[${timerAlarmLabel}]`,
    );
    const timerAlarmVideoLabel = `${currentVideoLabel}a`;
    filters.push(
      `[${currentVideoLabel}][${timerAlarmLabel}]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${formatEnableBetween(timerAlarmStart, timerAlarmVisibleEnd)}'[${timerAlarmVideoLabel}]`,
    );
    currentVideoLabel = timerAlarmVideoLabel;
  }

  const shinyCell = gridLayout.cells[plan.shiny_reveal?.selected_cell_index];
  if (shinyCell) {
    const shinyLabel = 'shinysprite';
    const shinyScaleExpression = buildAnimatedPopSettleExpression(
      revealVisualStart,
      shinyPopDuration,
      0.82,
      1.16,
      1,
      buildScaleFilterTimeExpression({
        fps,
        streamStartSeconds: revealVisualStart,
      }),
    );
    filters.push(
      `[${inputRefs.shinySprite}:v]fps=${fps},trim=duration=${Math.max(0.5, ensureNumber(renderPlan.phases.reveal?.duration_seconds, 0))},setpts=PTS-STARTPTS+${revealVisualStart}/TB,format=rgba,eq=contrast=1.08:saturation=1.08,scale=w='${spriteSize}*(${shinyScaleExpression})':h='${spriteSize}*(${shinyScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,setsar=1[${shinyLabel}]`,
    );
    const shinyVideoLabel = `${currentVideoLabel}s`;
    filters.push(
      `[${currentVideoLabel}][${shinyLabel}]overlay=${shinyCell.center_x}-w/2:${shinyCell.center_y}-h/2:enable='${formatEnableBetween(revealVisualStart, renderPlan.total_duration_seconds)}'[${shinyVideoLabel}]`,
    );
    currentVideoLabel = shinyVideoLabel;

    if (plan.assets.overlays?.selected_shiny_sparkle_path && inputRefs.shinySparkle != null) {
      const sparkleLabel = 'shinysparkle';
      const sparkleDuration = Math.max(
        0.12,
        ensureNumber(
          plan.assets.overlays?.selected_shiny_sparkle_duration_seconds,
          ensureNumber(plan.shiny_reveal?.sparkle_duration_seconds, 0.9),
        ),
      );
      const sparkleEnd = roundTime(
        Math.min(renderPlan.total_duration_seconds, revealVisualStart + sparkleDuration),
      );
      const sparkleSize = roundTime(
        spriteSize * Math.max(
          1,
          ensureNumber(
            plan.shiny_reveal?.sparkle_scale_multiplier,
            DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
          ),
        ),
      );
      filters.push(
        `[${inputRefs.shinySparkle}:v]fps=${fps},trim=duration=${sparkleDuration},setpts=PTS-STARTPTS+${revealVisualStart}/TB,scale=${sparkleSize}:${sparkleSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${sparkleLabel}]`,
      );
      const sparkleVideoLabel = `${currentVideoLabel}ss`;
      filters.push(
        `[${currentVideoLabel}][${sparkleLabel}]overlay=${shinyCell.center_x}-w/2:${shinyCell.center_y}-h/2:enable='${formatEnableBetween(revealVisualStart, sparkleEnd)}'[${sparkleVideoLabel}]`,
      );
      currentVideoLabel = sparkleVideoLabel;
    }
  }

  const drawtextParts = [];
  const fontPart = fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
  const promptTextEndSeconds = ensureNumber(
    renderPlan.audio_cues?.prompt_end_seconds,
    renderPlan.phases.countdown?.start_seconds ?? renderPlan.phases.reveal.start_seconds,
  );
  const hookSegments = textArtifacts.hook?.segments || textArtifacts.hook?.lines || [];
  const promptSegments = textArtifacts.prompt?.segments || textArtifacts.prompt?.lines || [];
  const revealSegments = textArtifacts.reveal?.segments || textArtifacts.reveal?.lines || [];
  for (const line of hookSegments) {
    const startSeconds = ensureNumber(line.start_seconds, renderPlan.phases.hook.start_seconds);
    const endSeconds = ensureNumber(line.end_seconds, renderPlan.phases.hook.end_seconds);
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_HOOK_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
    );
  }
  for (const line of promptSegments) {
    const startSeconds = ensureNumber(line.start_seconds, renderPlan.phases.type_prompt.start_seconds);
    const endSeconds = ensureNumber(line.end_seconds, promptTextEndSeconds);
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_PROMPT_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
    );
  }
  for (const line of revealSegments) {
    const startSeconds = ensureNumber(line.start_seconds, renderPlan.phases.reveal.start_seconds);
    const endSeconds = ensureNumber(line.end_seconds, renderPlan.total_duration_seconds);
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${DEFAULT_REVEAL_FONT_SIZE}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
    );
  }
  for (const countdown of renderPlan.countdown_numbers) {
    const scaleMultiplierExpression = buildCountdownNumberScaleMultiplierExpression(
      countdown.start_seconds,
      countdown.end_seconds,
    );
    drawtextParts.push(
      `drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize='${DEFAULT_TIMER_NUMBER_SIZE}*(${scaleMultiplierExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y='${buildCountdownNumberYExpression(renderPlan.timer_layout.number_center_y, countdown.start_seconds, countdown.end_seconds)}-text_h/2':alpha='${buildCountdownNumberAlphaExpression(countdown.start_seconds, countdown.end_seconds)}':enable='${formatEnableBetween(countdown.start_seconds, countdown.end_seconds)}'`,
    );
  }

  filters.push(`[${currentVideoLabel}]${drawtextParts.join(',')},trim=duration=${renderPlan.total_duration_seconds}[vout]`);

  return {
    script: `${filters.join(';\n')}\n`,
    outputLabel: 'vout',
  };
}
