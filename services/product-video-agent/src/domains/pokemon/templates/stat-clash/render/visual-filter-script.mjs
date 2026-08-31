import {
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_TEXT_BORDER,
  escapeDrawtextText,
  ensureNumber,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildProgressiveTextArtifacts,
} from '../../dual-type-reveal/render/text-layout.mjs';

function buildTimerBarScaleExpression(startSeconds, endSeconds, fullWidth) {
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(Math.max(start, ensureNumber(endSeconds, start)).toFixed(3));
  const width = Math.max(2, Math.round(ensureNumber(fullWidth, 0)));
  if (end <= start || width <= 0) {
    return '2';
  }
  return `max(2,if(lt(t,${start}),${width},if(lt(t,${end}),${width}*(1-((t-${start})/${Number((end - start).toFixed(3))})),0)))`;
}

function appendTimerBarPhase(filters, currentLabel, {
  labelPrefix,
  fps,
  sceneDurationSeconds,
  timerLayout,
  timerBarScaleExpression,
  enableStartSeconds,
  enableEndSeconds,
  baseColor,
}) {
  const enableExpression = formatEnableBetween(enableStartSeconds, enableEndSeconds);
  const timerWidth = Math.max(2, Math.round(ensureNumber(timerLayout.width, 0)));
  const timerHeight = Math.max(2, Math.round(ensureNumber(timerLayout.height, 0)));
  const highlightHeight = Math.max(4, Math.round(timerHeight * 0.34));
  const highlightY = Number((timerLayout.y + 2).toFixed(3));
  const shadowHeight = Math.max(3, Math.round(timerHeight * 0.18));
  const shadowY = Number((timerLayout.y + timerHeight - shadowHeight - 2).toFixed(3));

  const baseSourceLabel = `${labelPrefix}src`;
  filters.push(
    `color=c=${baseColor}@0.98:s=${timerWidth}x${timerHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${timerHeight}:eval=frame[${baseSourceLabel}]`,
  );
  const baseOverlayLabel = `${labelPrefix}base`;
  filters.push(
    `[${currentLabel}][${baseSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${enableExpression}'[${baseOverlayLabel}]`,
  );

  const highlightSourceLabel = `${labelPrefix}hlsrc`;
  filters.push(
    `color=c=white@0.18:s=${timerWidth}x${highlightHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${highlightHeight}:eval=frame[${highlightSourceLabel}]`,
  );
  const highlightOverlayLabel = `${labelPrefix}hl`;
  filters.push(
    `[${baseOverlayLabel}][${highlightSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${highlightY}:enable='${enableExpression}'[${highlightOverlayLabel}]`,
  );

  const shadowSourceLabel = `${labelPrefix}shsrc`;
  filters.push(
    `color=c=black@0.14:s=${timerWidth}x${shadowHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${shadowHeight}:eval=frame[${shadowSourceLabel}]`,
  );
  const shadowOverlayLabel = `${labelPrefix}sh`;
  filters.push(
    `[${highlightOverlayLabel}][${shadowSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${shadowY}:enable='${enableExpression}'[${shadowOverlayLabel}]`,
  );

  return shadowOverlayLabel;
}

function buildPromptSegments(text, template, textLayout, round) {
  const artifacts = buildProgressiveTextArtifacts(text, {
    template,
    fontSize: textLayout.prompt_font_size,
    maxLines: 2,
    baseY: textLayout.prompt_y,
    startSeconds: ensureNumber(round?.local?.prompt_start_seconds, 0.04),
    endSeconds: round.local.reveal_start_seconds,
  });
  return artifacts.lines.map((line) => ({
    text: line.text,
    font_size: line.font_size,
    y: line.y,
    start_seconds: ensureNumber(round?.local?.prompt_start_seconds, 0.04),
    end_seconds: round.local.reveal_start_seconds,
  }));
}

function buildRevealArtifacts(text, template, textLayout, round) {
  return buildProgressiveTextArtifacts(text, {
    template,
    fontSize: textLayout.reveal_font_size,
    maxLines: 2,
    baseY: textLayout.reveal_y,
    startSeconds: round.local.reveal_visual_start_seconds,
    endSeconds: round.local.scene_duration_seconds,
  });
}

