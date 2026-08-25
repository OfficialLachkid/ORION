import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectYoutubeAutoCommentVariant,
  syncYoutubeAutoCommentState,
} from '../src/youtube-auto-comments.mjs';

function createStore(initialPublication, options = {}) {
  let currentPublication = structuredClone(initialPublication);
  const updateCalls = [];
  return {
    updateCalls,
    async updatePublication(id, patch) {
      assert.equal(id, currentPublication.id);
      currentPublication = {
        ...currentPublication,
        ...patch,
        metadata: {
          ...(currentPublication.metadata || {}),
          ...(patch.metadata || {}),
        },
      };
      updateCalls.push({ id, patch: structuredClone(patch) });
      return structuredClone(currentPublication);
    },
    async fetchPublishedPublicationsByChannel() {
      return structuredClone(options.publishedPublications || []);
    },
    current() {
      return structuredClone(currentPublication);
    },
  };
}

function createChannelProfile(overrides = {}) {
  return {
    id: 'video-channel-poke-quizz-youtube',
    name: 'Poke Quizz',
    niche: 'pokemon_quiz',
    content_lane: 'poke-quizz',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    language: 'en-US',
    timezone: 'Europe/Amsterdam',
    status: 'active',
    schedule_slots: [{ hour: 12, minute: 0 }],
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
    ...overrides,
    metadata: {
      youtube_auto_comment: {
        enabled: true,
        max_attempts: 3,
        recent_history_limit: 2,
        default_variants: [
          { id: 'score', text: 'How many did you get right?' },
          { id: 'reveal', text: 'Did you get it before the reveal?' },
        ],
        template_variants: {
          'pokemon.type-quiz.v1': [
            { id: 'typing', text: 'Did you guess the typing before the reveal?' },
          ],
          'pokemon.find-the-shiny.v1': [
            { id: 'shiny', text: 'Did you spot the shiny in time?' },
          ],
        },
      },
      ...(overrides.metadata || {}),
    },
  };
}

test('selectYoutubeAutoCommentVariant avoids recently used variants when possible', () => {
  const channelProfile = createChannelProfile();
  const publication = {
    id: 'pub-1',
    metadata: {
      template_id: 'pokemon.type-quiz.v1',
    },
  };

  const variant = selectYoutubeAutoCommentVariant({
    publication,
    channelProfile,
    recentPublications: [
      {
        id: 'pub-0',
        metadata: {
          youtube_auto_comment: {
            variant_id: 'pokemon-type-quiz-v1-typing',
          },
        },
      },
    ],
    random: () => 0,
  });

  assert.equal(variant.id, 'default-score');
  assert.equal(variant.text, 'How many did you get right?');
});

test('syncYoutubeAutoCommentState is a no-op when the feature is not configured', async () => {
  const publication = {
    id: 'pub-disabled',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    external_id: 'yt-disabled',
    status: 'published',
    visibility: 'public',
    metadata: {
      workflow_state: 'published',
      template_id: 'pokemon.type-quiz.v1',
    },
  };
  const store = createStore(publication);
  const channelProfile = createChannelProfile({
    metadata: {
      youtube_auto_comment: {
        enabled: false,
      },
    },
  });

  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile,
    clientConfig: {},
    refreshToken: 'refresh-token',
    postYoutubeTopLevelCommentImpl: async () => {
      throw new Error('should not post');
    },
  });

  assert.equal(result.updated, false);
  assert.equal(store.updateCalls.length, 0);
  assert.equal(store.current().metadata.youtube_auto_comment, undefined);
});

