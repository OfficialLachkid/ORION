import { createHash, randomBytes } from 'node:crypto';

export const TIKTOK_AUTHORIZE_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
export const TIKTOK_TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
export const TIKTOK_REVOKE_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/revoke/';
export const TIKTOK_USER_INFO_ENDPOINT = 'https://open.tiktokapis.com/v2/user/info/';
export const TIKTOK_CREATOR_INFO_ENDPOINT = 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/';
export const TIKTOK_DEFAULT_SCOPES = Object.freeze(['user.info.basic', 'video.publish']);

function normalizeText(value) {
  return String(value || '').trim();
}

function assertField(value, fieldName) {
  if (!normalizeText(value)) {
    throw new Error(`Missing required TikTok OAuth field: ${fieldName}`);
  }
}

function normalizeScopes(scopes) {
  const values = Array.isArray(scopes)
    ? scopes
    : normalizeText(scopes).split(',');
  const normalized = values
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return [...new Set(normalized.length > 0 ? normalized : TIKTOK_DEFAULT_SCOPES)];
}

async function readJsonResponse(response) {
  const bodyText = typeof response?.text === 'function' ? await response.text() : '';
  let payload = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
  } else if (typeof response?.json === 'function') {
    payload = await response.json();
  }
  return { bodyText, payload: payload || {} };
}

function describeTikTokError(payload = {}, fallback = 'unknown error') {
  return normalizeText(
    payload.error_description
      || payload.error?.message
      || payload.error?.code
      || payload.message
      || fallback,
  );
}

function assertTikTokApiSuccess(response, payload, action, bodyText = '') {
  const errorCode = normalizeText(payload?.error?.code);
  if (!response?.ok || (errorCode && errorCode !== 'ok')) {
    const description = describeTikTokError(payload, bodyText || 'no response body');
    throw new Error(`${action} failed (${response?.status || 0}): ${description}`);
  }
}

export function createTikTokPkcePair(options = {}) {
  const verifier = normalizeText(options.verifier)
    || randomBytes(64).toString('base64url');
  if (verifier.length < 43 || verifier.length > 128 || !/^[A-Za-z0-9._~-]+$/u.test(verifier)) {
    throw new Error('TikTok PKCE code_verifier must be 43-128 unreserved URI characters.');
  }

  return {
    verifier,
    challenge: createHash('sha256').update(verifier, 'utf8').digest('hex'),
    method: 'S256',
  };
}

export function validateTikTokDesktopRedirectUri(value) {
  const redirectUri = normalizeText(value);
  let parsed;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error('TikTok Desktop redirect URI must be an absolute URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('TikTok Desktop redirect URI must use http or https.');
  }
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error('TikTok Desktop redirect URI must use localhost or 127.0.0.1.');
  }
  if (!parsed.port) {
    throw new Error('TikTok Desktop redirect URI must include a port.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('TikTok Desktop redirect URI cannot include query parameters or a fragment.');
  }
  return parsed.toString();
}

