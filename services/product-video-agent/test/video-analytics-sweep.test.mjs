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
    assert.equal(sendCalls[0].payload.embeds[0].title, 'Weekly YouTube Analytics Digest (7d) | 2026-08-10');
    assert.match(sendCalls[0].payload.embeds[0].description, /New videos \(7D\): \*\*1\*\*/u);
    assert.match(sendCalls[0].payload.embeds[0].description, /Videos with snapshots \(7D\): \*\*1\*\*/u);
    assert.match(sendCalls[0].payload.embeds[0].description, /Crossed 10k views \(7D\): \*\*0\*\*/u);
    assert.match(sendCalls[0].payload.embeds[0].description, /Combined views \(7D\): \*\*1,200\*\*/u);
    assert.match(sendCalls[0].payload.embeds[0].description, /Total views \(all time\): \*\*1,200\*\*/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- Channel: \[Poke Quizz\]\(https:\/\/www\.youtube\.com\/channel\/UC-POKE-QUIZZ\)/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- New videos \(7D\): 1/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- Views \(7D\): 1,200/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- Views \(all time\): 1,200/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- Best performer \(7D\): \[Electric Grass #shorts\]\(https:\/\/www\.youtube\.com\/watch\?v=yt-123\) \(1,200 views\)/u);
    assert.match(sendCalls[0].payload.embeds[0].fields[0].value, /- Signal: insufficient data/u);
    assert.equal('footer' in sendCalls[0].payload.embeds[0], false);
    assert.equal('timestamp' in sendCalls[0].payload.embeds[0], false);
    assert.equal(state.last_weekly_digest_at, '2026-08-10T09:00:00.000Z');
    assert.deepEqual(state.analytics_threads, {});
  } finally {
    await rm(statePath, { force: true });
  }
});

test('runVideoAnalyticsSweep posts an on-demand single-channel digest into the corresponding analytics thread', async () => {
  const statePath = resolve(tmpdir(), `orion-video-analytics-state-${Date.now()}-ondemand.json`);
  const sendCalls = [];
  let messageCounter = 0;

  const store = {
    async fetchPublishedPublicationsByChannel() {
      return [
        {
          id: 'pub-ondemand-123',
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          status: 'published',
          external_id: 'yt-ondemand-123',
          title: 'Ghost Ground #shorts',
          published_at: '2026-08-09T12:00:00.000Z',
          metadata: {
            type_pair: ['ghost', 'ground'],
            render_path: '/tmp/ghost-ground.mp4',
          },
        },
      ];
    },
    async fetchLatestAnalyticsSnapshot() {
      return null;
    },
    async upsertVideoAnalyticsSnapshot(row) {
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
      channel: 'poke-quizz-youtube',
      'post-discord': true,
      'digest-mode': 'on_demand',
      'post-target': 'corresponding',
      'digest-window-days': 3,
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
          ['yt-ondemand-123', {
            statistics: {
              viewCount: '2400',
              likeCount: '90',
              commentCount: '8',
            },
            snippet: {
              title: 'Ghost Ground #shorts',
            },
          }],
        ]),
      }),
      fetchYoutubePublicationMetrics: async () => ({
        metrics: {
          views: 2400,
          likes: 90,
          comments: 8,
          shares: 4,
          avg_view_duration_sec: 20,
          avg_view_percentage: 76,
          subs_gained: 5,
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
      fetchImpl: async (url) => {
        if (String(url).includes('/threads')) {
          return {
            ok: true,
            json: async () => ({
              id: 'analytics-thread-poke-quizz',
            }),
          };
        }
        throw new Error(`Unexpected fetch call: ${url}`);
      },
    });

    const state = JSON.parse(await readFile(statePath, 'utf8'));

    assert.equal(result.digest_posted, true);
    assert.equal(result.analytics_channel_id, '1528783542195323061');
    assert.equal(result.posted_channel_id, 'analytics-thread-poke-quizz');
    assert.equal(result.digest_mode, 'on_demand');
    assert.equal(result.post_target, 'corresponding');
    assert.equal(sendCalls.length, 2);
    assert.equal(sendCalls[0].channelId, '1528783542195323061');
    assert.equal(sendCalls[0].payload.content, 'Analytics thread for **Poke Quizz** (poke-quizz-youtube).');
    assert.equal(sendCalls[1].channelId, 'analytics-thread-poke-quizz');
    assert.equal(sendCalls[1].payload.embeds[0].title, 'YouTube Analytics Digest (3d) | 2026-08-10');
    assert.match(sendCalls[1].payload.embeds[0].description, /New videos \(3D\): \*\*1\*\*/u);
    assert.match(sendCalls[1].payload.embeds[0].description, /Combined views \(3D\): \*\*2,400\*\*/u);
    assert.match(sendCalls[1].payload.embeds[0].fields[0].value, /- Channel: \[Poke Quizz\]\(https:\/\/www\.youtube\.com\/channel\/UC-POKE-QUIZZ\)/u);
    assert.match(sendCalls[1].payload.embeds[0].fields[0].value, /- New videos \(3D\): 1/u);
    assert.match(sendCalls[1].payload.embeds[0].fields[0].value, /- Views \(3D\): 2,400/u);
    assert.match(sendCalls[1].payload.embeds[0].fields[0].value, /- Best performer \(3D\): \[Ghost Ground #shorts\]\(https:\/\/www\.youtube\.com\/watch\?v=yt-ondemand-123\) \(2,400 views\)/u);
    assert.equal(state.last_weekly_digest_at, '');
    assert.deepEqual(state.analytics_threads, {
      'video-channel-poke-quizz-youtube': {
        thread_id: 'analytics-thread-poke-quizz',
        anchor_message_id: 'message-1',
        channel_name: 'Poke Quizz',
        account_key: 'poke-quizz-youtube',
        created_at: state.analytics_threads['video-channel-poke-quizz-youtube'].created_at,
      },
    });
  } finally {
    await rm(statePath, { force: true });
  }
});
