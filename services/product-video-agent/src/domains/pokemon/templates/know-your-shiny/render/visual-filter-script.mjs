import {
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
  DEFAULT_TEXT_BORDER,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildProgressiveTextArtifacts } from '../../dual-type-reveal/render/text-layout.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeHighlightKeywords(template) {
  return (Array.isArray(template?.layout?.text?.highlight_keywords)
    ? template.layout.text.highlight_keywords
    : []
  )
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function resolveTextHighlightMatch(text, keywords = []) {
  const sourceText = String(text || '');
  for (const keyword of keywords) {
    const pattern = new RegExp(`\\b(${escapeRegExp(keyword)}[!?.,:;'\\u2019-]*)`, 'iu');
    const match = pattern.exec(sourceText);
    if (match) {
      return {
        before: sourceText.slice(0, match.index),
        highlighted_text: match[1],
      };
    }
  }
  return null;
}

function estimateSegmentTextWidth(text, fontSize) {
  const normalizedText = String(text || '');
  return roundTime(normalizedText.length * ensureNumber(fontSize, 60) * 0.56);
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
  const colorMix = String(candidate?.color_mix || '').trim();
  const saturation = Number(Math.max(0, ensureNumber(candidate?.saturation, 1)).toFixed(3));
  const brightness = Number(ensureNumber(candidate?.brightness, 0).toFixed(3));
  const contrast = Number(Math.max(0.1, ensureNumber(candidate?.contrast, 1)).toFixed(3));
  const filters = [];
  if (colorMix) {
    filters.push(`colorchannelmixer=${colorMix}`);
  }
  filters.push(`eq=saturation=${saturation}:brightness=${brightness}:contrast=${contrast}`);
  return filters.join(',');
}

function buildTimerBarScaleExpression(startSeconds, endSeconds, fullWidth) {
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(Math.max(start, ensureNumber(endSeconds, start)).toFixed(3));
  const width = Number(Math.max(0, ensureNumber(fullWidth, 0)).toFixed(3));
  if (end <= start || width <= 0) {
    return '2';
  }
  return `max(2,if(lt(t,${start}),${width},if(lt(t,${end}),${width}*(1-((t-${start})/${Number((end - start).toFixed(3))})),0)))`;
}

function buildTextSegments(text, {
  template,
  fontSize,
  baseY,
  startSeconds,
  endSeconds,
  maxLines = 2,
}) {
  return buildProgressiveTextArtifacts(text, {
    template,
    fontSize,
    maxLines,
    baseY,
    startSeconds,
    endSeconds,
  }).segments || [];
}

function appendHighlightedSegmentOverlay(filters, currentLabel, {
  labelPrefix,
  segment,
  fontPart,
  highlightColor,
  highlightKeywords,
}) {
  const match = resolveTextHighlightMatch(segment.text, highlightKeywords);
  if (!match) {
    return currentLabel;
  }
  const fullWidth = estimateSegmentTextWidth(segment.text, segment.font_size);
  const beforeWidth = estimateSegmentTextWidth(match.before, segment.font_size);
  const highlightLabel = `${labelPrefix}hl`;
  filters.push(
    `[${currentLabel}]drawtext=text='${escapeDrawtextText(match.highlighted_text)}'${fontPart}:fontcolor=${highlightColor}:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x='(w-${fullWidth})/2+${beforeWidth}':y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${highlightLabel}]`,
  );
  return highlightLabel;
}

