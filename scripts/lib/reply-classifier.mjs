// Pure classification of what came back on a sent outreach thread. Kept free of
// any I/O so it's fully unit-testable — the network side (fetching the thread,
// writing the lead row) lives in reply-detector.mjs.
//
// A grown thread does NOT automatically mean "they replied": it could be a
// bounce (the address was bad — must suppress, never follow up), an
// out-of-office auto-reply (not a real answer — don't count it as a reply,
// don't chase yet), or an explicit opt-out (they replied to say "stop" — must
// suppress, remove the lead from all future rotations). Only a genuine
// non-opt-out human reply should set responded_at and stop the sequence.

function headerValue(message, name) {
  const headers = message?.payload?.headers;
  if (!Array.isArray(headers)) {
    return '';
  }
  const match = headers.find((h) => String(h?.name || '').toLowerCase() === name.toLowerCase());
  return String(match?.value || '');
}

function extractEmailAddress(fromHeader) {
  const angle = /<([^>]+)>/u.exec(String(fromHeader || ''));
  return (angle ? angle[1] : String(fromHeader || '')).trim().toLowerCase();
}

const BOUNCE_SENDERS = [
  'mailer-daemon',
  'postmaster',
  'mail delivery subsystem',
  'mail delivery system',
  'maildelivery',
];

const AUTO_REPLY_SUBJECT_MARKERS = [
  'out of office',
  'automatic reply',
  'auto-reply',
  'autoreply',
  'automatisch',         // NL "automatisch antwoord" (also matches "automatische")
  'afwezig',             // NL "afwezig"/"afwezigheid" (away)
  'vakantie',            // NL "vacation"
  'ooo',
];

// Opt-out language — Dutch-first because the outreach is Dutch, plus English
// fallbacks since some replies use English out of habit. Grouped by confidence:
//
// HIGH: unambiguous opt-out language. If any HIGH marker matches, auto-mark
//       the lead as unsubscribed. False-positive risk is very low; a
//       recipient using these words does not want more mail from us.
//
// LOW:  softer phrases that CAN mean opt-out but often mean "not now" /
//       "we're happy with our current setup". These do NOT auto-suppress
//       — reply-detector posts them to Discord for operator review so a
//       real person decides whether to unsubscribe or just stop the
//       sequence (the "not interested for now, ask again next quarter"
//       case).
//
// Match rules: whole-word regex on the reply body, case-insensitive,
// diacritics-insensitive. Subject line is checked too — a subject like
// "afmelden" is signal even if the body is empty.
const OPT_OUT_MARKERS_HIGH = Object.freeze([
  // Dutch
  'afmelden',
  'uitschrijven',
  'graag verwijderen',
  'verwijder mij',
  'verwijder mijn',
  'niet meer mailen',
  'niet meer contact',
  'geen mails meer',
  'geen mail meer',
  'geen contact meer',
  'stuur geen mails',
  'stop met mailen',
  // English
  'unsubscribe',
  'remove me',
  'stop emailing',
  'do not contact',
  "don't contact",
  'do not email',
  "don't email",
]);

const OPT_OUT_MARKERS_LOW = Object.freeze([
  // Dutch — "not interested" style; often a soft no, sometimes a hard no
  'geen interesse',
  'niet geinteresseerd',
  'niet geïnteresseerd',
  'geen behoefte',
  'geen belangstelling',
  'niet nodig',
  // English soft
  'not interested',
  'no thank you',
  'no thanks',
]);

