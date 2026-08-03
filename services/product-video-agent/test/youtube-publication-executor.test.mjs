import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deleteYoutubeVideo,
  fetchYoutubeVideoStatus,
  fetchYoutubeVideoStatuses,
  scheduleYoutubePublication,
  uploadYoutubePreviewVideo,
} from '../src/youtube-publication-executor.mjs';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const channelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  language: 'en-US',
  timezone: 'Europe/Amsterdam',
  status: 'active',
  schedule_slots: [{ hour: 8, minute: 0 }],
  workflow: {
    preview_visibility: 'unlisted',
    publish_visibility: 'public',
    require_preview_approval: true,
    require_publish_approval: true,
    delete_preview_on_reject: true,
  },
  youtube: {
    channel_id: 'UC-POKE-QUIZZ',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
});

test('uploadYoutubePreviewVideo refreshes the token and uploads a preview video', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-youtube-preview-'));
  const filePath = resolve(root, 'preview.mp4');
  await writeFile(filePath, Buffer.from('fake-mp4'));
  const calls = [];

  const uploaded = await uploadYoutubePreviewVideo({
    publication: {
      id: 'publication-1',
      title: 'Guess These Pokemon',
      description: 'Beat the timer.',
      hashtags: ['#pokemon', '#shorts'],
      metadata: {
        render_path: filePath,
      },
    },
    videoRow: {
      render: {
        output_path: filePath,
      },
    },
    channelProfile,
    clientConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    },
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' });
      }
      if (String(url).includes('/upload/youtube/v3/videos')) {
        return Response.json({ id: 'yt-123' });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    },
  });

  assert.equal(uploaded.externalId, 'yt-123');
  assert.equal(uploaded.previewUrl, 'https://youtube.com/shorts/yt-123');
  assert.ok(calls.some((call) => call.url.includes('oauth2.googleapis.com/token')));
  assert.ok(calls.some((call) => call.url.includes('uploadType=multipart')));
});

test('scheduleYoutubePublication sends the scheduled publish update', async () => {
  const calls = [];
  const scheduled = await scheduleYoutubePublication({
    publication: {
      external_id: 'yt-123',
    },
    scheduledFor: '2026-08-01T10:00:00.000Z',
    clientConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    },
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' });
      }
      if (String(url).includes('/youtube/v3/videos?part=status')) {
        return Response.json({ id: 'yt-123' });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    },
  });

  assert.equal(scheduled.externalId, 'yt-123');
  assert.equal(scheduled.scheduledFor, '2026-08-01T10:00:00.000Z');
  assert.ok(calls.some((call) => call.url.includes('/youtube/v3/videos?part=status')));
});

test('deleteYoutubeVideo sends the delete request for a rejected preview', async () => {
  const calls = [];
  const deleted = await deleteYoutubeVideo({
    externalId: 'yt-123',
    clientConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    },
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' });
      }
      if (String(url).includes('/youtube/v3/videos?id=yt-123')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    },
  });

  assert.equal(deleted.externalId, 'yt-123');
  assert.ok(calls.some((call) => call.url.includes('/youtube/v3/videos?id=yt-123')));
});

test('fetchYoutubeVideoStatus returns the live YouTube visibility state', async () => {
  const calls = [];
  const status = await fetchYoutubeVideoStatus({
    externalId: 'yt-123',
    clientConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    },
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' });
      }
      if (String(url).includes('/youtube/v3/videos?part=status%2Csnippet&id=yt-123')) {
        return Response.json({
          items: [
            {
              id: 'yt-123',
              status: {
                privacyStatus: 'public',
              },
              snippet: {
                title: 'Type Combination! Psychic | Water',
                publishedAt: '2026-08-01T22:23:40Z',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    },
  });

  assert.equal(status.externalId, 'yt-123');
  assert.equal(status.privacyStatus, 'public');
  assert.equal(status.publishedAt, '2026-08-01T22:23:40Z');
  assert.equal(status.title, 'Type Combination! Psychic | Water');
  assert.ok(calls.some((call) => call.url.includes('/youtube/v3/videos?part=status%2Csnippet&id=yt-123')));
});

test('fetchYoutubeVideoStatuses resolves found and missing ids in one batch', async () => {
  const calls = [];
  const statuses = await fetchYoutubeVideoStatuses({
    externalIds: ['yt-123', 'yt-missing'],
    clientConfig: {
      clientId: 'client-id',
      clientSecret: 'client-secret',
    },
    refreshToken: 'refresh-token',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'access-token', expires_in: 3600, token_type: 'Bearer' });
      }
      if (String(url).includes('/youtube/v3/videos?part=status%2Csnippet&id=yt-123%2Cyt-missing')) {
        return Response.json({
          items: [
            {
              id: 'yt-123',
              status: {
                privacyStatus: 'unlisted',
              },
              snippet: {
                title: 'Type Combination! Fire | Water',
                publishedAt: '2026-08-01T22:23:40Z',
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    },
  });

  assert.deepEqual(statuses.map((status) => ({
    externalId: status.externalId,
    found: status.found,
    privacyStatus: status.privacyStatus,
  })), [
    {
      externalId: 'yt-123',
      found: true,
      privacyStatus: 'unlisted',
    },
    {
      externalId: 'yt-missing',
      found: false,
      privacyStatus: '',
    },
  ]);
  assert.ok(calls.some((call) => call.url.includes('/youtube/v3/videos?part=status%2Csnippet&id=yt-123%2Cyt-missing')));
});
