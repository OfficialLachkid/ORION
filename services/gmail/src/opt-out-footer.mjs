// Opt-out footer — single source of truth for the PS line every outbound
// outreach email must carry (legally required under NL Telecommunicatiewet
// art. 11.7 + GDPR). Two callers use it:
//   - normalizeDraft in send.mjs guarantees new drafts include it
//   - the gmail-executor's send-time guard patches any pre-existing Gmail
//     draft that is missing it before the drafts.send call fires, so the
//     ~400 drafts that already sat in Gmail before this footer was
//     introduced never go out non-compliant.
//
// The PS text is intentionally soft ("gekke gedachte" register) rather
// than corporate. If the qualifier prompt drifts and produces slightly
// different wording, hasOptOutFooter's KEYWORD-based check still
// recognizes it — the exact-string constant is only used for the append
// path, not for the presence check.

export const PS_OPT_OUT_FOOTER = 'PS: liever geen mails meer van mij? Laat het even weten met een korte reactie (\'geen interesse\' of \'afmelden\') en ik houd u van deze lijst af.';

// Body-text markers we recognize as "this draft already has an opt-out
// mechanism, no need to append another one". Deliberately lenient so a
// hand-edited PS with different phrasing still counts. Any single match
// short-circuits the append.
const OPT_OUT_PRESENCE_MARKERS = Object.freeze([
  // Dutch — the phrasings we or the operator would realistically write
  'afmelden',
  'uitschrijven',
  'geen mails meer',
  'geen mail meer',
  'geen contact meer',
  'graag verwijderen',
  'verwijder mij',
  'niet meer mailen',
  'stop met mailen',
  // English fallbacks in case an English draft slips through
  'unsubscribe',
  'remove me',
  'stop emailing',
  'do not contact',
]);

function normalizeForMatch(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '');
}

// True when the body already carries any recognizable opt-out phrase.
// Called from both the append helper (idempotency) and the executor's
// pre-send guard (to decide whether to patch the Gmail draft at all).
export function hasOptOutFooter(bodyText) {
  const haystack = normalizeForMatch(bodyText);
  if (!haystack) return false;
  return OPT_OUT_PRESENCE_MARKERS.some((marker) => haystack.includes(marker));
}

// Idempotent: returns `bodyText` unchanged when it already contains an
// opt-out phrase (hasOptOutFooter is true); otherwise appends
// PS_OPT_OUT_FOOTER with a leading blank line so the PS visually
// separates from the sign-off. Empty/whitespace-only input still yields
// the footer alone — no caller should be sending an empty body anyway,
// but if they do the recipient at least gets the compliance line.
export function ensureOptOutFooter(bodyText) {
  const source = String(bodyText || '');
  if (hasOptOutFooter(source)) return source;
  const trimmed = source.replace(/\s+$/u, '');
  const separator = trimmed.length > 0 ? '\n\n' : '';
  return `${trimmed}${separator}${PS_OPT_OUT_FOOTER}`;
}
