// Review-thread reconciliation
//
// A review message on Discord can be deleted outside the workflow —
// manually by a reviewer, or by a thread cleanup. The DB row for that
// publication stays stuck in `metadata.workflow_state = 'preview_uploaded'`
// forever, which inflates the queue-status card ("10/10 ready to review")
// even though several of those messages no longer exist in the review
// thread. The accumulated orphans also leave their YouTube unlisted
// preview videos running on the channel indefinitely.
//
// This module is the counter-pressure: for each publication the queue
// still considers review-ready, confirm its review_message_id still
// resolves on Discord. If it 404s, the message was deleted by someone
// who did not go through the reject flow — treat it as an implicit
// withdrawal, delete the YouTube preview + preview render, and update
// the DB so the row drops out of the review queue.

const DEFAULT_API = 'https://discord.com/api/v10';

export function isReviewReadyPublication(publication) {
  if (!publication || typeof publication !== 'object') return false;
  const workflow = String(publication.metadata?.workflow_state || '').trim().toLowerCase();
  if (workflow !== 'preview_uploaded') return false;
  const messageId = String(publication.metadata?.review_message_id || '').trim();
  return messageId.length > 0;
}

export function selectReviewReadyPublications(publications) {
  return (Array.isArray(publications) ? publications : []).filter(isReviewReadyPublication);
}

// Thin wrapper around GET /channels/{thread}/messages/{id}. Returns
// 'present' | 'missing' | 'error' so the caller can tell the difference
// between "Discord said this is gone" and "we couldn't tell". 5xx and
// unexpected codes fall into 'error' so we never withdraw on a transient
// network blip. 429 is retried up to `maxRetries` times, honoring the
// Retry-After header — the DM-messages bucket is tight and a reconcile
// over all channels hits it easily.
export async function fetchReviewMessagePresence({
  threadId,
  messageId,
  botToken,
  fetchImpl = globalThis.fetch,
  apiBase = DEFAULT_API,
  maxRetries = 3,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const normalizedThread = String(threadId || '').trim();
  const normalizedMessage = String(messageId || '').trim();
  const normalizedToken = String(botToken || '').trim();
  if (!normalizedThread || !normalizedMessage || !normalizedToken) {
    return { status: 'error', reason: 'missing_input' };
  }
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetchImpl(
      `${apiBase}/channels/${normalizedThread}/messages/${normalizedMessage}`,
      { method: 'GET', headers: { Authorization: `Bot ${normalizedToken}` } },
    );
    if (response.ok) return { status: 'present', httpStatus: response.status };
    if (response.status === 404) return { status: 'missing', httpStatus: 404 };
    if (response.status === 429 && attempt < maxRetries) {
      const retryAfterRaw = response.headers?.get?.('retry-after');
      const retryAfterSec = Number(retryAfterRaw);
      const backoffMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? Math.ceil(retryAfterSec * 1000) + 100
        : (attempt + 1) * 500;
      await sleep(backoffMs);
      continue;
    }
    return { status: 'error', reason: `discord_api_${response.status}`, httpStatus: response.status };
  }
  return { status: 'error', reason: 'discord_api_429', httpStatus: 429 };
}

