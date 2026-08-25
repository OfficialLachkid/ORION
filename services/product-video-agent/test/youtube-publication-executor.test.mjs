import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  deleteYoutubeVideo,
  ensureYoutubeAudienceDeclared,
  fetchYoutubeVideoStatus,
  fetchYoutubeVideoStatuses,
  postYoutubeTopLevelComment,
  scheduleYoutubePublication,
  uploadYoutubePreviewVideo,
  YoutubeApiQuotaExceededError,
  YoutubeCommentPostError,
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

test('postYoutubeTopLevelComment sends commentThreads.insert with snippet payload', async () => {
  const requests = [];
  const result = await postYoutubeTopLevelComment({
    externalId: 'yt-video-123',
    textOriginal: 'Did you get it before the reveal?',
    clientConfig: {
      clientId: 'desktop-client-id',
      clientSecret: 'desktop-secret',
    },
    refreshToken: 'refresh-token-123',
    fetchImpl: async (requestUrl, requestOptions) => {
      requests.push({
        requestUrl: String(requestUrl),
        requestOptions: {
          ...requestOptions,
          body: requestOptions?.body || '',
        },
      });

      if (requests.length === 1) {
        assert.equal(requestUrl, 'https://oauth2.googleapis.com/token');
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              access_token: 'access-token-123',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'https://www.googleapis.com/auth/youtube.force-ssl',
            });
          },
        };
      }

      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            id: 'comment-thread-123',
          });
        },
      };
    },
  });

  assert.equal(result.externalId, 'yt-video-123');
  assert.equal(result.commentId, 'comment-thread-123');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].requestUrl, 'https://www.googleapis.com/youtube/v3/commentThreads?part=snippet');
  assert.equal(requests[1].requestOptions.method, 'POST');
  assert.equal(requests[1].requestOptions.headers.Authorization, 'Bearer access-token-123');
  assert.deepEqual(JSON.parse(requests[1].requestOptions.body), {
    snippet: {
      videoId: 'yt-video-123',
      topLevelComment: {
        snippet: {
          textOriginal: 'Did you get it before the reveal?',
        },
      },
    },
  });
});

test('postYoutubeTopLevelComment throws YoutubeCommentPostError when the API rejects the comment', async () => {
  await assert.rejects(
    () => postYoutubeTopLevelComment({
      externalId: 'yt-video-123',
      textOriginal: 'Did you get it before the reveal?',
      clientConfig: {
        clientId: 'desktop-client-id',
        clientSecret: 'desktop-secret',
      },
      refreshToken: 'refresh-token-123',
      fetchImpl: async (requestUrl) => {
        if (String(requestUrl) === 'https://oauth2.googleapis.com/token') {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({
                access_token: 'access-token-123',
                expires_in: 3600,
                token_type: 'Bearer',
              });
            },
          };
        }

        return {
          ok: false,
          status: 403,
          async text() {
            return JSON.stringify({
              error: {
                errors: [
                  {
                    reason: 'commentsDisabled',
                  },
                ],
              },
            });
          },
        };
      },
    }),
    (error) => {
      assert.ok(error instanceof YoutubeCommentPostError);
      assert.equal(error.status, 403);
      assert.equal(error.reason, 'commentsDisabled');
      return true;
    },
  );
});

test('ensureYoutubeAudienceDeclared writes selfDeclaredMadeForKids when currently undeclared', async () => {
  // Regression guard for 2026-08-25: Studio's audience-question banner
  // blocks Save on ANY change until selfDeclaredMadeForKids is set. Call
  // BEFORE the Studio automation runs, only when undeclared.
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || 'GET', body: options?.body || null });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' });
    }
    if (String(url).includes('/youtube/v3/videos?part=status') && (options?.method === undefined || options.method === 'GET')) {
      // Simulate an item with NO selfDeclaredMadeForKids field — Studio's
      // "You need to answer this question" state.
      return Response.json({ items: [{ id: 'yt-undeclared', status: { privacyStatus: 'public' } }] });
    }
    if (String(url).includes('/youtube/v3/videos?part=status') && options?.method === 'PUT') {
      return Response.json({});
    }
    return Response.json({});
  };

  const result = await ensureYoutubeAudienceDeclared({
    externalId: 'yt-undeclared',
    madeForKids: false,
    clientConfig: { clientId: 'c', clientSecret: 's' },
    refreshToken: 'r',
    fetchImpl,
  });

  assert.equal(result.changed, true);
  assert.equal(result.currentValue, false);
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.ok(putCall, 'expected a PUT videos.update call');
  assert.match(putCall.body, /selfDeclaredMadeForKids/u);
});

