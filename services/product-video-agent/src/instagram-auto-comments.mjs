import {
  collectAutomaticCommentVariants,
  resolveAutomaticCommentConfig,
  selectAutomaticCommentVariant,
} from './automatic-comment-policy.mjs';
import {
  InstagramGraphApiError,
  createInstagramGraphClient,
} from './instagram-publication-executor.mjs';

const RECORD_KEY = 'instagram_auto_comment';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication?.metadata?.workflow_state || publication?.status).toLowerCase();
}

function normalizeRecord(publication = {}) {
  const record = publication?.metadata?.[RECORD_KEY];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  return {
    ...record,
    status: normalizeText(record.status).toLowerCase(),
    reason: normalizeText(record.reason).toLowerCase(),
    attempt_count: Number(record.attempt_count || 0),
    max_attempts: Number(record.max_attempts || 0),
    variant_id: normalizeText(record.variant_id),
    text: normalizeText(record.text),
    comment_id: normalizeText(record.comment_id),
    comment_url: normalizeText(record.comment_url),
    posted_at: normalizeText(record.posted_at),
    last_attempted_at: normalizeText(record.last_attempted_at),
    last_error: normalizeText(record.last_error),
    pending_since: normalizeText(record.pending_since),
    updated_at: normalizeText(record.updated_at),
    template_id: normalizeText(record.template_id),
    channel_account_key: normalizeText(record.channel_account_key),
    media_id: normalizeText(record.media_id),
  };
}

function buildRecord(publication, baseRecord, patch = {}, asOf = new Date().toISOString()) {
  return {
    ...baseRecord,
    ...patch,
    updated_at: asOf,
    channel_account_key: normalizeText(
      patch.channel_account_key ?? baseRecord.channel_account_key ?? publication?.account_key,
    ),
    template_id: normalizeText(
      patch.template_id ?? baseRecord.template_id ?? publication?.metadata?.template_id,
    ),
    media_id: normalizeText(
      patch.media_id
        ?? baseRecord.media_id
        ?? publication?.metadata?.instagram_media_id
        ?? publication?.external_id,
    ),
  };
}

async function updateRecord({ store, publication, record }) {
  const patch = {
    metadata: {
      ...(publication?.metadata || {}),
      [RECORD_KEY]: record,
    },
  };
  const updated = store?.updatePublication
    ? await store.updatePublication(publication.id, patch)
    : null;
  return updated || { ...publication, ...patch };
}

function classifyFailure(error) {
  const status = Number(error?.status || 0);
  if (status === 429) {
    return { status: 'pending', reason: 'rate_limited', retryable: true };
  }
  if (error instanceof InstagramGraphApiError && status >= 400 && status < 500) {
    return { status: 'failed', reason: 'instagram_comment_rejected', retryable: false };
  }
  return { status: 'uncertain', reason: 'instagram_comment_uncertain', retryable: false };
}

function expectedUsername(target = {}) {
  return normalizeText(
    target?.instagram?.expected_username || target?.instagram?.expectedUsername,
  ).replace(/^@/u, '').toLowerCase();
}

function targetAllowsComments(target = {}) {
  const override = target?.metadata?.automatic_comments;
  return !(override && typeof override === 'object' && override.enabled === false);
}

