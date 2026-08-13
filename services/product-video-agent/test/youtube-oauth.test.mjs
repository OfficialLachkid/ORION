import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildYoutubeAuthorizeUrl,
  buildYoutubeLoopbackRedirectUri,
  extractYoutubeOAuthClientCredentials,
  fetchYoutubeMineChannel,
  YOUTUBE_DEFAULT_SCOPES,
  YOUTUBE_READONLY_SCOPE,
  YT_ANALYTICS_READONLY_SCOPE,
} from '../src/youtube-oauth.mjs';

test('youtube oauth extracts desktop client credentials', () => {
  const credentials = extractYoutubeOAuthClientCredentials({
    installed: {
      client_id: 'desktop-client-id.apps.googleusercontent.com',
      client_secret: 'desktop-secret',
      redirect_uris: ['http://localhost'],
    },
  });

  assert.equal(credentials.clientId, 'desktop-client-id.apps.googleusercontent.com');
  assert.equal(credentials.clientSecret, 'desktop-secret');
  assert.equal(credentials.clientType, 'installed');
  assert.deepEqual(credentials.redirectUris, ['http://localhost']);
});

test('youtube authorize url requests offline consent for upload and analytics scopes', () => {
  const url = new URL(buildYoutubeAuthorizeUrl(
    { clientId: 'desktop-client-id.apps.googleusercontent.com' },
    {
      state: 'orion-test',
      loopbackPort: 54001,
      scopes: YOUTUBE_DEFAULT_SCOPES,
    },
  ));

  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.equal(url.searchParams.get('state'), 'orion-test');
  assert.equal(url.searchParams.get('redirect_uri'), buildYoutubeLoopbackRedirectUri(54001));
  assert.match(url.searchParams.get('scope') || '', /youtube\.upload/);
  assert.match(url.searchParams.get('scope') || '', /youtube\.force-ssl/);
  assert.match(url.searchParams.get('scope') || '', new RegExp(YOUTUBE_READONLY_SCOPE.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.match(url.searchParams.get('scope') || '', new RegExp(YT_ANALYTICS_READONLY_SCOPE.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.deepEqual(YOUTUBE_DEFAULT_SCOPES, [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ]);
});

test('youtube mine-channel fetch returns the authorized channel identity', async () => {
  const channel = await fetchYoutubeMineChannel('token-123', {
    endpoint: 'https://example.test/channels?part=id,snippet&mine=true',
    fetch: async (requestUrl, requestOptions) => {
      assert.equal(requestUrl, 'https://example.test/channels?part=id,snippet&mine=true');
      assert.equal(requestOptions.headers.Authorization, 'Bearer token-123');
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            items: [
              {
                id: 'UC1234567890',
                snippet: {
                  title: 'Poke Quizz',
                },
              },
            ],
          });
        },
      };
    },
  });

  assert.equal(channel.channelId, 'UC1234567890');
  assert.equal(channel.title, 'Poke Quizz');
});
