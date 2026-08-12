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
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import { buildProgressiveTextArtifacts } from '../../dual-type-reveal/render/text-layout.mjs';
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

function resolveIncomingTransitionSeconds(renderPlan, roundIndex) {
  return roundIndex > 0
    ? roundTime(Math.max(
      0,
      ensureNumber(renderPlan?.rounds?.[roundIndex - 1]?.transition_duration_seconds, 0),
    ))
    : 0;
}

function buildSceneSpriteFilter({
  inputIndex,
  fps,
  spriteLayout,
  round,
  roundIndex,
  incomingTransitionSeconds,
}) {
  const introStartSeconds = roundTime(incomingTransitionSeconds + 0.04);
  const introDurationSeconds = roundTime(Math.max(
    0.12,
    Math.min(
      ensureNumber(spriteLayout.intro_duration_seconds, 0.3),
      Math.max(0.2, round.local.reveal_start_seconds - introStartSeconds - 0.08),
    ),
  ));
  const displayScaleMultiplier = Math.max(
    0.001,
    ensureNumber(spriteLayout.display_scale_multiplier, 1),
  );
  const scaleExpression = buildAnimatedLerpExpression({
    fromValue: 0.001,
    toValue: displayScaleMultiplier,
    holdUntilSeconds: introStartSeconds,
    transitionDurationSeconds: introDurationSeconds,
    timeExpression: buildScaleFilterTimeExpression({ fps, streamStartSeconds: 0 }),
  });
  const bobStartSeconds = roundTime(
    introStartSeconds
    + introDurationSeconds
    + Math.max(0, ensureNumber(spriteLayout.countdown_float_start_delay_seconds, 0)),
  );
  const bobAmplitude = roundTime(Math.max(
    0,
    ensureNumber(spriteLayout.countdown_float_amplitude_px, 18),
  ));
  const bobFrequencyRadians = roundTime(Math.max(
    0.4,
    ensureNumber(spriteLayout.countdown_float_frequency_hz, 2.1)
      * Math.max(0.1, ensureNumber(spriteLayout.countdown_float_speed_multiplier, 1)),
  ) * 6.283185307);
  const bobExpression = `if(lt(t,${bobStartSeconds}),0,if(lt(t,${round.local.reveal_start_seconds}),sin((t-${bobStartSeconds})*${bobFrequencyRadians})*${bobAmplitude},0))`;
  return [
    `[${inputIndex}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='max(4,${spriteLayout.render_size_px}*(${scaleExpression}))':h='max(4,${spriteLayout.render_size_px}*(${scaleExpression}))':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[spr${roundIndex}]`,
    `[scene${roundIndex}b][spr${roundIndex}]overlay=${spriteLayout.center_x}-w/2:'${spriteLayout.center_y}-h/2-${bobExpression}':enable='gte(t,${introStartSeconds})'[scene${roundIndex}s]`,
  ];
}

function buildRoundPromptArtifacts(round, roundIndex, template, renderPlan, startSeconds) {
  if (roundIndex > 0) {
    return { segments: [] };
  }
  return buildProgressiveTextArtifacts(renderPlan.hook_text, {
    template,
    fontSize: renderPlan.text_layout.prompt_font_size,
    maxLines: 2,
    baseY: renderPlan.text_layout.prompt_y,
    startSeconds,
    endSeconds: round.local.reveal_start_seconds,
  });
}

function buildRoundNameArtifacts(round, template, renderPlan, startSeconds) {
  return buildProgressiveTextArtifacts(round.subject.name, {
    template,
    fontSize: renderPlan.text_layout.name_font_size,
    maxLines: 2,
    baseY: renderPlan.text_layout.name_y,
    startSeconds,
    endSeconds: round.local.scene_duration_seconds,
  });
}

function formatTypeLabel(type) {
  const normalized = String(type || '').trim();
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1).toLowerCase();
}

