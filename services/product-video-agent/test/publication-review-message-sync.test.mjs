import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicationReviewTemplateRuntime,
  resolvePublishQueueThreadId,
  syncPublicationReviewMessage,
} from '../src/publication-review-message-sync.mjs';

function buildRuntimeConfig() {
  return {
    env: {
      DISCORD_BOT_TOKEN: 'discord-token',
    },
    channelIds: {
      publishQueueAllChannels: '1537491255192453160',
    },
  };
}

function buildChannelProfile() {
  return {
    name: 'Poke Guess',
    timezone: 'Europe/Amsterdam',
    metadata: {
      review_thread_id: 'review-thread-1',
    },
    youtube: {
      channel_id: 'UC-TEST',
    },
  };
}

function buildVideoRow() {
  return {
    id: 'video-1',
    render: {
      output_path: 'data/runtime/product-video-agent/poke-quizz/review.mp4',
    },
  };
}

test('resolvePublicationReviewTemplateRuntime keeps DexGuess mixed-template cards on their own genre config', async () => {
  const runtime = await resolvePublicationReviewTemplateRuntime({
    publication: {
      metadata: {
        template_id: 'pokemon.type-quiz.v1',
        review_template_path: 'services/product-video-agent/config/templates/pokemon/type-quiz.v1.json',
        review_config_path: 'services/product-video-agent/config.example.json',
      },
    },
    channelSelector: 'dexguess-youtube',
    fallbackChannelConfigPath: 'services/product-video-agent/config/channels/dexguess-youtube.json',
  });

  assert.equal(
    runtime?.channelConfigPath,
    'services/product-video-agent/config/channels/dexguess-type-speed-quiz-youtube.json',
  );
  assert.equal(runtime?.genreLabel, 'Type Quiz');
});

test('resolvePublishQueueThreadId prefers the configured shared queue thread', () => {
  assert.equal(
    resolvePublishQueueThreadId(buildRuntimeConfig()),
    '1537491255192453160',
  );
});

test('syncPublicationReviewMessage routes scheduled cards into the shared publish queue thread', async () => {
  const editCalls = [];
  const sendCalls = [];
  const deleteCalls = [];
  const updateCalls = [];
  const publication = {
    id: 'publication-1',
    video_id: 'video-1',
    status: 'scheduled',
    scheduled_for: '2026-08-14T08:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      review_thread_id: 'review-thread-1',
      review_message_id: 'review-message-1',
      type_pair: ['water', 'bug'],
      render_path: 'data/runtime/product-video-agent/poke-quizz/review.mp4',
    },
  };
  const store = {
    async updatePublication(id, patch) {
      updateCalls.push({ id, patch });
      return {
        ...publication,
        metadata: {
          ...(publication.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
    },
  };

  const result = await syncPublicationReviewMessage({
    runtimeConfig: buildRuntimeConfig(),
    store,
    publication,
    videoRow: buildVideoRow(),
    channelProfile: buildChannelProfile(),
    channelSelector: 'poke-guess-youtube',
    editDiscordChannelMessageImpl: async (_config, channelId, messageId, payload) => {
      editCalls.push({ channelId, messageId, payload });
      return { posted: true, messageId, channelId };
    },
    sendDiscordChannelMessageImpl: async (_config, channelId, payload) => {
      sendCalls.push({ channelId, payload });
      return { posted: true, messageId: 'queue-message-1', channelId };
    },
    deleteDiscordChannelMessageImpl: async (_config, channelId, messageId) => {
      deleteCalls.push({ channelId, messageId });
      return { posted: true, deleted: true, channelId, messageId };
    },
  });

  assert.equal(editCalls.length, 1);
  assert.equal(editCalls[0].channelId, 'review-thread-1');
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].channelId, '1537491255192453160');
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.metadata.review_thread_id, '1537491255192453160');
  assert.equal(updateCalls[0].patch.metadata.review_message_id, 'queue-message-1');
  assert.equal(updateCalls[0].patch.metadata.review_home_thread_id, 'review-thread-1');
  assert.equal(deleteCalls.length, 1);
  assert.deepEqual(deleteCalls[0], {
    channelId: 'review-thread-1',
    messageId: 'review-message-1',
  });
  assert.equal(result.moved, true);
  assert.equal(result.routeAction, 'to_publish_queue');
  assert.equal(result.publication.metadata.review_thread_id, '1537491255192453160');
});

test('syncPublicationReviewMessage returns actionable cards from the publish queue back to the review thread', async () => {
  const sendCalls = [];
  const publication = {
    id: 'publication-2',
    video_id: 'video-1',
    status: 'approved',
    metadata: {
      workflow_state: 'preview_uploaded',
      review_thread_id: '1537491255192453160',
      review_message_id: 'queue-message-2',
      review_home_thread_id: 'review-thread-2',
      type_pair: ['ghost', 'fire'],
      render_path: 'data/runtime/product-video-agent/poke-quizz/review.mp4',
    },
  };

  const result = await syncPublicationReviewMessage({
    runtimeConfig: buildRuntimeConfig(),
    store: {
      async updatePublication(_id, patch) {
        return {
          ...publication,
          metadata: {
            ...(publication.metadata || {}),
            ...(patch.metadata || {}),
          },
        };
      },
    },
    publication,
    videoRow: buildVideoRow(),
    channelProfile: {
      ...buildChannelProfile(),
      metadata: {
        review_thread_id: 'review-thread-2',
      },
    },
    channelSelector: 'trivamon-youtube',
    editDiscordChannelMessageImpl: async (_config, channelId, messageId) => ({
      posted: true,
      channelId,
      messageId,
    }),
    sendDiscordChannelMessageImpl: async (_config, channelId, payload) => {
      sendCalls.push({ channelId, payload });
      return { posted: true, messageId: 'review-message-2b', channelId };
    },
    deleteDiscordChannelMessageImpl: async () => ({ posted: true, deleted: true }),
  });

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].channelId, 'review-thread-2');
  assert.ok(Array.isArray(sendCalls[0].payload.components));
  assert.ok(sendCalls[0].payload.components.length > 0);
  assert.equal(result.moved, true);
  assert.equal(result.routeAction, 'back_to_review');
  assert.equal(result.publication.metadata.review_thread_id, 'review-thread-2');
  assert.equal(result.publication.metadata.review_message_id, 'review-message-2b');
});
