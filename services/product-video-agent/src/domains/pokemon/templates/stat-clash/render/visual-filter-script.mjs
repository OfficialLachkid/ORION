import {
  buildAnimatedLerpExpression,
  buildAnimatedPopSettleExpression,
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';
import {
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
  const largeFontSize = Math.round(textLayout.prompt_font_size * 1.1);
  const mediumFontSize = Math.round(textLayout.prompt_font_size * 0.96);
  const lineGap = Math.max(10, Math.round(textLayout.prompt_font_size * 0.12));
  const lowerLineY = Number((baseY + mediumFontSize + lineGap).toFixed(3));

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
      return [
        {
          text: 'Special',
          font_size: mediumFontSize,
          y: baseY,
          start_seconds: startSeconds,
          end_seconds: endSeconds,
          color: '0xFFD60A',
        },
        {
          text: 'Attack?',
          font_size: largeFontSize,
          y: lowerLineY,
          start_seconds: startSeconds,
          end_seconds: endSeconds,
          color: '0xFF5A5F',
        },
      ];
    case 'special_defense':
      return [
        {
          text: 'Special',
          font_size: mediumFontSize,
          y: baseY,
          start_seconds: startSeconds,
          end_seconds: endSeconds,
          color: '0xFFD60A',
        },
        {
          text: 'Defense?',
          font_size: largeFontSize,
          y: lowerLineY,
          start_seconds: startSeconds,
          end_seconds: endSeconds,
          color: '0x4D96FF',
        },
      ];
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
  const highlightHeight = Math.max(4, Math.round(timerHeight * 0.34));
  const highlightY = Number((timerLayout.y + 2).toFixed(3));
  const accentHeight = Math.max(6, Math.round(timerHeight * 0.42));
  const accentY = Number((timerLayout.y + Math.round(timerHeight * 0.24)).toFixed(3));
  const shadowHeight = Math.max(3, Math.round(timerHeight * 0.18));
  const shadowY = Number((timerLayout.y + timerHeight - shadowHeight - 2).toFixed(3));

  const glowSourceLabel = `${labelPrefix}glowsrc`;
  filters.push(
    `color=c=${glowColor}@0.30:s=${timerWidth}x${glowHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,boxblur=6:2,scale=w='${timerBarScaleExpression}':h=${glowHeight}:eval=frame[${glowSourceLabel}]`,
  );
  const glowOverlayLabel = `${labelPrefix}glow`;
  filters.push(
    `[${currentLabel}][${glowSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${glowY}:enable='${enableExpression}'[${glowOverlayLabel}]`,
  );

  const baseSourceLabel = `${labelPrefix}src`;
  filters.push(
    `color=c=${baseColor}@0.98:s=${timerWidth}x${timerHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${timerHeight}:eval=frame[${baseSourceLabel}]`,
  );
  const baseOverlayLabel = `${labelPrefix}base`;
  filters.push(
    `[${glowOverlayLabel}][${baseSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${timerLayout.y}:enable='${enableExpression}'[${baseOverlayLabel}]`,
  );

  const accentSourceLabel = `${labelPrefix}accsrc`;
  filters.push(
    `color=c=${accentColor}@0.36:s=${timerWidth}x${accentHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${accentHeight}:eval=frame[${accentSourceLabel}]`,
  );
  const accentOverlayLabel = `${labelPrefix}acc`;
  filters.push(
    `[${baseOverlayLabel}][${accentSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${accentY}:enable='${enableExpression}'[${accentOverlayLabel}]`,
  );

  const highlightSourceLabel = `${labelPrefix}hlsrc`;
  filters.push(
    `color=c=white@0.18:s=${timerWidth}x${highlightHeight}:r=${fps}:d=${sceneDurationSeconds},format=rgba,trim=duration=${sceneDurationSeconds},setpts=PTS-STARTPTS,scale=w='${timerBarScaleExpression}':h=${highlightHeight}:eval=frame[${highlightSourceLabel}]`,
  );
  const highlightOverlayLabel = `${labelPrefix}hl`;
  filters.push(
    `[${accentOverlayLabel}][${highlightSourceLabel}]overlay=x='${timerLayout.center_x}-overlay_w/2':y=${highlightY}:enable='${enableExpression}'[${highlightOverlayLabel}]`,
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
  const startSeconds = ensureNumber(round?.local?.prompt_start_seconds, 0.04);
  const endSeconds = ensureNumber(round?.local?.reveal_start_seconds, startSeconds + 1);
  const headerText = extractPromptHeaderText(text, round);
  const headerFontSize = Math.max(64, Math.round(textLayout.prompt_font_size * 0.82));
  const lineHeight = headerFontSize + 12;
  const wrappedHeaderLines = wrapPromptTextLines(
    headerText,
    estimateWrapCharacterLimit(template, headerFontSize),
    2,
  );
  const headerLines = wrappedHeaderLines.map((line, index) => ({
    text: line,
    font_size: headerFontSize,
    y: textLayout.prompt_y + (index * lineHeight),
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    color: 'white',
  }));
  const lastHeaderLine = headerLines.at(-1);
  const statBaseY = Number((
    (lastHeaderLine?.y ?? textLayout.prompt_y)
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

function localizeCandidateTiming(candidate, round) {
  return {
    ...candidate,
    intro_start_seconds: roundTime(candidate.intro_start_seconds - round.scene_start_seconds),
    intro_end_seconds: roundTime(candidate.intro_end_seconds - round.scene_start_seconds),
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
  const introFormingEnabled = template?.renderer?.candidate_forming_enabled !== false;
  const introFormingDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.candidate_forming_duration_seconds, 1),
  );
  const introPokeballScaleMultiplier = Math.max(
    0.1,
    ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.04),
  );
  const introPokeballCenterYOffset = ensureNumber(
    template?.renderer?.intro_pokeball_center_y_offset_px,
    0,
  );
  const statRevealFadeDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.stat_reveal_fade_duration_seconds, 0.22),
  );
  const decoyGrayFadeDuration = Math.max(
    0.08,
    ensureNumber(template?.renderer?.decoy_grayscale_fade_duration_seconds, 0.22),
  );

  const backgroundLabels = Array.from({ length: roundCount }, (_unused, index) => `bg${index}`);
  filters.push(
    `[${inputRefs.background}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},${backgroundFilter}fps=${fps},setsar=1,split=${roundCount}${backgroundLabels.map((label) => `[${label}]`).join('')}`,
  );

  renderPlan.rounds.forEach((round, roundIndex) => {
    const roundInputs = inputRefs.rounds[roundIndex] || { candidates: [] };
    const sceneBaseLabel = `scene${roundIndex}b`;
    filters.push(
      `[${backgroundLabels[roundIndex]}]trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS[${sceneBaseLabel}]`,
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

    buildPromptSegments(round.prompt_text, template, renderPlan.text_layout, round)
      .forEach((segment, segmentIndex) => {
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
    const roundSharedPlatformLabels = Array.from(
      { length: round.candidates.length },
      (_unused, index) => `scene${roundIndex}sharedplatform${index}`,
    );
    if (inputRefs.grassPlatform != null && platformLayout.enabled && roundSharedPlatformLabels.length > 0) {
      filters.push(
        `[${inputRefs.grassPlatform}:v]fps=${fps},trim=duration=${round.scene_duration_seconds},setpts=PTS-STARTPTS,scale=${sharedPlatformWidth}:-1:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${roundSharedPlatformLabels.length}${roundSharedPlatformLabels.map((label) => `[${label}]`).join('')}`,
      );
    }

    const roundSharedPokeballLabels = Array.from(
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

      if (inputRefs.introPokeball != null) {
        const pokeballLabel = `scene${roundIndex}pokeball${candidate.index}`;
        const pokeballOverlayLabel = `scene${roundIndex}pokeballv${candidate.index}`;
        const pokeballDuration = Number(Math.max(
          0.08,
          candidate.pokeball_end_seconds - candidate.pokeball_start_seconds,
        ).toFixed(3));
        filters.push(
          `[${sharedPokeballLabel}]trim=duration=${pokeballDuration},setpts=PTS-STARTPTS+${Number(candidate.pokeball_start_seconds.toFixed(3))}/TB,format=rgba,setsar=1[${pokeballLabel}]`,
        );
        filters.push(
          `[${currentLabel}][${pokeballLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + introPokeballCenterYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(candidate.pokeball_start_seconds, candidate.pokeball_end_seconds)}'[${pokeballOverlayLabel}]`,
        );
        currentLabel = pokeballOverlayLabel;
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
      const spriteSplitLabels = candidate.is_correct
        ? `[${spriteIntroInputLabel}][${spriteSettledInputLabel}]`
        : `[${spriteIntroInputLabel}][${spriteSettledInputLabel}][${spriteGrayInputLabel}]`;
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
        `[${spritePreparedLabel}]scale=w='${baseSpriteSize}*(${spriteScaleExpression})':h='${baseSpriteSize}*(${spriteScaleExpression})':eval=frame:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${candidate.is_correct ? 2 : 3}${spriteSplitLabels}`,
      );
      filters.push(
        `[${currentLabel}][${spriteIntroInputLabel}]overlay=x='${cell.center_x}-w/2':y='${spriteYExpression}+${introYOffset}-h/2':enable='${formatEnableBetween(candidate.intro_start_seconds, candidate.intro_end_seconds)}'[${spriteOverlayLabel}]`,
      );
      currentLabel = spriteOverlayLabel;
      filters.push(
        `[${currentLabel}][${spriteSettledInputLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + gridSpriteYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(candidate.intro_end_seconds, round.local.scene_duration_seconds)}'[${settledSpriteLabel}]`,
      );
      currentLabel = settledSpriteLabel;

      if (!candidate.is_correct) {
        decoyGrayCandidates.push({
          candidate,
          cell,
          grayInputLabel: spriteGrayInputLabel,
        });
      }
    }

    const timerOuterBorderThickness = 4;
    const timerInnerBorderInset = 2;
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
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=black@0.38:t=fill:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerRailLabel}]`,
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

    const timerBorderOuterLabel = `scene${roundIndex}tb4o`;
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x - timerOuterBorderThickness}:y=${timerLayout.y - timerOuterBorderThickness}:w=${timerLayout.width + (timerOuterBorderThickness * 2)}:h=${timerLayout.height + (timerOuterBorderThickness * 2)}:color=black@0.74:t=${timerOuterBorderThickness}:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerBorderOuterLabel}]`,
    );
    currentLabel = timerBorderOuterLabel;

    const timerBorderInnerLabel = `scene${roundIndex}tb4i`;
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x + timerInnerBorderInset}:y=${timerLayout.y + timerInnerBorderInset}:w=${timerLayout.width - (timerInnerBorderInset * 2)}:h=${timerLayout.height - (timerInnerBorderInset * 2)}:color=white@0.18:t=2:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerBorderInnerLabel}]`,
    );
    currentLabel = timerBorderInnerLabel;

    const timerBorderLabel = `scene${roundIndex}tb4`;
    filters.push(
      `[${currentLabel}]drawbox=x=${timerLayout.x}:y=${timerLayout.y}:w=${timerLayout.width}:h=${timerLayout.height}:color=white@0.38:t=3:enable='${formatEnableBetween(round.local.countdown_start_seconds, round.local.reveal_start_seconds)}'[${timerBorderLabel}]`,
    );
    currentLabel = timerBorderLabel;

    decoyGrayCandidates.forEach(({ candidate, cell, grayInputLabel }) => {
      const grayLabel = `scene${roundIndex}gray${candidate.index}`;
      const grayOverlayLabel = `scene${roundIndex}grayv${candidate.index}`;
      filters.push(
        `[${grayInputLabel}]format=rgba,eq=saturation=0:brightness=-0.42:contrast=1.22,setsar=1,colorchannelmixer=aa=0.94,fade=t=in:st=${round.local.reveal_visual_start_seconds}:d=${decoyGrayFadeDuration}:alpha=1[${grayLabel}]`,
      );
      filters.push(
        `[${currentLabel}][${grayLabel}]overlay=x='${cell.center_x}-w/2':y='${Number((cell.center_y + gridSpriteYOffset).toFixed(3))}-h/2':enable='${formatEnableBetween(round.local.reveal_visual_start_seconds, round.local.scene_duration_seconds)}'[${grayOverlayLabel}]`,
      );
      currentLabel = grayOverlayLabel;
    });

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
