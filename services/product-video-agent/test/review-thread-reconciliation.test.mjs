import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchReviewMessagePresence,
  isReviewReadyPublication,
  reconcileReviewMessages,
  selectReviewReadyPublications,
  withdrawOrphanedPublication,
} from '../src/review-thread-reconciliation.mjs';

function buildPub(id, overrides = {}) {
  return {
    id,
    status: 'approved',
    external_id: `yt-${id}`,
    preview_url: `https://youtube.com/shorts/yt-${id}`,
    title: `Pub ${id}`,
    metadata: {
      workflow_state: 'preview_uploaded',
      review_message_id: `msg-${id}`,
      preview_render_path: `/tmp/render-${id}.mp4`,
      ...overrides.metadata,
    },
    ...overrides,
  };
}

test('isReviewReadyPublication: only matches preview_uploaded with a review_message_id', () => {
  assert.equal(isReviewReadyPublication(buildPub('a')), true);
  assert.equal(isReviewReadyPublication(buildPub('b', { metadata: { workflow_state: 'published' } })), false);
  assert.equal(isReviewReadyPublication(buildPub('c', { metadata: { workflow_state: 'withdrawn' } })), false);
  assert.equal(isReviewReadyPublication(buildPub('d', { metadata: { workflow_state: 'preview_uploaded', review_message_id: '' } })), false);
  assert.equal(isReviewReadyPublication(null), false);
  assert.equal(isReviewReadyPublication({}), false);
});

test('selectReviewReadyPublications filters out everything that is not actively waiting on a Discord message', () => {
  const pool = [
    buildPub('ok'),
    buildPub('published', { metadata: { workflow_state: 'published' } }),
    buildPub('withdrawn', { metadata: { workflow_state: 'withdrawn' } }),
    buildPub('no-msg', { metadata: { workflow_state: 'preview_uploaded', review_message_id: '' } }),
  ];
  const picked = selectReviewReadyPublications(pool).map((p) => p.id);
  assert.deepEqual(picked, ['ok']);
});

test('fetchReviewMessagePresence returns present/missing/error correctly', async () => {
  const okFetch = async () => ({ ok: true, status: 200 });
  const presence1 = await fetchReviewMessagePresence({ threadId: 't', messageId: 'm', botToken: 'x', fetchImpl: okFetch, maxRetries: 0 });
  assert.equal(presence1.status, 'present');

  const notFoundFetch = async () => ({ ok: false, status: 404 });
  const presence2 = await fetchReviewMessagePresence({ threadId: 't', messageId: 'm', botToken: 'x', fetchImpl: notFoundFetch, maxRetries: 0 });
  assert.equal(presence2.status, 'missing');

  const serverErrorFetch = async () => ({ ok: false, status: 500, headers: { get: () => null } });
  const presence3 = await fetchReviewMessagePresence({ threadId: 't', messageId: 'm', botToken: 'x', fetchImpl: serverErrorFetch, maxRetries: 0 });
  assert.equal(presence3.status, 'error');
  assert.equal(presence3.reason, 'discord_api_500');

  const missing = await fetchReviewMessagePresence({ threadId: '', messageId: 'm', botToken: 'x', fetchImpl: okFetch, maxRetries: 0 });
  assert.equal(missing.status, 'error');
});

test('fetchReviewMessagePresence retries 429s honoring Retry-After, then falls back on exhaustion', async () => {
  let call = 0;
  const sleeps = [];
  const fetchImpl = async () => {
    call += 1;
    if (call < 3) {
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '0.2' : null) },
      };
    }
    return { ok: true, status: 200 };
  };
  const presence = await fetchReviewMessagePresence({
    threadId: 't', messageId: 'm', botToken: 'x',
    fetchImpl, maxRetries: 3,
    sleep: async (ms) => { sleeps.push(ms); },
  });
  assert.equal(presence.status, 'present');
  assert.equal(call, 3, 'retried twice before success');
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0] >= 200, 'first backoff honored Retry-After (0.2s → >=200ms)');

  // When Retry-After is absent, falls back to attempt-indexed backoff
  let call2 = 0;
  const noHeaderFetch = async () => {
    call2 += 1;
    return { ok: false, status: 429, headers: { get: () => null } };
  };
  const sleeps2 = [];
  const exhausted = await fetchReviewMessagePresence({
    threadId: 't', messageId: 'm', botToken: 'x',
    fetchImpl: noHeaderFetch, maxRetries: 2,
    sleep: async (ms) => { sleeps2.push(ms); },
  });
  assert.equal(exhausted.status, 'error');
  assert.equal(exhausted.reason, 'discord_api_429');
  assert.equal(call2, 3, 'maxRetries=2 → 1 initial + 2 retries = 3 attempts');
  assert.deepEqual(sleeps2, [500, 1000], 'linear backoff on missing Retry-After');
});

