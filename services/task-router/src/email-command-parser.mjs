function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .trim();
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

function isLikelyEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(String(value || '').trim());
}

function extractDraftEmailParts(text) {
  const patterns = [
    /^(?:create\s+)?draft\s+(?:gmail\s+)?email\s+to\s+(.+?)\s+subject:\s+(.+?)\s+body:\s+([\s\S]+)$/iu,
    /^(?:draft|create)\s+(?:gmail\s+)?email\s+to\s+(.+?)\s+subject:\s+(.+?)\s+body:\s+([\s\S]+)$/iu,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return {
        to: stripWrappingQuotes(match[1]),
        subject: stripWrappingQuotes(match[2]),
        bodyText: stripWrappingQuotes(match[3]),
      };
    }
  }

  return null;
}

export function parseDraftEmailCommand(text) {
  const rawText = normalizeMultilineText(text);
  if (!rawText) {
    return null;
  }

  const extracted = extractDraftEmailParts(rawText);
  if (!extracted) {
    return null;
  }

  if (!isLikelyEmailAddress(extracted.to) || !extracted.subject || !extracted.bodyText) {
    return null;
  }

  return extracted;
}

export function serializeDraftEmailCommand(request = {}) {
  const to = normalizeWhitespace(request.to);
  const subject = normalizeWhitespace(request.subject);
  const bodyText = normalizeMultilineText(request.bodyText);
  if (!to || !subject || !bodyText) {
    return '';
  }

  return `draft email to ${to} subject: ${subject} body: ${bodyText}`;
}

export function summarizeDraftEmailRequest(request = {}) {
  const to = normalizeWhitespace(request.to);
  const subject = normalizeWhitespace(request.subject);
  if (!to || !subject) {
    return '';
  }

  return `Draft email to ${to}: ${subject}`;
}
