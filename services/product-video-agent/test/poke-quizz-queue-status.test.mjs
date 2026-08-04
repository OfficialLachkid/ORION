import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicationChannelProfile } from '../src/publication-channels.mjs';
import {
  buildPokeQuizzQueueStatusPayload,
  computePokeQuizzQueueStatus,
} from '../src/poke-quizz-queue-status.mjs';

const channelProfile = normalizePublicationChannelProfile({
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
    channel_id: 'UCvMqBsEPDvjgNRMymQyefFg',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
});

test('Poke Quizz queue status counts future scheduled rows and preview uploads', () => {
  const queueStatus = computePokeQuizzQueueStatus([
    {
      id: 'review-1',
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
      status: 'approved',
      metadata: { workflow_state: 'preview_uploaded' },
    },
    {
      id: 'scheduled-1',
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
      status: 'scheduled',
      scheduled_for: '2026-08-03T06:00:00.000Z',
      created_at: '2026-08-02T10:00:00.000Z',
      metadata: { workflow_state: 'scheduled' },
    },
    {
      id: 'scheduled-2',
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
      status: 'scheduled',
      scheduled_for: '2026-08-03T10:00:00.000Z',
      created_at: '2026-07-31T10:00:00.000Z',
      metadata: { workflow_state: 'scheduled' },
    },
  ], channelProfile, '2026-08-02T18:00:00.000Z');

  assert.equal(queueStatus.reviewReadyCount, 1);
  assert.equal(queueStatus.publishQueueCount, 2);
  assert.equal(queueStatus.nextScheduledFor, '2026-08-03T06:00:00.000Z');
});

test('Poke Quizz queue status payload includes queue and review counts', () => {
  const payload = buildPokeQuizzQueueStatusPayload({
    channelProfile,
    queueStatus: {
      reviewReadyCount: 7,
      publishQueueCount: 5,
      nextScheduledFor: '2026-08-03T06:00:00.000Z',
    },
    reviewThreadId: '1532709429902839810',
    reviewTargetCount: 10,
  });

  assert.equal(payload.embeds?.[0]?.title, 'Poke Quizz Queue Status');
  assert.match(payload.embeds?.[0]?.description || '', /has \*\*5\*\* video\(s\) in publish queue/u);
  assert.match(payload.embeds?.[0]?.description || '', /1532709429902839810/u);
  assert.equal(payload.embeds?.[0]?.color, 0xFEE75C);
});
