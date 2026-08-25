import {
  DEFAULT_TEXT_LINE_SPACING,
  ensureNumber,
  roundTime,
} from './constants.mjs';

function normalizeDrawtextText(value) {
  return String(value || '').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

export function estimateWrapCharacterLimit(template, fontSize) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const safeZone = template?.canvas?.safe_zone || {};
  const maxTextWidth = canvasWidth - ensureNumber(safeZone.left, 100) - ensureNumber(safeZone.right, 100);
  return Math.max(12, Math.floor(maxTextWidth / Math.max(1, ensureNumber(fontSize, 60) * 0.56)));
}

function wrapTextLines(value, maxCharactersPerLine) {
  const sourceText = normalizeDrawtextText(value).trim();
  if (!sourceText) {
    return [];
  }

  const normalizedMaxCharacters = Math.max(8, Math.floor(ensureNumber(maxCharactersPerLine, 24)));
  const tokens = sourceText.split(/\s+/u).filter(Boolean);
  const lines = [];
  let currentLine = '';

  for (const token of tokens) {
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

  return lines;
}

export function wrapTextBlock(value, { maxCharactersPerLine, maxLines = 2 }) {
  const lines = wrapTextLines(value, maxCharactersPerLine);
  if (lines.length === 0) {
    return {
      wrapped_text: '',
      lines: [],
    };
  }

  if (lines.length > maxLines) {
    const preservedLines = lines.slice(0, Math.max(0, maxLines - 1));
    const lastLine = lines.slice(Math.max(0, maxLines - 1)).join(' ');
    lines.length = 0;
    lines.push(...preservedLines, lastLine);
  }

  return {
    wrapped_text: lines.join('\n'),
    lines,
  };
}

function fitTextBlockToLineCount(text, {
  template,
  fontSize,
  maxLines,
}) {
  const requestedFontSize = Math.max(24, Math.floor(ensureNumber(fontSize, 60)));
  const minimumFontSize = Math.max(48, Math.floor(requestedFontSize * 0.72));
  let fittedFontSize = requestedFontSize;
  let fittedLines = wrapTextLines(text, estimateWrapCharacterLimit(template, fittedFontSize));

  while (fittedLines.length > maxLines && fittedFontSize > minimumFontSize) {
    fittedFontSize -= 2;
    fittedLines = wrapTextLines(text, estimateWrapCharacterLimit(template, fittedFontSize));
  }

  const wrapped = fittedLines.length <= maxLines
    ? {
      wrapped_text: fittedLines.join('\n'),
      lines: fittedLines,
    }
    : wrapTextBlock(text, {
      maxCharactersPerLine: estimateWrapCharacterLimit(template, fittedFontSize),
      maxLines,
    });

  return {
    font_size: fittedFontSize,
    wrapped,
  };
}

function computeTextBlockY(baseY, lineCount, fontSize, template) {
  const safeTop = ensureNumber(template?.canvas?.safe_zone?.top, 160);
  if (lineCount <= 1) return baseY;
  const lineHeight = ensureNumber(fontSize, 60) + DEFAULT_TEXT_LINE_SPACING;
  return Math.max(safeTop - 10, Math.floor(baseY - (((lineCount - 1) * lineHeight) / 2)));
}

function buildTextLineArtifacts(text, { template, fontSize, maxLines, baseY }) {
  const fitted = fitTextBlockToLineCount(text, {
    template,
    fontSize,
    maxLines,
  });
  const effectiveFontSize = fitted.font_size;
  const wrapped = fitted.wrapped;
  const lineHeight = effectiveFontSize + DEFAULT_TEXT_LINE_SPACING;
  const blockY = computeTextBlockY(baseY, wrapped.lines.length, effectiveFontSize, template);
  return {
    font_size: effectiveFontSize,
    line_height: lineHeight,
    lines: wrapped.lines.map((lineText, index) => ({
      text: lineText,
      font_size: effectiveFontSize,
      y: blockY + (index * lineHeight),
    })),
  };
}

function tokenizeTextWords(value) {
  return String(value || '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}

export function buildProgressiveTextArtifacts(text, {
  template,
  fontSize,
  maxLines,
  baseY,
  startSeconds,
  endSeconds,
  progressiveEndSeconds = endSeconds,
}) {
  const lineArtifacts = buildTextLineArtifacts(text, {
    template,
    fontSize,
    maxLines,
    baseY,
  });
  const allWords = lineArtifacts.lines.flatMap((line) => tokenizeTextWords(line.text));
  if (allWords.length === 0) {
    return {
      ...lineArtifacts,
      segments: [],
    };
  }

  const start = roundTime(startSeconds);
  const end = roundTime(endSeconds);
  const progressiveEnd = Math.max(start, roundTime(Math.min(end, progressiveEndSeconds)));
  const finalSegmentStart = Math.max(start, roundTime(progressiveEnd - 0.12));
  const wordStepSeconds = roundTime(Math.min(
    0.28,
    Math.max(0.1, ((progressiveEnd - start) * 0.58) / Math.max(1, allWords.length)),
  ));
  let globalWordIndex = 0;
  const segments = [];

  for (const line of lineArtifacts.lines) {
    const words = tokenizeTextWords(line.text);
    if (words.length === 0) {
      continue;
    }
    const lineSegments = [];
    for (let index = 0; index < words.length; index += 1) {
      const segmentStart = roundTime(Math.min(
        finalSegmentStart,
        start + (globalWordIndex * wordStepSeconds),
      ));
      globalWordIndex += 1;
      lineSegments.push({
        text: words.slice(0, index + 1).join(' '),
        font_size: line.font_size,
        y: line.y,
        start_seconds: segmentStart,
        end_seconds: end,
      });
    }
    for (let index = 0; index < lineSegments.length - 1; index += 1) {
      lineSegments[index].end_seconds = lineSegments[index + 1].start_seconds;
    }
    segments.push(...lineSegments);
  }

  return {
    ...lineArtifacts,
    segments,
  };
}