function resolvePlatformLayout(template) {
  const config = template?.layout?.sprite_platform || {};
  return {
    enabled: config.option_enabled !== false,
    width_multiplier: ensureNumber(config.option_width_multiplier, 0.9),
    center_y_offset_multiplier: ensureNumber(config.center_y_offset_multiplier, 0.34),
    center_y_offset_px: ensureNumber(config.option_center_y_offset_px, ensureNumber(config.center_y_offset_px, 0)),
  };
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = null) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const fontPart = buildFontPart(fontPath);
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
  const platformLayout = resolvePlatformLayout(template);
  const highlightKeywords = normalizeHighlightKeywords(template);
  const highlightColor = String(template?.layout?.text?.highlight_color || '0xFFD60A').trim() || '0xFFD60A';

  const backgroundLabels = Array.from({ length: roundCount }, (_, index) => `bg${index}`);
  const backgroundFilter = backgroundBlurSigma > 0
    ? `gblur=sigma=${backgroundBlurSigma},`
    : '';
  filters.push(
    `[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${backgroundFilter}fps=${fps},setsar=1,split=${roundCount}${backgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  renderPlan.rounds.forEach((round, roundIndex) => {
    const incomingTransitionSeconds = resolveIncomingTransitionSeconds(renderPlan, roundIndex);
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    let currentLabel = sceneBaseLabel;
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
      const hookSegments = buildTextSegments(renderPlan.hook_text, {
        template,
        fontSize: renderPlan.text_layout.hook_font_size,
        baseY: renderPlan.text_layout.hook_y,
        startSeconds: 0.04,
        endSeconds: round.local.countdown_start_seconds,
        maxLines: 2,
      });
      hookSegments.forEach((segment, segmentIndex) => {
        const hookSceneLabel = `scene${roundIndex}h${segmentIndex}`;
        filters.push(
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}'${fontPart}:fontcolor=white:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${hookSceneLabel}]`,
        );
        currentLabel = hookSceneLabel;
        currentLabel = appendHighlightedSegmentOverlay(filters, currentLabel, {
          labelPrefix: `scene${roundIndex}h${segmentIndex}`,
          segment,
          fontPart,
          highlightColor,
          highlightKeywords,
        });
      });
    }

    const promptStartSeconds = roundTime(round.local.countdown_start_seconds + 0.02);
    const promptSegments = buildTextSegments(round.prompt_text || '', {
      template,
      fontSize: renderPlan.text_layout.prompt_font_size,
      baseY: renderPlan.text_layout.prompt_y,
      startSeconds: promptStartSeconds,
      endSeconds: round.local.reveal_start_seconds,
      maxLines: 2,
    });
    promptSegments.forEach((segment, segmentIndex) => {
      const promptSceneLabel = `scene${roundIndex}p${segmentIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}'${fontPart}:fontcolor=white:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${promptSceneLabel}]`,
      );
      currentLabel = promptSceneLabel;
      currentLabel = appendHighlightedSegmentOverlay(filters, currentLabel, {
        labelPrefix: `scene${roundIndex}p${segmentIndex}`,
        segment,
        fontPart,
        highlightColor,
        highlightKeywords,
      });
    });

    const roundSpriteInput = inputRefs.rounds[roundIndex].sprite;
    const splitLabels = round.candidates.map((candidate) => `r${roundIndex}cand${candidate.index}`);
    const graySplitLabels = round.candidates.filter((candidate) => !candidate.is_correct).map((candidate) => `r${roundIndex}gray${candidate.index}`);
    filters.push(
      `[${roundSpriteInput}:v]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,split=${splitLabels.length + graySplitLabels.length}${splitLabels.map((label) => `[${label}]`).join('')}${graySplitLabels.map((label) => `[${label}]`).join('')}`,
    );

    const baseSpriteSize = roundTime(
      ensureNumber(gridLayout.item_size_px, 220) * ensureNumber(gridLayout.sprite_scale_multiplier, 1),
    );
    const introDuration = Math.max(0.08, ensureNumber(template?.renderer?.candidate_intro_duration_seconds, 0.18));
    const grayFadeDuration = Math.max(0.08, ensureNumber(template?.renderer?.decoy_grayscale_fade_duration_seconds, 0.22));
    let grayLabelCursor = 0;

    for (const candidate of round.candidates) {
      const cell = gridLayout.cells[candidate.index];
      const introStart = roundTime(incomingTransitionSeconds + 0.08 + (candidate.index * 0.03));
      const baseLabel = `r${roundIndex}c${candidate.index}`;
      const baseChain = `${buildColorFilterChain(candidate)},scale=${baseSpriteSize}:${baseSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1`;
      filters.push(`[${splitLabels[candidate.index]}]fps=${fps},${baseChain}[${baseLabel}]`);
      if (inputRefs.grassPlatform != null && platformLayout.enabled) {
        const platformWidth = Number((baseSpriteSize * platformLayout.width_multiplier).toFixed(3));
        const platformLabel = `r${roundIndex}platform${candidate.index}`;
        const platformSceneLabel = `scene${roundIndex}platform${candidate.index}`;
        const platformCenterY = Number((
          cell.center_y
          + (baseSpriteSize * platformLayout.center_y_offset_multiplier)
          + platformLayout.center_y_offset_px
        ).toFixed(3));
        filters.push(
          `[${inputRefs.grassPlatform}:v]fps=${fps},scale=${platformWidth}:-1,format=rgba,setsar=1[${platformLabel}]`,
        );
        filters.push(
          `[${currentLabel}][${platformLabel}]overlay=x='${cell.center_x}-w/2':y='${platformCenterY}-h/2':enable='${formatEnableBetween(introStart, round.local.scene_duration_seconds)}'[${platformSceneLabel}]`,
        );
        currentLabel = platformSceneLabel;
      }
      const baseSceneLabel = `scene${roundIndex}cand${candidate.index}`;
      filters.push(
        `[${currentLabel}][${baseLabel}]overlay=x='${cell.center_x}-w/2':y='${cell.center_y}-h/2':enable='${formatEnableBetween(introStart, round.local.scene_duration_seconds)}'[${baseSceneLabel}]`,
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

    const timerRailLabel = `scene${roundIndex}tb0`;
    const timerBarScaleExpression = buildTimerBarScaleExpression(
      round.local.countdown_start_seconds,
      round.local.reveal_start_seconds,
      timerLayout.width,
    );
    const greenEnd = roundTime(
      round.local.countdown_start_seconds
      + ((round.local.reveal_start_seconds - round.local.countdown_start_seconds) * 0.5),
    );
    const yellowEnd = roundTime(
      round.local.countdown_start_seconds
      + ((round.local.reveal_start_seconds - round.local.countdown_start_seconds) * 0.8),
    );
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=black@0.28:t=fill:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerRailLabel}]`,
    );
    currentLabel = timerRailLabel;

    const timerGreenSourceLabel = `scene${roundIndex}tb1src`;
    filters.push(
      `color=c=0x32D74B@0.98:s=${timerLayout.width}x${timerLayout.height}:r=${fps}:d=${round.scene_duration_seconds},format=rgba,trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${timerLayout.height}:eval=frame[${timerGreenSourceLabel}]`,
    );
    const timerGreenLabel = `scene${roundIndex}tb1`;
    filters.push(
      `[${currentLabel}][${timerGreenSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${formatEnableBetween(round.local.countdown_start_seconds, greenEnd)}'[${timerGreenLabel}]`,
    );
    currentLabel = timerGreenLabel;

    const timerYellowSourceLabel = `scene${roundIndex}tb2src`;
    filters.push(
      `color=c=0xFFD60A@0.98:s=${timerLayout.width}x${timerLayout.height}:r=${fps}:d=${round.scene_duration_seconds},format=rgba,trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${timerLayout.height}:eval=frame[${timerYellowSourceLabel}]`,
    );
    const timerYellowLabel = `scene${roundIndex}tb2`;
    filters.push(
      `[${currentLabel}][${timerYellowSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${formatEnableBetween(greenEnd, yellowEnd)}'[${timerYellowLabel}]`,
    );
    currentLabel = timerYellowLabel;

    const timerRedSourceLabel = `scene${roundIndex}tb3src`;
    filters.push(
      `color=c=0xFF453A@0.98:s=${timerLayout.width}x${timerLayout.height}:r=${fps}:d=${round.scene_duration_seconds},format=rgba,trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${timerLayout.height}:eval=frame[${timerRedSourceLabel}]`,
    );
    const timerRedLabel = `scene${roundIndex}tb3`;
    filters.push(
      `[${currentLabel}][${timerRedSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${formatEnableBetween(yellowEnd, round.local.reveal_start_seconds)}'[${timerRedLabel}]`,
    );
    currentLabel = timerRedLabel;

    const timerBorderLabel = `scene${roundIndex}tb4`;
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=white@0.16:t=2:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerBorderLabel}]`,
    );
    currentLabel = timerBorderLabel;

    if (plan.shiny_reveal?.active && plan.assets.overlays?.selected_shiny_sparkle_path && inputRefs.shinySparkle != null) {
      const correctCandidate = round.candidates.find((candidate) => candidate.is_correct)
        || round.candidates[round.correct_candidate_index]
        || round.candidates[0];
      const correctCell = gridLayout.cells[correctCandidate.index];
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
        baseSpriteSize * Math.max(
          1,
          ensureNumber(
            plan.shiny_reveal?.sparkle_scale_multiplier,
            DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
          ),
        ),
      );
      filters.push(
        `[${inputRefs.shinySparkle}:v]fps=${fps},trim=duration=${sparkleDuration},setpts=PTS-STARTPTS+${round.local.reveal_visual_start_seconds}/TB,scale=${sparkleSize}:${sparkleSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${sparkleLabel}]`,
      );
      const sparkleSceneLabel = `scene${roundIndex}ss`;
      filters.push(
        `[${currentLabel}][${sparkleLabel}]overlay=${correctCell.center_x}-w/2:${correctCell.center_y}-h/2:enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, sparkleEnd)}'[${sparkleSceneLabel}]`,
      );
      currentLabel = sparkleSceneLabel;
    }

    const revealSegments = buildTextSegments(round.reveal_text || '', {
      template,
      fontSize: renderPlan.text_layout.reveal_font_size,
      baseY: renderPlan.text_layout.reveal_y,
      startSeconds: round.local.reveal_visual_start_seconds,
      endSeconds: round.local.scene_duration_seconds,
      maxLines: 2,
    });
    revealSegments.forEach((segment, segmentIndex) => {
      const revealSceneLabel = `scene${roundIndex}r${segmentIndex}`;
      filters.push(
        `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}'${fontPart}:fontcolor=white:fontsize=${segment.font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${revealSceneLabel}]`,
      );
      currentLabel = revealSceneLabel;
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
