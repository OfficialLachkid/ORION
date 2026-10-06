import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildTikTokAuthorizeUrl,
  buildTikTokCredentialEnvValues,
  createTikTokPkcePair,
  exchangeTikTokAuthorizationCode,
  fetchTikTokCreatorInfo,
  refreshTikTokAccessToken,
  resolveTikTokCredentialEnvKeys,
  TIKTOK_DEFAULT_SCOPES,
  validateTikTokDesktopRedirectUri,
} from '../src/tiktok-oauth.mjs';

const clientConfig = {
  clientKey: 'client-key-123',
  clientSecret: 'client-secret-456',
};

function jsonResponse(payload, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

test('tiktok desktop oauth uses TikTok hex-encoded SHA256 PKCE', () => {
  const verifier = 'A'.repeat(64);
  const pair = createTikTokPkcePair({ verifier });

  assert.equal(pair.verifier, verifier);
  assert.equal(pair.challenge, createHash('sha256').update(verifier).digest('hex'));
  assert.equal(pair.challenge.length, 64);
  assert.equal(pair.method, 'S256');
});

test('tiktok authorize URL contains the registered loopback redirect and required scopes', () => {
  const redirectUri = validateTikTokDesktopRedirectUri('http://127.0.0.1:53684/callback/');
  const url = new URL(buildTikTokAuthorizeUrl(clientConfig, {
    redirectUri,
    scopes: TIKTOK_DEFAULT_SCOPES,
    state: 'csrf-state-123',
    codeChallenge: 'a'.repeat(64),
  }));

  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/');
  assert.equal(url.searchParams.get('client_key'), clientConfig.clientKey);
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,video.publish');
  assert.equal(url.searchParams.get('state'), 'csrf-state-123');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('tiktok authorization-code exchange sends desktop PKCE fields and maps rotating tokens', async () => {
  const tokens = await exchangeTikTokAuthorizationCode(clientConfig, 'authorization-code', {
    redirectUri: 'http://127.0.0.1:53684/callback/',
    codeVerifier: 'v'.repeat(64),
    fetch: async (url, request) => {
      assert.equal(url, 'https://open.tiktokapis.com/v2/oauth/token/');
      assert.equal(request.method, 'POST');
      const body = new URLSearchParams(request.body);
      assert.equal(body.get('client_key'), clientConfig.clientKey);
      assert.equal(body.get('client_secret'), clientConfig.clientSecret);
      assert.equal(body.get('code'), 'authorization-code');
      assert.equal(body.get('code_verifier'), 'v'.repeat(64));
      assert.equal(body.get('redirect_uri'), 'http://127.0.0.1:53684/callback/');
      assert.equal(body.get('grant_type'), 'authorization_code');
      return jsonResponse({
        access_token: 'access-one',
        refresh_token: 'refresh-one',
        open_id: 'open-id-one',
        expires_in: 86400,
        refresh_expires_in: 31536000,
        scope: 'user.info.basic,video.publish',
        token_type: 'Bearer',
      });
    },
  });

  assert.deepEqual(tokens, {
    accessToken: 'access-one',
    refreshToken: 'refresh-one',
    openId: 'open-id-one',
    expiresIn: 86400,
    refreshExpiresIn: 31536000,
    scope: 'user.info.basic,video.publish',
    tokenType: 'Bearer',
  });
});

test('tiktok token refresh accepts refresh-token rotation', async () => {
  const tokens = await refreshTikTokAccessToken(clientConfig, 'refresh-one', {
    fetch: async (_url, request) => {
      const body = new URLSearchParams(request.body);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-one');
      return jsonResponse({
        access_token: 'access-two',
        refresh_token: 'refresh-two',
        open_id: 'open-id-one',
        expires_in: 86400,
        refresh_expires_in: 31536000,
        scope: 'user.info.basic,video.publish',
      });
    },
  });

  assert.equal(tokens.accessToken, 'access-two');
  assert.equal(tokens.refreshToken, 'refresh-two');
});

test('tiktok creator-info query verifies the authorized publishing identity', async () => {
  const creator = await fetchTikTokCreatorInfo('access-one', {
    fetch: async (url, request) => {
      assert.equal(url, 'https://open.tiktokapis.com/v2/post/publish/creator_info/query/');
      assert.equal(request.headers.Authorization, 'Bearer access-one');
      return jsonResponse({
        data: {
          creator_username: 'pokequizz7',
          creator_nickname: 'Poke Quiz',
          privacy_level_options: ['SELF_ONLY'],
        },
        error: { code: 'ok', message: '', log_id: 'log-one' },
      });
    },
  });

  assert.equal(creator.creator_username, 'pokequizz7');
  assert.deepEqual(creator.privacy_level_options, ['SELF_ONLY']);
});

test('tiktok account credential names derive from the configured access-token key', () => {
  const target = {
    tiktok: { access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN' },
  };
  assert.deepEqual(resolveTikTokCredentialEnvKeys(target), {
    accessToken: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
    refreshToken: 'TIKTOK_POKE_QUIZZ_REFRESH_TOKEN',
    accessTokenExpiresAt: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN_EXPIRES_AT',
    refreshTokenExpiresAt: 'TIKTOK_POKE_QUIZZ_REFRESH_TOKEN_EXPIRES_AT',
    openId: 'TIKTOK_POKE_QUIZZ_OPEN_ID',
    scopes: 'TIKTOK_POKE_QUIZZ_SCOPES',
  });

  assert.deepEqual(buildTikTokCredentialEnvValues(target, {
    accessToken: 'access-one',
    refreshToken: 'refresh-one',
    openId: 'open-id-one',
    expiresIn: 60,
    refreshExpiresIn: 120,
    scope: 'video.publish,user.info.basic',
  }, { now: new Date('2026-10-06T12:00:00.000Z') }), {
    TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'access-one',
    TIKTOK_POKE_QUIZZ_REFRESH_TOKEN: 'refresh-one',
    TIKTOK_POKE_QUIZZ_ACCESS_TOKEN_EXPIRES_AT: '2026-10-06T12:01:00.000Z',
    TIKTOK_POKE_QUIZZ_REFRESH_TOKEN_EXPIRES_AT: '2026-10-06T12:02:00.000Z',
    TIKTOK_POKE_QUIZZ_OPEN_ID: 'open-id-one',
    TIKTOK_POKE_QUIZZ_SCOPES: 'video.publish,user.info.basic',
  });
});
