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
  normalizeAnimationTimeExpression,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_POKEBALL_INTRO_SECONDS,
  DEFAULT_POKEBALL_SCALE_MULTIPLIER,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_REVEAL_FONT_SIZE,
  DEFAULT_REVEAL_TRANSITION_SECONDS,
  DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER,
  DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
  DEFAULT_TEXT_BORDER,
  DEFAULT_TIMER_ALARM_EXIT_SECONDS,
  DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS,
  DEFAULT_TIMER_NUMBER_SIZE,
  DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  resolvePokeballIntroStartSeconds,
  roundTime,
  safeFilterLabel,
} from '../../dual-type-reveal/render/constants.mjs';

function resolveCellPokeballReplayStartSeconds({
  cell,
  gridLayout,
  countdownStart,
  countdownDuration,
  revealVisualStart,
  pokeballIntroStart,
  pokeballSourceDuration,
}) {
  const windowStartRatio = Math.min(
    0.92,
    Math.max(
      0,
      ensureNumber(gridLayout?.pokeball_wiggle_window_start_ratio, 0.12),
    ),
  );
  const windowEndRatio = Math.min(
    0.96,
    Math.max(
      windowStartRatio + 0.04,
      ensureNumber(gridLayout?.pokeball_wiggle_window_end_ratio, 0.76),
    ),
  );
  const introAnimationEnd = roundTime(
    Math.min(revealVisualStart, pokeballIntroStart + pokeballSourceDuration),
  );
  const availableWindowStart = roundTime(
    Math.max(
      introAnimationEnd + 0.12,
      countdownStart + (countdownDuration * windowStartRatio),
    ),
  );
  const availableWindowEnd = roundTime(
    Math.min(
      revealVisualStart - Math.max(0.12, pokeballSourceDuration) - 0.08,
      countdownStart + (countdownDuration * windowEndRatio),
    ),
  );
  if (availableWindowEnd <= availableWindowStart) {
    return roundTime(Math.max(introAnimationEnd + 0.12, availableWindowEnd));
  }

  const offsetRatio = Math.min(
    1,
    Math.max(
      0,
      ensureNumber(
        cell?.pokeball_replay_offset_ratio,
        ensureNumber(cell?.pokeball_wiggle_offset_ratio, 0.5),
      ),
    ),
  );
  return roundTime(availableWindowStart + ((availableWindowEnd - availableWindowStart) * offsetRatio));
}

function buildHalfOpenEnableExpression(startSeconds, endSeconds) {
  return `gte(t,${roundTime(startSeconds)})*lt(t,${roundTime(endSeconds)})`;
}

