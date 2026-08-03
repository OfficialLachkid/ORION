import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProductVideoAction } from '../src/product-video-executor.mjs';

test('publish approval triggers an immediate scheduling pass and returns the scheduled slot', async () => {
  const initialPublication = {
    id: 'publication-bug-ground',
    video_id: 'video-bug-ground',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'pending',
    preview_url: 'https://youtube.com/shorts/TeDQp0JgAdg',
    metadata: {
      workflow_state: 'preview_uploaded',
    },
  };
  const scheduledPublication = {
    ...initialPublication,
    status: 'scheduled',
    scheduled_for: '2026-08-03T06:00:00.000Z',
    metadata: {
      ...initialPublication.metadata,
      workflow_state: 'scheduled',
    },
  };

  let fetchCount = 0;
  const updateCalls = [];
  const runCalls = [];
  const queueSyncCalls = [];
  const publicationStore = {
    async fetchPublicationById(id) {
      assert.equal(id, 'publication-bug-ground');
      fetchCount += 1;
      return fetchCount === 1 ? initialPublication : scheduledPublication;
    },
    async updatePublication(id, patch) {
      updateCalls.push({ id, patch });
      return {
        ...initialPublication,
        status: patch.status || initialPublication.status,
        metadata: {
          ...initialPublication.metadata,
          ...(patch.metadata || {}),
        },
      };
    },
  };

  const result = await executeProductVideoAction(
    'poke_quizz_publish_preview',
    {
      task_id: 'TASK-ORION-PQ-PUBLISH-TEST',
      approved_by: 'Lachkid',
      approved_by_id: '374565340644114433',
      poke_quizz_publication_review: {
        publicationId: 'publication-bug-ground',
        channelSelector: 'poke-quizz-youtube',
      },
    },
    { env: {} },
    {
      publicationStore,
      runProcess: async (options) => {
      runCalls.push(options);
      return {
        stdout: [
            '[info] Scheduled publication publication-bug-ground for 2026-08-03T06:00:00.000Z',
            JSON.stringify([
              {
                publication_id: 'publication-bug-ground',
                action: 'schedule_update',
                scheduled_for: '2026-08-03T06:00:00.000Z',
              },
            ], null, 2),
          ].join('\n'),
        };
      },
      syncQueueStatusMessage: async (options) => {
        queueSyncCalls.push(options);
        return { posted: true };
      },
      queueStatusChannelProfile: {
        platform: 'youtube_shorts',
        account_key: 'poke-quizz-youtube',
      },
      executePublicationScriptPath: '/tmp/execute-youtube-publication.mjs',
    },
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.status, 'approved');
  assert.equal(updateCalls[0].patch.metadata.workflow_state, 'preview_approved');
  assert.equal(runCalls.length, 1);
  assert.deepEqual(runCalls[0].args.slice(0, 5), [
    '/tmp/execute-youtube-publication.mjs',
    '--channel',
    'poke-quizz-youtube',
    '--schedule-approved',
    '--as-of',
  ]);
  assert.equal(result.report.state, 'scheduled');
  assert.equal(result.report.workflowState, 'scheduled');
  assert.equal(result.report.scheduledFor, '2026-08-03T06:00:00.000Z');
  assert.equal(queueSyncCalls.length, 1);
  assert.equal(queueSyncCalls[0].channelSelector, 'poke-quizz-youtube');
});

test('delete action refreshes the Poke Quizz queue status message after removal', async () => {
  const initialPublication = {
    id: 'publication-delete-test',
    video_id: 'video-delete-test',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    status: 'approved',
    visibility: 'unlisted',
    preview_url: 'https://youtube.com/shorts/delete-me',
    external_id: 'delete-me',
    uploaded_at: '2026-08-03T10:00:00.000Z',
    metadata: {
      workflow_state: 'preview_uploaded',
      render_path: '',
      review_thread_id: '',
      review_message_id: '',
    },
  };
  const updateCalls = [];
  const queueSyncCalls = [];
  const publicationStore = {
    async fetchPublicationById(id) {
      assert.equal(id, 'publication-delete-test');
      return initialPublication;
    },
    async fetchVideoById(id) {
      assert.equal(id, 'video-delete-test');
      return null;
    },
    async updatePublication(id, patch) {
      updateCalls.push({ id, patch });
      return {
        ...initialPublication,
        ...patch,
        metadata: {
          ...initialPublication.metadata,
          ...(patch.metadata || {}),
        },
      };
    },
  };

  const result = await executeProductVideoAction(
    'poke_quizz_delete_preview',
    {
      task_id: 'TASK-ORION-PQ-DELETE-TEST',
      poke_quizz_delete: {
        publicationId: 'publication-delete-test',
        channelSelector: 'poke-quizz-youtube',
      },
    },
    {
      env: {
        YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN: 'refresh-token',
      },
    },
    {
      publicationStore,
      loadPublicationChannelProfiles: async () => ([
        {
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          youtube: {
            oauth_client_secret_path: 'config/youtube/client-secret.json',
            oauth_refresh_token_env: 'YOUTUBE_POKE_QUIZZ_REFRESH_TOKEN',
          },
        },
      ]),
      findPublicationChannelProfile: (profiles) => profiles[0],
      loadYoutubeClientCredentials: async () => ({
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
      deleteYoutubeVideo: async () => ({
        externalId: 'delete-me',
        deletedAt: '2026-08-03T12:00:00.000Z',
      }),
      syncQueueStatusMessage: async (options) => {
        queueSyncCalls.push(options);
        return { posted: true };
      },
      queueStatusChannelProfile: {
        platform: 'youtube_shorts',
        account_key: 'poke-quizz-youtube',
      },
    },
  );

  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.status, 'deleted');
  assert.equal(updateCalls[0].patch.metadata.workflow_state, 'deleted');
  assert.equal(queueSyncCalls.length, 1);
  assert.equal(queueSyncCalls[0].channelSelector, 'poke-quizz-youtube');
  assert.equal(result.report.state, 'deleted');
  assert.equal(result.report.workflowState, 'deleted');
});