function platformOverlayY(cell, baseSpriteSize, platformLayout) {
  return Number((
    cell.center_y
    + (baseSpriteSize * platformLayout.center_y_offset_multiplier)
    + platformLayout.center_y_offset_px
  ).toFixed(3));
}

function drawCounter(filters, currentLabel, roundIndex, round, textLayout) {
  const counterStartSeconds = roundIndex > 0
    ? Number((round.local.countdown_start_seconds + 0.03).toFixed(3))
    : 0.03;
  const counterScaleExpression = buildAnimatedPopSettleExpression(
    counterStartSeconds,
    0.24,
    0.62,
    1.18,
    1,
  );
  const counterLabel = `scene${roundIndex}counter`;
  filters.push(
    `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.round_label)}':fontcolor=white:fontsize='${textLayout.counter_font_size}*(${counterScaleExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${textLayout.counter_x}:y=${textLayout.counter_y}:alpha='${buildAnimatedTextSegmentAlphaExpression(counterStartSeconds, round.local.scene_duration_seconds)}'[${counterLabel}]`,
  );
  return counterLabel;
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const roundCount = renderPlan.rounds.length;
  const gridLayout = renderPlan.grid_layout || { cells: [] };
  const timerLayout = renderPlan.timer_layout || {
    x: 210,
    y: 1030,
    width: 660,
    height: 34,
    center_x: 540,
  };
  const backgroundBlurSigma = Math.max(0, ensureNumber(template?.layout?.background?.blur_sigma, 0));
  const backgroundFilter = backgroundBlurSigma > 0
    ? `gblur=sigma=${backgroundBlurSigma},`
    : '';
  const platformLayout = {
    enabled: template?.layout?.sprite_platform?.option_enabled !== false,
    width_multiplier: ensureNumber(template?.layout?.sprite_platform?.option_width_multiplier, 0.92),
    center_y_offset_multiplier: ensureNumber(template?.layout?.sprite_platform?.center_y_offset_multiplier, 0.34),
    center_y_offset_px: ensureNumber(template?.layout?.sprite_platform?.option_center_y_offset_px, 82),
  };
  const gridSpriteYOffset = ensureNumber(template?.layout?.sprite_grid?.sprite_center_y_offset_px, -10);
  const introDuration = Math.max(0.12, ensureNumber(template?.renderer?.candidate_intro_duration_seconds, 0.22));
  const introScaleInitial = ensureNumber(template?.renderer?.candidate_intro_scale_initial, 0.68);
  const introScalePeak = ensureNumber(template?.renderer?.candidate_intro_scale_peak, 1.08);
  const introScaleSettle = ensureNumber(template?.renderer?.candidate_intro_scale_settle, 1);
  const introYOffset = ensureNumber(template?.renderer?.candidate_intro_y_offset_px, 42);
  const introPokeballScaleMultiplier = Math.max(
    0.1,
    ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.04),
  );
  const statRevealFadeDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.stat_reveal_fade_duration_seconds, 0.22),
  );

  const backgroundBaseLabel = 'bgbase';
  filters.push(
    `[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${backgroundFilter}fps=${fps},setsar=1,trim=duration=${renderPlan.total_duration_seconds},setpts=PTS-STARTPTS[${backgroundBaseLabel}]`,
  );

  renderPlan.rounds.forEach((round, roundIndex) => {
    const roundInputs = inputRefs.rounds[roundIndex] || { candidates: [] };
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `color=c=black@0.0:s=${width}x${height}:r=${fps}:d=${round.scene_duration_seconds},format=rgba,trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    let currentLabel = drawCounter(filters, sceneBaseLabel, roundIndex, round, renderPlan.text_layout);

    buildPromptSegments(round.prompt_text, template, renderPlan.text_layout, round)
      .forEach((segment, segmentIndex) => {
        const promptLabel = `scene${roundIndex}prompt${segmentIndex}`;
        filters.push(
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}':fontcolor=white:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${promptLabel}]`,
        );
        currentLabel = promptLabel;
      });

    const baseSpriteSize = Number((
      ensureNumber(gridLayout.item_size_px, 220)
      * ensureNumber(gridLayout.sprite_scale_multiplier, 1)
    ).toFixed(3));

    for (const candidate of round.candidates) {
      const cell = gridLayout.cells[candidate.index];
      const candidateInputIndex = roundInputs.candidates?.[candidate.index];
      if (inputRefs.introPokeball != null) {
        const pokeballLabel = `scene${roundIndex}pokeball${candidate.index}`;
        const pokeballOverlayLabel = `scene${roundIndex}pokeballv${candidate.index}`;
        const pokeballDuration = Number(Math.max(
          0.08,
          candidate.pokeball_end_seconds - candidate.pokeball_start_seconds,
        ).toFixed(3));
        const pokeballSize = Number((baseSpriteSize * introPokeballScaleMultiplier).toFixed(3));
        filters.push(
          `[${inputRefs.introPokeball}:v]fps=${fps},trim=duration=${pokeballDuration},setpts=PTS-STARTPTS+${Number((candidate.pokeball_start_seconds - round.scene_start_seconds).toFixed(3))}/TB,scale=${pokeballSize}:${pokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${pokeballLabel}]`,
        );
        filters.push(
          `[${currentLabel}][${pokeballLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${formatEnableBetween(candidate.pokeball_start_seconds - round.scene_start_seconds, candidate.pokeball_end_seconds - round.scene_start_seconds)}'[${pokeballOverlayLabel}]`,
        );
        currentLabel = pokeballOverlayLabel;
      }

      if (inputRefs.grassPlatform != null && platformLayout.enabled) {
        const platformWidth = Number((baseSpriteSize * platformLayout.width_multiplier).toFixed(3));
        const platformSourceLabel = `scene${roundIndex}platform${candidate.index}`;
        const platformOverlayLabel = `scene${roundIndex}platformv${candidate.index}`;
        const platformScaleExpression = buildAnimatedPopSettleExpression(
          candidate.intro_start_seconds - round.scene_start_seconds,
          introDuration,
          introScaleInitial,
          introScalePeak,
          introScaleSettle,
        );
        filters.push(
          `[${inputRefs.grassPlatform}:v]fps=${fps},scale=w='${platformWidth}*(${platformScaleExpression})':h=-1:eval=frame,format=rgba,setsar=1[${platformSourceLabel}]`,
        );
        filters.push(
          `[${currentLabel}][${platformSourceLabel}]overlay=x='${cell.center_x}-w/2':y='${platformOverlayY(cell, baseSpriteSize, platformLayout)}-h/2':enable='${formatEnableBetween(candidate.intro_start_seconds - round.scene_start_seconds, round.local.scene_duration_seconds)}'[${platformOverlayLabel}]`,
        );
        currentLabel = platformOverlayLabel;
      }

      if (candidateInputIndex == null) {
        continue;
      }
      const spriteLabel = `scene${roundIndex}sprite${candidate.index}`;
      const spriteOverlayLabel = `scene${roundIndex}spritev${candidate.index}`;
      const spriteScaleExpression = buildAnimatedPopSettleExpression(
        candidate.intro_start_seconds - round.scene_start_seconds,
        introDuration,
        introScaleInitial,
        introScalePeak,
        introScaleSettle,
      );
      const spriteYExpression = buildAnimatedTextYExpression(
        Number((cell.center_y + gridSpriteYOffset).toFixed(3)),
        candidate.intro_start_seconds - round.scene_start_seconds,
      );
      filters.push(
        `[${candidateInputIndex}:v]fps=${fps},scale=w='${baseSpriteSize}*(${spriteScaleExpression})':h='${baseSpriteSize}*(${spriteScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${spriteLabel}]`,
      );
      filters.push(
        `[${currentLabel}][${spriteLabel}]overlay=x='${cell.center_x}-w/2':y='${spriteYExpression}+${introYOffset}-h/2':enable='${formatEnableBetween(candidate.intro_start_seconds - round.scene_start_seconds, candidate.intro_end_seconds - round.scene_start_seconds)}'[${spriteOverlayLabel}]`,
      );
      currentLabel = spriteOverlayLabel;

      const settledSpriteLabel = `scene${roundIndex}settled${candidate.index}`;
      filters.push(
        `[${currentLabel}][${spriteLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + gridSpriteYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(candidate.intro_end_seconds - round.scene_start_seconds, round.local.scene_duration_seconds)}'[${settledSpriteLabel}]`,
      );
      currentLabel = settledSpriteLabel;
    }

    const timerRailLabel = `scene${roundIndex}tb0`;
    const timerBarScaleExpression = buildTimerBarScaleExpression(
      round.local.countdown_start_seconds,
      round.local.reveal_start_seconds,
      timerLayout.width,
    );
    const greenEnd = Number((
      round.local.countdown_start_seconds
      + ((round.local.reveal_start_seconds - round.local.countdown_start_seconds) * 0.5)
    ).toFixed(3));
    const yellowEnd = Number((
      round.local.countdown_start_seconds
      + ((round.local.reveal_start_seconds - round.local.countdown_start_seconds) * 0.8)
    ).toFixed(3));
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=black@0.28:t=fill:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerRailLabel}]`,
    );
    currentLabel = timerRailLabel;

    currentLabel = appendTimerBarPhase(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}tb1`,
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
      timerLayout,
      timerBarScaleExpression,
      enableStartSeconds: round.local.countdown_start_seconds,
      enableEndSeconds: greenEnd,
      baseColor: '0x32D74B',
    });
    currentLabel = appendTimerBarPhase(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}tb2`,
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
      timerLayout,
      timerBarScaleExpression,
      enableStartSeconds: greenEnd,
      enableEndSeconds: yellowEnd,
      baseColor: '0xFFD60A',
    });
    currentLabel = appendTimerBarPhase(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}tb3`,
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
      timerLayout,
      timerBarScaleExpression,
      enableStartSeconds: yellowEnd,
      enableEndSeconds: round.local.reveal_start_seconds,
      baseColor: '0xFF453A',
    });

    const timerBorderLabel = `scene${roundIndex}tb4`;
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=white@0.16:t=2:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerBorderLabel}]`,
    );
    currentLabel = timerBorderLabel;

    const revealArtifacts = buildRevealArtifacts(
      round.reveal_text,
      template,
      renderPlan.text_layout,
      round,
    );
    revealArtifacts.lines.forEach((line, lineIndex) => {
      const revealLabel = `scene${roundIndex}reveal${lineIndex}`;
        filters.push(
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(line.text)}':fontcolor=white:fontsize=${line.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, round.local.reveal_visual_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${revealLabel}]`,
        );
        currentLabel = revealLabel;
      });

    for (const candidate of round.candidates) {
      const cell = gridLayout.cells[candidate.index];
      const isTopRow = cell.row === 0;
      const statY = isTopRow
        ? Number((cell.y + renderPlan.stat_value_layout.top_row_y_offset_px).toFixed(3))
        : Number((cell.y + cell.height + renderPlan.stat_value_layout.bottom_row_y_offset_px).toFixed(3));
      const statColor = candidate.is_correct
        ? renderPlan.stat_value_layout.winner_color
        : renderPlan.stat_value_layout.default_color;
      const statLabel = `scene${roundIndex}stat${candidate.index}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(candidate.stat_value)}':fontcolor=${statColor}:fontsize=${renderPlan.stat_value_layout.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${cell.center_x}-text_w/2:y='${buildAnimatedTextYExpression(statY, round.local.reveal_visual_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.reveal_visual_start_seconds + statRevealFadeDuration)}':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${statLabel}]`,
      );
      currentLabel = statLabel;
    }

    filters.push(
      `[${currentLabel}]format=rgba,setpts=PTS-STARTPTS+${Number(round.scene_start_seconds.toFixed(3))}/TB[scene${roundIndex}]`,
    );
  });

  let compositeLabel = backgroundBaseLabel;
  renderPlan.rounds.forEach((round, roundIndex) => {
    const nextCompositeLabel = `scenecomposite${roundIndex}`;
    const slideStartSeconds = ensureNumber(round.slide_start_seconds, round.scene_start_seconds);
    const slideEndSeconds = slideStartSeconds + ensureNumber(round.transition_duration_seconds, 0);
    const xExpression = round.transition_duration_seconds > 0
      ? `if(lt(t,${slideStartSeconds}),0,if(lt(t,${slideEndSeconds}),-w*(((t)-${slideStartSeconds})/${round.transition_duration_seconds}),-w))`
      : '0';
    filters.push(
      `[${compositeLabel}][scene${roundIndex}]overlay=x='${xExpression}':y=0:enable='${formatEnableBetween(round.scene_start_seconds, round.scene_end_seconds)}'[${nextCompositeLabel}]`,
    );
    compositeLabel = nextCompositeLabel;
  });
  filters.push(`[${compositeLabel}]format=yuv420p[vout]`);
  return {
    script: `${filters.join(';\n')}\n`,
  };
}
