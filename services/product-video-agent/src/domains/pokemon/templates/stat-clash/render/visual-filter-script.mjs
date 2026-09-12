import {
  buildAnimatedLerpExpression,
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  buildScaleFilterTimeExpression,
  formatEnableBetween,
  normalizeAnimationTimeExpression,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
  DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
  DEFAULT_TEXT_BORDER,
  escapeDrawtextText,
  escapeFilterPath,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildProgressiveTextArtifacts,
  estimateWrapCharacterLimit,
} from '../../dual-type-reveal/render/text-layout.mjs';
import { appendFormingSpriteFilters } from '../../shared/render/forming-animation.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function resolveTextOutlineWidth(template) {
  return Math.max(
    1,
    Math.round(ensureNumber(template?.layout?.text?.outline_width, DEFAULT_TEXT_BORDER + 2)),
  );
}

function extractPromptHeaderText(text, round) {
  const normalized = String(text || '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!normalized) {
    return '';
  }
  const statLabel = String(round?.stat_label || '').trim();
  if (!statLabel) {
    return normalized.replace(/[?!.,:;]+\s*$/u, '').trim();
  }
  const escapedStatLabel = statLabel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const stripped = normalized.replace(
    new RegExp(`\\s*${escapedStatLabel}\\s*[?!.,:;]*\\s*$`, 'u'),
    '',
  ).trim();
  return stripped || normalized.replace(/[?!.,:;]+\s*$/u, '').trim();
}

function buildStyledStatPromptLines(round, textLayout, startSeconds, endSeconds, baseY) {
  const statKey = String(round?.stat_key || '').trim().toLowerCase();
  if (!statKey) {
    return [];
  }
  const largeFontSize = Math.round(textLayout.prompt_font_size * 1.1);

  switch (statKey) {
    case 'hp':
      return [{
        text: 'HP?',
        font_size: largeFontSize,
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        color: '0x4CD964',
      }];
    case 'attack':
      return [{
        text: 'Attack?',
        font_size: largeFontSize,
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        color: '0xFF5A5F',
      }];
    case 'defense':
      return [{
        text: 'Defense?',
        font_size: largeFontSize,
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        color: '0x4D96FF',
      }];
    case 'speed':
      return [{
        text: 'Speed?',
        font_size: largeFontSize,
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        color: '0xAF52DE',
      }];
    case 'special_attack':
      return [{
        parts: [
          { text: 'Sp.', font_size: largeFontSize, color: '0xFFD60A' },
          { text: 'Atk?', font_size: largeFontSize, color: '0xFF5A5F' },
        ],
        part_gap_px: Math.max(14, Math.round(largeFontSize * 0.16)),
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      }];
    case 'special_defense':
      return [{
        parts: [
          { text: 'Sp.', font_size: largeFontSize, color: '0xFFD60A' },
          { text: 'Def?', font_size: largeFontSize, color: '0x4D96FF' },
        ],
        part_gap_px: Math.max(14, Math.round(largeFontSize * 0.16)),
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      }];
    default:
      return [{
        text: `${String(round?.stat_label || 'Stat').trim() || 'Stat'}?`,
        font_size: largeFontSize,
        y: baseY,
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        color: '0xFFD60A',
      }];
  }
}

function estimateTextWidth(text, fontSize) {
  const normalizedText = String(text || '');
  return Math.max(
    1,
    Number((normalizedText.length * ensureNumber(fontSize, 96) * 0.58).toFixed(3)),
  );
}

function buildCenteredPromptPartX(parts, gapPx, index) {
  const safeParts = Array.isArray(parts) ? parts : [];
  const safeGapPx = Math.max(0, ensureNumber(gapPx, 0));
  const widths = safeParts.map((part) => estimateTextWidth(part.text, part.font_size));
  const totalWidth = widths.reduce((sum, width) => sum + width, 0)
    + (Math.max(0, widths.length - 1) * safeGapPx);
  const offset = (-totalWidth / 2)
    + widths.slice(0, index).reduce((sum, width) => sum + width, 0)
    + (safeGapPx * index);
  const roundedOffset = Number(offset.toFixed(3));
  return roundedOffset >= 0 ? `(w/2)+${roundedOffset}` : `(w/2)${roundedOffset}`;
}

function wrapPromptTextLines(text, maxCharactersPerLine, maxLines = 2) {
  const normalizedText = String(text || '').replace(/\s+/gu, ' ').trim();
  if (!normalizedText) {
    return [];
  }
  const normalizedMaxCharacters = Math.max(8, Math.floor(ensureNumber(maxCharactersPerLine, 24)));
  const lines = [];
  let currentLine = '';
  for (const token of normalizedText.split(/\s+/u).filter(Boolean)) {
    const nextLine = currentLine ? `${currentLine} ${token}` : token;
    if (!currentLine || nextLine.length <= normalizedMaxCharacters) {
      currentLine = nextLine;
      continue;
    }
    lines.push(currentLine);
    currentLine = token;
  }
  if (currentLine) {
    lines.push(currentLine);
  }
  if (lines.length <= maxLines) {
    return lines;
  }
  const preservedLines = lines.slice(0, Math.max(0, maxLines - 1));
  const lastLine = lines.slice(Math.max(0, maxLines - 1)).join(' ');
  return [...preservedLines, lastLine];
}

function buildTimerBarScaleExpression(startSeconds, endSeconds, fullWidth) {
  const start = Number(ensureNumber(startSeconds, 0).toFixed(3));
  const end = Number(Math.max(start, ensureNumber(endSeconds, start)).toFixed(3));
  const width = Math.max(2, Math.round(ensureNumber(fullWidth, 0)));
  if (end <= start || width <= 0) {
    return '2';
  }
  return `max(2,if(lt(t,${start}),${width},if(lt(t,${end}),${width}*(1-((t-${start})/${Number((end - start).toFixed(3))})),0)))`;
}

function buildRoundedRectAlphaExpression(width, height, alphaValue) {
  const normalizedWidth = Math.max(2, Math.round(ensureNumber(width, 0)));
  const normalizedHeight = Math.max(2, Math.round(ensureNumber(height, 0)));
  const radius = Math.max(2, Math.floor(normalizedHeight / 2));
  const radiusSquared = radius * radius;
  const centerY = Number((((normalizedHeight - 1) / 2)).toFixed(3));
  const leftCenterX = radius;
  const rightCenterX = Math.max(radius, normalizedWidth - radius - 1);
  const railStartX = Math.max(0, radius);
  const railEndX = Math.max(railStartX, normalizedWidth - radius - 1);
  const normalizedAlphaValue = Math.max(0, Math.min(255, Math.round(ensureNumber(alphaValue, 255))));
  return `if(between(X,${railStartX},${railEndX}),${normalizedAlphaValue},if(lte((X-${leftCenterX})*(X-${leftCenterX})+(Y-${centerY})*(Y-${centerY}),${radiusSquared}),${normalizedAlphaValue},if(lte((X-${rightCenterX})*(X-${rightCenterX})+(Y-${centerY})*(Y-${centerY}),${radiusSquared}),${normalizedAlphaValue},0)))`;
}

function appendRoundedRectSource(filters, {
  label,
  color,
  alpha,
  width,
  height,
  fps,
  sceneDurationSeconds,
  blur = null,
  scaleWidthExpression = null,
  alphaMaskExpression = null,
}) {
  const normalizedWidth = Math.max(2, Math.round(ensureNumber(width, 0)));
  const normalizedHeight = Math.max(2, Math.round(ensureNumber(height, 0)));
  const resolvedAlphaMaskExpression = alphaMaskExpression || buildRoundedRectAlphaExpression(
    normalizedWidth,
    normalizedHeight,
    Math.round(Math.max(0, Math.min(1, ensureNumber(alpha, 1))) * 255),
  );
  let filter = `color=c=${color}:s=${normalizedWidth}x${normalizedHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${resolvedAlphaMaskExpression}'`;
  if (blur) {
    filter += `,boxblur=${blur}`;
  }
  if (scaleWidthExpression) {
    filter += `,scale=w='${scaleWidthExpression}':h=${normalizedHeight}:eval=frame`;
  }
  filters.push(`${filter}[${label}]`);
}

