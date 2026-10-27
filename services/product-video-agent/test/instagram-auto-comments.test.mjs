import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isInstagramAutoCommentDue,
  resolveInstagramAutoCommentConfig,
  syncInstagramAutoCommentState,
} from '../src/instagram-auto-comments.mjs';
import { InstagramGraphApiError } from '../src/instagram-publication-executor.mjs';

const sourceProfile = {
  account_key: 'poke-quizz-youtube',
  metadata: {
    automatic_comments: {
      enabled: true,
      max_attempts: 3,
      recent_history_limit: 2,
      default_variants: [
        { id: 'first', text: 'How many did you get right?' },
        { id: 'second', text: 'Which reveal surprised you most?' },
      ],
    },
  },
};
const target = {
  accountKey: 'poke-quizzz-instagram',
  instagram: {
    expected_username: 'pokequizzz',
    access_token_env: 'INSTAGRAM_POKE_QUIZZ_ACCESS_TOKEN',
  },
};

function publication(overrides = {}) {
  return {
    id: 'publication-instagram-1',
    platform: 'instagram_reels',
    account_key: 'poke-quizzz-instagram',
    status: 'published',
    external_id: 'media-1',
    public_url: 'https://www.instagram.com/reel/example/',
    ...overrides,
    metadata: {
      workflow_state: 'published',
      template_id: 'pokemon.type-quiz.v1',
      instagram_media_id: 'media-1',
      ...(overrides.metadata || {}),
    },
  };
}

function memoryStore(initial) {
  let stored = initial;
  return {
    async updatePublication(_id, patch) {
      stored = {
        ...stored,
        ...patch,
        metadata: patch.metadata || stored.metadata,
      };
      return stored;
    },
    async fetchPublishedPublicationsByChannel() { return [stored]; },
    current() { return stored; },
  };
}

test('Instagram comments inherit the reusable channel policy', () => {
  const config = resolveInstagramAutoCommentConfig(sourceProfile);
  assert.equal(config.enabled, true);
  assert.equal(config.maxAttempts, 3);
  assert.deepEqual(config.defaultVariants.map((item) => item.text), [
    'How many did you get right?',
    'Which reveal surprised you most?',
  ]);
});

test('syncInstagramAutoCommentState posts once and stores the remote comment id', async () => {
  const store = memoryStore(publication());
  const calls = [];
  const result = await syncInstagramAutoCommentState({
    store,
    publication: store.current(),
    sourcePublication: { metadata: { publication_policy: { auto_comment_enabled: true } } },
    sourceChannelProfile: sourceProfile,
    target,
    asOf: '2026-10-27T13:00:00.000Z',
    random: () => 0,
    graphClient: {
      async createTopLevelComment(input) {
        calls.push(input);
        return { commentId: 'comment-1' };
      },
    },
  });

  assert.equal(result.action, 'posted');
  assert.equal(result.commentId, 'comment-1');
  assert.deepEqual(calls, [{ mediaId: 'media-1', message: 'How many did you get right?' }]);
  assert.equal(store.current().metadata.instagram_auto_comment.status, 'posted');

  const repeated = await syncInstagramAutoCommentState({
    store,
    publication: store.current(),
    sourceChannelProfile: sourceProfile,
    target,
    graphClient: { async createTopLevelComment() { throw new Error('must not run'); } },
  });
  assert.equal(repeated.action, 'already_posted');
});

test('rate limiting leaves the same selected comment pending for a safe retry', async () => {
  const store = memoryStore(publication());
  const result = await syncInstagramAutoCommentState({
    store,
    publication: store.current(),
    sourceChannelProfile: sourceProfile,
    target,
    random: () => 0,
    graphClient: {
      async createTopLevelComment() {
        throw new InstagramGraphApiError('rate limited', { status: 429 });
      },
    },
  });

  assert.equal(result.action, 'retry_pending');
  assert.equal(result.status, 'pending');
  assert.equal(store.current().metadata.instagram_auto_comment.text, 'How many did you get right?');
  assert.equal(isInstagramAutoCommentDue(store.current()), true);
});

test('an interrupted attempt reconciles an existing matching Instagram comment without reposting', async () => {
  const store = memoryStore(publication({
    metadata: {
      instagram_auto_comment: {
        status: 'posting',
        reason: 'posting',
        attempt_count: 1,
        max_attempts: 3,
        variant_id: 'default-first',
        text: 'How many did you get right?',
      },
    },
  }));
  const result = await syncInstagramAutoCommentState({
    store,
    publication: store.current(),
    sourceChannelProfile: sourceProfile,
    target,
    graphClient: {
      async fetchMediaComments() {
        return [{
          commentId: 'comment-existing',
          text: 'How many did you get right?',
          username: 'pokequizzz',
          timestamp: '2026-10-27T13:00:02.000Z',
        }];
      },
      async createTopLevelComment() { throw new Error('must not repost'); },
    },
  });

  assert.equal(result.action, 'reconciled');
  assert.equal(result.commentId, 'comment-existing');
  assert.equal(store.current().metadata.instagram_auto_comment.status, 'posted');
});

test('an ambiguous Instagram failure is fail-closed to prevent duplicate comments', async () => {
  const store = memoryStore(publication());
  const result = await syncInstagramAutoCommentState({
    store,
    publication: store.current(),
    sourceChannelProfile: sourceProfile,
    target,
    graphClient: {
      async createTopLevelComment() { throw new TypeError('network dropped'); },
    },
  });

  assert.equal(result.action, 'failed');
  assert.equal(result.status, 'uncertain');
  assert.equal(isInstagramAutoCommentDue(store.current()), true);
});
