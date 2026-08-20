import {
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  buildCountdownNumberAlphaExpression,
  buildCountdownNumberScaleMultiplierExpression,
  buildCountdownNumberYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_TEXT_BORDER,
  DEFAULT_TIMER_NUMBER_SIZE,
  DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function formatCounterText(round) {
  return String(round.round_label || `${round.round_number}/${round.total_rounds || 3}`);
}

function resolveIncomingTransitionSeconds(renderPlan, roundIndex) {
  return roundIndex > 0
    ? roundTime(Math.max(
      0,
      ensureNumber(renderPlan?.rounds?.[roundIndex - 1]?.transition_duration_seconds, 0),
    ))
    : 0;
}

function buildColorFilterChain(candidate) {
  const hueDegrees = Number(ensureNumber(candidate?.hue_degrees, 0).toFixed(3));
  const saturation = Number(Math.max(0, ensureNumber(candidate?.saturation, 1)).toFixed(3));
  const brightness = Number(ensureNumber(candidate?.brightness, 0).toFixed(3));
  const contrast = Number(Math.max(0.1, ensureNumber(candidate?.contrast, 1)).toFixed(3));
  return [
    `hue=h=${hueDegrees}*PI/180:s=${saturation}`,
    `eq=brightness=${brightness}:contrast=${contrast}`,
  ].join(',');
}

function buildRevealCenterExpression(startValue, endValue, startSeconds, endSeconds) {
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(Math.max(start, ensureNumber(endSeconds, start)).toFixed(3));
  const from = Number(ensureNumber(startValue, 0).toFixed(3));
  const to = Number(ensureNumber(endValue, from).toFixed(3));
  if (end <= start || from === to) {
    return `${to}`;
  }
  return `if(lt(t,${start}),${from},if(lt(t,${end}),${from}+(${to}-${from})*((t-${start})/${Number((end - start).toFixed(3))}),${to}))`;
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = null) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const fontPart = buildFontPart(fontPath);
  const roundCount = renderPlan.rounds.length;
  const timerVisualWidth = roundTime(renderPlan.timer_layout.width * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerVisualHeight = roundTime(renderPlan.timer_layout.height * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const gridLayout = renderPlan.grid_layout || { cells: [] };
  const revealLayout = renderPlan.reveal_sprite || { center_x: 540, center_y: 980 };
  const backgroundBlurSigma = Math.max(0, ensureNumber(template?.layout?.background?.blur_sigma, 0));

  const backgroundLabels = Array.from({ length: roundCount }, (_, index) => `bg${index}`);
  const backgroundFilter = backgroundBlurSigma > 0
    ? `gblur=sigma=${backgroundBlurSigma},`
    : '';
  filters.push(
    `[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${backgroundFilter}fps=${fps},setsar=1,split=${roundCount}${backgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  let timerLabels = [];
  if (inputRefs.timerCountdown != null) {
    timerLabels = Array.from({ length: roundCount }, (_, index) => `timer${index}`);
    filters.push(
      `[${inputRefs.timerCountdown}:v]split=${roundCount}${timerLabels.map((label) => `[${label}]`).join('')}`,
    );
  }

  renderPlan.rounds.forEach((round, roundIndex) => {
    const incomingTransitionSeconds = resolveIncomingTransitionSeconds(renderPlan, roundIndex);
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    let currentLabel = sceneBaseLabel;
    if (timerLabels[roundIndex]) {
      const timerSceneLabel = `scene${roundIndex}t`;
      filters.push(
        `[${timerLabels[roundIndex]}]fps=${fps},trim=duration=${round.countdown_duration_seconds},setpts=PTS-STARTPTS+${round.local.countdown_start_seconds}/TB,crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=${timerVisualWidth}:${timerVisualHeight}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[tmr${roundIndex}]`,
      );
      filters.push(
        `[${currentLabel}][tmr${roundIndex}]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerSceneLabel}]`,
      );
      currentLabel = timerSceneLabel;
    }

    const counterSceneLabel = `scene${roundIndex}c`;
    const counterStartSeconds = roundTime(incomingTransitionSeconds + 0.03);
    const counterScaleExpression = buildAnimatedPopSettleExpression(
      counterStartSeconds,
      0.24,
      0.62,
      1.18,
      1,
    );
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(formatCounterText(round))}'${fontPart}:fontcolor=white:fontsize='${renderPlan.text_layout.counter_font_size}*(${counterScaleExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.text_layout.counter_x}:y='${renderPlan.text_layout.counter_y}':alpha='${buildAnimatedTextSegmentAlphaExpression(counterStartSeconds, round.local.scene_duration_seconds)}'[${counterSceneLabel}]`,
    );
    currentLabel = counterSceneLabel;

    if (roundIndex === 0 && renderPlan.hook_text) {
      const hookSceneLabel = `scene${roundIndex}h`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(renderPlan.hook_text)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.hook_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(renderPlan.text_layout.hook_y, 0.04)}':alpha='${buildAnimatedTextSegmentAlphaExpression(0.04, round.local.countdown_start_seconds)}':enable='${formatEnableBetween(0.04, round.local.countdown_start_seconds)}'[${hookSceneLabel}]`,
      );
      currentLabel = hookSceneLabel;
    }

    const promptSceneLabel = `scene${roundIndex}p`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.prompt_text || '')}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.prompt_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(renderPlan.text_layout.prompt_y, incomingTransitionSeconds + 0.08)}':alpha='${buildAnimatedTextSegmentAlphaExpression(incomingTransitionSeconds + 0.08, round.local.reveal_start_seconds)}':enable='${formatEnableBetween(incomingTransitionSeconds + 0.08, round.local.reveal_start_seconds)}'[${promptSceneLabel}]`,
    );
    currentLabel = promptSceneLabel;

    const roundSpriteInput = inputRefs.rounds[roundIndex].sprite;
    const splitLabels = round.candidates.map((candidate) => `r${roundIndex}cand${candidate.index}`);
    const graySplitLabels = round.candidates.filter((candidate) => !candidate.is_correct).map((candidate) => `r${roundIndex}gray${candidate.index}`);
    filters.push(
      `[${roundSpriteInput}:v]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,split=${splitLabels.length + graySplitLabels.length + 1}${splitLabels.map((label) => `[${label}]`).join('')}${graySplitLabels.map((label) => `[${label}]`).join('')}[r${roundIndex}movebase]`,
    );

    const baseSpriteSize = roundTime(
      ensureNumber(gridLayout.item_size_px, 220) * ensureNumber(gridLayout.sprite_scale_multiplier, 1),
    );
    const revealSpriteSize = roundTime(
      ensureNumber(revealLayout.item_size_px, 320) * ensureNumber(revealLayout.sprite_scale_multiplier, 1),
    );
    const revealMoveDuration = Math.max(0.18, ensureNumber(template?.renderer?.correct_move_duration_seconds, 0.36));
    const revealMoveEnd = roundTime(round.local.reveal_visual_start_seconds + revealMoveDuration);
    const correctScaleMultiplier = Math.max(0.2, ensureNumber(template?.renderer?.correct_scale_multiplier, 1.08));
    const introDuration = Math.max(0.08, ensureNumber(template?.renderer?.candidate_intro_duration_seconds, 0.18));
    const grayFadeDuration = Math.max(0.08, ensureNumber(template?.renderer?.decoy_grayscale_fade_duration_seconds, 0.22));
    const correctCellFadeDuration = Math.max(0.06, ensureNumber(template?.renderer?.correct_cell_fade_duration_seconds, 0.16));

    let grayLabelCursor = 0;
    for (const candidate of round.candidates) {
      const cell = gridLayout.cells[candidate.index];
      const introStart = roundTime(incomingTransitionSeconds + 0.08 + (candidate.index * 0.03));
      const baseLabel = `r${roundIndex}c${candidate.index}`;
      const baseChain = `${buildColorFilterChain(candidate)},scale=${baseSpriteSize}:${baseSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1`;
      filters.push(`[${splitLabels[candidate.index]}]fps=${fps},${baseChain}[${baseLabel}]`);
      const baseSceneLabel = `scene${roundIndex}cand${candidate.index}`;
      const baseEnd = candidate.is_correct
        ? roundTime(round.local.reveal_visual_start_seconds + correctCellFadeDuration)
        : round.local.scene_duration_seconds;
      filters.push(
        `[${currentLabel}][${baseLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${formatEnableBetween(introStart, baseEnd)}'[${baseSceneLabel}]`,
      );
      currentLabel = baseSceneLabel;

      if (!candidate.is_correct) {
        const grayLabel = graySplitLabels[grayLabelCursor];
        grayLabelCursor += 1;
        const graySceneLabel = `scene${roundIndex}gray${candidate.index}`;
        filters.push(
          `[${grayLabel}]fps=${fps},${baseChain},hue=s=0,fade=t=in:st=${round.local.reveal_visual_start_seconds}:d=${grayFadeDuration}:alpha=1[${grayLabel}v]`,
        );
        filters.push(
          `[${currentLabel}][${grayLabel}v]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${graySceneLabel}]`,
        );
        currentLabel = graySceneLabel;
      }
    }

    const correctCandidate = round.candidates.find((candidate) => candidate.is_correct) || round.candidates[round.correct_candidate_index] || round.candidates[0];
    const correctCell = gridLayout.cells[correctCandidate.index];
    const movingLabel = `r${roundIndex}move`;
    const movingSceneLabel = `scene${roundIndex}move`;
    const movingSize = roundTime(revealSpriteSize * correctScaleMultiplier);
    filters.push(
      `[r${roundIndex}movebase]fps=${fps},${buildColorFilterChain(correctCandidate)},scale=${movingSize}:${movingSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${movingLabel}]`,
    );
    filters.push(
      `[${currentLabel}][${movingLabel}]overlay=x='${buildRevealCenterExpression(correctCell.center_x, revealLayout.center_x, round.local.reveal_visual_start_seconds, revealMoveEnd)}-w/2':y='${buildRevealCenterExpression(correctCell.center_y, revealLayout.center_y, round.local.reveal_visual_start_seconds, revealMoveEnd)}-h/2':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${movingSceneLabel}]`,
    );
    currentLabel = movingSceneLabel;

    const revealSceneLabel = `scene${roundIndex}r`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.reveal_text || '')}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.reveal_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${renderPlan.text_layout.reveal_y}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${revealSceneLabel}]`,
    );
    currentLabel = revealSceneLabel;

    round.countdown_numbers.forEach((countdown, countdownIndex) => {
      if (String(countdown.value) === '0') {
        return;
      }
      const scaleMultiplierExpression = buildCountdownNumberScaleMultiplierExpression(
        countdown.start_seconds - round.scene_start_seconds,
        countdown.end_seconds - round.scene_start_seconds,
      );
      const countdownSceneLabel = `scene${roundIndex}cd${countdownIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(countdown.value)}'${fontPart}:fontcolor=white:fontsize='${DEFAULT_TIMER_NUMBER_SIZE}*(${scaleMultiplierExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.timer_layout.number_center_x}-text_w/2:y='${buildCountdownNumberYExpression(renderPlan.timer_layout.number_center_y, countdown.start_seconds - round.scene_start_seconds, countdown.end_seconds - round.scene_start_seconds)}-text_h/2':alpha='${buildCountdownNumberAlphaExpression(countdown.start_seconds - round.scene_start_seconds, countdown.end_seconds - round.scene_start_seconds)}':enable='${formatEnableBetween(countdown.start_seconds - round.scene_start_seconds, countdown.end_seconds - round.scene_start_seconds)}'[${countdownSceneLabel}]`,
      );
      currentLabel = countdownSceneLabel;
    });

    filters.push(`[${currentLabel}]format=rgba[scene${roundIndex}]`);
  });

  let currentSceneOutput = 'scene0';
  for (let roundIndex = 1; roundIndex < renderPlan.rounds.length; roundIndex += 1) {
    const nextOutputLabel = `sceneout${roundIndex}`;
    const transitionDuration = renderPlan.rounds[roundIndex - 1].transition_duration_seconds;
    filters.push(
      `[${currentSceneOutput}][scene${roundIndex}]xfade=transition=slideleft:duration=${transitionDuration}:offset=${renderPlan.rounds[roundIndex].scene_start_seconds}[${nextOutputLabel}]`,
    );
    currentSceneOutput = nextOutputLabel;
  }

  filters.push(`[${currentSceneOutput}]format=yuv420p[vout]`);
  return {
    script: `${filters.join(';\n')}\n`,
  };
}