function buildStaticSpriteWobbleExpression(round, candidate, template) {
  const startSeconds = roundTime(Math.max(
    ensureNumber(candidate?.intro_end_seconds, 0),
    ensureNumber(round?.local?.countdown_start_seconds, 0),
  ));
  const endSeconds = roundTime(Math.max(
    startSeconds,
    ensureNumber(round?.local?.reveal_start_seconds, startSeconds),
  ));
  const amplitude = roundTime(Math.max(
    0,
    ensureNumber(template?.renderer?.fallback_sprite_wobble_amplitude_px, 12),
  ));
  const cycleLengthMultiplier = Math.max(
    0.1,
    ensureNumber(template?.renderer?.fallback_sprite_wobble_cycle_length_multiplier, 1.5),
  );
  const frequencyRadians = roundTime(Math.max(
    0.4,
    ensureNumber(template?.renderer?.fallback_sprite_wobble_frequency_hz, 2.1) / cycleLengthMultiplier,
  ) * 6.283185307);
  if (endSeconds <= startSeconds || amplitude <= 0) {
    return '0';
  }
  return `if(lt(t,${startSeconds}),0,if(lt(t,${endSeconds}),sin((t-${startSeconds})*${frequencyRadians})*${amplitude},0))`;
}

function buildHeldPokeballWiggleValueExpression({
  startSeconds,
  amplitude,
  frequencyHz,
  momentumStrength,
  directionMultiplier,
  timeExpression,
}) {
  const time = normalizeAnimationTimeExpression(timeExpression);
  const start = roundTime(startSeconds);
  const normalizedAmplitude = roundTime(Math.max(0, amplitude));
  const frequencyRadians = roundTime(Math.max(0.1, frequencyHz) * 6.283185307);
  const normalizedMomentumStrength = roundTime(Math.max(0, momentumStrength));
  const normalizedDirectionMultiplier = ensureNumber(directionMultiplier, 1) < 0 ? -1 : 1;
  if (normalizedAmplitude <= 0) {
    return '0';
  }
  const sineExpression = `sin((${time}-${start})*${frequencyRadians})`;
  const momentumExpression = normalizedMomentumStrength > 0
    ? `(${sineExpression})*(1+${normalizedMomentumStrength}*(1-abs(${sineExpression})))`
    : sineExpression;
  const signedAmplitude = roundTime(normalizedAmplitude * normalizedDirectionMultiplier);
  return `if(lt(${time},${start}),0,(${momentumExpression})*${signedAmplitude})`;
}

