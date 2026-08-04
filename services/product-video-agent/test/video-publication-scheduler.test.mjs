import test from 'node:test';
import assert from 'node:assert/strict';
import { runVideoPublicationScheduler } from '../scripts/run-video-publication-scheduler.mjs';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';

const activeChannelProfile = normalizePublicationChannelProfile({
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  niche: 'pokemon_quiz',
  content_lane: 'poke-quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  timezone: 'Europe/Amsterdam',
  schedule_slots: [
    { hour: 8, minute: 0 },
    { hour: 12, minute: 0 },
    { hour: 16, minute: 0 },
  ],
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

const pausedChannelProfile = {
  ...activeChannelProfile,
  id: 'video-channel-paused-youtube',
  account_key: 'paused-youtube',
  name: 'Paused Channel',
  status: 'paused',
};

const previewPending = {
  id: 'pub-preview',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Preview Pending',
  metadata: {
    workflow_state: 'preview_upload_pending',
  },
  created_at: '2026-07-31T08:00:00.000Z',
};

const previewApproved = {
  id: 'pub-approved',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Preview Approved',
  external_id: 'yt-123',
  metadata: {
    workflow_state: 'preview_approved',
  },
  created_at: '2026-07-31T08:10:00.000Z',
};

test('runVideoPublicationScheduler executes preview uploads and schedule updates for active channels', async () => {
  const executionCalls = [];
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile, pausedChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async ({ channelSelector, scheduleApproved }) => {
      executionCalls.push({ channelSelector, scheduleApproved });
      return scheduleApproved
        ? [{ publication_id: 'pub-approved', action: 'schedule_update' }]
        : [{ publication_id: 'pub-preview', action: 'preview_upload' }];
    },
  });

  assert.deepEqual(executionCalls, [
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: false },
    { channelSelector: 'poke-quizz-youtube', scheduleApproved: true },
  ]);
  assert.equal(result.queue_plan.channels.length, 1);
  assert.equal(result.execution_results.length, 1);
  assert.deepEqual(result.execution_results[0].preview_upload_results, [
    { publication_id: 'pub-preview', action: 'preview_upload' },
  ]);
  assert.deepEqual(result.execution_results[0].schedule_update_results, [
    { publication_id: 'pub-approved', action: 'schedule_update' },
  ]);
});

test('runVideoPublicationScheduler skips execution in plan-only mode', async () => {
  let executionCallCount = 0;
  const result = await runVideoPublicationScheduler({
    channels: 'services/product-video-agent/publication-channels.example.json',
    'as-of': '2026-08-01T10:01:00.000Z',
    'plan-only': true,
  }, {
    runtimeConfig: { env: {} },
    loadPublicationChannelProfiles: async () => [activeChannelProfile],
    loadQueuedPublications: async () => [previewPending, previewApproved],
    executePublicationPhase: async () => {
      executionCallCount += 1;
      return [];
    },
  });

  assert.equal(executionCallCount, 0);
  assert.deepEqual(result.execution_results, []);
  assert.equal(result.queue_plan.channels[0].scheduled_publish_queue.length, 1);
});
