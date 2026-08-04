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

export function wrapTextBlock(value, { maxCharactersPerLine, maxLines = 2 }) {
  const sourceText = normalizeDrawtextText(value).trim();
  if (!sourceText) {
    return {
      wrapped_text: '',
      lines: [],
    };
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

function computeTextBlockY(baseY, lineCount, fontSize, template) {
  const safeTop = ensureNumber(template?.canvas?.safe_zone?.top, 160);
  if (lineCount <= 1) return baseY;
  const lineHeight = ensureNumber(fontSize, 60) + DEFAULT_TEXT_LINE_SPACING;
  return Math.max(safeTop - 10, Math.floor(baseY - (((lineCount - 1) * lineHeight) / 2)));
}

function buildTextLineArtifacts(text, { template, fontSize, maxLines, baseY }) {
  const wrapped = wrapTextBlock(text, {
    maxCharactersPerLine: estimateWrapCharacterLimit(template, fontSize),
    maxLines,
  });
  const lineHeight = fontSize + DEFAULT_TEXT_LINE_SPACING;
  const blockY = computeTextBlockY(baseY, wrapped.lines.length, fontSize, template);
  return {
    line_height: lineHeight,
    lines: wrapped.lines.map((lineText, index) => ({
      text: lineText,
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
  const finalSegmentStart = Math.max(start, roundTime(end - 0.12));
  const wordStepSeconds = roundTime(Math.min(
    0.28,
    Math.max(0.1, ((end - start) * 0.58) / Math.max(1, allWords.length)),
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
