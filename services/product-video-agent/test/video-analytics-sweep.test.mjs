import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

import { runVideoAnalyticsSweep } from '../scripts/run-video-analytics-sweep.mjs';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const analyticsChannelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  timezone: 'Europe/Amsterdam',
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

test('runVideoAnalyticsSweep captures due snapshots and posts only the shared overview digest by default', async () => {
  const statePath = resolve(tmpdir(), `orion-video-analytics-state-${Date.now()}.json`);
  const sendCalls = [];
  const upserts = [];
  let messageCounter = 0;

  const store = {
    async fetchPublishedPublicationsByChannel() {
      return [
        {
          id: 'pub-123',
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          status: 'published',
          external_id: 'yt-123',
          title: 'Electric Grass #shorts',
          published_at: '2026-08-09T12:00:00.000Z',
          metadata: {
            type_pair: ['electric', 'grass'],
            render_path: '/tmp/electric-grass.mp4',
          },
        },
      ];
    },
    async fetchLatestAnalyticsSnapshot() {
      return null;
    },
    async upsertVideoAnalyticsSnapshot(row) {
      upserts.push(row);
      return {
        publication_id: row.publication_id,
        captured_at: row.captured_at,
        metrics: row.metrics,
        raw_payload: row.raw_payload,
      };
    },
  };

  try {
    const result = await runVideoAnalyticsSweep({
      'as-of': '2026-08-10T09:00:00.000Z',
      'post-discord': true,
      'force-digest': true,
      'state-path': statePath,
    }, {
      runtimeConfig: {
        env: {
          DISCORD_BOT_TOKEN: 'discord-token',
          YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN: 'refresh-token',
        },
        channelIds: {
          orionAnalytics: '1528783542195323061',
        },
      },
      store,
      loadPublicationChannelProfiles: async () => [analyticsChannelProfile],
      loadYoutubeClientCredentials: async () => ({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
      createYoutubeAnalyticsAccessToken: async () => 'access-token',
      fetchYoutubeVideoStatisticsMap: async () => ({
        statisticsByVideoId: new Map([
          ['yt-123', {
            statistics: {
              viewCount: '1200',
              likeCount: '80',
              commentCount: '5',
            },
            snippet: {
              title: 'Electric Grass #shorts',
            },
          }],
        ]),
      }),
      fetchYoutubePublicationMetrics: async () => ({
        metrics: {
          views: 1200,
          likes: 80,
          comments: 5,
          shares: 3,
          avg_view_duration_sec: 18,
          avg_view_percentage: 72,
          subs_gained: 4,
          subs_lost: 1,
        },
        raw_payload: {
          source: 'test',
        },
      }),
      sendDiscordChannelMessage: async (_config, channelId, payload) => {
        messageCounter += 1;
        sendCalls.push({ channelId, payload });
        return {
          posted: true,
          messageId: `message-${messageCounter}`,
          channelId,
        };
      },
      fetchImpl: async () => {
        throw new Error('No direct Discord thread API call should occur when post-channel-threads is disabled.');
      },
    });

    const state = JSON.parse(await readFile(statePath, 'utf8'));

    assert.equal(result.digest_posted, true);
    assert.equal(result.analytics_channel_id, '1528783542195323061');
    assert.deepEqual(upserts, [
      {
        publication_id: 'pub-123',
        captured_at: '2026-08-10T09:00:00.000Z',
        metrics: {
          views: 1200,
          likes: 80,
          comments: 5,
          shares: 3,
          avg_view_duration_sec: 18,
          avg_view_percentage: 72,
          subs_gained: 4,
          subs_lost: 1,
        },
        raw_payload: {
          source: 'test',
        },
      },
    ]);
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].action, 'captured');
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].channelId, '1528783542195323061');
    assert.equal(state.last_weekly_digest_at, '2026-08-10T09:00:00.000Z');
    assert.deepEqual(state.analytics_threads, {});
  } finally {
    await rm(statePath, { force: true });
  }
});