function resolveFindTheShinyPokeballIntroDurationSeconds(gridLayout) {
  return roundTime(Math.max(
    0.12,
    ensureNumber(
      gridLayout?.pokeball_intro_duration_seconds,
      DEFAULT_POKEBALL_INTRO_SECONDS,
    ),
  ));
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const gridLayout = renderPlan.grid || { cells: [] };
  const selectedShinyCellIndex = Number(plan.shiny_reveal?.selected_cell_index ?? -1);
  const gridItemSize = ensureNumber(gridLayout.item_size_px, 180);
  const countdownDuration = Math.max(0.5, ensureNumber(renderPlan.phases.countdown?.duration_seconds, 0));
  const countdownStart = ensureNumber(renderPlan.phases.countdown?.start_seconds, 0);
  const revealVisualStart = ensureNumber(
    renderPlan.audio_cues?.reveal_visual_start_seconds,
    ensureNumber(renderPlan.phases.reveal?.start_seconds, 0),
  );
  const revealTransitionDuration = ensureNumber(
    renderPlan.transitions?.reveal_cross_scale_seconds,
    DEFAULT_REVEAL_TRANSITION_SECONDS,
  );
  const revealTransitionEnd = roundTime(
    Math.min(renderPlan.total_duration_seconds, revealVisualStart + revealTransitionDuration),
  );
  const revealDurationSeconds = Math.max(
    0.5,
    ensureNumber(renderPlan.phases.reveal?.duration_seconds, 0),
  );
  const spriteHoldSize = roundTime(
    gridItemSize * Math.max(
      1,
      ensureNumber(
        gridLayout.sprite_scale_multiplier,
        DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER,
      ),
    ),
  );
  const pokeballSize = roundTime(
    gridItemSize * Math.max(
      1,
      ensureNumber(
        template?.layout?.pokeball_grid?.overlay_scale_multiplier,
        DEFAULT_POKEBALL_SCALE_MULTIPLIER,
      ),
    ),
  );
  const timerVisualWidth = roundTime(renderPlan.timer_layout.width * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerVisualHeight = roundTime(renderPlan.timer_layout.height * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const promptFontSize = Math.max(
    DEFAULT_PROMPT_FONT_SIZE,
    ensureNumber(template?.layout?.text?.prompt_font_size, DEFAULT_PROMPT_FONT_SIZE),
  );
  const pokeballIntroStart = resolvePokeballIntroStartSeconds(renderPlan);
  const pokeballIntroDuration = resolveFindTheShinyPokeballIntroDurationSeconds(gridLayout);
  const pokeballSourceDuration = Math.max(
    0.12,
    ensureNumber(plan.assets.overlays?.selected_primary_pokeball_duration_seconds, 0.6),
  );

  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);

  let currentVideoLabel = 'v0';

  if (inputRefs.pokeball != null && gridLayout.cells.length > 0) {
    const pokeballSourceLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbsrc', index));
    const pokeballIntroSourceLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbisrc', index));
    const pokeballReplaySourceLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbrsrc', index));
    const pokeballIntroLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbi', index));
    const pokeballReplayLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbr', index));
    const pokeballTransitionLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbt', index));
    const pokeballOverlayLabels = gridLayout.cells.map((_, index) => safeFilterLabel('pbo', index));
    const pokeballReplayWindows = gridLayout.cells.map((cell) => {
      const replayStart = resolveCellPokeballReplayStartSeconds({
        cell,
        gridLayout,
        countdownStart,
        countdownDuration,
        revealVisualStart,
        pokeballIntroStart,
        pokeballSourceDuration,
      });
      const introAnimationEnd = roundTime(
        Math.min(revealVisualStart, pokeballIntroStart + pokeballSourceDuration),
      );
      return {
        intro_end: introAnimationEnd,
        replay_start: replayStart,
        replay_end: roundTime(
          Math.min(revealVisualStart, replayStart + pokeballSourceDuration),
        ),
      };
    });
    filters.push(
      `[${inputRefs.pokeball}:v]fps=${fps},format=rgba,scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,setsar=1,split=${pokeballSourceLabels.length}${pokeballSourceLabels.map((label) => `[${label}]`).join('')}`,
    );

    for (let index = 0; index < gridLayout.cells.length; index += 1) {
      const cell = gridLayout.cells[index];
      const replayWindow = pokeballReplayWindows[index];
      const introHoldDuration = roundTime(Math.max(0, replayWindow.replay_start - replayWindow.intro_end));
      const replayHoldDuration = roundTime(Math.max(0, revealVisualStart - replayWindow.replay_end));
      const introScaleExpression = buildAnimatedPopSettleExpression(
        pokeballIntroStart,
        pokeballIntroDuration,
        0,
        1.08,
        1,
        buildScaleFilterTimeExpression({
          fps,
          streamStartSeconds: pokeballIntroStart,
        }),
      );
      filters.push(
        `[${pokeballSourceLabels[index]}]split=2[${pokeballIntroSourceLabels[index]}][${pokeballReplaySourceLabels[index]}]`,
      );
      filters.push(
        `[${pokeballIntroSourceLabels[index]}]trim=duration=${pokeballSourceDuration},tpad=stop_mode=clone:stop_duration=${introHoldDuration},setpts=PTS-STARTPTS+${pokeballIntroStart}/TB,scale=w='${pokeballSize}*(${introScaleExpression})':h='${pokeballSize}*(${introScaleExpression})':eval=frame,setsar=1[${pokeballIntroLabels[index]}]`,
      );
      filters.push(
        `[${pokeballReplaySourceLabels[index]}]trim=duration=${pokeballSourceDuration},tpad=stop_mode=clone:stop_duration=${replayHoldDuration},setpts=PTS-STARTPTS+${replayWindow.replay_start}/TB,scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,setsar=1[${pokeballReplayLabels[index]}]`,
      );
      filters.push(
        `[${pokeballReplayLabels[index]}]split=2[${pokeballOverlayLabels[index]}][${pokeballTransitionLabels[index]}]`,
      );
      const withIntroVideoLabel = safeFilterLabel('vg', index);
      filters.push(
        `[${currentVideoLabel}][${pokeballIntroLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${buildHalfOpenEnableExpression(pokeballIntroStart, replayWindow.replay_start)}'[${withIntroVideoLabel}]`,
      );
      const withReplayVideoLabel = safeFilterLabel('vgr', index);
      filters.push(
        `[${withIntroVideoLabel}][${pokeballOverlayLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${buildHalfOpenEnableExpression(replayWindow.replay_start, revealVisualStart)}'[${withReplayVideoLabel}]`,
      );
      currentVideoLabel = withReplayVideoLabel;
    }

    const transitionScaleTimeExpression = buildScaleFilterTimeExpression({
      fps,
      streamStartSeconds: revealVisualStart,
    });
    const transitionProgressExpression = `min(max((${normalizeAnimationTimeExpression(transitionScaleTimeExpression)}-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const pokeballScaleFactor = `max(0.02,pow(max(0.02,1-${transitionProgressExpression}),1.85))`;
    const pokeballScaleExpression = `max(6,${pokeballSize}*(${pokeballScaleFactor}))`;
    for (let index = 0; index < gridLayout.cells.length; index += 1) {
      filters.push(
        `[${pokeballTransitionLabels[index]}]scale=w='${pokeballScaleExpression}':h='${pokeballScaleExpression}':eval=frame,setsar=1[${safeFilterLabel('pokeballpop', index)}]`,
      );
    }
  }

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

  const nonShinyCells = gridLayout.cells.filter((cell) => cell.index !== selectedShinyCellIndex);
  const normalTransitionLabelByCellIndex = new Map();
  const normalHoldLabelByCellIndex = new Map();
  if (nonShinyCells.length > 0) {
    const normalSplitLabels = [];
    for (const cell of nonShinyCells) {
      normalSplitLabels.push(`[${safeFilterLabel('normalsrc', cell.index)}]`);
      normalSplitLabels.push(`[${safeFilterLabel('normalholdsrc', cell.index)}]`);
    }
    filters.push(
      `[${inputRefs.normalSprite}:v]fps=${fps},trim=duration=${revealDurationSeconds},setpts=PTS-STARTPTS+${revealVisualStart}/TB,format=rgba,eq=contrast=1.08:saturation=1.05,split=${normalSplitLabels.length}${normalSplitLabels.join('')}`,
    );
    const transitionScaleTimeExpression = buildScaleFilterTimeExpression({
      fps,
      streamStartSeconds: revealVisualStart,
    });
    const transitionProgressExpression = `min(max((${normalizeAnimationTimeExpression(transitionScaleTimeExpression)}-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const spriteScaleFactor = `max(0.03,if(lt(${transitionProgressExpression},0.22),0.06+(${transitionProgressExpression}/0.22)*0.34,0.40+(((${transitionProgressExpression}-0.22)/0.78)*0.80)))`;
    const spriteScaleExpression = `max(6,${spriteHoldSize}*(${spriteScaleFactor}))`;
    for (const cell of nonShinyCells) {
      const holdSourceLabel = safeFilterLabel('normalholdsrc', cell.index);
      const holdLabel = safeFilterLabel('normalhold', cell.index);
      const transitionSourceLabel = safeFilterLabel('normalsrc', cell.index);
      const transitionLabel = safeFilterLabel('normaltransition', cell.index);
      filters.push(
        `[${holdSourceLabel}]scale=${spriteHoldSize}:${spriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1[${holdLabel}]`,
      );
      filters.push(
        `[${transitionSourceLabel}]scale=w='${spriteScaleExpression}':h='${spriteScaleExpression}':eval=frame,setsar=1[${transitionLabel}]`,
      );
      normalHoldLabelByCellIndex.set(cell.index, holdLabel);
      normalTransitionLabelByCellIndex.set(cell.index, transitionLabel);
    }
  }

  let shinyHoldLabel = null;
  let shinyTransitionLabel = null;
  const shinyCell = gridLayout.cells.find((cell) => cell.index === selectedShinyCellIndex) || null;
  if (shinyCell) {
    const transitionScaleTimeExpression = buildScaleFilterTimeExpression({
      fps,
      streamStartSeconds: revealVisualStart,
    });
    const transitionProgressExpression = `min(max((${normalizeAnimationTimeExpression(transitionScaleTimeExpression)}-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const spriteScaleFactor = `max(0.03,if(lt(${transitionProgressExpression},0.22),0.06+(${transitionProgressExpression}/0.22)*0.34,0.40+(((${transitionProgressExpression}-0.22)/0.78)*0.80)))`;
    const spriteScaleExpression = `max(6,${spriteHoldSize}*(${spriteScaleFactor}))`;
    shinyHoldLabel = 'shinyhold';
    shinyTransitionLabel = 'shinytransition';
    filters.push(
      `[${inputRefs.shinySprite}:v]fps=${fps},trim=duration=${revealDurationSeconds},setpts=PTS-STARTPTS+${revealVisualStart}/TB,format=rgba,eq=contrast=1.08:saturation=1.08,split=2[shinysrc][shinyholdsrc]`,
    );
    filters.push(
      `[shinyholdsrc]scale=${spriteHoldSize}:${spriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1[${shinyHoldLabel}]`,
    );
    filters.push(
      `[shinysrc]scale=w='${spriteScaleExpression}':h='${spriteScaleExpression}':eval=frame,setsar=1[${shinyTransitionLabel}]`,
    );
  }

  for (const cell of gridLayout.cells) {
    const transitionLabel = cell.index === selectedShinyCellIndex
      ? shinyTransitionLabel
      : normalTransitionLabelByCellIndex.get(cell.index);
    if (!transitionLabel) {
      continue;
    }
    let transitionBaseLabel = currentVideoLabel;
    const pokeballTransitionLabel = inputRefs.pokeball != null
      ? safeFilterLabel('pokeballpop', cell.index)
      : null;
    if (pokeballTransitionLabel) {
      const withPokeballTransitionLabel = safeFilterLabel('vxp', cell.index);
      const progressExpression = `min(max((t-${revealVisualStart})/${revealTransitionDuration},0),1)`;
      const pokeballBounceExpression = `if(lt(${progressExpression},0.24),(${progressExpression}/0.24)*26,max(0,26-(((${progressExpression}-0.24)/0.76)*26)))`;
      filters.push(
        `[${currentVideoLabel}][${pokeballTransitionLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2-${pokeballBounceExpression}':enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withPokeballTransitionLabel}]`,
      );
      transitionBaseLabel = withPokeballTransitionLabel;
    }
    const withSpriteTransitionLabel = safeFilterLabel('vxs', cell.index);
    filters.push(
      `[${transitionBaseLabel}][${transitionLabel}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withSpriteTransitionLabel}]`,
    );
    currentVideoLabel = withSpriteTransitionLabel;
  }

  for (const cell of gridLayout.cells) {
    const holdLabel = cell.index === selectedShinyCellIndex
      ? shinyHoldLabel
      : normalHoldLabelByCellIndex.get(cell.index);
    if (!holdLabel) {
      continue;
    }
    const nextVideoLabel = safeFilterLabel('vr', cell.index);
    filters.push(
      `[${currentVideoLabel}][${holdLabel}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealTransitionEnd, renderPlan.total_duration_seconds)}'[${nextVideoLabel}]`,
    );
    currentVideoLabel = nextVideoLabel;
  }

  if (shinyCell && plan.assets.overlays?.selected_shiny_sparkle_path && inputRefs.shinySparkle != null) {
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
      spriteHoldSize * Math.max(
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
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${promptFontSize}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
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