test('syncYoutubeAutoCommentState marks scheduled videos as pending until public', async () => {
  const publication = {
    id: 'pub-scheduled',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    external_id: 'yt-scheduled',
    status: 'scheduled',
    visibility: 'private',
    scheduled_for: '2026-08-21T12:00:00.000Z',
    metadata: {
      workflow_state: 'scheduled',
      template_id: 'pokemon.type-quiz.v1',
    },
  };
  const store = createStore(publication);
  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile: createChannelProfile(),
    clientConfig: {},
    refreshToken: 'refresh-token',
    postYoutubeTopLevelCommentImpl: async () => {
      throw new Error('should not post for scheduled videos');
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'waiting_for_scheduled_publication');
  assert.equal(store.current().metadata.youtube_auto_comment.status, 'pending');
  assert.equal(store.current().metadata.youtube_auto_comment.video_id, 'yt-scheduled');
});

test('syncYoutubeAutoCommentState posts a top-level comment once the video is public', async () => {
  const publication = {
    id: 'pub-public',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    external_id: 'yt-public',
    status: 'published',
    visibility: 'public',
    metadata: {
      workflow_state: 'published',
      template_id: 'pokemon.find-the-shiny.v1',
    },
  };
  const store = createStore(publication, {
    publishedPublications: [
      {
        id: 'pub-older',
        metadata: {
          youtube_auto_comment: {
            variant_id: 'pokemon-find-the-shiny-v1-shiny',
          },
        },
      },
    ],
  });

  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile: createChannelProfile(),
    clientConfig: { clientId: 'id', clientSecret: 'secret' },
    refreshToken: 'refresh-token',
    random: () => 0,
    postYoutubeTopLevelCommentImpl: async (args) => {
      assert.equal(args.externalId, 'yt-public');
      assert.equal(args.textOriginal, 'How many did you get right?');
      return {
        commentId: 'comment-123',
        postedAt: '2026-08-20T08:00:00.000Z',
      };
    },
  });

  assert.equal(result.status, 'posted');
  assert.equal(result.commentId, 'comment-123');
  assert.equal(store.current().metadata.youtube_auto_comment.status, 'posted');
  assert.equal(store.current().metadata.youtube_auto_comment.comment_id, 'comment-123');
  assert.equal(store.current().metadata.youtube_auto_comment.attempt_count, 1);
  assert.equal(store.current().metadata.youtube_auto_comment.variant_id, 'default-score');
});

test('syncYoutubeAutoCommentState leaves retryable failures pending until max attempts is reached', async () => {
  const publication = {
    id: 'pub-retry',
    platform: 'youtube_shorts',
    account_key: 'poke-quizz-youtube',
    external_id: 'yt-retry',
    status: 'published',
    visibility: 'public',
    metadata: {
      workflow_state: 'published',
      template_id: 'pokemon.type-quiz.v1',
    },
  };
  const store = createStore(publication);
  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile: createChannelProfile(),
    clientConfig: {},
    refreshToken: 'refresh-token',
    postYoutubeTopLevelCommentImpl: async () => {
      const error = new Error('backend unavailable');
      error.status = 503;
      error.reason = 'backendError';
      throw error;
    },
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.retryable, true);
  assert.equal(store.current().metadata.youtube_auto_comment.status, 'pending');
  assert.equal(store.current().metadata.youtube_auto_comment.attempt_count, 1);
});

test('syncYoutubeAutoCommentState skips unsupported cross-channel publications', async () => {
  const publication = {
    id: 'pub-cross-channel',
    platform: 'youtube_shorts',
    account_key: 'other-channel',
    external_id: 'yt-cross-channel',
    status: 'published',
    visibility: 'public',
    metadata: {
      workflow_state: 'published',
      template_id: 'pokemon.type-quiz.v1',
    },
  };
  const store = createStore(publication);
  const result = await syncYoutubeAutoCommentState({
    store,
    publication,
    channelProfile: createChannelProfile(),
    clientConfig: {},
    refreshToken: 'refresh-token',
    postYoutubeTopLevelCommentImpl: async () => {
      throw new Error('should not post for unsupported channels');
    },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'unsupported_channel');
  assert.equal(store.current().metadata.youtube_auto_comment.status, 'skipped');
});