test('ensureYoutubeAudienceDeclared is a no-op when the flag is already declared', async () => {
  // Never override an existing true/false — the operator's declaration
  // stands. Only touches videos where the field is undefined/missing.
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || 'GET' });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' });
    }
    if (String(url).includes('/youtube/v3/videos?part=status')) {
      return Response.json({ items: [{ id: 'yt-declared', status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }] });
    }
    return Response.json({});
  };

  const result = await ensureYoutubeAudienceDeclared({
    externalId: 'yt-declared',
    madeForKids: false,
    clientConfig: { clientId: 'c', clientSecret: 's' },
    refreshToken: 'r',
    fetchImpl,
  });

  assert.equal(result.changed, false);
  assert.equal(result.previousValue, false);
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall, undefined, 'no PUT should be issued when already declared');
});

test('ensureYoutubeAudienceDeclared never overrides an existing true declaration to false', async () => {
  // Critical safety guard: if a video is legitimately declared "made for
  // kids", we must not silently flip it to false. The operator's
  // declaration is authoritative — this helper only fills the undeclared
  // gap.
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method || 'GET' });
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' });
    }
    if (String(url).includes('/youtube/v3/videos?part=status')) {
      return Response.json({ items: [{ id: 'yt-kids', status: { privacyStatus: 'public', selfDeclaredMadeForKids: true } }] });
    }
    return Response.json({});
  };

  const result = await ensureYoutubeAudienceDeclared({
    externalId: 'yt-kids',
    madeForKids: false,
    clientConfig: { clientId: 'c', clientSecret: 's' },
    refreshToken: 'r',
    fetchImpl,
  });

  assert.equal(result.changed, false);
  assert.equal(result.previousValue, true);
  const putCall = calls.find((c) => c.method === 'PUT');
  assert.equal(putCall, undefined, 'declared-true must NOT be flipped to false');
});

test('fetchYoutubeVideoStatus throws YoutubeApiQuotaExceededError on quotaExceeded 403', async () => {
  // Regression guard for 2026-08-25: YouTube's quotaExceeded 403 is a
  // run-terminator (all subsequent calls fail the same way until midnight
  // Pacific). Callers need to distinguish it from generic 403s to bail
  // early instead of churning through the queue.
  const fetchImpl = async (url) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' });
    }
    return new Response(JSON.stringify({
      error: {
        code: 403,
        errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota', message: 'Quota exceeded' }],
        message: 'The request cannot be completed because you have exceeded your quota.',
      },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  };
  await assert.rejects(
    fetchYoutubeVideoStatus({ externalId: 'yt-1', clientConfig: { clientId: 'c', clientSecret: 's' }, refreshToken: 'r', fetchImpl }),
    (err) => err instanceof YoutubeApiQuotaExceededError && err.code === 'quota_exceeded',
  );
});

test('ensureYoutubeAudienceDeclared throws YoutubeApiQuotaExceededError when the PUT itself hits quota', async () => {
  // A cheap videos.list (1 unit) may succeed while the videos.update (50
  // units) that follows blows the daily allocation. Distinguish that from
  // a legit non-quota 403.
  const fetchImpl = async (url, options) => {
    if (String(url).includes('oauth2.googleapis.com/token')) {
      return Response.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' });
    }
    if (String(url).includes('/youtube/v3/videos?part=status') && (options?.method === undefined || options.method === 'GET')) {
      return Response.json({ items: [{ id: 'yt-1', status: { privacyStatus: 'public' } }] });
    }
    if (String(url).includes('/youtube/v3/videos?part=status') && options?.method === 'PUT') {
      return new Response(JSON.stringify({
        error: { code: 403, errors: [{ reason: 'quotaExceeded', domain: 'youtube.quota' }] },
      }), { status: 403, headers: { 'Content-Type': 'application/json' } });
    }
    return Response.json({});
  };
  await assert.rejects(
    ensureYoutubeAudienceDeclared({ externalId: 'yt-1', madeForKids: false, clientConfig: { clientId: 'c', clientSecret: 's' }, refreshToken: 'r', fetchImpl }),
    (err) => err instanceof YoutubeApiQuotaExceededError,
  );
});