test('withdrawOrphanedPublication deletes the YouTube preview, deletes the render, and flips the DB row to withdrawn', async () => {
  const calls = { yt: [], render: [], update: [] };
  const pub = buildPub('orphan');
  const store = {
    async updatePublication(id, patch) {
      calls.update.push({ id, patch });
      return { ...pub, ...patch, metadata: { ...(pub.metadata || {}), ...(patch.metadata || {}) } };
    },
  };
  const report = await withdrawOrphanedPublication({
    publication: pub,
    reviewThreadId: 'thread-1',
    store,
    deleteYoutubeVideo: async ({ externalId }) => {
      calls.yt.push(externalId);
      return { deletedAt: '2026-10-03T12:00:00Z' };
    },
    deleteRenderFile: async (path) => {
      calls.render.push(path);
      return { deleted: true, deletedAt: '2026-10-03T12:00:00Z' };
    },
    nowIso: '2026-10-03T12:00:00Z',
  });
  assert.deepEqual(calls.yt, ['yt-orphan']);
  assert.deepEqual(calls.render, ['/tmp/render-orphan.mp4']);
  assert.equal(calls.update.length, 1);
  const patch = calls.update[0].patch;
  assert.equal(patch.status, 'withdrawn');
  assert.equal(patch.external_id, null, 'external_id must be cleared when youtube delete succeeded');
  assert.equal(patch.public_url, null);
  assert.equal(patch.metadata.workflow_state, 'withdrawn');
  assert.equal(patch.metadata.withdrawn_reason, 'review_message_404');
  assert.equal(patch.metadata.withdrawn_preview_external_id, 'yt-orphan');
  assert.equal(patch.metadata.withdrawn_preview_delete_error, '');
  assert.equal(patch.metadata.withdrawn_preview_render_deleted_at, '2026-10-03T12:00:00Z');
  assert.equal(report.youtubeDelete.deleted, true);
  assert.equal(report.renderDelete.deleted, true);
});

test('withdrawOrphanedPublication records YouTube delete failures without crashing or clearing external_id', async () => {
  const pub = buildPub('yt-fail');
  const calls = { update: [] };
  const store = {
    async updatePublication(id, patch) {
      calls.update.push({ id, patch });
      return { ...pub, ...patch, metadata: { ...(pub.metadata || {}), ...(patch.metadata || {}) } };
    },
  };
  const report = await withdrawOrphanedPublication({
    publication: pub,
    reviewThreadId: 'thread-1',
    store,
    deleteYoutubeVideo: async () => { throw new Error('quotaExceeded'); },
    deleteRenderFile: async () => ({ deleted: false, error: 'file not found' }),
    nowIso: '2026-10-03T12:00:00Z',
  });
  const patch = calls.update[0].patch;
  assert.equal(patch.status, 'withdrawn', 'row still flips to withdrawn — the Discord message is gone either way');
  assert.equal(patch.external_id, 'yt-yt-fail', 'external_id preserved so a later retry can delete the still-live YouTube preview');
  assert.equal(patch.public_url, pub.public_url);
  assert.equal(patch.metadata.withdrawn_preview_delete_error, 'quotaExceeded');
  assert.equal(patch.metadata.withdrawn_preview_render_delete_error, 'file not found');
  assert.equal(report.youtubeDelete.deleted, false);
  assert.equal(report.youtubeDelete.error, 'quotaExceeded');
});

test('reconcileReviewMessages: checks only review-ready pubs, withdraws the 404s, keeps the present ones', async () => {
  const pubs = [
    buildPub('present'),
    buildPub('missing-a'),
    buildPub('missing-b'),
    buildPub('published', { metadata: { workflow_state: 'published', review_message_id: 'msg-published' } }),
  ];
  const withdrawn = [];
  const summary = await reconcileReviewMessages({
    publications: pubs,
    reviewThreadId: 'thread-1',
    checkMessagePresence: async ({ messageId }) => {
      if (messageId === 'msg-present') return { status: 'present' };
      return { status: 'missing' };
    },
    withdrawPublication: async ({ publication }) => {
      withdrawn.push(publication.id);
      return { publicationId: publication.id, reviewMessageId: publication.metadata.review_message_id, youtubeDelete: { deleted: true }, renderDelete: { deleted: true } };
    },
  });
  assert.equal(summary.candidates, 3);
  assert.equal(summary.present, 1);
  assert.equal(summary.missing, 2);
  assert.equal(summary.errors, 0);
  assert.deepEqual(withdrawn.sort(), ['missing-a', 'missing-b']);
  assert.equal(summary.withdrawn.length, 2);
});

test('reconcileReviewMessages: Discord errors do NOT trigger withdrawals — orphan status is unresolved', async () => {
  const pubs = [buildPub('flaky')];
  const withdrawn = [];
  const summary = await reconcileReviewMessages({
    publications: pubs,
    reviewThreadId: 'thread-1',
    checkMessagePresence: async () => ({ status: 'error', reason: 'discord_api_429' }),
    withdrawPublication: async ({ publication }) => {
      withdrawn.push(publication.id);
      return {};
    },
  });
  assert.equal(summary.candidates, 1);
  assert.equal(summary.missing, 0);
  assert.equal(summary.errors, 1);
  assert.deepEqual(withdrawn, [], 'a transient Discord error must never flip a publication to withdrawn');
  assert.equal(summary.unresolved.length, 1);
  assert.equal(summary.unresolved[0].reason, 'discord_api_429');
});

test('reconcileReviewMessages refuses to run without a review thread id', async () => {
  const summary = await reconcileReviewMessages({
    publications: [buildPub('a')],
    reviewThreadId: '',
    checkMessagePresence: async () => ({ status: 'present' }),
    withdrawPublication: async () => ({}),
  });
  assert.equal(summary.candidates, 1);
  assert.equal(summary.present, 0, 'no check was performed');
  assert.equal(summary.unresolved[0].reason, 'no_review_thread_id');
});
