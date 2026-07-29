const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
export const GMAIL_COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
// Read scope for reply detection — metadata only (message headers + labels +
// thread structure, NOT bodies). Enough to count thread messages and read the
// From/Subject of a reply to tell a real reply from a bounce/auto-reply, while
// granting the least privilege (we never need to read the email body to detect
// that *something* came back). gmail.readonly would also work but reads bodies.
export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';

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
