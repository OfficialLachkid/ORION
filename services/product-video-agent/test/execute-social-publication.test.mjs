import test from 'node:test';
import assert from 'node:assert/strict';
import { executeDueSocialPublications } from '../scripts/publication/social/tiktok/execute-due-publications.mjs';
import {
  TikTokPublicationAuthRequiredError,
} from '../src/tiktok-publication-executor.mjs';

function createStore(publications, videos = {}) {
  const rows = new Map(publications.map((publication) => [publication.id, structuredClone(publication)]));
  const updateCalls = [];
  return {
    updateCalls,
    async fetchPublicationsByPlatform({ platform }) {
      return [...rows.values()].filter((publication) => publication.platform === platform);
    },
    async fetchPublicationsByChannel({ platform, accountKey }) {
      return [...rows.values()].filter((publication) => (
        publication.platform === platform
        && publication.account_key === accountKey
      ));
    },
    async fetchVideoById(id) {
      return structuredClone(videos[id] || null);
    },
    async updatePublication(id, patch) {
      const current = rows.get(id);
      const next = {
        ...current,
        ...patch,
        metadata: {
          ...(current?.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
      rows.set(id, next);
      updateCalls.push({ id, patch: structuredClone(patch) });
      return structuredClone(next);
    },
    current(id) {
      return structuredClone(rows.get(id));
    },
  };
}

const dueTikTokPublication = {
  id: 'publication-target-tiktok',
  video_id: 'video-1',
  platform: 'tiktok_video',
  account_key: 'poke-quizz-tiktok',
  status: 'scheduled',
  scheduled_for: '2026-09-07T10:00:00.000Z',
  title: 'Guess the Cry!',
  hashtags: ['#pokemon'],
  metadata: {
    workflow_state: 'scheduled',
    render_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
    publisher_target: {
      account_key: 'poke-quizz-tiktok',
      platform: 'tiktok_video',
      tiktok: {
        access_token_env: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
      },
    },
  },
};

test('executeDueSocialPublications dry-runs due TikTok rows only', async () => {
  const store = createStore([
    dueTikTokPublication,
    {
      ...dueTikTokPublication,
      id: 'future-tiktok',
      scheduled_for: '2026-09-09T10:00:00.000Z',
    },
    {
      ...dueTikTokPublication,
      id: 'youtube-row',
      platform: 'youtube_shorts',
      account_key: 'poke-quizz-youtube',
    },
  ]);

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
    'dry-run': true,
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
  });

  assert.deepEqual(results, [
    {
      publication_id: 'publication-target-tiktok',
      platform: 'tiktok_video',
      account_key: 'poke-quizz-tiktok',
      action: 'tiktok_publish_due',
      workflow_state: 'scheduled',
      scheduled_for: '2026-09-07T10:00:00.000Z',
      external_id: '',
    },
  ]);
});

test('executeDueSocialPublications uploads a due TikTok row and stores publish id', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': {
      id: 'video-1',
      render: {
        output_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
      },
    },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'token',
      },
    },
    publicationStore: store,
    publishTikTokVideo: async ({ publication, videoRow, target }) => {
      assert.equal(publication.id, 'publication-target-tiktok');
      assert.equal(videoRow.id, 'video-1');
      assert.equal(target.tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
      return {
        status: 'publishing',
        workflowState: 'publishing',
        externalId: 'publish-123',
        publishId: 'publish-123',
        uploadedAt: '2026-09-07T12:00:00.000Z',
        tokenEnv: 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN',
      };
    },
  });

  assert.equal(results[0].action, 'tiktok_publish_upload');
  assert.equal(results[0].external_id, 'publish-123');
  assert.equal(store.current('publication-target-tiktok').external_id, 'publish-123');
  assert.equal(store.current('publication-target-tiktok').metadata.tiktok_publish_id, 'publish-123');
  assert.ok(store.current('publication-target-tiktok').metadata.next_status_poll_at);
});

test('executeDueSocialPublications polls an uploaded TikTok row and marks it published', async () => {
  const store = createStore([{
    ...dueTikTokPublication,
    status: 'publishing',
    external_id: 'publish-123',
    metadata: {
      ...dueTikTokPublication.metadata,
      workflow_state: 'publishing',
      next_status_poll_at: '2026-09-07T11:59:00.000Z',
    },
  }]);

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: {
      env: {
        TIKTOK_POKE_QUIZZ_ACCESS_TOKEN: 'token',
      },
    },
    publicationStore: store,
    fetchTikTokPublicationStatus: async ({ publishId, target }) => {
      assert.equal(publishId, 'publish-123');
      assert.equal(target.tiktok.access_token_env, 'TIKTOK_POKE_QUIZZ_ACCESS_TOKEN');
      return {
        status: 'published',
        rawStatus: 'PUBLISH_COMPLETE',
      };
    },
  });

  assert.equal(results[0].action, 'tiktok_status_fetch');
  assert.equal(results[0].workflow_state, 'published');
  assert.equal(store.current('publication-target-tiktok').status, 'published');
  assert.equal(store.current('publication-target-tiktok').published_at, '2026-09-07T12:00:00.000Z');
});

test('executeDueSocialPublications marks missing TikTok auth as auth_required', async () => {
  const store = createStore([dueTikTokPublication], {
    'video-1': {
      id: 'video-1',
      render: {
        output_path: 'data/runtime/product-video-agent/poke-quizz/example.mp4',
      },
    },
  });

  const results = await executeDueSocialPublications({
    'as-of': '2026-09-07T12:00:00.000Z',
  }, {
    runtimeConfig: { env: {} },
    publicationStore: store,
    publishTikTokVideo: async () => {
      throw new TikTokPublicationAuthRequiredError('Missing TikTok token');
    },
  });

  assert.equal(results[0].action, 'tiktok_publish_failed');
  assert.equal(results[0].workflow_state, 'auth_required');
  assert.equal(store.current('publication-target-tiktok').status, 'blocked');
  assert.equal(store.current('publication-target-tiktok').metadata.workflow_state, 'auth_required');
});
