import test from 'node:test';
import assert from 'node:assert/strict';
import { executeProductVideoAction } from '../src/product-video-executor.mjs';

test('manual review generation uses the selected channel config and default review-thread routing', async () => {
  const runCalls = [];
  const normalizePath = (value) => String(value || '').replaceAll('\\', '/');

  const result = await executeProductVideoAction(
    'poke_quizz_generate_review',
    {
      task_id: 'TASK-ORION-PQ-GENERATE-TEST',
      submitted_at: '2026-08-10T09:45:00.000Z',
      poke_quizz_generate_review: {
        templateKey: 'find-the-shiny',
        templateLabel: 'Find the Shiny',
        channelSelector: 'trivamon-youtube',
        channelLabel: 'TrivaMon',
        channelConfigPath: 'services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json',
      },
    },
    { env: {} },
    {
      ensurePreferredPokeQuizzCatalogJsonPath: async () => 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
      loadPublicationChannelProfiles: async () => ([
        {
          platform: 'youtube_shorts',
          account_key: 'trivamon-youtube',
          metadata: {
            review_thread_id: '1536146358749233222',
          },
        },
      ]),
      findPublicationChannelProfile: (profiles) => profiles[0],
      runProcess: async (options) => {
        runCalls.push(options);
        return {
          stdout: JSON.stringify({
            publication_id: 'publication-trivamon-review-1',
            preview_url: 'https://youtube.com/shorts/manual-preview',
            task_id: 'TASK-ORION-PQ-PUBLISH-MANUAL',
            message_id: '1536308033032945767',
            render_path: 'data/runtime/product-video-agent/poke-quizz/manual-preview.mp4',
          }, null, 2),
        };
      },
    },
  );

  assert.equal(runCalls.length, 1);
  assert.equal(
    normalizePath(runCalls[0].args[0]).endsWith('services/product-video-agent/scripts/generate-poke-quizz-review.mjs'),
    true,
  );
  assert.equal(runCalls[0].args.includes('--catalog-json'), true);
  assert.equal(runCalls[0].args.includes('--channel-config'), true);
  assert.equal(runCalls[0].args.includes('--channel'), true);
  assert.equal(runCalls[0].args.includes('--thread-id'), true);
  assert.equal(
    normalizePath(runCalls[0].args[runCalls[0].args.indexOf('--catalog-json') + 1]).endsWith('data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json'),
    true,
  );
  assert.equal(
    normalizePath(runCalls[0].args[runCalls[0].args.indexOf('--channel-config') + 1]).endsWith('services/product-video-agent/config/channels/trivamon-find-the-shiny-youtube.json'),
    true,
  );
  assert.equal(runCalls[0].args[runCalls[0].args.indexOf('--channel') + 1], 'trivamon-youtube');
  assert.equal(runCalls[0].args[runCalls[0].args.indexOf('--thread-id') + 1], '1536146358749233222');
  assert.equal(result.report.state, 'preview_generated');
  assert.equal(result.report.previewUrl, 'https://youtube.com/shorts/manual-preview');
  assert.equal(result.report.publicationId, 'publication-trivamon-review-1');
});

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
    async fetchVideoById(id) {
      assert.equal(id, 'video-bug-ground');
      return {
        id,
        render: {
          output_path: 'data/runtime/product-video-agent/poke-quizz/bug-ground.mp4',
        },
      };
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

test('publish approval restores the actionable state when scheduling fails before a slot is assigned', async () => {
  const initialPublication = {
    id: 'publication-trivamon-review-2',
    video_id: 'video-trivamon-review-2',
    platform: 'youtube_shorts',
    account_key: 'trivamon-youtube',
    status: 'pending',
    preview_url: 'https://youtube.com/shorts/trivamon-preview',
    metadata: {
      workflow_state: 'preview_uploaded',
      review_thread_id: '',
      review_message_id: '',
    },
  };
  const videoRow = {
    id: 'video-trivamon-review-2',
    render: {
      output_path: 'data/runtime/product-video-agent/poke-quizz/trivamon-preview.mp4',
    },
  };
  const updateCalls = [];
  const queueSyncCalls = [];
  let currentPublication = structuredClone(initialPublication);
  const publicationStore = {
    async fetchPublicationById(id) {
      assert.equal(id, 'publication-trivamon-review-2');
      return currentPublication;
    },
    async fetchVideoById(id) {
      assert.equal(id, 'video-trivamon-review-2');
      return videoRow;
    },
    async updatePublication(id, patch) {
      assert.equal(id, 'publication-trivamon-review-2');
      updateCalls.push({ id, patch });
      currentPublication = {
        ...currentPublication,
        ...patch,
        metadata: {
          ...(currentPublication.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
      return currentPublication;
    },
  };

  await assert.rejects(
    () => executeProductVideoAction(
      'poke_quizz_publish_preview',
      {
        task_id: 'TASK-ORION-PQ-PUBLISH-TRIVAMON',
        approved_by: 'Lachkid',
        approved_by_id: '374565340644114433',
        poke_quizz_publication_review: {
          publicationId: 'publication-trivamon-review-2',
          channelSelector: 'trivamon-youtube',
        },
      },
      { env: {} },
      {
        publicationStore,
        loadPublicationChannelProfiles: async () => ([
          {
            platform: 'youtube_shorts',
            account_key: 'trivamon-youtube',
            youtube: {
              oauth_client_secret_path: 'config/youtube/client-secret.json',
              oauth_refresh_token_env: 'YOUTUBE_TRIVAMON_REFRESH_TOKEN',
            },
          },
        ]),
        findPublicationChannelProfile: (profiles) => profiles[0],
        runProcess: async () => {
          throw new Error('schedule sync crashed');
        },
        syncQueueStatusMessage: async (options) => {
          queueSyncCalls.push(options);
          return { posted: true };
        },
        queueStatusChannelProfile: {
          platform: 'youtube_shorts',
          account_key: 'trivamon-youtube',
        },
        executePublicationScriptPath: '/tmp/execute-youtube-publication.mjs',
      },
    ),
    /schedule sync crashed/u,
  );

  assert.equal(updateCalls.length, 2);
  assert.equal(updateCalls[0].patch.metadata.workflow_state, 'preview_approved');
  assert.equal(updateCalls[1].patch.metadata.workflow_state, 'preview_uploaded');
  assert.equal(currentPublication.metadata.workflow_state, 'preview_uploaded');
  assert.equal(currentPublication.status, 'pending');
  assert.equal(currentPublication.metadata.publish_attempt_error, 'schedule sync crashed');
  assert.equal(queueSyncCalls.length, 1);
  assert.equal(queueSyncCalls[0].channelSelector, 'trivamon-youtube');
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

test('feedback regeneration falls back to the preferred localized catalog when the rehydrated task has no plan path', async () => {
  const runCalls = [];
  const callSequence = [];
  const normalizePath = (value) => String(value || '').replaceAll('\\', '/');

  const result = await executeProductVideoAction(
    'poke_quizz_feedback_regenerate',
    {
      task_id: 'TASK-ORION-PQ-REGENERATE-TEST',
      submitted_at: '2026-08-04T13:54:40.000Z',
      poke_quizz_feedback: {
        publicationId: 'publication-rock-ground',
        reviewThreadId: '1532709429902839810',
        channelSelector: 'poke-quizz-youtube',
        typePair: ['rock', 'ground'],
        feedback: 'Use a different background.',
        planPath: '',
        catalogJsonPath: '',
        templatePath: '',
        configPath: '',
      },
    },
    { env: {} },
    {
      ensurePreferredPokeQuizzCatalogJsonPath: async () => 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
      runProcess: async (options) => {
        callSequence.push(`run:${normalizePath(options.args[0]).split('/').at(-1)}`);
        runCalls.push(options);
        return {
          stdout: JSON.stringify({
            publication_id: 'publication-rock-ground-v2',
            preview_url: 'https://youtube.com/shorts/revised-preview',
            task_id: 'TASK-ORION-PQ-PUBLISH-NEW',
            message_id: '1533600000000000000',
            render_path: 'data/runtime/product-video-agent/poke-quizz/revised.mp4',
          }, null, 2),
        };
      },
      updatePriorPublicationForRevision: async () => {
        callSequence.push('update-prior');
      },
    },
  );

  assert.equal(runCalls.length, 2);
  assert.equal(
    normalizePath(runCalls[0].args[0]).endsWith('services/product-video-agent/scripts/plan-pokemon-type-challenge.mjs'),
    true,
  );
  assert.deepEqual(runCalls[0].args.slice(-2), [
    '--type-pair',
    'rock,ground',
  ]);
  assert.equal(
    normalizePath(runCalls[1].args[0]).endsWith('services/product-video-agent/scripts/generate-poke-quizz-review.mjs'),
    true,
  );
  assert.equal(runCalls[1].args.includes('--catalog-json'), true);
  assert.equal(
    normalizePath(runCalls[1].args[runCalls[1].args.indexOf('--catalog-json') + 1]).endsWith('data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json'),
    true,
  );
  assert.deepEqual(callSequence, [
    'run:plan-pokemon-type-challenge.mjs',
    'run:generate-poke-quizz-review.mjs',
    'update-prior',
  ]);
  assert.equal(result.report.state, 'preview_regenerated');
  assert.equal(result.report.previewUrl, 'https://youtube.com/shorts/revised-preview');
});

test('feedback regeneration rebuilds from the localized catalog even when the original review task still has a plan path', async () => {
  const runCalls = [];
  const normalizePath = (value) => String(value || '').replaceAll('\\', '/');

  const result = await executeProductVideoAction(
    'poke_quizz_feedback_regenerate',
    {
      task_id: 'TASK-ORION-PQ-REGENERATE-PLAN-REBUILD',
      submitted_at: '2026-08-04T14:12:00.000Z',
      poke_quizz_feedback: {
        publicationId: 'publication-rock-fairy',
        reviewThreadId: '1532709429902839810',
        channelSelector: 'poke-quizz-youtube',
        typePair: ['rock', 'fairy'],
        feedback: 'Use the latest spacing changes.',
        planPath: 'data/runtime/product-video-agent/poke-quizz/old-review.plan.json',
        catalogJsonPath: '',
        templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
        configPath: 'services/product-video-agent/config.example.json',
      },
    },
    { env: {} },
    {
      ensurePreferredPokeQuizzCatalogJsonPath: async () => 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
      runProcess: async (options) => {
        runCalls.push(options);
        return {
          stdout: JSON.stringify({
            publication_id: 'publication-rock-fairy-v2',
            preview_url: 'https://youtube.com/shorts/rebuilt-preview',
            task_id: 'TASK-ORION-PQ-PUBLISH-NEWER',
            message_id: '1533600000000001234',
            render_path: 'data/runtime/product-video-agent/poke-quizz/rebuilt.mp4',
          }, null, 2),
        };
      },
      updatePriorPublicationForRevision: async () => {},
    },
  );

  assert.equal(runCalls.length, 2);
  assert.equal(
    normalizePath(runCalls[0].args[0]).endsWith('services/product-video-agent/scripts/plan-pokemon-type-challenge.mjs'),
    true,
  );
  assert.equal(
    normalizePath(runCalls[0].args[runCalls[0].args.indexOf('--template') + 1]).endsWith('services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json'),
    true,
  );
  assert.equal(
    normalizePath(runCalls[1].args[runCalls[1].args.indexOf('--plan') + 1]).includes('/data/runtime/product-video-agent/poke-quizz/reviews/'),
    true,
  );
  assert.equal(
    normalizePath(runCalls[1].args[runCalls[1].args.indexOf('--plan') + 1]).endsWith('/old-review.plan.json'),
    false,
  );
  assert.equal(result.report.state, 'preview_regenerated');
  assert.equal(result.report.previewUrl, 'https://youtube.com/shorts/rebuilt-preview');
});
