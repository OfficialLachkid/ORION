// Pure classification of what came back on a sent outreach thread. Kept free of
// any I/O so it's fully unit-testable — the network side (fetching the thread,
// writing the lead row) lives in reply-detector.mjs.
//
// A grown thread does NOT automatically mean "they replied": it could be a
// bounce (the address was bad — must suppress, never follow up) or an
// out-of-office auto-reply (not a real answer — don't count it as a reply,
// don't chase yet). Only a genuine human reply should set responded_at and
// stop the sequence.

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

// messages: the thread's messages array (metadata format). ourEmail: the
// sender address we send FROM, so we can tell inbound from our own messages.
// Returns { kind: 'none' | 'reply' | 'bounce' | 'auto_reply', from, subject }.
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

  return { kind: 'reply', from, subject };
}
