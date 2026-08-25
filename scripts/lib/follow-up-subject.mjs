// Gmail's UI threads by subject + threadId together. If a follow-up subject
// doesn't start with "Re: <original>", Gmail may show it as a separate thread
// even when threadId is set on the API request. Claude's follow-up prompt
// asks for "Re: <original>" but sometimes drops the prefix — this helper
// force-normalizes so threading always works: strip any existing
// Re:/Fwd:/Antw: prefix from the ORIGINAL subject, then prepend "Re: " to it.
// The follow-up's own Claude-generated subject is ignored in the happy path
// and only used as a fallback if the original is missing.
export function normalizeFollowUpSubject({ originalSubject = '', fallbackSubject = '' } = {}) {
  const original = String(originalSubject || '').trim();
  const fallback = String(fallbackSubject || '').trim();
  if (!original) return fallback;
  const stripped = original.replace(/^\s*(?:re|fwd?|antw)\s*:\s*/iu, '').trim();
  return stripped ? `Re: ${stripped}` : fallback;
}
