import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createYoutubePlaylist,
  findYoutubePlaylistByTitle,
  insertYoutubePlaylistItem,
  YoutubePlaylistApiError,
} from '../src/youtube-playlists/youtube-api.mjs';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return JSON.stringify(payload); },
  };
}

test('YouTube playlist creation uses the authenticated official API', async () => {
  const calls = [];
  const result = await createYoutubePlaylist({
    accessToken: 'token',
    title: 'Find The Shiny — All Difficulties',
    description: 'Managed by ORION.',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse({
        id: 'PL-template',
        snippet: { title: 'Find The Shiny — All Difficulties' },
        status: { privacyStatus: 'public' },
      });
    },
  });
  assert.equal(result.playlistId, 'PL-template');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer token');
  assert.match(calls[0].url, /\/youtube\/v3\/playlists/iu);
});

test('managed playlist discovery reuses an exact existing title', async () => {
  const result = await findYoutubePlaylistByTitle({
    accessToken: 'token',
    title: 'Hard Challenges',
    fetchImpl: async () => jsonResponse({
      items: [
        { id: 'PL-other', snippet: { title: 'Other' }, status: { privacyStatus: 'public' } },
        { id: 'PL-hard', snippet: { title: 'Hard Challenges' }, status: { privacyStatus: 'public' } },
      ],
    }),
  });
  assert.deepEqual(result, {
    found: true,
    playlistId: 'PL-hard',
    title: 'Hard Challenges',
    privacy: 'public',
  });
});

test('playlist item insertion binds one video to one playlist', async () => {
  const result = await insertYoutubePlaylistItem({
    accessToken: 'token',
    playlistId: 'PL-hard',
    videoId: 'video-123',
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.snippet.playlistId, 'PL-hard');
      assert.equal(body.snippet.resourceId.videoId, 'video-123');
      return jsonResponse({
        id: 'PLI-1',
        snippet: { playlistId: 'PL-hard', resourceId: { videoId: 'video-123' } },
      });
    },
  });
  assert.equal(result.playlistItemId, 'PLI-1');
});

test('quota failures are classified as retryable', async () => {
  await assert.rejects(
    createYoutubePlaylist({
      accessToken: 'token',
      title: 'Hard Challenges',
      fetchImpl: async () => jsonResponse({
        error: { errors: [{ reason: 'quotaExceeded' }] },
      }, 403),
    }),
    (error) => error instanceof YoutubePlaylistApiError
      && error.code === 'quota_exceeded'
      && error.retryable === true,
  );
});