export function buildTikTokAuthorizeUrl(clientConfig, options = {}) {
  const clientKey = normalizeText(clientConfig?.clientKey);
  assertField(clientKey, 'clientKey');
  assertField(options.state, 'state');
  assertField(options.codeChallenge, 'codeChallenge');

  const redirectUri = validateTikTokDesktopRedirectUri(options.redirectUri);
  const params = new URLSearchParams({
    client_key: clientKey,
    response_type: 'code',
    scope: normalizeScopes(options.scopes).join(','),
    redirect_uri: redirectUri,
    state: normalizeText(options.state),
    code_challenge: normalizeText(options.codeChallenge),
    code_challenge_method: 'S256',
  });
  return `${TIKTOK_AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

export async function exchangeTikTokAuthorizationCode(clientConfig, code, options = {}) {
  const clientKey = normalizeText(clientConfig?.clientKey);
  const clientSecret = normalizeText(clientConfig?.clientSecret);
  assertField(clientKey, 'clientKey');
  assertField(clientSecret, 'clientSecret');
  assertField(code, 'authorizationCode');
  assertField(options.codeVerifier, 'codeVerifier');

  const fetchImpl = options.fetch || globalThis.fetch;
  const redirectUri = validateTikTokDesktopRedirectUri(options.redirectUri);
  const response = await fetchImpl(options.endpoint || TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      code: normalizeText(code),
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code_verifier: normalizeText(options.codeVerifier),
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`TikTok token exchange failed (${response.status}): ${describeTikTokError(payload, bodyText || 'no response body')}`);
  }
  assertField(payload.access_token, 'access_token');
  assertField(payload.refresh_token, 'refresh_token');
  assertField(payload.open_id, 'open_id');

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    openId: payload.open_id,
    expiresIn: Number(payload.expires_in || 0),
    refreshExpiresIn: Number(payload.refresh_expires_in || 0),
    scope: normalizeText(payload.scope),
    tokenType: normalizeText(payload.token_type) || 'Bearer',
  };
}

export async function refreshTikTokAccessToken(clientConfig, refreshToken, options = {}) {
  const clientKey = normalizeText(clientConfig?.clientKey);
  const clientSecret = normalizeText(clientConfig?.clientSecret);
  assertField(clientKey, 'clientKey');
  assertField(clientSecret, 'clientSecret');
  assertField(refreshToken, 'refreshToken');

  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchImpl(options.endpoint || TIKTOK_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: normalizeText(refreshToken),
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`TikTok token refresh failed (${response.status}): ${describeTikTokError(payload, bodyText || 'no response body')}`);
  }
  assertField(payload.access_token, 'access_token');
  assertField(payload.refresh_token, 'refresh_token');

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    openId: normalizeText(payload.open_id),
    expiresIn: Number(payload.expires_in || 0),
    refreshExpiresIn: Number(payload.refresh_expires_in || 0),
    scope: normalizeText(payload.scope),
    tokenType: normalizeText(payload.token_type) || 'Bearer',
  };
}

export async function revokeTikTokAccessToken(clientConfig, accessToken, options = {}) {
  assertField(clientConfig?.clientKey, 'clientKey');
  assertField(clientConfig?.clientSecret, 'clientSecret');
  assertField(accessToken, 'accessToken');
  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchImpl(options.endpoint || TIKTOK_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: normalizeText(clientConfig.clientKey),
      client_secret: normalizeText(clientConfig.clientSecret),
      token: normalizeText(accessToken),
    }).toString(),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`TikTok token revocation failed (${response.status}): ${describeTikTokError(payload, bodyText || 'no response body')}`);
  }
  return true;
}

export async function fetchTikTokUserInfo(accessToken, options = {}) {
  assertField(accessToken, 'accessToken');
  const fetchImpl = options.fetch || globalThis.fetch;
  const endpoint = new URL(options.endpoint || TIKTOK_USER_INFO_ENDPOINT);
  endpoint.searchParams.set('fields', 'open_id,union_id,avatar_url,display_name');
  const response = await fetchImpl(endpoint.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${normalizeText(accessToken)}` },
  });
  const { bodyText, payload } = await readJsonResponse(response);
  assertTikTokApiSuccess(response, payload, 'TikTok user-info query', bodyText);
  if (!payload.data?.user?.open_id) {
    throw new Error('TikTok user-info query returned no user identity.');
  }
  return payload.data.user;
}

export async function fetchTikTokCreatorInfo(accessToken, options = {}) {
  assertField(accessToken, 'accessToken');
  const fetchImpl = options.fetch || globalThis.fetch;
  const response = await fetchImpl(options.endpoint || TIKTOK_CREATOR_INFO_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${normalizeText(accessToken)}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
  const { bodyText, payload } = await readJsonResponse(response);
  assertTikTokApiSuccess(response, payload, 'TikTok creator-info query', bodyText);
  if (!payload.data?.creator_username) {
    throw new Error('TikTok creator-info query returned no creator username.');
  }
  return payload.data;
}

export function resolveTikTokCredentialEnvKeys(target = {}) {
  const accessToken = normalizeText(
    target.tiktok?.access_token_env
      || target.tiktok?.accessTokenEnv
      || target.metadata?.access_token_env,
  );
  assertField(accessToken, 'target.tiktok.access_token_env');
  const prefix = accessToken.endsWith('_ACCESS_TOKEN')
    ? accessToken.slice(0, -'_ACCESS_TOKEN'.length)
    : accessToken;

  return {
    accessToken,
    refreshToken: normalizeText(target.tiktok?.refresh_token_env) || `${prefix}_REFRESH_TOKEN`,
    accessTokenExpiresAt: normalizeText(target.tiktok?.access_token_expires_at_env) || `${prefix}_ACCESS_TOKEN_EXPIRES_AT`,
    refreshTokenExpiresAt: normalizeText(target.tiktok?.refresh_token_expires_at_env) || `${prefix}_REFRESH_TOKEN_EXPIRES_AT`,
    openId: normalizeText(target.tiktok?.open_id_env) || `${prefix}_OPEN_ID`,
    scopes: normalizeText(target.tiktok?.scopes_env) || `${prefix}_SCOPES`,
  };
}

function expiryIso(now, expiresIn) {
  const seconds = Number(expiresIn || 0);
  return seconds > 0
    ? new Date(now.getTime() + (seconds * 1000)).toISOString()
    : '';
}

export function buildTikTokCredentialEnvValues(target, tokens, options = {}) {
  const keys = resolveTikTokCredentialEnvKeys(target);
  const now = options.now instanceof Date ? options.now : new Date();
  return {
    [keys.accessToken]: normalizeText(tokens.accessToken),
    [keys.refreshToken]: normalizeText(tokens.refreshToken),
    [keys.accessTokenExpiresAt]: expiryIso(now, tokens.expiresIn),
    [keys.refreshTokenExpiresAt]: expiryIso(now, tokens.refreshExpiresIn),
    [keys.openId]: normalizeText(tokens.openId),
    [keys.scopes]: normalizeScopes(tokens.scope).join(','),
  };
}
