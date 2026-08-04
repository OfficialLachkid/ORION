const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_CHANNELS_URL = 'https://www.googleapis.com/youtube/v3/channels';

export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';
export const YOUTUBE_FORCE_SSL_SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';
export const YOUTUBE_DEFAULT_SCOPES = Object.freeze([
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
]);

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
    throw new Error(`Missing required YouTube OAuth field: ${fieldName}`);
  }
}

export function buildYoutubeLoopbackRedirectUri(loopbackPort) {
  const port = Number.isFinite(loopbackPort) && loopbackPort > 0 ? loopbackPort : 53683;
  return `http://127.0.0.1:${port}/callback`;
}

export function extractYoutubeOAuthClientCredentials(payload) {
  const source = payload?.installed || payload?.web;
  if (!source) {
    throw new Error('YouTube OAuth client JSON must contain either an "installed" or "web" root object.');
  }

  assertField(source.client_id, 'client_id');
  assertField(source.client_secret, 'client_secret');

  return {
    clientId: source.client_id,
    clientSecret: source.client_secret,
    clientType: payload?.installed ? 'installed' : 'web',
    redirectUris: Array.isArray(source.redirect_uris) ? [...source.redirect_uris] : [],
  };
}

function normalizeScopes(scopes) {
  if (typeof scopes === 'string' && scopes.trim()) {
    return scopes.trim();
  }

  if (Array.isArray(scopes) && scopes.length > 0) {
    return scopes
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  return YOUTUBE_DEFAULT_SCOPES.join(' ');
}

export function buildYoutubeAuthorizeUrl(clientConfig, options = {}) {
  assertField(clientConfig?.clientId, 'clientId');
  const redirectUri = options.redirectUri || buildYoutubeLoopbackRedirectUri(options.loopbackPort);
  const state = options.state || '';
  const params = new URLSearchParams({
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    client_id: clientConfig.clientId,
    redirect_uri: redirectUri,
    scope: normalizeScopes(options.scopes),
  });

  if (state) {
    params.set('state', state);
  }

  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeYoutubeAuthorizationCode(clientConfig, code, options = {}) {
  assertField(clientConfig?.clientId, 'clientId');
  assertField(clientConfig?.clientSecret, 'clientSecret');
  assertField(code, 'authorizationCode');

  const fetchImpl = options.fetch || fetch;
  const redirectUri = options.redirectUri || buildYoutubeLoopbackRedirectUri(options.loopbackPort);
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube token exchange failed (${response.status}): ${bodyText || 'no body'}`);
  }
  if (!payload.refresh_token) {
    throw new Error('YouTube token exchange succeeded but returned no refresh_token. Re-run with prompt=consent.');
  }
  if (!payload.access_token) {
    throw new Error('YouTube token exchange succeeded but returned no access_token.');
  }

  return {
    refreshToken: payload.refresh_token,
    accessToken: payload.access_token,
    expiresIn: Number(payload.expires_in || 0),
    scope: payload.scope || '',
    tokenType: payload.token_type || 'Bearer',
  };
}

export async function refreshYoutubeAccessToken(clientConfig, refreshToken, options = {}) {
  assertField(clientConfig?.clientId, 'clientId');
  assertField(clientConfig?.clientSecret, 'clientSecret');
  assertField(refreshToken, 'refreshToken');

  const fetchImpl = options.fetch || fetch;
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientConfig.clientId,
      client_secret: clientConfig.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube access-token refresh failed (${response.status}): ${bodyText || 'no body'}`);
  }
  if (!payload.access_token) {
    throw new Error('YouTube refresh succeeded but returned no access_token.');
  }

  return {
    accessToken: payload.access_token,
    expiresIn: Number(payload.expires_in || 0),
    scope: payload.scope || '',
    tokenType: payload.token_type || 'Bearer',
    obtainedAtUtc: new Date().toISOString(),
  };
}

export async function fetchYoutubeMineChannel(accessToken, options = {}) {
  assertField(accessToken, 'accessToken');
  const fetchImpl = options.fetch || fetch;
  const endpoint = options.endpoint || `${YOUTUBE_CHANNELS_URL}?part=id,snippet&mine=true`;
  const response = await fetchImpl(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube channels.list failed (${response.status}): ${bodyText || 'no body'}`);
  }

  const channel = Array.isArray(payload.items) ? payload.items[0] : null;
  if (!channel?.id) {
    throw new Error('YouTube channels.list returned no authorized channel for the current token.');
  }

  return {
    channelId: channel.id,
    title: channel.snippet?.title || '',
    payload,
  };
}
