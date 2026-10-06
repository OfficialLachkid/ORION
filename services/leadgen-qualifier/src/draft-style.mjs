const LONG_DASH_PATTERN = /[—–]/gu;

export function sanitizeGeneratedDraftPunctuation(value) {
  if (typeof value !== 'string') {
    return value;
  }
  return value.replace(LONG_DASH_PATTERN, ',');
}

export function sanitizeGeneratedDraftFields(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }
  return {
    ...payload,
    draft_subject: sanitizeGeneratedDraftPunctuation(payload.draft_subject),
    draft_body: sanitizeGeneratedDraftPunctuation(payload.draft_body),
  };
}