function buildRoundTypeLabelArtifacts(round) {
  return round.type_badge_layout.map((badgeLayout, index) => ({
    text: formatTypeLabel(round.type_icons[index]?.type),
    center_x: badgeLayout.center_x,
    y: badgeLayout.label_y,
    font_size: badgeLayout.label_font_size,
  })).filter((artifact) => artifact.text);
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
    const incomingTransitionSeconds = resolveIncomingTransitionSeconds(renderPlan, roundIndex);
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    const roundSpriteInput = inputRefs.rounds[roundIndex].sprite;
    filters.push(...buildSceneSpriteFilter({
      inputIndex: roundSpriteInput,
      fps,
      spriteLayout: renderPlan.sprite_layout,
      round,
      roundIndex,
      incomingTransitionSeconds,
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
      `[${currentLabel}]drawtext=text='${escapeDrawtextText(formatCounterText(round))}'${fontPart}:fontcolor=white:fontsize='${renderPlan.text_layout.counter_font_size}*(${counterScaleExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.text_layout.counter_x}:y='${renderPlan.text_layout.counter_y}-${buildAnimatedLiftExpression(counterStartSeconds, 0.24, 16)}':alpha='${buildAnimatedTextSegmentAlphaExpression(counterStartSeconds, round.local.scene_duration_seconds)}'[${counterSceneLabel}]`,
    );
    currentLabel = counterSceneLabel;

    const promptArtifacts = buildRoundPromptArtifacts(
      round,
      roundIndex,
      template,
      renderPlan,
      roundTime(incomingTransitionSeconds + 0.04),
    );
    for (let promptIndex = 0; promptIndex < promptArtifacts.segments.length; promptIndex += 1) {
      const segment = promptArtifacts.segments[promptIndex];
      const promptSceneLabel = `scene${roundIndex}p${promptIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}'${fontPart}:fontcolor=white:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${promptSceneLabel}]`,
      );
      currentLabel = promptSceneLabel;
    }

    const nameArtifacts = buildRoundNameArtifacts(
      round,
      template,
      renderPlan,
      roundTime(incomingTransitionSeconds + 0.12),
    );
    const nameScaleExpression = buildAnimatedPopSettleExpression(
      roundTime(incomingTransitionSeconds + 0.12),
      0.3,
      0,
      1.08,
      1,
    );
    for (let nameIndex = 0; nameIndex < nameArtifacts.lines.length; nameIndex += 1) {
      const line = nameArtifacts.lines[nameIndex];
      const nameSceneLabel = `scene${roundIndex}n${nameIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(line.text)}'${fontPart}:fontcolor=white:fontsize='${line.font_size}*(${nameScaleExpression})':borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${line.y}:alpha='${buildAnimatedTextSegmentAlphaExpression(0.12, round.local.scene_duration_seconds)}':enable='${formatEnableBetween(0.12, round.local.scene_duration_seconds)}'[${nameSceneLabel}]`,
      );
      currentLabel = nameSceneLabel;
    }

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

    const typeLabelArtifacts = buildRoundTypeLabelArtifacts(round);
    for (let labelIndex = 0; labelIndex < typeLabelArtifacts.length; labelIndex += 1) {
      const label = typeLabelArtifacts[labelIndex];
      const typeTextSceneLabel = `scene${roundIndex}txt${labelIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(label.text)}'${fontPart}:fontcolor=white:fontsize=${label.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${label.center_x}-text_w/2:y='${buildAnimatedTextYExpression(label.y, round.local.reveal_visual_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}':enable='gte(t,${round.local.reveal_visual_start_seconds})'[${typeTextSceneLabel}]`,
      );
      currentLabel = typeTextSceneLabel;
    }

    round.type_icons.forEach((_, iconIndex) => {
      const iconInput = inputRefs.rounds[roundIndex].typeIcons[iconIndex];
      const badgeLayout = round.type_badge_layout[iconIndex];
      const scaleExpression = buildAnimatedLerpExpression({
        fromValue: 0.001,
        toValue: 1,
        holdUntilSeconds: round.local.reveal_visual_start_seconds,
        transitionDurationSeconds: typeBadgePopDuration,
        timeExpression: buildScaleFilterTimeExpression({ fps, streamStartSeconds: 0 }),
      });
      filters.push(
        `[${iconInput}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='max(4,${badgeLayout.size_px}*(${scaleExpression}))':h='max(4,${badgeLayout.size_px}*(${scaleExpression}))':eval=frame,format=rgba,setsar=1[round${roundIndex}icon${iconIndex}]`,
      );
      const iconSceneLabel = `scene${roundIndex}icon${iconIndex}`;
      filters.push(
        `[${currentLabel}][round${roundIndex}icon${iconIndex}]overlay=${badgeLayout.center_x}-w/2:${badgeLayout.center_y}-h/2:enable='gte(t,${round.local.reveal_visual_start_seconds})'[${iconSceneLabel}]`,
      );
      currentLabel = iconSceneLabel;
    });

    if (round.subject?.is_shiny_reveal && plan.assets.overlays?.selected_shiny_sparkle_path && inputRefs.shinySparkle != null) {
      const sparkleLabel = `scene${roundIndex}sparkle`;
      const sparkleDuration = Math.max(
        0.12,
        ensureNumber(
          plan.assets.overlays?.selected_shiny_sparkle_duration_seconds,
          ensureNumber(plan.shiny_reveal?.sparkle_duration_seconds, 0.9),
        ),
      );
      const sparkleEnd = roundTime(
        Math.min(round.local.scene_duration_seconds, round.local.reveal_visual_start_seconds + sparkleDuration),
      );
      const sparkleSize = roundTime(
        renderPlan.sprite_layout.render_size_px * Math.max(
          0.2,
          ensureNumber(plan.shiny_reveal?.sparkle_scale_multiplier, 1.35),
        ),
      );
      filters.push(
        `[${inputRefs.shinySparkle}:v]fps=${fps},trim=duration=${sparkleDuration},setpts=PTS-STARTPTS+${round.local.reveal_visual_start_seconds}/TB,scale=${sparkleSize}:${sparkleSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${sparkleLabel}]`,
      );
      const sparkleSceneLabel = `scene${roundIndex}ss`;
      filters.push(
        `[${currentLabel}][${sparkleLabel}]overlay=${renderPlan.sprite_layout.center_x}-w/2:${renderPlan.sprite_layout.center_y}-h/2:enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, sparkleEnd)}'[${sparkleSceneLabel}]`,
      );
      currentLabel = sparkleSceneLabel;
    }

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