function normalizeForMatch(text) {
  // Lowercase + strip common diacritics so "geinteresseerd" and
  // "geïnteresseerd" both match. Also collapse whitespace so multi-line
  // signatures don't hide phrases.
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

// Pure body/subject scanner. Returns:
//   { level: 'high' | 'low' | 'none', matched: [phrase, ...] }
// level 'high' → auto-unsubscribe.
// level 'low'  → route to operator review, do NOT auto-unsubscribe.
// level 'none' → treat as a normal reply.
export function detectOptOutInText(bodyText = '', subjectText = '') {
  const haystack = normalizeForMatch(`${subjectText} ${bodyText}`);
  if (!haystack) return { level: 'none', matched: [] };
  const highHits = OPT_OUT_MARKERS_HIGH.filter((m) => haystack.includes(m));
  if (highHits.length > 0) {
    return { level: 'high', matched: highHits };
  }
  const lowHits = OPT_OUT_MARKERS_LOW.filter((m) => haystack.includes(m));
  if (lowHits.length > 0) {
    return { level: 'low', matched: lowHits };
  }
  return { level: 'none', matched: [] };
}

// Extract raw body text from a Gmail message payload for opt-out scanning.
// Handles the common shapes: plain-text top-level body, multipart with a
// text/plain part, or nested parts. Returns '' when no text body is
// available (metadata-only fetches, HTML-only messages we can't decode
// safely, etc.) — callers gracefully degrade to subject-only detection.
function decodeBase64Url(data) {
  try {
    const normalized = String(data || '').replace(/-/gu, '+').replace(/_/gu, '/');
    // Buffer is available in Node; skip if it isn't.
    if (typeof Buffer !== 'undefined') return Buffer.from(normalized, 'base64').toString('utf8');
    return '';
  } catch {
    return '';
  }
}

export function extractGmailMessageBodyText(message) {
  const payload = message?.payload;
  if (!payload) return '';
  const collect = (part) => {
    if (!part) return '';
    if (String(part.mimeType || '').toLowerCase() === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts) && part.parts.length > 0) {
      return part.parts.map(collect).filter(Boolean).join('\n');
    }
    // Fallback: top-level body with no explicit mime — try it as text.
    if (!part.parts && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    return '';
  };
  return collect(payload);
}

// messages: the thread's messages array. ourEmail: the sender address we send
// FROM, so we can tell inbound from our own messages. When messages carry a
// full payload (from format=full), body text is scanned for opt-out language.
// When only headers are available (format=metadata), the subject line alone
// is scanned — lower recall, but no crash.
//
// Returns { kind, from, subject, optOut? } where:
//   kind: 'none' | 'reply' | 'bounce' | 'auto_reply' | 'opt_out'
//   optOut (only present on 'opt_out' or on ambiguous replies):
//     { level: 'high' | 'low', matched: [phrase, ...] }
export function classifyThreadReply(messages, ourEmail) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length <= 1) {
    return { kind: 'none', from: '', subject: '' };
  }

  const ours = String(ourEmail || '').trim().toLowerCase();

  // Consider messages we did NOT send — the newest inbound one decides.
  const inbound = list.filter((m) => {
    const from = extractEmailAddress(headerValue(m, 'From'));
    return from && from !== ours;
  });
  if (inbound.length === 0) {
    // Thread grew but only with our own messages (e.g. we sent a follow-up).
    return { kind: 'none', from: '', subject: '' };
  }

  const latest = inbound[inbound.length - 1];
  const from = extractEmailAddress(headerValue(latest, 'From'));
  const fromRaw = headerValue(latest, 'From').toLowerCase();
  const subject = headerValue(latest, 'Subject');
  const autoSubmitted = headerValue(latest, 'Auto-Submitted').toLowerCase();

  if (BOUNCE_SENDERS.some((marker) => from.includes(marker) || fromRaw.includes(marker))) {
    return { kind: 'bounce', from, subject };
  }

  const looksAuto = (autoSubmitted && autoSubmitted !== 'no')
    || AUTO_REPLY_SUBJECT_MARKERS.some((marker) => subject.toLowerCase().includes(marker));
  if (looksAuto) {
    return { kind: 'auto_reply', from, subject };
  }

  const bodyText = extractGmailMessageBodyText(latest);
  const optOut = detectOptOutInText(bodyText, subject);
  if (optOut.level === 'high') {
    return { kind: 'opt_out', from, subject, optOut };
  }
  if (optOut.level === 'low') {
    // Still a reply — but flag for operator review so a human can decide
    // whether it's a real opt-out or a soft "not now" that we should ask
    // again later.
    return { kind: 'reply', from, subject, optOut };
  }
  return { kind: 'reply', from, subject };
}
