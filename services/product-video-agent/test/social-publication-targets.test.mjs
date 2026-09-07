import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TIKTOK_VIDEO_PLATFORM,
  buildAdditionalPlatformPublicationRows,
  listEnabledAdditionalPublicationTargets,
  upsertAdditionalPlatformPublicationTargets,
} from '../src/social-publication-targets.mjs';

const sourceChannelProfile = {
  id: 'video-channel-poke-quizz-youtube',
  name: 'Poke Quizz',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  metadata: {
    publisher: {
      targets: [
        {
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          enabled: true,
        },
        {
          platform: 'tiktok',
          account_key: 'poke-quizz-tiktok',
          enabled: true,
          schedule_mode: 'orion',
          visibility: 'private',
          tiktok: {
            access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
            privacy_level: 'SELF_ONLY',
          },
        },
        {
          platform: 'tiktok_video',
          account_key: 'disabled-tiktok',
          enabled: false,
        },
      ],
    },
  },
};

const sourcePublication = {
  id: 'publication-source-youtube',
  video_id: 'video-source',
  platform: 'youtube_shorts',
  account_key: 'poke-quizz-youtube',
  title: 'Guess the Pokemon!',
  description: 'A short quiz.',
  hashtags: ['#pokemon', '#shorts'],
  preview_url: 'https://youtube.com/shorts/preview',
  external_id: 'yt-preview',
  metadata: {
    workflow_state: 'scheduled',
    template_id: 'pokemon.memory.v1',
    render_path: 'data/runtime/product-video-agent/poke-quizz/source.mp4',
    review_task_id: 'TASK-REVIEW',
    review_thread_id: 'review-thread',
    review_message_id: 'review-message',
  },
};

const videoRow = {
  id: 'video-source',
  title: 'Video row fallback title',
  render: {
    output_path: 'data/runtime/product-video-agent/poke-quizz/fallback.mp4',
  },
};

test('listEnabledAdditionalPublicationTargets returns enabled non-source platform targets only', () => {
  const targets = listEnabledAdditionalPublicationTargets(sourceChannelProfile);

  assert.equal(targets.length, 1);
  assert.equal(targets[0].platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(targets[0].accountKey, 'poke-quizz-tiktok');
  assert.equal(targets[0].tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
});

test('buildAdditionalPlatformPublicationRows creates a scheduled TikTok publication row from a YouTube source', () => {
  const [row] = buildAdditionalPlatformPublicationRows({
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
    asOf: '2026-09-07T12:00:00.000Z',
  });

  assert.equal(row.platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(row.account_key, 'poke-quizz-tiktok');
  assert.equal(row.video_id, 'video-source');
  assert.equal(row.status, 'scheduled');
  assert.equal(row.scheduled_for, '2026-09-08T10:00:00.000Z');
  assert.equal(row.metadata.workflow_state, 'scheduled');
  assert.equal(row.metadata.source_publication_id, 'publication-source-youtube');
  assert.equal(row.metadata.source_external_id, 'yt-preview');
  assert.equal(row.metadata.render_path, 'data/runtime/product-video-agent/poke-quizz/source.mp4');
  assert.equal(row.metadata.publisher_target.tiktok.privacy_level, 'SELF_ONLY');
});

test('upsertAdditionalPlatformPublicationTargets is a no-op when no target is enabled', async () => {
  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {},
    sourcePublication,
    videoRow,
    sourceChannelProfile: {
      ...sourceChannelProfile,
      metadata: {
        publisher: {
          targets: [],
        },
      },
    },
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });

  assert.deepEqual(results, []);
});

test('upsertAdditionalPlatformPublicationTargets stores enabled additional target rows', async () => {
  const upsertedRows = [];
  const results = await upsertAdditionalPlatformPublicationTargets({
    store: {
      async upsertPublication(row) {
        upsertedRows.push(row);
        return row;
      },
    },
    sourcePublication,
    videoRow,
    sourceChannelProfile,
    scheduledFor: '2026-09-08T10:00:00.000Z',
  });

  assert.equal(upsertedRows.length, 1);
  assert.equal(results.length, 1);
  assert.equal(results[0].platform, TIKTOK_VIDEO_PLATFORM);
  assert.equal(results[0].workflow_state, 'scheduled');
});
