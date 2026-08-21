const DEFAULT_MAX_RESULTS = 10;
const MAX_RESULTS_CEILING = 50;
const DEFAULT_SWEEP_ROUNDS = 1;
const MAX_SWEEP_ROUNDS = 10;

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

function clampRounds(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_SWEEP_ROUNDS;
  }

  return Math.min(Math.round(parsed), MAX_SWEEP_ROUNDS);
}

function extractLeadgenSweepParts(text) {
  const pattern = /^run leadgen sweep(?:\s+rounds:\s*(\d+))?$/iu;
  const match = pattern.exec(text);
  if (!match) {
    return null;
  }

  return {
    mode: 'sweep',
    rounds: match[1] ? Number(match[1]) : DEFAULT_SWEEP_ROUNDS,
  };
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

  const extractedSweep = extractLeadgenSweepParts(rawText);
  if (extractedSweep) {
    return {
      mode: 'sweep',
      rounds: clampRounds(extractedSweep.rounds),
    };
  }

  const extracted = extractLeadgenParts(rawText);
  if (!extracted || !extracted.query) {
    return null;
  }

  return {
    mode: 'search',
    query: extracted.query,
    max: clampMax(extracted.max),
  };
}

export function serializeLeadgenCommand(request = {}) {
  if (String(request.mode || '').trim().toLowerCase() === 'sweep') {
    return serializeLeadgenSweepCommand(request);
  }

  const query = normalizeWhitespace(request.query);
  if (!query) {
    return '';
  }

  const max = clampMax(request.max);
  return `find leads for ${query} max: ${max}`;
}

export function serializeLeadgenSweepCommand(request = {}) {
  const rounds = clampRounds(request.rounds);
  return `run leadgen sweep rounds: ${rounds}`;
}

export function summarizeLeadgenRequest(request = {}) {
  if (String(request.mode || '').trim().toLowerCase() === 'sweep') {
    return `Run leadgen sweep: ${clampRounds(request.rounds)} round(s) across all niches`;
  }

  const query = normalizeWhitespace(request.query);
  if (!query) {
    return '';
  }

  return `Find leads for: ${query}`;
}
