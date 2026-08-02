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
});
