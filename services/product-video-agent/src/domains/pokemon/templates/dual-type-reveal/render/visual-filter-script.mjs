import {
  buildAnimatedLiftExpression,
  buildAnimatedLerpExpression,
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
  resolveRevealSpriteHoldSize,
} from './animation-expressions.mjs';
import {
  DEFAULT_COUNTDOWN_VOLUME,
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_POKEBALL_INTRO_SECONDS,
  DEFAULT_POKEBALL_SCALE_MULTIPLIER,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_REVEAL_TRANSITION_SECONDS,
  DEFAULT_REVEAL_FONT_SIZE,
  DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER,
  DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
  DEFAULT_TEXT_BORDER,
  DEFAULT_TIMER_ALARM_EXIT_SECONDS,
  DEFAULT_TIMER_ALARM_EXTRA_HOLD_SECONDS,
  DEFAULT_TIMER_NUMBER_SIZE,
  DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_BACKDROP_ALPHA,
  DEFAULT_TYPE_ICON_BACKDROP_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_BADGE_ART_FINAL_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_BADGE_ART_INTRO_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_POP_IN_INITIAL_SCALE,
  DEFAULT_TYPE_ICON_POP_IN_PEAK_SCALE,
  DEFAULT_TYPE_ICON_POP_IN_SECONDS,
  DEFAULT_TYPE_ICON_POP_IN_SETTLE_SCALE,
  DEFAULT_TYPE_ICON_SCALE_SETTLE_RATIO,
  DEFAULT_TYPE_ICON_SETTLE_SCALE_MULTIPLIER,
  DEFAULT_TYPE_ICON_SETTLE_SECONDS,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
  resolvePokeballIntroStartSeconds,
  safeFilterLabel,
  typeIconUsesOpaqueBadgeArt,
} from './constants.mjs';

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath, textArtifacts) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
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
  filters.push(`[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1[v0]`);

  for (let index = 0; index < plan.assets.type_icons.length; index += 1) {
    const iconLabel = safeFilterLabel('type', index);
    const iconInnerLabel = safeFilterLabel('typeinner', index);
    const iconBackdropBaseLabel = safeFilterLabel('typebgbase', index);
    const iconBackdropLabel = safeFilterLabel('typebg', index);
    const position = renderPlan.type_icon_layout[index];
    const introPosition = renderPlan.type_icon_intro_layout[index] || position;
    const usesOpaqueBadgeArt = typeIconUsesOpaqueBadgeArt(plan.assets.type_icons[index]);
    const settleDuration = ensureNumber(
      renderPlan.transitions?.type_icon_settle_seconds,
      DEFAULT_TYPE_ICON_SETTLE_SECONDS,
    );
    const sizeSettleDuration = roundTime(
      Math.max(0.14, settleDuration * DEFAULT_TYPE_ICON_SCALE_SETTLE_RATIO),
    );
    const hookStart = ensureNumber(renderPlan.phases.hook?.start_seconds, 0);
    const iconSettleStart = ensureNumber(renderPlan.phases.type_prompt?.start_seconds, 0);
    const scaleFilterTimeExpression = buildScaleFilterTimeExpression({ fps });
    const baseSizeExpression = buildAnimatedLerpExpression({
      fromValue: introPosition.width,
      toValue: position.width,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: sizeSettleDuration,
      timeExpression: scaleFilterTimeExpression,
    });
    const introPopMultiplierExpression = buildAnimatedPopSettleExpression(
      hookStart,
      DEFAULT_TYPE_ICON_POP_IN_SECONDS,
      DEFAULT_TYPE_ICON_POP_IN_INITIAL_SCALE,
      DEFAULT_TYPE_ICON_POP_IN_PEAK_SCALE,
      DEFAULT_TYPE_ICON_POP_IN_SETTLE_SCALE,
      scaleFilterTimeExpression,
    );
    const settleScaleMultiplierExpression = buildAnimatedLerpExpression({
      fromValue: DEFAULT_TYPE_ICON_SETTLE_SCALE_MULTIPLIER,
      toValue: 1,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: sizeSettleDuration,
      timeExpression: scaleFilterTimeExpression,
    });
    const finalCenterX = position.x + Math.floor(position.width / 2);
    const finalCenterY = position.y + Math.floor(position.height / 2);
    const introCenterX = introPosition.x + Math.floor(introPosition.width / 2);
    const introCenterY = introPosition.y + Math.floor(introPosition.height / 2);
    const iconCenterXExpression = buildAnimatedLerpExpression({
      fromValue: introCenterX,
      toValue: finalCenterX,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: settleDuration,
    });
    const iconCenterYExpression = buildAnimatedLerpExpression({
      fromValue: introCenterY,
      toValue: finalCenterY,
      holdUntilSeconds: iconSettleStart,
      transitionDurationSeconds: settleDuration,
    });
    const introLiftExpression = buildAnimatedLiftExpression(hookStart);
    const iconScaleExpression =
      `(${baseSizeExpression})*(${introPopMultiplierExpression})*(${settleScaleMultiplierExpression})`;
    const badgeArtScaleMultiplierExpression = usesOpaqueBadgeArt
      ? buildAnimatedLerpExpression({
        fromValue: DEFAULT_TYPE_ICON_BADGE_ART_INTRO_SCALE_MULTIPLIER,
        toValue: DEFAULT_TYPE_ICON_BADGE_ART_FINAL_SCALE_MULTIPLIER,
        holdUntilSeconds: iconSettleStart,
        transitionDurationSeconds: sizeSettleDuration,
        timeExpression: scaleFilterTimeExpression,
      })
      : '1';
    const iconForegroundScaleExpression = usesOpaqueBadgeArt
      ? `(${iconScaleExpression})*(${badgeArtScaleMultiplierExpression})`
      : iconScaleExpression;
    const iconBackdropScaleMultiplier = DEFAULT_TYPE_ICON_BACKDROP_SCALE_MULTIPLIER;
    const iconBackdropAlpha = usesOpaqueBadgeArt
      ? Math.max(180, DEFAULT_TYPE_ICON_BACKDROP_ALPHA - 40)
      : DEFAULT_TYPE_ICON_BACKDROP_ALPHA;
    const iconBackdropScaleExpression = `(${iconScaleExpression})*${iconBackdropScaleMultiplier}`;
    filters.push(
      `[${inputRefs.typeIcons[index]}:v]scale=w='${iconForegroundScaleExpression}':h='${iconForegroundScaleExpression}':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${iconLabel}]`,
    );
    if (!usesOpaqueBadgeArt) {
      filters.push(
        `color=c=white:s=640x640,format=rgba,geq=r='255':g='255':b='255':a='if(lte(((X-W/2)*(X-W/2))+((Y-H/2)*(Y-H/2)),((W/2)-10)*((W/2)-10)),${iconBackdropAlpha},0)'[${iconBackdropBaseLabel}]`,
      );
      filters.push(
        `[${iconBackdropBaseLabel}]scale=w='${iconBackdropScaleExpression}':h='${iconBackdropScaleExpression}':eval=frame,setsar=1[${iconBackdropLabel}]`,
      );
      filters.push(
        `[v${index}][${iconBackdropLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[${iconInnerLabel}]`,
      );
      filters.push(
        `[${iconInnerLabel}][${iconLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[v${index + 1}]`,
      );
    } else {
      filters.push(
        `[v${index}][${iconLabel}]overlay=x='${iconCenterXExpression}-w/2':y='${iconCenterYExpression}-h/2-${introLiftExpression}':enable='${formatEnableBetween(renderPlan.phases.hook.start_seconds, renderPlan.total_duration_seconds)}'[v${index + 1}]`,
      );
    }
  }

  let currentVideoLabel = `v${plan.assets.type_icons.length}`;

  const gridItemSize = ensureNumber(renderPlan.grid.item_size_px, 180);
  const pokeballSize = roundTime(
    gridItemSize * Math.max(
      1,
      ensureNumber(template?.layout?.pokeball_grid?.overlay_scale_multiplier, DEFAULT_POKEBALL_SCALE_MULTIPLIER),
    ),
  );
  const timerVisualWidth = roundTime(renderPlan.timer_layout.width * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerVisualHeight = roundTime(renderPlan.timer_layout.height * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const pokeballIntroStart = resolvePokeballIntroStartSeconds(renderPlan);
  const pokeballIntroDuration = roundTime(
    DEFAULT_POKEBALL_INTRO_SECONDS,
  );
  const pokeballVisibleDuration = roundTime(Math.max(0.5, revealTransitionEnd - pokeballIntroStart));
  const spriteHoldSize = resolveRevealSpriteHoldSize({
    gridItemSize,
    itemCount: renderPlan.grid.item_count || renderPlan.grid.cells.length,
    configuredMultiplier: ensureNumber(
      template?.layout?.silhouettes?.reveal_scale_multiplier,
      DEFAULT_REVEALED_SPRITE_SCALE_MULTIPLIER,
    ),
  });
  const pokeballStaticLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pbs', index));
  const pokeballIntroLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pbi', index));
  const pokeballTransitionLabels = renderPlan.grid.cells.map((_, index) => safeFilterLabel('pbt', index));
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
  if (pokeballStaticLabels.length > 0) {
    filters.push(`[${inputRefs.timerCountdown}:v]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=${timerVisualWidth}:${timerVisualHeight}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[timercountdown]`);
    filters.push(`[${inputRefs.pokeball}:v]fps=${fps},trim=duration=${pokeballVisibleDuration},setpts=PTS-STARTPTS+${pokeballIntroStart}/TB,scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[pokeballbase]`);
    const pokeballSplitLabels = [...pokeballStaticLabels, ...pokeballTransitionLabels];
    filters.push(`[pokeballbase]split=${pokeballSplitLabels.length}${pokeballSplitLabels.map((label) => `[${label}]`).join('')}`);
    for (let index = 0; index < renderPlan.grid.cells.length; index += 1) {
      const cell = renderPlan.grid.cells[index];
      const introScaleTimeExpression = buildScaleFilterTimeExpression({
        fps,
        streamStartSeconds: pokeballIntroStart,
      });
      const introScaleExpression = buildAnimatedPopSettleExpression(
        pokeballIntroStart,
        pokeballIntroDuration,
        0,
        1.08,
        1,
        introScaleTimeExpression,
      );
      filters.push(
        `[${pokeballStaticLabels[index]}]scale=w='${pokeballSize}*(${introScaleExpression})':h='${pokeballSize}*(${introScaleExpression})':eval=frame,setsar=1[${pokeballIntroLabels[index]}]`,
      );
      const nextVideoLabel = safeFilterLabel('vg', index);
      filters.push(
        `[${currentVideoLabel}][${pokeballIntroLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(pokeballIntroStart, revealVisualStart)}'[${nextVideoLabel}]`,
      );
      currentVideoLabel = nextVideoLabel;
    }
    const timerVideoLabel = `${currentVideoLabel}t`;
    filters.push(
      `[${currentVideoLabel}][timercountdown]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${formatEnableBetween(renderPlan.phases.countdown.start_seconds, renderPlan.phases.reveal.start_seconds)}'[${timerVideoLabel}]`,
    );
    currentVideoLabel = timerVideoLabel;
  }

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

  const spriteHoldLabels = [];
  const spriteTransitionLabels = [];
  for (let index = 0; index < plan.assets.pokemon.length; index += 1) {
    const spriteSourceLabel = safeFilterLabel('spritebase', index);
    const spriteHoldSourceLabel = safeFilterLabel('spriteholdbase', index);
    const spriteHoldLabel = safeFilterLabel('spritehold', index);
    const spriteTransitionLabel = safeFilterLabel('spritetransition', index);
    spriteHoldLabels.push(spriteHoldLabel);
    spriteTransitionLabels.push(spriteTransitionLabel);
    filters.push(
      `[${inputRefs.pokemon[index]}:v]fps=${fps},trim=duration=${Math.max(0.5, ensureNumber(renderPlan.phases.reveal?.duration_seconds, 0))},setpts=PTS-STARTPTS+${revealVisualStart}/TB,format=rgba,eq=contrast=1.08:saturation=1.05,split=2[${spriteSourceLabel}][${spriteHoldSourceLabel}]`,
    );
    filters.push(
      `[${spriteHoldSourceLabel}]scale=${spriteHoldSize}:${spriteHoldSize}:force_original_aspect_ratio=decrease,setsar=1[${spriteHoldLabel}]`,
    );
    const transitionScaleTimeExpression = buildScaleFilterTimeExpression({
      fps,
      streamStartSeconds: revealVisualStart,
    });
    const progressExpression = `min(max((${normalizeAnimationTimeExpression(transitionScaleTimeExpression)}-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const pokeballScaleFactor = `max(0.02,pow(max(0.02,1-${progressExpression}),1.85))`;
    const spriteScaleFactor = `max(0.03,if(lt(${progressExpression},0.22),0.06+(${progressExpression}/0.22)*0.34,0.40+(((${progressExpression}-0.22)/0.78)*0.80)))`;
    const pokeballScaleExpression = `max(6,${pokeballSize}*(${pokeballScaleFactor}))`;
    const spriteScaleExpression = `max(6,${spriteHoldSize}*(${spriteScaleFactor}))`;
    filters.push(
      `[${pokeballTransitionLabels[index]}]scale=w='${pokeballScaleExpression}':h='${pokeballScaleExpression}':eval=frame,setsar=1[${safeFilterLabel('pokeballpop', index)}]`,
    );
    filters.push(
      `[${spriteSourceLabel}]scale=w='${spriteScaleExpression}':h='${spriteScaleExpression}':eval=frame,setsar=1[${spriteTransitionLabel}]`,
    );
  }

  for (let index = 0; index < renderPlan.grid.cells.length && index < spriteTransitionLabels.length; index += 1) {
    const cell = renderPlan.grid.cells[index];
    const pokeballTransitionLabel = safeFilterLabel('pokeballpop', index);
    const withPokeballTransitionLabel = safeFilterLabel('vxp', index);
    const withSpriteTransitionLabel = safeFilterLabel('vxs', index);
    const progressExpression = `min(max((t-${revealVisualStart})/${revealTransitionDuration},0),1)`;
    const pokeballBounceExpression = `if(lt(${progressExpression},0.24),(${progressExpression}/0.24)*26,max(0,26-(((${progressExpression}-0.24)/0.76)*26)))`;
    filters.push(
      `[${currentVideoLabel}][${pokeballTransitionLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2-${pokeballBounceExpression}':enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withPokeballTransitionLabel}]`,
    );
    filters.push(
      `[${withPokeballTransitionLabel}][${spriteTransitionLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealVisualStart, revealTransitionEnd)}'[${withSpriteTransitionLabel}]`,
    );
    currentVideoLabel = withSpriteTransitionLabel;
  }

  for (let index = 0; index < renderPlan.grid.cells.length && index < spriteHoldLabels.length; index += 1) {
    const cell = renderPlan.grid.cells[index];
    const nextVideoLabel = safeFilterLabel('vr', index);
    filters.push(
      `[${currentVideoLabel}][${spriteHoldLabels[index]}]overlay=${cell.center_x}-w/2:${cell.center_y}-h/2:enable='${formatEnableBetween(revealTransitionEnd, renderPlan.total_duration_seconds)}'[${nextVideoLabel}]`,
    );
    currentVideoLabel = nextVideoLabel;
  }

  if (plan.shiny_reveal?.active && inputRefs.shinySparkle != null) {
    const shinyCell = renderPlan.grid.cells[plan.shiny_reveal.selected_subject_index];
    if (shinyCell) {
      const sparkleLabel = safeFilterLabel('shinysparkle', plan.shiny_reveal.selected_subject_index);
      const sparkleVideoLabel = `${currentVideoLabel}ss`;
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
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, DEFAULT_HOOK_FONT_SIZE)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
    );
  }
  for (const line of promptSegments) {
    const startSeconds = ensureNumber(line.start_seconds, renderPlan.phases.type_prompt.start_seconds);
    const endSeconds = ensureNumber(line.end_seconds, promptTextEndSeconds);
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, DEFAULT_PROMPT_FONT_SIZE)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
    );
  }
  for (const line of revealSegments) {
    const startSeconds = ensureNumber(line.start_seconds, renderPlan.phases.reveal.start_seconds);
    const endSeconds = ensureNumber(line.end_seconds, renderPlan.total_duration_seconds);
    drawtextParts.push(
      `drawtext=textfile='${escapeFilterPath(line.file_path)}'${fontPart}:fontcolor=white:fontsize=${ensureNumber(line.font_size, DEFAULT_REVEAL_FONT_SIZE)}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`,
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