function parseTimestamp(value) {
  const normalized = normalizeText(value);
  const timestamp = normalized ? new Date(normalized).getTime() : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function resolveInstagramAutoCommentActivationEligibility(
  publication = {},
  runtimeEnv = {},
) {
  const cutoff = parseTimestamp(runtimeEnv.INSTAGRAM_COMMENTING_ENABLED_SINCE);
  if (cutoff === null) {
    return { eligible: false, reason: 'activation_cutoff_missing' };
  }
  const publicationTimestamp = parseTimestamp(
    publication.scheduled_for
      || publication.metadata?.approved_at
      || publication.created_at,
  );
  if (publicationTimestamp === null) {
    return { eligible: false, reason: 'publication_time_unknown' };
  }
  if (publicationTimestamp < cutoff) {
    return { eligible: false, reason: 'before_activation_cutoff' };
  }
  return { eligible: true, reason: 'eligible' };
}

async function findExistingComment({ client, mediaId, text, target }) {
  const comments = await client.fetchMediaComments(mediaId, { limit: 50 });
  const username = expectedUsername(target);
  return comments.find((comment) => (
    normalizeText(comment.text) === normalizeText(text)
    && (!username || normalizeText(comment.username).toLowerCase() === username)
  )) || null;
}

async function fetchRecentPublications({ store, publication, config }) {
  if (!store?.fetchPublishedPublicationsByChannel) return [];
  return store.fetchPublishedPublicationsByChannel({
    platform: 'instagram_reels',
    accountKey: publication.account_key,
    limit: config.lookbackLimit,
  });
}

export function resolveInstagramAutoCommentConfig(sourceChannelProfile = {}) {
  return resolveAutomaticCommentConfig(sourceChannelProfile, { platform: 'instagram' });
}

export function isInstagramAutoCommentDue(publication = {}) {
  if (normalizeWorkflowState(publication) !== 'published') return false;
  return ['pending', 'posting', 'uncertain'].includes(normalizeRecord(publication).status);
}

export async function syncInstagramAutoCommentState({
  store,
  publication,
  sourcePublication = null,
  sourceChannelProfile,
  target = {},
  runtimeEnv = {},
  asOf = new Date().toISOString(),
  recentPublications = null,
  random = Math.random,
  graphClient = null,
} = {}) {
  if (!publication || !sourceChannelProfile) {
    return {
      publication,
      action: 'skipped',
      status: 'skipped',
      reason: 'missing_context',
      updated: false,
    };
  }

  const config = resolveInstagramAutoCommentConfig(sourceChannelProfile);
  const existingRecord = normalizeRecord(publication);
  const mediaId = normalizeText(
    publication?.metadata?.instagram_media_id || publication?.external_id,
  );
  const upsertRecord = async (patch) => {
    const record = buildRecord(publication, existingRecord, {
      enabled: config.enabled,
      max_attempts: config.maxAttempts,
      media_id: mediaId,
      ...patch,
    }, asOf);
    return {
      publication: await updateRecord({ store, publication, record }),
      record,
      updated: true,
    };
  };

  const accountMatches = normalizeText(publication.account_key)
    === normalizeText(target.accountKey || target.account_key);
  if (normalizeText(publication.platform) !== 'instagram_reels' || !accountMatches) {
    const result = await upsertRecord({
      status: 'skipped',
      reason: 'unsupported_channel',
      last_error: '',
    });
    return { ...result, action: 'disabled', status: 'skipped', reason: 'unsupported_channel' };
  }

  if (existingRecord.status === 'posted' && existingRecord.comment_id) {
    return {
      publication,
      action: 'already_posted',
      status: 'posted',
      reason: 'already_posted',
      updated: false,
      record: existingRecord,
    };
  }

  const activation = resolveInstagramAutoCommentActivationEligibility(
    publication,
    runtimeEnv,
  );
  if (!activation.eligible) {
    if (!existingRecord.status) {
      return {
        publication,
        action: 'disabled',
        status: '',
        reason: activation.reason,
        updated: false,
        record: existingRecord,
      };
    }
    const result = await upsertRecord({
      status: 'skipped',
      reason: activation.reason,
      last_error: '',
    });
    return {
      ...result,
      action: 'disabled',
      status: 'skipped',
      reason: activation.reason,
    };
  }

  const policyAllowsComments = sourcePublication?.metadata?.publication_policy?.auto_comment_enabled !== false;
  if (!config.enabled || !targetAllowsComments(target) || !policyAllowsComments) {
    const reason = !policyAllowsComments
      ? 'publication_policy_disabled'
      : 'automatic_comments_disabled';
    if (!existingRecord.status) {
      return {
        publication,
        action: 'disabled',
        status: '',
        reason,
        updated: false,
        record: existingRecord,
      };
    }
    const result = await upsertRecord({ status: 'skipped', reason, last_error: '' });
    return { ...result, action: 'disabled', status: 'skipped', reason };
  }

  if (normalizeWorkflowState(publication) !== 'published' || !mediaId) {
    return {
      publication,
      action: 'waiting_for_publication',
      status: existingRecord.status || '',
      reason: 'waiting_for_publication',
      updated: false,
      record: existingRecord,
    };
  }

  const variants = collectAutomaticCommentVariants({
    publication,
    channelProfile: sourceChannelProfile,
    platform: 'instagram',
  });
  if (variants.length === 0) {
    const result = await upsertRecord({
      status: 'skipped',
      reason: 'no_variants_configured',
      last_error: '',
    });
    return { ...result, action: 'no_variants', status: 'skipped', reason: 'no_variants_configured' };
  }

  const client = graphClient || createInstagramGraphClient(runtimeEnv, target);
  if (['posting', 'uncertain'].includes(existingRecord.status) && existingRecord.text) {
    try {
      const found = await findExistingComment({
        client,
        mediaId,
        text: existingRecord.text,
        target,
      });
      if (found?.commentId) {
        const result = await upsertRecord({
          status: 'posted',
          reason: 'reconciled',
          comment_id: found.commentId,
          comment_url: normalizeText(publication.public_url),
          posted_at: found.timestamp || asOf,
          last_error: '',
        });
        return {
          ...result,
          action: 'reconciled',
          status: 'posted',
          reason: 'reconciled',
          commentId: found.commentId,
          variantId: existingRecord.variant_id,
        };
      }
    } catch (error) {
      return {
        publication,
        action: 'reconciliation_pending',
        status: existingRecord.status,
        reason: 'comment_lookup_failed',
        updated: false,
        record: existingRecord,
        error: normalizeText(error?.message || error),
      };
    }
    if (existingRecord.status === 'uncertain') {
      return {
        publication,
        action: 'manual_reconciliation_required',
        status: 'uncertain',
        reason: 'instagram_comment_uncertain',
        updated: false,
        record: existingRecord,
      };
    }
    const result = await upsertRecord({
      status: 'uncertain',
      reason: 'interrupted_comment_attempt',
      last_error: existingRecord.last_error || 'Comment attempt was interrupted before its result was persisted.',
    });
    return {
      ...result,
      action: 'manual_reconciliation_required',
      status: 'uncertain',
      reason: 'interrupted_comment_attempt',
    };
  }

  const attemptCount = Number(existingRecord.attempt_count || 0);
  if (attemptCount >= config.maxAttempts) {
    const result = await upsertRecord({ status: 'failed', reason: 'max_attempts_reached' });
    return { ...result, action: 'failed', status: 'failed', reason: 'max_attempts_reached' };
  }

  const history = Array.isArray(recentPublications)
    ? recentPublications
    : await fetchRecentPublications({ store, publication, config });
  const selectedVariant = existingRecord.text
    ? { id: existingRecord.variant_id, text: existingRecord.text }
    : selectAutomaticCommentVariant({
      publication,
      channelProfile: sourceChannelProfile,
      platform: 'instagram',
      recordKey: RECORD_KEY,
      recentPublications: history,
      random,
    }) || variants[0];
  const postingRecord = buildRecord(publication, existingRecord, {
    enabled: true,
    max_attempts: config.maxAttempts,
    status: 'posting',
    reason: 'posting',
    attempt_count: attemptCount + 1,
    variant_id: selectedVariant.id,
    text: selectedVariant.text,
    media_id: mediaId,
    pending_since: existingRecord.pending_since || asOf,
    last_attempted_at: asOf,
    last_error: '',
  }, asOf);
  const postingPublication = await updateRecord({ store, publication, record: postingRecord });

  try {
    const posted = await client.createTopLevelComment({
      mediaId,
      message: selectedVariant.text,
    });
    const postedRecord = buildRecord(postingPublication, postingRecord, {
      status: 'posted',
      reason: 'posted',
      comment_id: normalizeText(posted.commentId),
      comment_url: normalizeText(publication.public_url),
      posted_at: asOf,
      last_error: '',
    }, asOf);
    const updatedPublication = await updateRecord({
      store,
      publication: postingPublication,
      record: postedRecord,
    });
    return {
      publication: updatedPublication,
      action: 'posted',
      status: 'posted',
      reason: 'posted',
      updated: true,
      record: postedRecord,
      commentId: postedRecord.comment_id,
      variantId: postedRecord.variant_id,
    };
  } catch (error) {
    const classified = classifyFailure(error);
    const reachedMaxAttempts = postingRecord.attempt_count >= config.maxAttempts;
    const nextStatus = classified.status === 'pending' && reachedMaxAttempts
      ? 'failed'
      : classified.status;
    const nextReason = nextStatus === 'failed' && reachedMaxAttempts
      ? 'max_attempts_reached'
      : classified.reason;
    const failedRecord = buildRecord(postingPublication, postingRecord, {
      status: nextStatus,
      reason: nextReason,
      last_error: normalizeText(error?.message || error),
    }, asOf);
    const updatedPublication = await updateRecord({
      store,
      publication: postingPublication,
      record: failedRecord,
    });
    return {
      publication: updatedPublication,
      action: nextStatus === 'pending' ? 'retry_pending' : 'failed',
      status: nextStatus,
      reason: nextReason,
      updated: true,
      record: failedRecord,
      error: failedRecord.last_error,
      retryable: classified.retryable && nextStatus === 'pending',
    };
  }
}
