import {
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  buildCountdownNumberAlphaExpression,
  buildCountdownNumberScaleMultiplierExpression,
  buildCountdownNumberYExpression,
  buildScaleFilterTimeExpression,
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
  return String(round.round_label || `${round.round_number}/${round.total_rounds || 5}`);
}

function buildSceneSpriteFilter({
  inputIndex,
  fps,
  spriteSize,
  centerX,
  centerY,
  roundIndex,
}) {
  return [
    `[${inputIndex}:v]fps=${fps},trim=duration=${roundTime(9999)},setpts=PTS-STARTPTS,scale=${spriteSize}:${spriteSize}:force_original_aspect_ratio=decrease,setsar=1[spr${roundIndex}]`,
    `[scene${roundIndex}b][spr${roundIndex}]overlay=${centerX}-w/2:${centerY}-h/2[scene${roundIndex}s]`,
  ];
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = null) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const fontPart = buildFontPart(fontPath);
  const roundCount = renderPlan.rounds.length;
  const timerVisualWidth = roundTime(renderPlan.timer_layout.width * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const timerVisualHeight = roundTime(renderPlan.timer_layout.height * DEFAULT_TIMER_VISUAL_SCALE_MULTIPLIER);
  const typeBadgePopDuration = roundTime(Math.max(
    0.12,
    ensureNumber(template?.layout?.type_badges?.pop_in_duration_seconds, 0.22),
  ));

  const backgroundLabels = Array.from({ length: roundCount }, (_, index) => `bg${index}`);
  filters.push(
    `[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},fps=${fps},setsar=1,split=${roundCount}${backgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  let timerLabels = [];
  if (inputRefs.timerCountdown != null) {
    timerLabels = Array.from({ length: roundCount }, (_, index) => `timer${index}`);
    filters.push(
      `[${inputRefs.timerCountdown}:v]split=${roundCount}${timerLabels.map((label) => `[${label}]`).join('')}`,
    );
  }

  renderPlan.rounds.forEach((round, roundIndex) => {
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    const roundSpriteInput = inputRefs.rounds[roundIndex].sprite;
    filters.push(...buildSceneSpriteFilter({
      inputIndex: roundSpriteInput,
      fps,
      spriteSize: renderPlan.sprite_layout.render_size_px,
      centerX: renderPlan.sprite_layout.center_x,
      centerY: renderPlan.sprite_layout.center_y,
      roundIndex,
    }));

    let currentLabel = `scene${roundIndex}s`;
    if (timerLabels[roundIndex]) {
      const timerSourceDuration = Math.max(
        0.12,
        ensureNumber(
          plan.assets.overlays?.selected_timer_countdown_duration_seconds,
          plan.assets.overlays?.selected_timer_duration_seconds ?? round.countdown_duration_seconds,
        ),
      );
      const timerSetpts = timerSourceDuration > 0
        ? `(PTS-STARTPTS)*${roundTime(round.countdown_duration_seconds / timerSourceDuration)}+${round.local.countdown_start_seconds}/TB`
        : `PTS-STARTPTS+${round.local.countdown_start_seconds}/TB`;
      filters.push(
        `[${timerLabels[roundIndex]}]fps=${fps},trim=duration=${timerSourceDuration},setpts=${timerSetpts},crop=iw*0.72:ih*0.72:(iw-ow)/2:(ih-oh)/2-20,scale=${timerVisualWidth}:${timerVisualHeight}:force_original_aspect_ratio=decrease,format=rgba,colorkey=0xFFFFFF:0.22:0.1,setsar=1[timercountdown${roundIndex}]`,
      );
      const timerSceneLabel = `scene${roundIndex}t`;
      filters.push(
        `[${currentLabel}][timercountdown${roundIndex}]overlay=x='${renderPlan.timer_layout.number_center_x}-w/2':y='${renderPlan.timer_layout.number_center_y}-h/2':enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerSceneLabel}]`,
      );
      currentLabel = timerSceneLabel;
    }

    const hookAlphaExpression = roundIndex === 0
      ? buildAnimatedTextSegmentAlphaExpression(0, round.local.countdown_start_seconds)
      : '0';
    const hookYExpression = roundIndex === 0
      ? buildAnimatedTextYExpression(renderPlan.text_layout.hook_y, 0)
      : renderPlan.text_layout.hook_y;
    if (roundIndex === 0 && renderPlan.hook_text) {
      const hookSceneLabel = `scene${roundIndex}h`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(renderPlan.hook_text)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.hook_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=(w-text_w)/2:y='${hookYExpression}-text_h/2':alpha='${hookAlphaExpression}':enable='${formatEnableBetween(0, round.local.countdown_start_seconds)}'[${hookSceneLabel}]`,
      );
      currentLabel = hookSceneLabel;
    }

    const counterSceneLabel = `scene${roundIndex}c`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(formatCounterText(round))}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.counter_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=${renderPlan.text_layout.counter_x}:y=${renderPlan.text_layout.counter_y}[${counterSceneLabel}]`,
    );
    currentLabel = counterSceneLabel;

    const nameSceneLabel = `scene${roundIndex}n`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.subject.name)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=(w-text_w)/2:y=${renderPlan.text_layout.name_y}-text_h/2[${nameSceneLabel}]`,
    );
    currentLabel = nameSceneLabel;

    round.countdown_numbers.forEach((countdown, countdownIndex) => {
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

    const typeTextSceneLabel = `scene${roundIndex}txt`;
    filters.push(
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.type_label)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.text_layout.type_text_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(renderPlan.text_layout.type_text_y, round.local.reveal_visual_start_seconds)}-text_h/2':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}':enable='gte(t,${round.local.reveal_visual_start_seconds})'[${typeTextSceneLabel}]`,
    );
    currentLabel = typeTextSceneLabel;

    round.type_icons.forEach((_, iconIndex) => {
      const iconInput = inputRefs.rounds[roundIndex].typeIcons[iconIndex];
      const badgeLayout = round.type_badge_layout[iconIndex];
      const scaleExpression = buildAnimatedPopSettleExpression(
        round.local.reveal_visual_start_seconds,
        typeBadgePopDuration,
        0.42,
        1.12,
        1,
        buildScaleFilterTimeExpression({ fps, streamStartSeconds: 0 }),
      );
      filters.push(
        `[${iconInput}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='${badgeLayout.size_px}*(${scaleExpression})':h='${badgeLayout.size_px}*(${scaleExpression})':eval=frame,format=rgba,setsar=1[round${roundIndex}icon${iconIndex}]`,
      );
      const iconSceneLabel = `scene${roundIndex}icon${iconIndex}`;
      filters.push(
        `[${currentLabel}][round${roundIndex}icon${iconIndex}]overlay=${badgeLayout.center_x}-w/2:${badgeLayout.center_y}-h/2:enable='gte(t,${round.local.reveal_visual_start_seconds})'[${iconSceneLabel}]`,
      );
      currentLabel = iconSceneLabel;
    });

    filters.push(`[${currentLabel}]setsar=1[scene${roundIndex}]`);
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
