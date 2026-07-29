import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GMAIL_SEND_SCOPE,
  buildAuthorizeUrl,
  buildLoopbackRedirectUri,
  exchangeAuthorizationCode,
  fetchAccessToken,
} from '../src/oauth.mjs';

function baseConfig(overrides = {}) {
  return {
    clientId: 'client-abc.apps.googleusercontent.com',
    clientSecret: 'GOCSPX-super-secret',
    refreshToken: 'refresh-xyz',
    loopbackPort: 53682,
    ...overrides,
  };
}

test('buildLoopbackRedirectUri uses the configured port', () => {
  assert.equal(buildLoopbackRedirectUri(53682), 'http://127.0.0.1:53682/callback');
  assert.equal(buildLoopbackRedirectUri(null), 'http://127.0.0.1:53682/callback');
});

test('buildAuthorizeUrl sets response_type, access_type, prompt, scope, redirect', () => {
  const url = new URL(buildAuthorizeUrl(baseConfig(), { state: 'nonce-1' }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('scope'), GMAIL_SEND_SCOPE);
  assert.equal(url.searchParams.get('client_id'), baseConfig().clientId);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:53682/callback');
  assert.equal(url.searchParams.get('state'), 'nonce-1');
});

test('buildAuthorizeUrl throws when clientId is missing', () => {
  assert.throws(() => buildAuthorizeUrl(baseConfig({ clientId: '' })), /clientId/u);
});

test('exchangeAuthorizationCode returns refresh + access tokens on success', async () => {
  const stubFetch = async (_url, options) => {
    const params = Object.fromEntries(new URLSearchParams(options.body).entries());
    assert.equal(params.code, 'code-1');
    assert.equal(params.grant_type, 'authorization_code');
    assert.equal(params.redirect_uri, 'http://127.0.0.1:53682/callback');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        refresh_token: 'new-refresh',
        access_token: 'new-access',
        expires_in: 3599,
        scope: GMAIL_SEND_SCOPE,
      }),
    };
  };
  const result = await exchangeAuthorizationCode(baseConfig(), 'code-1', { fetch: stubFetch });
  assert.equal(result.refreshToken, 'new-refresh');
  assert.equal(result.accessToken, 'new-access');
  assert.equal(result.expiresIn, 3599);
});

test('exchangeAuthorizationCode throws when refresh_token is missing', async () => {
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: 'a' }),
  });
  await assert.rejects(
    exchangeAuthorizationCode(baseConfig(), 'code-1', { fetch: stubFetch }),
    /no refresh_token/u
  );
});

test('exchangeAuthorizationCode throws with status when Google returns an error', async () => {
  const stubFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '{"error":"invalid_grant"}',
  });
  await assert.rejects(
    exchangeAuthorizationCode(baseConfig(), 'bad-code', { fetch: stubFetch }),
    /Gmail token exchange failed \(400\)/u
  );
});

test('fetchAccessToken uses refresh_token grant and returns the new access token', async () => {
  const stubFetch = async (_url, options) => {
    const params = Object.fromEntries(new URLSearchParams(options.body).entries());
    assert.equal(params.grant_type, 'refresh_token');
    assert.equal(params.refresh_token, 'refresh-xyz');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'ya29.rotated', expires_in: 3599, scope: GMAIL_SEND_SCOPE }),
    };
  };
  const { accessToken, expiresIn } = await fetchAccessToken(baseConfig(), { fetch: stubFetch });
  assert.equal(accessToken, 'ya29.rotated');
  assert.equal(expiresIn, 3599);
});
