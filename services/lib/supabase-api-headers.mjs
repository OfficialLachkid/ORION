function normalizeApiKey(value) {
  return String(value || '').trim();
}

export function isSupabaseOpaqueApiKey(apiKey) {
  return /^sb_(?:publishable|secret)_/u.test(normalizeApiKey(apiKey));
}

export function createSupabaseApiHeaders(apiKey, extraHeaders = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  return {
    apikey: normalizedApiKey,
    // Opaque sb_* keys are API gateway credentials, not JWTs. Sending one
    // as a bearer token makes PostgREST attempt JWT parsing and reject it.
    ...(!isSupabaseOpaqueApiKey(normalizedApiKey)
      ? { Authorization: `Bearer ${normalizedApiKey}` }
      : {}),
    ...extraHeaders,
  };
}