// Side-effect wrapper for withdrawing a single orphaned publication.
// Keeps artifact cleanup aligned with the memory rule
// `feedback_cleanup_on_reject`: delete the underlying YouTube preview
// and the local render file before flipping the DB status, so orphans
// don't accumulate silently.
export async function withdrawOrphanedPublication({
  publication,
  reviewThreadId,
  store,
  deleteYoutubeVideo,
  deleteRenderFile,
  nowIso = new Date().toISOString(),
}) {
  if (!publication || !publication.id) {
    throw new Error('withdrawOrphanedPublication requires a publication with an id.');
  }
  if (!store || typeof store.updatePublication !== 'function') {
    throw new Error('withdrawOrphanedPublication requires a publication store with updatePublication.');
  }
  const externalId = String(publication.external_id || '').trim();
  const renderPath = String(publication.metadata?.preview_render_path || '').trim();
  const report = {
    publicationId: publication.id,
    reviewThreadId,
    reviewMessageId: String(publication.metadata?.review_message_id || '').trim(),
    youtubeDelete: { attempted: false, deleted: false, error: '' },
    renderDelete: { attempted: false, deleted: false, error: '' },
    withdrawnAt: nowIso,
  };

  if (externalId && typeof deleteYoutubeVideo === 'function') {
    report.youtubeDelete.attempted = true;
    try {
      const outcome = await deleteYoutubeVideo({ externalId });
      report.youtubeDelete.deleted = true;
      report.youtubeDelete.deletedAt = outcome?.deletedAt || nowIso;
    } catch (error) {
      report.youtubeDelete.error = error?.message || 'unknown delete error';
    }
  }

  if (renderPath && typeof deleteRenderFile === 'function') {
    report.renderDelete.attempted = true;
    try {
      const outcome = await deleteRenderFile(renderPath);
      report.renderDelete.deleted = Boolean(outcome?.deleted);
      report.renderDelete.deletedAt = outcome?.deletedAt || '';
      report.renderDelete.error = outcome?.error || '';
    } catch (error) {
      report.renderDelete.error = error?.message || 'unknown render delete error';
    }
  }

  // Preserve the review_message_id for the audit trail — operators
  // sometimes need it to go searching for the deletion in audit logs.
  const youtubeCleared = report.youtubeDelete.deleted;
  const updated = await store.updatePublication(publication.id, {
    status: 'withdrawn',
    public_url: youtubeCleared ? null : publication.public_url,
    external_id: youtubeCleared ? null : publication.external_id,
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: 'withdrawn',
      withdrawn_at: nowIso,
      withdrawn_reason: 'review_message_404',
      withdrawn_preview_withdrawn_at: nowIso,
      withdrawn_preview_url: publication.preview_url || '',
      withdrawn_preview_external_id: publication.external_id || '',
      withdrawn_preview_deleted_at: report.youtubeDelete.deleted ? report.youtubeDelete.deletedAt : '',
      withdrawn_preview_delete_error: report.youtubeDelete.error || '',
      withdrawn_preview_render_path: renderPath,
      withdrawn_preview_render_deleted_at: report.renderDelete.deleted ? report.renderDelete.deletedAt : '',
      withdrawn_preview_render_delete_error: report.renderDelete.error || '',
      review_message_missing_detected_at: nowIso,
    },
  });
  report.publication = updated || publication;
  return report;
}

// Primary entrypoint. Pure orchestration — all side effects are injected
// so this is trivial to unit-test. Does NOT fetch publications itself;
// callers pass the already-fetched set so this works for both the
// nightly sweep and the one-shot targeted cleanup.
export async function reconcileReviewMessages({
  publications,
  reviewThreadId,
  checkMessagePresence,
  withdrawPublication,
  logger = null,
}) {
  const candidates = selectReviewReadyPublications(publications);
  const summary = {
    reviewThreadId: String(reviewThreadId || '').trim(),
    candidates: candidates.length,
    present: 0,
    missing: 0,
    errors: 0,
    withdrawn: [],
    unresolved: [],
  };
  if (!summary.reviewThreadId) {
    summary.unresolved.push({ reason: 'no_review_thread_id' });
    return summary;
  }
  if (typeof checkMessagePresence !== 'function') {
    throw new Error('reconcileReviewMessages requires checkMessagePresence');
  }
  if (typeof withdrawPublication !== 'function') {
    throw new Error('reconcileReviewMessages requires withdrawPublication');
  }

  for (const publication of candidates) {
    const messageId = publication.metadata?.review_message_id;
    const presence = await checkMessagePresence({ threadId: summary.reviewThreadId, messageId });
    if (presence.status === 'present') {
      summary.present += 1;
      continue;
    }
    if (presence.status === 'error') {
      summary.errors += 1;
      summary.unresolved.push({ publicationId: publication.id, reason: presence.reason || 'presence_error' });
      logger?.warn?.('[review-reconcile] presence lookup failed', { publicationId: publication.id, ...presence });
      continue;
    }
    summary.missing += 1;
    const report = await withdrawPublication({ publication });
    summary.withdrawn.push(report);
    logger?.info?.('[review-reconcile] withdrew orphan', {
      publicationId: publication.id,
      reviewMessageId: report.reviewMessageId,
      youtubeDeleted: report.youtubeDelete?.deleted,
      renderDeleted: report.renderDelete?.deleted,
    });
  }

  return summary;
}
