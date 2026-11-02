function escapeXml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function estimateSvgTextWidth(text, fontSize) {
  return [...String(text || '')].reduce((width, character) => {
    if (/\s/u.test(character)) return width + (fontSize * 0.36);
    if (/[MW]/u.test(character)) return width + (fontSize * 0.96);
    if (/[A-Z0-9]/u.test(character)) return width + (fontSize * 0.74);
    return width + (fontSize * 0.62);
  }, 0);
}

export function wrapTextInsideFrame({ text, frameWidth, fontSize, sideMargin = 50 }) {
  const words = String(text || '').trim().split(/\s+/u).filter(Boolean);
  const maximumWidth = Math.max(1, Number(frameWidth) - (Number(sideMargin) * 2));
  const lines = [];
  for (const word of words) {
    const candidate = lines.length > 0 ? `${lines.at(-1)} ${word}` : word;
    if (lines.length === 0 || estimateSvgTextWidth(candidate, fontSize) <= maximumWidth) {
      if (lines.length === 0) lines.push(word);
      else lines[lines.length - 1] = candidate;
    } else {
      lines.push(word);
    }
  }
  return {
    lines: lines.length > 0 ? lines : [''],
    maximum_width: maximumWidth,
    estimated_widths: (lines.length > 0 ? lines : [''])
      .map((line) => Math.min(maximumWidth, estimateSvgTextWidth(line, fontSize))),
  };
}

export function buildBoundaryAwareTextMarkup({
  text,
  centerX,
  frameWidth,
  fontSize,
  startY,
  lineHeight,
  sideMargin = 50,
  attributes,
}) {
  const wrapped = wrapTextInsideFrame({ text, frameWidth, fontSize, sideMargin });
  const markup = wrapped.lines.map((line, index) => {
    const naturalWidth = estimateSvgTextWidth(line, fontSize);
    const fitAttributes = naturalWidth > wrapped.maximum_width
      ? ` textLength="${wrapped.maximum_width}" lengthAdjust="spacingAndGlyphs"`
      : '';
    return `<text x="${centerX}" y="${startY + (index * lineHeight)}" text-anchor="middle" font-size="${fontSize}"${fitAttributes} ${attributes}>${escapeXml(line)}</text>`;
  });
  return {
    ...wrapped,
    markup,
    end_y: startY + ((wrapped.lines.length - 1) * lineHeight),
  };
}

export function buildBubbleSurvivalTitleMarkup({ centerX, frameWidth }) {
  return buildBoundaryAwareTextMarkup({
    text: 'SHOWDOWN',
    centerX,
    frameWidth,
    fontSize: 30,
    startY: 88,
    lineHeight: 32,
    sideMargin: 50,
    attributes: 'font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#fff" stroke="#091020" stroke-width="5" paint-order="stroke"',
  });
}

export function resolveShowdownTitleAnimationState(videoTime, animation = {}, characterCount = 8) {
  const startSeconds = Math.max(0, Number(animation?.start_seconds ?? 0.08));
  const intervalSeconds = Math.max(0.01, Number(animation?.letter_interval_seconds ?? 0.085));
  const popSeconds = Math.max(0.01, Number(animation?.letter_pop_seconds ?? 0.12));
  const elapsed = Number(videoTime) - startSeconds;
  const letters = Array.from({ length: Math.max(0, Number(characterCount) || 0) }, (_unused, index) => {
    const localElapsed = elapsed - (index * intervalSeconds);
    const progress = Math.min(1, Math.max(0, localElapsed / popSeconds));
    return {
      visible: localElapsed >= 0,
      progress,
      opacity: progress,
      scale: 0.62 + (0.38 * Math.sin((progress * Math.PI) / 2)),
    };
  });
  return {
    letters,
    complete: letters.length === 0 || letters.every((letter) => letter.progress >= 1),
  };
}

export function buildAnimatedBubbleSurvivalTitleMarkup({
  centerX,
  frameWidth,
  videoTime,
  animation,
  fontSize = 30,
  startY = 88,
  sideMargin = 50,
}) {
  const characters = [...'SHOWDOWN'];
  const maximumWidth = Math.max(1, Number(frameWidth) - (Number(sideMargin) * 2));
  const naturalWidths = characters.map((character) => estimateSvgTextWidth(character, fontSize));
  const naturalWidth = naturalWidths.reduce((sum, width) => sum + width, 0);
  const fitScale = Math.min(1, maximumWidth / Math.max(1, naturalWidth));
  const state = resolveShowdownTitleAnimationState(videoTime, animation, characters.length);
  let cursor = Number(centerX) - ((naturalWidth * fitScale) / 2);
  const markup = characters.map((character, index) => {
    const characterWidth = naturalWidths[index] * fitScale;
    const characterCenterX = cursor + (characterWidth / 2);
    cursor += characterWidth;
    const letter = state.letters[index];
    if (!letter.visible) return '';
    return `<text x="0" y="0" text-anchor="middle" font-size="${fontSize * fitScale}" font-family="Arial Black, Arial, sans-serif" font-weight="900" fill="#fff" stroke="#091020" stroke-width="5" paint-order="stroke" opacity="${letter.opacity.toFixed(3)}" transform="translate(${characterCenterX.toFixed(3)} ${startY}) scale(${letter.scale.toFixed(3)})">${escapeXml(character)}</text>`;
  });
  return {
    markup,
    maximum_width: maximumWidth,
    estimated_widths: [Math.min(maximumWidth, naturalWidth)],
    end_y: startY,
    animation_state: state,
  };
}
