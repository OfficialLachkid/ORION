const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CEILING = 50;

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function stripWrappingQuotes(value) {
  const text = String(value || '').trim();
  if (
    (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith('“') && text.endsWith('”'))
    || (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1).trim();
  }

  return text;
}

function clampMax(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(Math.round(parsed), MAX_RESULTS_CEILING);
}

function extractLeadgenParts(text) {
  const pattern = /^find leads for\s+(.+?)(?:\s+max:\s*(\d+))?$/iu;
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }

  return {
    query: stripWrappingQuotes(match[1]),
    max: match[2] ? Number(match[2]) : DEFAULT_MAX_RESULTS,
  };
}

export function parseLeadgenCommand(text) {
  const rawText = normalizeWhitespace(text);
  if (!rawText) {
    return null;
  }

  const extracted = extractLeadgenParts(rawText);
  if (!extracted || !extracted.query) {
    return null;
  }

  return {
    query: extracted.query,
    max: clampMax(extracted.max),
  };
}

export function serializeLeadgenCommand(request = {}) {
  const query = normalizeWhitespace(request.query);
  if (!query) {
    return '';
  }

  const max = clampMax(request.max);
  return `find leads for ${query} max: ${max}`;
}

export function summarizeLeadgenRequest(request = {}) {
  const query = normalizeWhitespace(request.query);
  if (!query) {
    return '';
  }

  return `Find leads for: ${query}`;
}