function buildBackgroundPreparationFilter({
  inputRef,
  width,
  height,
  fps,
  blurSigma,
  template,
}) {
  const motionConfig = template?.layout?.background?.motion || {};
  const motionEnabled = motionConfig?.enabled === true;
  const safeBlurSigma = Math.max(0, ensureNumber(blurSigma, 0));
  const blurFilter = safeBlurSigma > 0
    ? `,gblur=sigma=${Number(safeBlurSigma.toFixed(3))}`
    : '';

  if (!motionEnabled) {
    return `[${inputRef}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${blurFilter},fps=${fps},setsar=1`;
  }

  const zoomScale = Math.max(1.01, ensureNumber(motionConfig.zoom_scale, 1.12));
  const subpixelScale = Math.max(
    1,
    Math.min(3, Math.round(ensureNumber(motionConfig.subpixel_scale, 1))),
  );
  const panCycleSeconds = Math.max(4, ensureNumber(motionConfig.pan_cycle_seconds, 18));
  const verticalPanRatio = Math.max(
    0,
    Math.min(1, ensureNumber(motionConfig.vertical_pan_ratio, 0.72)),
  );
  const outputWidth = width * subpixelScale;
  const outputHeight = height * subpixelScale;
  const scaledWidth = Math.ceil(width * zoomScale * subpixelScale);
  const scaledHeight = Math.ceil(height * zoomScale * subpixelScale);
  const xSpeed = Number(((Math.PI * 2) / panCycleSeconds).toFixed(6));
  const ySpeed = Number((xSpeed * 0.73).toFixed(6));
  const xExpression = `(iw-${outputWidth})*(0.5+0.5*sin(t*${xSpeed}))`;
  const yExpression = `((ih-${outputHeight})*(1-${verticalPanRatio})/2)+((ih-${outputHeight})*${verticalPanRatio})*(0.5+0.5*cos(t*${ySpeed}))`;
  const subpixelDownscaleFilter = subpixelScale > 1
    ? `,scale=${width}:${height}:flags=lanczos`
    : '';

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${outputWidth}:h=${outputHeight}:x='${xExpression}':y='${yExpression}'${subpixelDownscaleFilter}${blurFilter},setsar=1`;
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
  glowColor,
  accentColor,
}) {
  const enableExpression = formatEnableBetween(enableStartSeconds, enableEndSeconds);
  const timerWidth = Math.max(2, Math.round(ensureNumber(timerLayout.width, 0)));
  const timerHeight = Math.max(2, Math.round(ensureNumber(timerLayout.height, 0)));
  const glowHeight = Math.max(timerHeight + 18, Math.round(timerHeight * 1.55));
  const glowY = Number((timerLayout.y - ((glowHeight - timerHeight) / 2)).toFixed(3));
  const trailHeight = Math.max(glowHeight + 8, Math.round(timerHeight * 1.9));
  const trailY = Number((timerLayout.y - ((trailHeight - timerHeight) / 2)).toFixed(3));
  const highlightHeight = Math.max(4, Math.round(timerHeight * 0.34));
  const highlightY = Number((timerLayout.y + 2).toFixed(3));
  const accentHeight = Math.max(6, Math.round(timerHeight * 0.42));
  const accentY = Number((timerLayout.y + Math.round(timerHeight * 0.24)).toFixed(3));
  const shadowHeight = Math.max(3, Math.round(timerHeight * 0.18));
  const shadowY = Number((timerLayout.y + timerHeight - shadowHeight - 2).toFixed(3));
  const trailSweepFramesRadians = Number((0.12).toFixed(6));
  const trailCenterExpression = `(W*(0.5+0.32*sin(N*${trailSweepFramesRadians})))`;
  const trailSweepExpression = `clip(1-abs(X-${trailCenterExpression})/(W*0.24),0,1)`;
  const trailMaskExpression = `(${buildRoundedRectAlphaExpression(
    timerWidth,
    trailHeight,
    Math.round(0.38 * 255),
  )})*(0.48+0.52*(${trailSweepExpression}))`;

  const trailSourceLabel = `${labelPrefix}trailsrc`;
  appendRoundedRectSource(filters, {
    label: trailSourceLabel,
    color: glowColor,
    alpha: 0.38,
    width: timerWidth,
    height: trailHeight,
    fps,
    sceneDurationSeconds,
    blur: '10:3',
    scaleWidthExpression: timerBarScaleExpression,
    alphaMaskExpression: trailMaskExpression,
  });
  const trailOverlayLabel = `${labelPrefix}trail`;
  filters.push(
    `[${currentLabel}][${trailSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${trailY}:enable='${enableExpression}'[${trailOverlayLabel}]`,
  );

  const glowSourceLabel = `${labelPrefix}glowsrc`;
  appendRoundedRectSource(filters, {
    label: glowSourceLabel,
    color: glowColor,
    alpha: 0.30,
    width: timerWidth,
    height: glowHeight,
    fps,
    sceneDurationSeconds,
    blur: '6:2',
    scaleWidthExpression: timerBarScaleExpression,
  });
  const glowOverlayLabel = `${labelPrefix}glow`;
  filters.push(
    `[${trailOverlayLabel}][${glowSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${glowY}:enable='${enableExpression}'[${glowOverlayLabel}]`,
  );

  const baseSourceLabel = `${labelPrefix}src`;
  appendRoundedRectSource(filters, {
    label: baseSourceLabel,
    color: baseColor,
    alpha: 0.98,
    width: timerWidth,
    height: timerHeight,
    fps,
    sceneDurationSeconds,
    scaleWidthExpression: timerBarScaleExpression,
  });
  const baseOverlayLabel = `${labelPrefix}base`;
  filters.push(
    `[${glowOverlayLabel}][${baseSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${enableExpression}'[${baseOverlayLabel}]`,
  );

  const accentSourceLabel = `${labelPrefix}accsrc`;
  appendRoundedRectSource(filters, {
    label: accentSourceLabel,
    color: accentColor,
    alpha: 0.36,
    width: timerWidth,
    height: accentHeight,
    fps,
    sceneDurationSeconds,
    scaleWidthExpression: timerBarScaleExpression,
  });
  const accentOverlayLabel = `${labelPrefix}acc`;
  filters.push(
    `[${baseOverlayLabel}][${accentSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${accentY}:enable='${enableExpression}'[${accentOverlayLabel}]`,
  );

  const highlightSourceLabel = `${labelPrefix}hlsrc`;
  appendRoundedRectSource(filters, {
    label: highlightSourceLabel,
    color: 'white',
    alpha: 0.18,
    width: timerWidth,
    height: highlightHeight,
    fps,
    sceneDurationSeconds,
    scaleWidthExpression: timerBarScaleExpression,
  });
  const highlightOverlayLabel = `${labelPrefix}hl`;
  filters.push(
    `[${accentOverlayLabel}][${highlightSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${highlightY}:enable='${enableExpression}'[${highlightOverlayLabel}]`,
  );

  const shadowSourceLabel = `${labelPrefix}shsrc`;
  appendRoundedRectSource(filters, {
    label: shadowSourceLabel,
    color: 'black',
    alpha: 0.14,
    width: timerWidth,
    height: shadowHeight,
    fps,
    sceneDurationSeconds,
    scaleWidthExpression: timerBarScaleExpression,
  });
  const shadowOverlayLabel = `${labelPrefix}sh`;
  filters.push(
    `[${highlightOverlayLabel}][${shadowSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${shadowY}:enable='${enableExpression}'[${shadowOverlayLabel}]`,
  );

  return shadowOverlayLabel;
}

function appendLayered3dText(filters, currentLabel, {
  labelPrefix,
  lines,
  startSeconds,
  endSeconds,
  baseY,
  lineGapPx,
  depthPx,
  depthSteps,
  shadowColor,
  shadowX,
  shadowY,
  fontPart,
  textOutlineWidth,
}) {
  let lineY = baseY;
  let outputLabel = currentLabel;

  lines.forEach((line, lineIndex) => {
    const text = String(line.text || '').trim();
    const fontSize = Math.max(24, Math.round(ensureNumber(line.font_size, 84)));
    const outlineWidth = Math.max(
      1,
      Math.round(ensureNumber(line.outline_width, textOutlineWidth)),
    );
    for (let depthStep = depthSteps; depthStep >= 1; depthStep -= 1) {
      const depthOffset = Number(((depthPx * depthStep) / depthSteps).toFixed(3));
      const depthLabel = `${labelPrefix}${lineIndex}depth${depthStep}`;
      filters.push(
        `[${outputLabel}]drawtext=text='${escapeDrawtextText(text)}'${fontPart}:fontcolor=${line.depth_color || '0x244B73'}:fontsize=${fontSize}:borderw=${outlineWidth}:bordercolor=${line.outline_color || 'black'}:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(lineY + depthOffset, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'[${depthLabel}]`,
      );
      outputLabel = depthLabel;
    }

    const faceLabel = `${labelPrefix}${lineIndex}face`;
    filters.push(
      `[${outputLabel}]drawtext=text='${escapeDrawtextText(text)}'${fontPart}:fontcolor=${line.color || 'white'}:fontsize=${fontSize}:borderw=${outlineWidth}:bordercolor=${line.outline_color || 'black'}:shadowcolor=${shadowColor}:shadowx=${shadowX}:shadowy=${shadowY}:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(lineY, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'[${faceLabel}]`,
    );
    outputLabel = faceLabel;
    lineY += fontSize + lineGapPx;
  });

  return outputLabel;
}

function appendRoundHeadline(filters, currentLabel, {
  roundIndex,
  round,
  template,
  fontPart,
  textOutlineWidth,
}) {
  const headlineConfig = template?.layout?.text?.round_headline || {};
  const lines = Array.isArray(headlineConfig.lines)
    ? headlineConfig.lines.filter((line) => String(line?.text || '').trim())
    : [];
  if (headlineConfig.enabled !== true || lines.length === 0) {
    return currentLabel;
  }

  const startSeconds = ensureNumber(round?.local?.prompt_start_seconds, 0.04);
  const endSeconds = ensureNumber(round?.local?.scene_duration_seconds, startSeconds + 1);
  return appendLayered3dText(filters, currentLabel, {
    labelPrefix: `scene${roundIndex}headline`,
    lines,
    startSeconds,
    endSeconds,
    baseY: ensureNumber(headlineConfig.y, 96)
      + ensureNumber(template?.layout?.foreground_y_offset_px, 0),
    lineGapPx: Math.max(0, ensureNumber(headlineConfig.line_gap_px, 4)),
    depthPx: Math.max(0, Math.round(ensureNumber(headlineConfig.depth_px, 8))),
    depthSteps: Math.max(1, Math.round(ensureNumber(headlineConfig.depth_steps, 4))),
    shadowColor: String(headlineConfig.shadow_color || 'black@0.7'),
    shadowX: Math.round(ensureNumber(headlineConfig.shadow_x_px, 4)),
    shadowY: Math.round(ensureNumber(headlineConfig.shadow_y_px, 6)),
    fontPart,
    textOutlineWidth,
  });
}

function appendFinalPrompt(filters, currentLabel, {
  roundIndex,
  round,
  template,
  timerLayout,
  fontPart,
  textOutlineWidth,
}) {
  const promptText = String(round?.reveal_text || '').trim();
  const promptConfig = template?.layout?.text?.final_prompt || {};
  const headlineConfig = template?.layout?.text?.round_headline || {};
  if (!promptText || promptConfig.enabled !== true || !timerLayout) {
    return null;
  }

  const fontSize = Math.max(24, Math.round(ensureNumber(promptConfig.font_size, 72)));
  const maxLines = Math.max(1, Math.round(ensureNumber(promptConfig.max_lines, 2)));
  const lineGapPx = Math.max(0, ensureNumber(
    promptConfig.line_gap_px,
    headlineConfig.line_gap_px || 4,
  ));
  const renderedText = promptConfig.uppercase === false ? promptText : promptText.toUpperCase();
  const wrappedLines = wrapPromptTextLines(
    renderedText,
    estimateWrapCharacterLimit(template, fontSize),
    maxLines,
  );
  if (wrappedLines.length === 0) {
    return null;
  }

  const headlineStyles = Array.isArray(headlineConfig.lines)
    ? headlineConfig.lines.filter((line) => line && typeof line === 'object')
    : [];
  const singleLineStyleIndex = Math.max(
    0,
    Math.round(ensureNumber(promptConfig.single_line_style_index, 1)),
  );
  const styledLines = wrappedLines.map((text, lineIndex) => {
    const styleIndex = wrappedLines.length === 1 ? singleLineStyleIndex : lineIndex;
    const style = headlineStyles[styleIndex % Math.max(1, headlineStyles.length)] || {};
    return {
      text,
      font_size: fontSize,
      color: style.color || 'white',
      outline_color: style.outline_color || 'black',
      depth_color: style.depth_color || '0x244B73',
      outline_width: style.outline_width,
    };
  });
  const blockHeight = (styledLines.length * fontSize)
    + (Math.max(0, styledLines.length - 1) * lineGapPx);
  const anchor = String(promptConfig.anchor || 'timer_center').trim().toLowerCase();
  const anchorY = anchor === 'timer_center'
    ? ensureNumber(timerLayout.center_y, timerLayout.y)
    : ensureNumber(promptConfig.center_y, timerLayout.center_y);
  const centerY = anchorY + ensureNumber(promptConfig.center_y_offset_px, 0);
  const baseY = Number((centerY - (blockHeight / 2)).toFixed(3));
  const startSeconds = ensureNumber(round?.local?.reveal_visual_start_seconds, 0);
  const endSeconds = ensureNumber(round?.local?.scene_duration_seconds, startSeconds + 1);

  return appendLayered3dText(filters, currentLabel, {
    labelPrefix: `scene${roundIndex}finalprompt`,
    lines: styledLines,
    startSeconds,
    endSeconds,
    baseY,
    lineGapPx,
    depthPx: Math.max(0, Math.round(ensureNumber(headlineConfig.depth_px, 8))),
    depthSteps: Math.max(1, Math.round(ensureNumber(headlineConfig.depth_steps, 4))),
    shadowColor: String(headlineConfig.shadow_color || 'black@0.7'),
    shadowX: Math.round(ensureNumber(headlineConfig.shadow_x_px, 4)),
    shadowY: Math.round(ensureNumber(headlineConfig.shadow_y_px, 6)),
    fontPart,
    textOutlineWidth,
  });
}

function buildPromptSegments(text, template, textLayout, round, timerLayout = null) {
  const startSeconds = ensureNumber(round?.local?.prompt_start_seconds, 0.04);
  const endSeconds = ensureNumber(round?.local?.reveal_start_seconds, startSeconds + 1);
  const headerText = extractPromptHeaderText(text, round);
  const promptAboveTimer = template?.layout?.text?.prompt_above_timer === true && timerLayout;
  const headerFontSize = Math.max(
    promptAboveTimer ? 44 : 64,
    Math.round(textLayout.prompt_font_size * 0.82),
  );
  const lineHeight = headerFontSize + 12;
  const wrappedHeaderLines = wrapPromptTextLines(
    headerText,
    estimateWrapCharacterLimit(template, headerFontSize),
    2,
  );
  const promptBlockHeight = Math.max(
    headerFontSize,
    (wrappedHeaderLines.length * headerFontSize)
      + (Math.max(0, wrappedHeaderLines.length - 1) * 12),
  );
  const promptBaseY = promptAboveTimer
    ? Number((
      timerLayout.y
      - Math.max(0, ensureNumber(template?.layout?.text?.prompt_above_timer_gap_px, 24))
      - promptBlockHeight
    ).toFixed(3))
    : textLayout.prompt_y;
  const headerLines = wrappedHeaderLines.map((line, index) => ({
    text: line,
    font_size: headerFontSize,
    y: promptBaseY + (index * lineHeight),
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    color: 'white',
  }));
  const lastHeaderLine = headerLines.at(-1);
  const statBaseY = Number((
    (lastHeaderLine?.y ?? promptBaseY)
    + (lastHeaderLine?.font_size ?? headerFontSize)
    + Math.max(10, Math.round(textLayout.prompt_font_size * 0.08))
  ).toFixed(3));
  return [
    ...headerLines,
    ...buildStyledStatPromptLines(round, textLayout, startSeconds, endSeconds, statBaseY),
  ];
}

function buildRevealArtifacts(text, template, textLayout, round) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) {
    return { lines: [] };
  }
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

function buildCounterXExpression(roundIndex, textLayout, canvasWidth) {
  if (roundIndex === 0) {
    return {
      startSeconds: 0.03,
      xExpression: textLayout.counter_x,
    };
  }
  return {
    startSeconds: 0.03,
    xExpression: buildAnimatedLerpExpression({
      fromValue: canvasWidth + 48,
      toValue: textLayout.counter_x,
      holdUntilSeconds: 0.03,
      transitionDurationSeconds: 0.34,
    }),
  };
}

function overlayCounterText(
  filters,
  currentLabel,
  roundIndex,
  round,
  textLayout,
  canvasWidth,
  fontPart,
  textOutlineWidth,
) {
  const { startSeconds: counterStartSeconds, xExpression } = buildCounterXExpression(
    roundIndex,
    textLayout,
    canvasWidth,
  );
  const counterScaleExpression = buildAnimatedPopSettleExpression(
    counterStartSeconds,
    0.24,
    0.62,
    1.18,
    1,
  );
  const counterLabel = `scene${roundIndex}counter`;
  filters.push(
    `[${currentLabel}]drawtext=text='${escapeDrawtextText(round.round_label)}'${fontPart}:fontcolor=white:fontsize='${textLayout.counter_font_size}*(${counterScaleExpression})':borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x='${xExpression}':y=${textLayout.counter_y}:alpha='${buildAnimatedTextSegmentAlphaExpression(counterStartSeconds, round.local.scene_duration_seconds)}':enable='${formatEnableBetween(counterStartSeconds, round.local.scene_duration_seconds)}'[${counterLabel}]`,
  );
  return counterLabel;
}

function buildIntroHookScene(filters, {
  backgroundLabel,
  hook,
  template,
  inputRefs,
  gridLayout,
  platformLayout,
  baseSpriteSize,
  fps,
  introPokeballScaleMultiplier,
  introPokeballCenterYOffset,
  textLayout,
  fontPart,
  textOutlineWidth,
}) {
  const baseLabel = 'introhookbase';
  const hookPokeballsEnabled = template?.renderer?.hook_pokeballs_enabled === true;
  const textLabel = 'introhooktext';
  const hookScaleExpression = buildAnimatedPopSettleExpression(
    hook.text_start_seconds,
    0.32,
    0.62,
    1.16,
    1,
  );
  filters.push(
    `[${backgroundLabel}]trim=duration=${hook.scene_duration_seconds},setpts=PTS-STARTPTS[${baseLabel}]`,
  );
  let currentLabel = baseLabel;

  const cells = Array.isArray(gridLayout?.cells) ? gridLayout.cells : [];
  if (hookPokeballsEnabled && cells.length > 0 && inputRefs?.grassPlatform != null && platformLayout?.enabled) {
    const sharedPlatformWidth = Number((
      ensureNumber(baseSpriteSize, 220)
      * ensureNumber(platformLayout.width_multiplier, 0.92)
    ).toFixed(3));
    const platformLabels = cells.map((_cell, index) => `introhookplatformsrc${index}`);
    filters.push(
      `[${inputRefs.grassPlatform}:v]fps=${fps},trim=duration=${hook.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${sharedPlatformWidth}:-1:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${platformLabels.length}${platformLabels.map((label) => `[${label}]`).join('')}`,
    );
    cells.forEach((cell, index) => {
      const platformLabel = `introhookplatform${index}`;
      filters.push(
        `[${currentLabel}][${platformLabels[index]}]overlay=x='${cell.center_x}-w/2':y='${platformOverlayY(cell, baseSpriteSize, platformLayout)}-h/2':enable='${formatEnableBetween(0, hook.scene_duration_seconds)}'[${platformLabel}]`,
      );
      currentLabel = platformLabel;
    });
  }

  if (hookPokeballsEnabled && cells.length > 0 && inputRefs?.introPokeball != null) {
    const sharedPokeballSize = Number((
      ensureNumber(baseSpriteSize, 220)
      * Math.max(0.1, ensureNumber(introPokeballScaleMultiplier, 1.04))
    ).toFixed(3));
    const pokeballIntroDuration = Math.max(
      0.12,
      ensureNumber(template?.renderer?.hook_pokeball_intro_duration_seconds, 0.56),
    );
    const pokeballIntroStagger = Math.max(
      0.02,
      ensureNumber(template?.renderer?.hook_pokeball_intro_stagger_seconds, 0.32),
    );
    const pokeballLabels = cells.map((_cell, index) => `introhookpokeballsrc${index}`);
    filters.push(
      `[${inputRefs.introPokeball}:v]fps=${fps},trim=duration=${hook.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${sharedPokeballSize}:${sharedPokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${pokeballLabels.length}${pokeballLabels.map((label) => `[${label}]`).join('')}`,
    );
    cells.forEach((cell, index) => {
      const startSeconds = roundTime(0.1 + (index * pokeballIntroStagger));
      const scaleExpression = buildAnimatedPopSettleExpression(
        startSeconds,
        pokeballIntroDuration,
        0.02,
        1.08,
        1,
        buildScaleFilterTimeExpression({ fps, streamStartSeconds: startSeconds }),
      );
      const animatedLabel = `introhookpokeball${index}`;
      filters.push(
        `[${pokeballLabels[index]}]setpts=PTS-STARTPTS+${startSeconds}/TB,scale=w='${sharedPokeballSize}*(${scaleExpression})':h='${sharedPokeballSize}*(${scaleExpression})':eval=frame,setsar=1[${animatedLabel}]`,
      );
      const overlayLabel = `introhookpokeballv${index}`;
      filters.push(
        `[${currentLabel}][${animatedLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + introPokeballCenterYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(startSeconds, hook.scene_duration_seconds)}'[${overlayLabel}]`,
      );
      currentLabel = overlayLabel;
    });
  }

  filters.push(
    `[${currentLabel}]drawtext=text='${escapeDrawtextText(hook.text)}'${fontPart}:fontcolor=white:fontsize='${textLayout.hook_font_size}*(${hookScaleExpression})':borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(textLayout.hook_y, hook.text_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(hook.text_start_seconds, hook.text_end_seconds)}':enable='${formatEnableBetween(hook.text_start_seconds, hook.text_end_seconds)}'[${textLabel}]`,
  );
  return textLabel;
}

function overlayIntroHookTextOnRound(filters, currentLabel, {
  hook,
  round,
  textLayout,
  fontPart,
  textOutlineWidth,
}) {
  const roundStartSeconds = ensureNumber(round?.scene_start_seconds, 0);
  const candidateIntroStarts = (Array.isArray(round?.candidates) ? round.candidates : [])
    .map((candidate) => ensureNumber(candidate?.intro_start_seconds, Number.POSITIVE_INFINITY) - roundStartSeconds)
    .filter(Number.isFinite);
  const firstPokemonIntroStart = candidateIntroStarts.length > 0
    ? Math.min(...candidateIntroStarts)
    : ensureNumber(hook?.text_end_seconds, 1.2);
  const startSeconds = roundTime(Math.max(0, ensureNumber(hook?.text_start_seconds, 0.04)));
  const configuredEndSeconds = roundTime(Math.max(
    startSeconds + 0.3,
    ensureNumber(hook?.text_end_seconds, firstPokemonIntroStart),
  ));
  const endSeconds = roundTime(Math.max(
    startSeconds + 0.3,
    Math.min(configuredEndSeconds, firstPokemonIntroStart - 0.05),
  ));
  const hookScaleExpression = buildAnimatedPopSettleExpression(
    startSeconds,
    0.32,
    0.62,
    1.16,
    1,
  );
  const hookLabel = 'scene0hookoverlay';
  filters.push(
    `[${currentLabel}]drawtext=text='${escapeDrawtextText(hook.text)}'${fontPart}:fontcolor=white:fontsize='${textLayout.hook_font_size}*(${hookScaleExpression})':borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(textLayout.hook_y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'[${hookLabel}]`,
  );
  return hookLabel;
}

function localizeCandidateTiming(candidate, round) {
  return {
    ...candidate,
    intro_start_seconds: roundTime(candidate.intro_start_seconds - round.scene_start_seconds),
    intro_end_seconds: roundTime(candidate.intro_end_seconds - round.scene_start_seconds),
    pokeball_hold_start_seconds: roundTime(
      ensureNumber(candidate.pokeball_hold_start_seconds, candidate.pokeball_start_seconds) - round.scene_start_seconds,
    ),
    pokeball_start_seconds: roundTime(candidate.pokeball_start_seconds - round.scene_start_seconds),
    pokeball_end_seconds: roundTime(candidate.pokeball_end_seconds - round.scene_start_seconds),
    reveal_start_seconds: roundTime(candidate.reveal_start_seconds - round.scene_start_seconds),
  };
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = null) {
  const filters = [];
  const { width, height, fps } = renderPlan.canvas;
  const fontPart = buildFontPart(fontPath);
  const textOutlineWidth = resolveTextOutlineWidth(template);
  const gridLayout = renderPlan.grid_layout || { cells: [] };
  const timerLayout = renderPlan.timer_layout || {
    x: 210,
    y: 1030,
    width: 660,
    height: 34,
    center_x: 540,
  };
  const roundCount = Math.max(1, renderPlan.rounds.length);
  const backgroundBlurSigma = Math.max(0, ensureNumber(template?.layout?.background?.blur_sigma, 0));
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
  const introFormingEnabled = template?.renderer?.candidate_forming_enabled !== false;
  const introFormingDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.candidate_forming_duration_seconds, 1),
  );
  const introPokeballScaleMultiplier = Math.max(
    0.1,
    ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.04),
  );
  const heldPokeballScaleMultiplier = Math.max(
    0.1,
    ensureNumber(
      template?.renderer?.held_pokeball_scale_multiplier,
      introPokeballScaleMultiplier,
    ),
  );
  const heldPokeballIntroDuration = Math.max(
    0.12,
    ensureNumber(template?.renderer?.held_pokeball_intro_duration_seconds, 0.56),
  );
  const heldPokeballWiggleAmplitudeRadians = Math.max(
    0,
    ensureNumber(template?.renderer?.held_pokeball_wiggle_amplitude_radians, 0.12),
  );
  const heldPokeballWiggleFrequencyHz = Math.max(
    0.1,
    ensureNumber(template?.renderer?.held_pokeball_wiggle_frequency_hz, 1.35),
  );
  const heldPokeballWiggleHorizontalAmplitudePx = Math.max(
    0,
    ensureNumber(template?.renderer?.held_pokeball_wiggle_horizontal_amplitude_px, 24),
  );
  const heldPokeballWiggleMomentumStrength = Math.max(
    0,
    Math.min(
      1,
      ensureNumber(template?.renderer?.held_pokeball_wiggle_momentum_strength, 0),
    ),
  );
  const introPokeballCenterYOffset = ensureNumber(
    template?.renderer?.intro_pokeball_center_y_offset_px,
    0,
  );
  const heldPokeballSourceStartSeconds = Math.max(
    0,
    ensureNumber(template?.renderer?.held_pokeball_source_start_seconds, 0),
  );
  const statRevealFadeDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.stat_reveal_fade_duration_seconds, 0.22),
  );
  const decoyGrayFadeDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.decoy_grayscale_fade_duration_seconds, 0.22),
  );
  const decoyGrayscaleEnabled = template?.reveal?.decoy_grayscale_enabled !== false;
  const holdPokeballsUntilReveal = template?.renderer?.hold_pokeballs_until_reveal === true;
  const revealPokeballOverlayEnabled = template?.renderer?.reveal_pokeball_overlay_enabled !== false;
  const hookBaseSpriteSize = Number((
    ensureNumber(gridLayout.item_size_px, 220)
    * ensureNumber(gridLayout.sprite_scale_multiplier, 1)
  ).toFixed(3));

  const hasIntroHook = Boolean(renderPlan?.intro_hook?.enabled);
  const hookOverlayFirstRound = hasIntroHook && (
    renderPlan?.intro_hook?.overlay_first_round === true
    || renderPlan?.renderer?.hook_overlay_first_round === true
  );
  const hasSeparateIntroHook = hasIntroHook && !hookOverlayFirstRound;
  const hookBackgroundLabel = hasSeparateIntroHook ? 'bghook' : null;
  const backgroundLabels = Array.from({ length: roundCount }, (_unused, index) => `bg${index}`);
  const allBackgroundLabels = [
    ...(hasSeparateIntroHook ? [hookBackgroundLabel] : []),
    ...backgroundLabels,
  ];
  const backgroundPreparationFilter = buildBackgroundPreparationFilter({
    inputRef: inputRefs.background,
    width,
    height,
    fps,
    blurSigma: backgroundBlurSigma,
    template,
  });
  filters.push(
    `${backgroundPreparationFilter},split=${allBackgroundLabels.length}${allBackgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  const shinySparkleEnabled = plan.shiny_reveal?.active && inputRefs.shinySparkle != null;
  const shinySparkleEntries = [];
  const shinySparkleBaseLabels = new Map();
  if (shinySparkleEnabled) {
    renderPlan.rounds.forEach((round, roundIndex) => {
      for (const candidate of Array.isArray(round.candidates) ? round.candidates : []) {
        if (candidate?.subject?.is_shiny_variant !== true) {
          continue;
        }
        const key = `${roundIndex}:${candidate.index}`;
        const label = `scene${roundIndex}sparklebase${candidate.index}`;
        shinySparkleEntries.push({ key, label });
        shinySparkleBaseLabels.set(key, label);
      }
    });
  }
  if (shinySparkleEntries.length > 0) {
    filters.push(
      `[${inputRefs.shinySparkle}:v]fps=${fps},format=rgba,setsar=1,split=${shinySparkleEntries.length}${shinySparkleEntries.map((entry) => `[${entry.label}]`).join('')}`,
    );
  }

  const introHookSceneLabel = hasSeparateIntroHook
    ? buildIntroHookScene(filters, {
      backgroundLabel: hookBackgroundLabel,
      hook: renderPlan.intro_hook,
      template,
      inputRefs,
      gridLayout,
      platformLayout,
      baseSpriteSize: hookBaseSpriteSize,
      fps,
      introPokeballScaleMultiplier,
      introPokeballCenterYOffset,
      textLayout: renderPlan.text_layout,
      fontPart,
      textOutlineWidth,
    })
    : null;

  renderPlan.rounds.forEach((round, roundIndex) => {
    const roundInputs = inputRefs.rounds[roundIndex] || { candidates: [] };
    const sceneBaseLabel = `scene${roundIndex}b`;
    const backgroundStartSeconds = roundTime(Math.max(
      0,
      ensureNumber(round.scene_start_seconds, 0),
    ));
    const backgroundTrimFilter = backgroundStartSeconds > 0
      ? `trim=start=${backgroundStartSeconds}:duration=${round.scene_duration_seconds}`
      : `trim=duration=${round.scene_duration_seconds}`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]${backgroundTrimFilter},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
    );

    let currentLabel = sceneBaseLabel;
    if (template?.layout?.text?.show_counter !== false) {
      currentLabel = overlayCounterText(
        filters,
        sceneBaseLabel,
        roundIndex,
        round,
        renderPlan.text_layout,
        width,
        fontPart,
        textOutlineWidth,
      );
    }

    buildPromptSegments(round.prompt_text, template, renderPlan.text_layout, round, timerLayout)
      .forEach((segment, segmentIndex) => {
        if (Array.isArray(segment.parts) && segment.parts.length > 0) {
          let segmentLabel = currentLabel;
          segment.parts.forEach((part, partIndex) => {
            const promptLabel = `scene${roundIndex}prompt${segmentIndex}part${partIndex}`;
            filters.push(
              `[${segmentLabel}]drawtext=text='${escapeDrawtextText(part.text)}'${fontPart}:fontcolor=${part.color || 'white'}:fontsize=${part.font_size}:borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x='${buildCenteredPromptPartX(segment.parts, segment.part_gap_px, partIndex)}':y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${promptLabel}]`,
            );
            segmentLabel = promptLabel;
          });
          currentLabel = segmentLabel;
          return;
        }

        const promptLabel = `scene${roundIndex}prompt${segmentIndex}`;
        filters.push(
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(segment.text)}'${fontPart}:fontcolor=${segment.color || 'white'}:fontsize=${segment.font_size}:borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(segment.y, segment.start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(segment.start_seconds, segment.end_seconds)}':enable='${formatEnableBetween(segment.start_seconds, segment.end_seconds)}'[${promptLabel}]`,
        );
        currentLabel = promptLabel;
      });

    const baseSpriteSize = Number((
      ensureNumber(gridLayout.item_size_px, 220)
      * ensureNumber(gridLayout.sprite_scale_multiplier, 1)
    ).toFixed(3));
    const sharedPlatformWidth = Number((baseSpriteSize * platformLayout.width_multiplier).toFixed(3));
    const sharedPokeballSize = Number((baseSpriteSize * introPokeballScaleMultiplier).toFixed(3));
    const heldPokeballSize = Number((baseSpriteSize * heldPokeballScaleMultiplier).toFixed(3));
    const heldPokeballCanvasSize = Math.max(
      2,
      Math.ceil((heldPokeballSize * 1.4) / 2) * 2,
    );
    const roundSharedPlatformLabels = Array.from(
      { length: round.candidates.length },
      (_unused, index) => `scene${roundIndex}sharedplatform${index}`,
    );
    if (inputRefs.grassPlatform != null && platformLayout.enabled && roundSharedPlatformLabels.length > 0) {
      filters.push(
        `[${inputRefs.grassPlatform}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${sharedPlatformWidth}:-1:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${roundSharedPlatformLabels.length}${roundSharedPlatformLabels.map((label) => `[${label}]`).join('')}`,
      );
    }

    const roundSharedPokeballLabels = holdPokeballsUntilReveal
      ? []
      : Array.from(
        { length: round.candidates.length },
        (_unused, index) => `scene${roundIndex}sharedpokeball${index}`,
      );
    if (inputRefs.introPokeball != null && roundSharedPokeballLabels.length > 0) {
      filters.push(
        `[${inputRefs.introPokeball}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${sharedPokeballSize}:${sharedPokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${roundSharedPokeballLabels.length}${roundSharedPokeballLabels.map((label) => `[${label}]`).join('')}`,
      );
    }
    const decoyGrayCandidates = [];

    for (const [candidateLoopIndex, candidateValue] of round.candidates.entries()) {
      const candidate = localizeCandidateTiming(candidateValue, round);
      const cell = gridLayout.cells[candidate.index];
      const sharedPlatformLabel = roundSharedPlatformLabels[candidateLoopIndex] || null;
      const sharedPokeballLabel = roundSharedPokeballLabels[candidateLoopIndex] || null;
      const platformVisibleStart = Number(ensureNumber(
        round.local.activation_start_seconds,
        0,
      ).toFixed(3));
      if (inputRefs.grassPlatform != null && platformLayout.enabled) {
        const platformOverlayLabel = `scene${roundIndex}platformv${candidate.index}`;
        filters.push(
          `[${currentLabel}][${sharedPlatformLabel}]overlay=x='${cell.center_x}-w/2':y='${platformOverlayY(cell, baseSpriteSize, platformLayout)}-h/2':enable='${formatEnableBetween(platformVisibleStart, round.local.scene_duration_seconds)}'[${platformOverlayLabel}]`,
        );
        currentLabel = platformOverlayLabel;
      }

      const staticPokeballHoldInputIndex = roundInputs.pokeball_hold_sprites?.[candidate.index];
      const hasStaticPokeballHold = holdPokeballsUntilReveal && staticPokeballHoldInputIndex != null;
      if ((inputRefs.introPokeball != null && revealPokeballOverlayEnabled) || hasStaticPokeballHold) {
        let pokeballSourceLabel = sharedPokeballLabel;
        if (holdPokeballsUntilReveal) {
          const holdLabel = `scene${roundIndex}pokeballhold${candidate.index}`;
          const holdOverlayLabel = `scene${roundIndex}pokeballholdv${candidate.index}`;
          let holdXExpression = `${cell.center_x}-w/2`;
          const holdStart = Number(Math.max(
            platformVisibleStart,
            ensureNumber(candidate.pokeball_hold_start_seconds, platformVisibleStart),
          ).toFixed(3));
          const holdEnd = Number(Math.max(
            holdStart + 0.08,
            hasStaticPokeballHold ? candidate.intro_start_seconds : candidate.pokeball_start_seconds,
          ).toFixed(3));
          const holdDuration = Number(Math.max(0.08, holdEnd - holdStart).toFixed(3));
          if (hasStaticPokeballHold) {
            const heldPokeballWiggleSpeedMultiplier = Math.max(
              0.5,
              Math.min(
                1.5,
                ensureNumber(candidate?.pokeball_wiggle_speed_multiplier, 1),
              ),
            );
            const candidateWiggleFrequencyHz = (
              heldPokeballWiggleFrequencyHz * heldPokeballWiggleSpeedMultiplier
            );
            const candidateWiggleDirectionMultiplier = (
              ensureNumber(candidate?.pokeball_wiggle_direction_multiplier, 1) < 0 ? -1 : 1
            );
            const holdScaleTimeExpression = buildScaleFilterTimeExpression({
              fps,
              streamStartSeconds: holdStart,
            });
            const holdScaleExpression = buildAnimatedPopSettleExpression(
              holdStart,
              heldPokeballIntroDuration,
              0.02,
              1.08,
              1,
              holdScaleTimeExpression,
            );
            const wiggleStart = roundTime(Math.min(
              holdEnd,
              holdStart + heldPokeballIntroDuration,
            ));
            const holdWiggleExpression = buildHeldPokeballWiggleValueExpression({
              startSeconds: wiggleStart,
              amplitude: heldPokeballWiggleAmplitudeRadians,
              frequencyHz: candidateWiggleFrequencyHz,
              momentumStrength: heldPokeballWiggleMomentumStrength,
              directionMultiplier: candidateWiggleDirectionMultiplier,
              timeExpression: holdScaleTimeExpression,
            });
            const holdHorizontalWiggleExpression = buildHeldPokeballWiggleValueExpression({
              startSeconds: wiggleStart,
              amplitude: heldPokeballWiggleHorizontalAmplitudePx,
              frequencyHz: candidateWiggleFrequencyHz,
              momentumStrength: heldPokeballWiggleMomentumStrength,
              directionMultiplier: candidateWiggleDirectionMultiplier,
              timeExpression: 't',
            });
            holdXExpression = `${cell.center_x}-w/2+(${holdHorizontalWiggleExpression})`;
            filters.push(
              `[${staticPokeballHoldInputIndex}:v]fps=${fps},trim=duration=${holdDuration},setpts=PTS-STARTPTS+${holdStart}/TB,scale=w='${heldPokeballSize}*(${holdScaleExpression})':h='${heldPokeballSize}*(${holdScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,pad=${heldPokeballCanvasSize}:${heldPokeballCanvasSize}:(ow-iw)/2:(oh-ih)/2:color=black@0:eval=frame,rotate='${holdWiggleExpression}':ow=iw:oh=ih:c=none,setsar=1[${holdLabel}]`,
            );
          } else {
            const holdIntroDuration = Math.max(
              0.12,
              ensureNumber(template?.renderer?.hook_pokeball_intro_duration_seconds, 0.56),
            );
            const holdScaleExpression = buildAnimatedPopSettleExpression(
              holdStart,
              holdIntroDuration,
              0.02,
              1.08,
              1,
              buildScaleFilterTimeExpression({ fps, streamStartSeconds: holdStart }),
            );
            const holdTrimFilter = heldPokeballSourceStartSeconds > 0
              ? `trim=start=${heldPokeballSourceStartSeconds}:duration=${holdDuration}`
              : `trim=duration=${holdDuration}`;
            filters.push(
              `[${inputRefs.introPokeball}:v]fps=${fps},${holdTrimFilter},setpts=PTS-STARTPTS+${holdStart}/TB,scale=w='${sharedPokeballSize}*(${holdScaleExpression})':h='${sharedPokeballSize}*(${holdScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${holdLabel}]`,
            );
          }
          filters.push(
            `[${currentLabel}][${holdLabel}]overlay=x='${holdXExpression}':y='${Number((cell.center_y + introPokeballCenterYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(holdStart, holdEnd)}'[${holdOverlayLabel}]`,
          );
          currentLabel = holdOverlayLabel;
          pokeballSourceLabel = null;
        }
        if (inputRefs.introPokeball != null && revealPokeballOverlayEnabled) {
          const pokeballLabel = `scene${roundIndex}pokeball${candidate.index}`;
          const pokeballOverlayLabel = `scene${roundIndex}pokeballv${candidate.index}`;
          const pokeballDuration = Number(Math.max(
            0.08,
            candidate.pokeball_end_seconds - candidate.pokeball_start_seconds,
          ).toFixed(3));
          if (pokeballSourceLabel) {
            filters.push(
              `[${pokeballSourceLabel}]trim=duration=${pokeballDuration},setpts=PTS-STARTPTS+${Number(candidate.pokeball_start_seconds.toFixed(3))}/TB,format=rgba,setsar=1[${pokeballLabel}]`,
            );
          } else {
            filters.push(
              `[${inputRefs.introPokeball}:v]fps=${fps},trim=duration=${pokeballDuration},setpts=PTS-STARTPTS+${Number(candidate.pokeball_start_seconds.toFixed(3))}/TB,scale=${sharedPokeballSize}:${sharedPokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${pokeballLabel}]`,
            );
          }
          filters.push(
            `[${currentLabel}][${pokeballLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + introPokeballCenterYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(candidate.pokeball_start_seconds, candidate.pokeball_end_seconds)}'[${pokeballOverlayLabel}]`,
          );
          currentLabel = pokeballOverlayLabel;
        }
      }

      const candidateInputIndex = roundInputs.candidates?.[candidate.index];

      if (candidateInputIndex == null) {
        continue;
      }
      const spriteRawLabel = `scene${roundIndex}spriteraw${candidate.index}`;
      const spritePreparedLabel = `scene${roundIndex}spriteprep${candidate.index}`;
      const spriteIntroInputLabel = `scene${roundIndex}spriteintrosrc${candidate.index}`;
      const spriteSettledInputLabel = `scene${roundIndex}spritesettledsrc${candidate.index}`;
      const spriteGrayInputLabel = `scene${roundIndex}spritegraybase${candidate.index}`;
      const spriteOverlayLabel = `scene${roundIndex}spritev${candidate.index}`;
      const settledSpriteLabel = `scene${roundIndex}settled${candidate.index}`;
      const isStillSpriteFallback = Boolean(roundInputs.still_candidates?.[candidate.index]);
      const spriteScaleExpression = buildAnimatedPopSettleExpression(
        candidate.intro_start_seconds,
        introDuration,
        introScaleInitial,
        introScalePeak,
        introScaleSettle,
      );
      const spriteYExpression = buildAnimatedTextYExpression(
        Number((cell.center_y + gridSpriteYOffset).toFixed(3)),
        candidate.intro_start_seconds,
      );
      const settledSpriteBaseY = Number((cell.center_y + gridSpriteYOffset).toFixed(3));
      const settledSpriteYOffsetExpression = isStillSpriteFallback
        ? `-${buildStaticSpriteWobbleExpression(round, candidate, template)}`
        : '';
      const shouldCreateGraySprite = !candidate.is_correct && decoyGrayscaleEnabled;
      const spriteSplitLabels = shouldCreateGraySprite
        ? `[${spriteIntroInputLabel}][${spriteSettledInputLabel}][${spriteGrayInputLabel}]`
        : `[${spriteIntroInputLabel}][${spriteSettledInputLabel}]`;
      filters.push(
        `[${candidateInputIndex}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,format=rgba,setsar=1[${spriteRawLabel}]`,
      );
      if (introFormingEnabled) {
        appendFormingSpriteFilters(filters, {
          inputLabel: spriteRawLabel,
          outputLabel: spritePreparedLabel,
          workingLabelPrefix: `scene${roundIndex}spriteform${candidate.index}`,
          startSeconds: candidate.intro_start_seconds,
          durationSeconds: introFormingDuration,
        });
      } else {
        filters.push(
          `[${spriteRawLabel}]null[${spritePreparedLabel}]`,
        );
      }
      filters.push(
        `[${spritePreparedLabel}]scale=w='${baseSpriteSize}*(${spriteScaleExpression})':h='${baseSpriteSize}*(${spriteScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${shouldCreateGraySprite ? 3 : 2}${spriteSplitLabels}`,
      );
      filters.push(
        `[${currentLabel}][${spriteIntroInputLabel}]overlay=x='${cell.center_x}-w/2':y='${spriteYExpression}+${introYOffset}-h/2':enable='${formatEnableBetween(candidate.intro_start_seconds, candidate.intro_end_seconds)}'[${spriteOverlayLabel}]`,
      );
      currentLabel = spriteOverlayLabel;
      filters.push(
        `[${currentLabel}][${spriteSettledInputLabel}]overlay=x='${cell.center_x}-w/2':y='${settledSpriteBaseY}${settledSpriteYOffsetExpression}-h/2':enable='${formatEnableBetween(candidate.intro_end_seconds, round.local.scene_duration_seconds)}'[${settledSpriteLabel}]`,
      );
      currentLabel = settledSpriteLabel;

      const sparkleBaseLabel = shinySparkleBaseLabels.get(`${roundIndex}:${candidate.index}`);
      if (sparkleBaseLabel) {
        const sparkleDuration = Math.max(
          0.12,
          ensureNumber(
            plan.assets.overlays?.selected_shiny_sparkle_duration_seconds,
            ensureNumber(plan.shiny_reveal?.sparkle_duration_seconds, 0.9),
          ),
        );
        const sparkleStart = Number(candidate.intro_start_seconds.toFixed(3));
        const sparkleEnd = Number(Math.min(
          round.local.scene_duration_seconds,
          sparkleStart + sparkleDuration,
        ).toFixed(3));
        const sparkleSize = Number((
          baseSpriteSize
          * Math.max(
            1,
            ensureNumber(
              plan.shiny_reveal?.sparkle_scale_multiplier,
              DEFAULT_SHINY_SPARKLE_SCALE_MULTIPLIER,
            ),
          )
        ).toFixed(3));
        const sparklePreparedLabel = `scene${roundIndex}sparkle${candidate.index}`;
        const sparkleOverlayLabel = `scene${roundIndex}sparklev${candidate.index}`;
        filters.push(
          `[${sparkleBaseLabel}]trim=duration=${sparkleDuration},setpts=PTS-STARTPTS+${sparkleStart}/TB,scale=${sparkleSize}:${sparkleSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${sparklePreparedLabel}]`,
        );
        filters.push(
          `[${currentLabel}][${sparklePreparedLabel}]overlay=x='${cell.center_x}-w/2':y='${settledSpriteBaseY}-h/2':enable='${formatEnableBetween(sparkleStart, sparkleEnd)}'[${sparkleOverlayLabel}]`,
        );
        currentLabel = sparkleOverlayLabel;
      }

      if (shouldCreateGraySprite) {
        decoyGrayCandidates.push({
          candidate,
          cell,
          grayInputLabel: spriteGrayInputLabel,
        });
      }
    }

    const roundHeadlineEnabled = template?.layout?.text?.round_headline?.enabled === true;
    if (roundIndex === 0 && hookOverlayFirstRound && !roundHeadlineEnabled) {
      currentLabel = overlayIntroHookTextOnRound(filters, currentLabel, {
        hook: renderPlan.intro_hook,
        round,
        textLayout: renderPlan.text_layout,
        fontPart,
        textOutlineWidth,
      });
    }

    currentLabel = appendRoundHeadline(filters, currentLabel, {
      roundIndex,
      round,
      template,
      fontPart,
      textOutlineWidth,
    });

    const timerVisibleStartSeconds = template?.layout?.timer?.show_before_countdown === true
      ? round.local.activation_start_seconds
      : round.local.countdown_start_seconds;
    const timerOuterBorderThickness = 4;
    const timerInnerBorderInset = 2;
    const timerOuterLabel = `scene${roundIndex}tb0o`;
    appendRoundedRectSource(filters, {
      label: timerOuterLabel,
      color: 'black',
      alpha: 0.74,
      width: timerLayout.width + (timerOuterBorderThickness * 2),
      height: timerLayout.height + (timerOuterBorderThickness * 2),
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
    });
    filters.push(
      `[${currentLabel}][${timerOuterLabel}]overlay=x=${timerLayout.x - timerOuterBorderThickness}:y=${timerLayout.y - timerOuterBorderThickness}:enable='${formatEnableBetween(timerVisibleStartSeconds, round.local.reveal_start_seconds)}'[scene${roundIndex}tb0]`,
    );
    currentLabel = `scene${roundIndex}tb0`;
    const timerInnerGlowLabel = `scene${roundIndex}tb0i`;
    appendRoundedRectSource(filters, {
      label: timerInnerGlowLabel,
      color: 'white',
      alpha: 0.10,
      width: timerLayout.width - (timerInnerBorderInset * 2),
      height: timerLayout.height - (timerInnerBorderInset * 2),
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
    });
    filters.push(
      `[${currentLabel}][${timerInnerGlowLabel}]overlay=x=${timerLayout.x + timerInnerBorderInset}:y=${timerLayout.y + timerInnerBorderInset}:enable='${formatEnableBetween(timerVisibleStartSeconds, round.local.reveal_start_seconds)}'[scene${roundIndex}tb0g]`,
    );
    currentLabel = `scene${roundIndex}tb0g`;
    const timerRailLabel = `scene${roundIndex}tb0r`;
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
    appendRoundedRectSource(filters, {
      label: timerRailLabel,
      color: 'black',
      alpha: 0.38,
      width: timerLayout.width,
      height: timerLayout.height,
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
    });
    filters.push(
      `[${currentLabel}][${timerRailLabel}]overlay=x=${timerLayout.x}:y=${timerLayout.y}:enable='${formatEnableBetween(timerVisibleStartSeconds, round.local.reveal_start_seconds)}'[scene${roundIndex}tb0rail]`,
    );
    currentLabel = `scene${roundIndex}tb0rail`;

    currentLabel = appendTimerBarPhase(filters, currentLabel, {
      labelPrefix: `scene${roundIndex}tb1`,
      fps,
      sceneDurationSeconds: round.scene_duration_seconds,
      timerLayout,
      timerBarScaleExpression,
      enableStartSeconds: timerVisibleStartSeconds,
      enableEndSeconds: greenEnd,
      baseColor: '0x32D74B',
      glowColor: '0x2EEA78',
      accentColor: '0xB8FFD0',
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
      glowColor: '0xFFE45C',
      accentColor: '0xFFF3A8',
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
      glowColor: '0xFF7B74',
      accentColor: '0xFFB2AC',
    });

    decoyGrayCandidates.forEach(({ candidate, cell, grayInputLabel }) => {
      const grayLabel = `scene${roundIndex}gray${candidate.index}`;
      const grayOverlayLabel = `scene${roundIndex}grayv${candidate.index}`;
      filters.push(
        `[${grayInputLabel}]format=rgba,eq=saturation=0:brightness=-0.42:contrast=1.22,setsar=1,colorchannelmixer=aa=0.94,fade=t=in:st=${round.local.reveal_visual_start_seconds}:d=${decoyGrayFadeDuration}:alpha=1[${grayLabel}]`,
      );
      filters.push(
        `[${currentLabel}][${grayLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + gridSpriteYOffset).toFixed(3))}${Boolean(roundInputs.still_candidates?.[candidate.index]) ? `-${buildStaticSpriteWobbleExpression(round, candidate, template)}` : ''}-h/2':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${grayOverlayLabel}]`,
      );
      currentLabel = grayOverlayLabel;
    });

    const finalPromptLabel = appendFinalPrompt(filters, currentLabel, {
      roundIndex,
      round,
      template,
      timerLayout,
      fontPart,
      textOutlineWidth,
    });
    if (finalPromptLabel) {
      currentLabel = finalPromptLabel;
    } else {
      const revealArtifacts = buildRevealArtifacts(
        round.reveal_text,
        template,
        renderPlan.text_layout,
        round,
      );
      revealArtifacts.lines.forEach((line, lineIndex) => {
        const revealLabel = `scene${roundIndex}reveal${lineIndex}`;
        filters.push(
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(line.text)}'${fontPart}:fontcolor=white:fontsize=${line.font_size}:borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(line.y, round.local.reveal_visual_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${revealLabel}]`,
        );
        currentLabel = revealLabel;
      });
    }

    if (renderPlan.stat_value_layout?.enabled !== false) {
      for (const candidateValue of round.candidates) {
        const candidate = localizeCandidateTiming(candidateValue, round);
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
          `[${currentLabel}]drawtext=text='${escapeDrawtextText(candidate.stat_value)}'${fontPart}:fontcolor=${statColor}:fontsize=${renderPlan.stat_value_layout.font_size}:borderw=${textOutlineWidth}:bordercolor=black:fix_bounds=1:x=${cell.center_x}-text_w/2:y='${buildAnimatedTextYExpression(statY, round.local.reveal_visual_start_seconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(round.local.reveal_visual_start_seconds, round.local.reveal_visual_start_seconds + statRevealFadeDuration)}':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${statLabel}]`,
        );
        currentLabel = statLabel;
      }
    }

    filters.push(`[${currentLabel}]setsar=1[scene${roundIndex}]`);
  });

  let currentSceneOutput = 'scene0';
  let firstRoundIndex = 1;
  if (introHookSceneLabel) {
    const hookOutputLabel = 'sceneout0';
    filters.push(
      `[${introHookSceneLabel}][scene0]xfade=transition=slideleft:duration=${renderPlan.intro_hook.transition_duration_seconds}:offset=${renderPlan.rounds[0].scene_start_seconds}[${hookOutputLabel}]`,
    );
    currentSceneOutput = hookOutputLabel;
    firstRoundIndex = 1;
  }
  for (let roundIndex = firstRoundIndex; roundIndex < renderPlan.rounds.length; roundIndex += 1) {
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
