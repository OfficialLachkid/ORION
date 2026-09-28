const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
// Metadata scope — message headers + labels + thread structure, NOT bodies.
// Was sufficient for pre-2026-09-28 reply detection (counting inbound
// messages + reading From/Subject to tell reply vs bounce vs auto-reply).
// Kept as a fallback / documentation; the token now requests the strictly-
// broader readonly scope so reply-detector can scan message bodies for
// opt-out language (afmelden / unsubscribe) — a legal requirement under
// NL Telecommunicatiewet 11.7 + GDPR.
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
// Read scope with BODY access — needed so reply-detector can scan the reply
// body for opt-out language (not just the subject). Google's readonly scope
// is a proper superset of metadata: everything metadata could do plus
// message.body content. We ask for readonly (not metadata) so the operator
// only has to consent to one read scope instead of two overlapping ones.
export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

async function readJsonResponse(response) {
  if (typeof response?.text === 'function') {
    const bodyText = await response.text();
    let payload;
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
    return {
      bodyText,
      payload,
    };
  }

  if (typeof response?.json === 'function') {
    const payload = await response.json();
    return {
      bodyText: JSON.stringify(payload || {}),
      payload: payload || {},
    };
  }

  return {
    bodyText: '',
    payload: {},
  };
}

function assertField(value, fieldName) {
  if (!value) {
    throw new Error(`Missing required Gmail OAuth field: ${fieldName}`);
  }
}

export function buildLoopbackRedirectUri(loopbackPort) {
  const port = Number.isFinite(loopbackPort) && loopbackPort > 0 ? loopbackPort : 53682;
  return `http://127.0.0.1:${port}/callback`;
}

export function buildAuthorizeUrl(gmailConfig, options = {}) {
  assertField(gmailConfig.clientId, 'clientId');
  const redirectUri = options.redirectUri || buildLoopbackRedirectUri(gmailConfig.loopbackPort);
  const state = options.state || '';
  const scope = options.scope || GMAIL_SEND_SCOPE;
  const params = new URLSearchParams({
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    client_id: gmailConfig.clientId,
    redirect_uri: redirectUri,
    scope,
  });
  if (state) {
    params.set('state', state);
  }
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeAuthorizationCode(gmailConfig, code, options = {}) {
  assertField(gmailConfig.clientId, 'clientId');
  assertField(gmailConfig.clientSecret, 'clientSecret');
  assertField(code, 'authorizationCode');
  const fetchImpl = options.fetch || fetch;
  const redirectUri = options.redirectUri || buildLoopbackRedirectUri(gmailConfig.loopbackPort);

  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: gmailConfig.clientId,
      client_secret: gmailConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Gmail token exchange failed (${response.status}): ${bodyText || 'no body'}`);
  }
  if (!payload.refresh_token) {
    throw new Error('Gmail token exchange succeeded but returned no refresh_token. Re-run with prompt=consent.');
  }
  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token || '',
    expiresIn: Number(payload.expires_in || 0),
    scope: payload.scope || '',
    tokenType: payload.token_type || 'Bearer',
  };
}

export async function fetchAccessToken(gmailConfig, options = {}) {
  assertField(gmailConfig.clientId, 'clientId');
  assertField(gmailConfig.clientSecret, 'clientSecret');
  assertField(gmailConfig.refreshToken, 'refreshToken');
  const fetchImpl = options.fetch || options.fetchImpl || fetch;

  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: gmailConfig.clientId,
      client_secret: gmailConfig.clientSecret,
      refresh_token: gmailConfig.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Gmail access-token refresh failed (${response.status}): ${bodyText || 'no body'}`);
  }
  if (!payload.access_token) {
    throw new Error('Gmail refresh succeeded but returned no access_token.');
  }
  return {
    accessToken: payload.access_token,
    expiresIn: Number(payload.expires_in || 0),
    expiresInSeconds: Number(payload.expires_in || 0),
    scope: payload.scope || '',
    tokenType: payload.token_type || 'Bearer',
    obtainedAtUtc: new Date().toISOString(),
  };
}

export async function refreshGmailAccessToken(gmailConfig, options = {}) {
  return fetchAccessToken(gmailConfig, {
    fetch: options.fetchImpl || options.fetch,
  });
}
