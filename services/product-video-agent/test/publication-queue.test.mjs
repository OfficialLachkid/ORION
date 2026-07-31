import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPublicationQueuePlan,
  selectRelatedPublicationCandidate,
} from '../src/publication-queue.mjs';
import {
  normalizePublicationChannelProfile,
  toVideoChannelRow,
} from '../src/publication-channels.mjs';
import {
  buildYoutubePreviewUploadPlan,
  buildYoutubeScheduleUpdatePlan,
} from '../src/youtube-publication.mjs';

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
    channel_id: 'UC-POKE-QUIZZ',
    default_category_id: '24',
    oauth_client_secret_path: 'config/youtube/client-secret.json',
    oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
  },
});

const previewPending = {
  id: 'pub-preview',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Guess the Pokemon: Water / Flying',
  description: 'A short quiz.',
  hashtags: ['#pokemon', '#shorts'],
  metadata: {
    workflow_state: 'preview_upload_pending',
    type_pair: ['water', 'flying'],
  },
  created_at: '2026-07-30T05:00:00.000Z',
};

const previewApproved = {
  id: 'pub-schedule',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'approved',
  title: 'Guess the Pokemon: Dark / Dragon',
  description: 'A darker short quiz.',
  hashtags: ['#pokemon', '#shorts'],
  external_id: 'yt-123',
  metadata: {
    workflow_state: 'preview_approved',
    type_pair: ['dark', 'dragon'],
  },
  created_at: '2026-07-30T05:10:00.000Z',
};

const publishedSameType = {
  id: 'pub-old-dark-dragon',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  status: 'published',
  title: 'Previous Dark / Dragon',
  description: 'Published already.',
  hashtags: ['#pokemon', '#shorts'],
  public_url: 'https://youtube.com/shorts/example-dark-dragon',
  metadata: {
    workflow_state: 'published',
    type_pair: ['dark', 'dragon'],
  },
  published_at: '2026-07-29T16:00:00.000Z',
  created_at: '2026-07-29T12:00:00.000Z',
};

test('publication queue separates preview uploads from scheduled publish candidates', () => {
  const queuePlan = buildPublicationQueuePlan({
    publications: [previewPending, previewApproved],
    channelProfiles: [channelProfile],
    asOf: '2026-07-30T06:30:00.000Z',
  });

  assert.equal(queuePlan.channels.length, 1);
  assert.deepEqual(queuePlan.channels[0].preview_upload_queue, [
    {
      publication_id: 'pub-preview',
      title: 'Guess the Pokemon: Water / Flying',
      workflow_state: 'preview_upload_pending',
      status: 'approved',
    },
  ]);
  assert.deepEqual(queuePlan.channels[0].scheduled_publish_queue, [
    {
      publication_id: 'pub-schedule',
      title: 'Guess the Pokemon: Dark / Dragon',
      workflow_state: 'scheduled',
      scheduled_for: '2026-07-30T10:00:00.000Z',
    },
  ]);
});

test('youtube preview plan uses an unlisted review upload', () => {
  const plan = buildYoutubePreviewUploadPlan(previewPending, channelProfile);
  assert.equal(plan.action, 'videos.insert');
  assert.equal(plan.body.status.privacyStatus, 'unlisted');
  assert.equal(plan.body.snippet.title, previewPending.title);
});

test('youtube schedule update uses private plus publishAt', () => {
  const plan = buildYoutubeScheduleUpdatePlan(previewApproved, '2026-07-30T08:00:00.000Z');
  assert.equal(plan.action, 'videos.update');
  assert.equal(plan.body.status.privacyStatus, 'private');
  assert.equal(plan.body.status.publishAt, '2026-07-30T08:00:00.000Z');
});

test('related publication selection prefers the latest same-type published short', () => {
  const related = selectRelatedPublicationCandidate(
    [previewApproved, previewPending, publishedSameType],
    previewApproved,
  );
  assert.equal(related?.id, 'pub-old-dark-dragon');
});

test('channel profiles upsert into the generic video_channels row shape', () => {
  const row = toVideoChannelRow(channelProfile);
  assert.equal(row.id, 'video-channel-poke-quizz-youtube');
  assert.equal(row.platform, 'youtube_shorts');
  assert.equal(row.language, 'en-US');
  assert.equal(row.settings.timezone, 'Europe/Amsterdam');
  assert.equal(row.settings.workflow.preview_visibility, 'unlisted');
  assert.equal(row.settings.schedule_slots.length, 3);
});
