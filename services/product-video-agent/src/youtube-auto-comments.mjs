import { postYoutubeTopLevelComment } from './youtube-publication-executor.mjs';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RECENT_HISTORY_LIMIT = 3;
const DEFAULT_VARIANT_LOOKBACK_LIMIT = 20;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.max(1, Math.floor(numeric));
}

function normalizePublicationWorkflowState(publication = {}) {
  return normalizeText(publication?.metadata?.workflow_state || publication?.status).toLowerCase();
}

function normalizePublicationVisibility(publication = {}, liveStatus = null) {
  return normalizeText(
    liveStatus?.privacyStatus
      || publication?.visibility
      || (normalizePublicationWorkflowState(publication) === 'published' ? 'public' : ''),
  ).toLowerCase();
}

function isPublicationPublic(publication = {}, liveStatus = null) {
  return normalizePublicationVisibility(publication, liveStatus) === 'public';
}

function isPublicationScheduled(publication = {}, liveStatus = null) {
  if (normalizePublicationWorkflowState(publication) === 'scheduled') {
    return true;
  }
  return Boolean(normalizeText(liveStatus?.publishAt || publication?.scheduled_for));
}

function createVariantId(templateId, id, index) {
  const normalizedTemplateId = normalizeText(templateId).replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '');
  const normalizedId = normalizeText(id).replace(/[^a-z0-9]+/giu, '-').replace(/^-+|-+$/gu, '');
  if (normalizedId) {
    return normalizedTemplateId ? `${normalizedTemplateId}-${normalizedId}` : normalizedId;
  }
  if (normalizedTemplateId) {
    return `${normalizedTemplateId}-variant-${index + 1}`;
  }
  return `variant-${index + 1}`;
}

function normalizeVariantList(entries = [], templateId = '') {
  const items = Array.isArray(entries) ? entries : [];
  return items
    .map((entry, index) => {
      if (typeof entry === 'string') {
        const text = normalizeText(entry);
        if (!text) {
          return null;
        }
        return {
          id: createVariantId(templateId, '', index),
          text,
        };
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const text = normalizeText(entry.text || entry.body || entry.comment);
      if (!text) {
        return null;
      }

      return {
        id: createVariantId(templateId, entry.id, index),
        text,
      };
    })
    .filter(Boolean);
}

function dedupeVariants(variants = []) {
  const deduped = [];
  const seen = new Set();
  for (const variant of variants) {
    const key = `${normalizeText(variant?.id).toLowerCase()}::${normalizeText(variant?.text).toLowerCase()}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(variant);
  }
  return deduped;
}

function normalizeTemplateVariantMap(entries = {}) {
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(entries)
      .map(([templateId, variants]) => {
        const normalizedTemplateId = normalizeText(templateId);
        if (!normalizedTemplateId) {
          return null;
        }
        const normalizedVariants = dedupeVariants(
          normalizeVariantList(variants, normalizedTemplateId),
        );
        return [normalizedTemplateId, normalizedVariants];
      })
      .filter((entry) => Array.isArray(entry?.[1]) && entry[1].length > 0),
  );
}

function normalizeYoutubeAutoCommentRecord(publication = {}) {
  const record = publication?.metadata?.youtube_auto_comment;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return {};
  }

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
    video_id: normalizeText(record.video_id),
  };
}

export function resolveYoutubeAutoCommentConfig(channelProfile = {}) {
  const source = channelProfile?.metadata?.youtube_auto_comment
    || channelProfile?.metadata?.automatic_comments
    || {};
  const defaults = source.default_variants || source.defaults || source.variants || [];
  const templateVariants = source.template_variants || source.templates || {};

  return {
    enabled: source.enabled === true,
    maxAttempts: normalizeInteger(source.max_attempts, DEFAULT_MAX_ATTEMPTS),
    recentHistoryLimit: normalizeInteger(source.recent_history_limit, DEFAULT_RECENT_HISTORY_LIMIT),
    lookbackLimit: normalizeInteger(source.lookback_limit, DEFAULT_VARIANT_LOOKBACK_LIMIT),
    defaultVariants: dedupeVariants(normalizeVariantList(defaults, 'default')),
    templateVariants: normalizeTemplateVariantMap(templateVariants),
  };
}

export function collectYoutubeAutoCommentVariants({
  publication,
  channelProfile,
} = {}) {
  const config = resolveYoutubeAutoCommentConfig(channelProfile);
  const templateId = normalizeText(publication?.metadata?.template_id);
  const templateVariants = templateId
    ? (config.templateVariants[templateId] || [])
    : [];
  return dedupeVariants([
    ...templateVariants,
    ...config.defaultVariants,
  ]);
}

export function selectYoutubeAutoCommentVariant({
  publication,
  channelProfile,
  recentPublications = [],
  random = Math.random,
} = {}) {
  const variants = collectYoutubeAutoCommentVariants({ publication, channelProfile });
  if (variants.length === 0) {
    return null;
  }

  const config = resolveYoutubeAutoCommentConfig(channelProfile);
  const recentLimit = normalizeInteger(config.recentHistoryLimit, DEFAULT_RECENT_HISTORY_LIMIT);
  const recentVariantIds = new Set(
    (Array.isArray(recentPublications) ? recentPublications : [])
      .filter((candidate) => candidate?.id !== publication?.id)
      .slice(0, recentLimit)
      .map((candidate) => normalizeText(candidate?.metadata?.youtube_auto_comment?.variant_id))
      .filter(Boolean),
  );

  const eligible = variants.filter((variant) => !recentVariantIds.has(variant.id));
  const pool = eligible.length > 0 ? eligible : variants;
  const numericRandom = typeof random === 'function' ? Number(random()) : Number(random);
  const boundedRandom = Number.isFinite(numericRandom)
    ? Math.min(Math.max(numericRandom, 0), 0.999999)
    : 0;
  const selectedIndex = Math.floor(boundedRandom * pool.length);
  return pool[selectedIndex] || pool[0] || null;
}

function mergePublicationPatch(publication, patch) {
  return {
    ...publication,
    ...patch,
    metadata: {
      ...(publication?.metadata || {}),
      ...(patch?.metadata || {}),
    },
  };
}

function buildCommentUrl(videoId, commentId) {
  const normalizedVideoId = normalizeText(videoId);
  const normalizedCommentId = normalizeText(commentId);
  if (!normalizedVideoId || !normalizedCommentId) {
    return '';
  }
  return `https://www.youtube.com/watch?v=${encodeURIComponent(normalizedVideoId)}&lc=${encodeURIComponent(normalizedCommentId)}`;
}

function buildAutoCommentRecord(publication, baseRecord, patch = {}, asOf = new Date().toISOString()) {
  return {
    ...baseRecord,
    ...patch,
    updated_at: asOf,
    max_attempts: normalizeInteger(
      patch.max_attempts ?? baseRecord.max_attempts,
      DEFAULT_MAX_ATTEMPTS,
    ),
    channel_account_key: normalizeText(
      patch.channel_account_key
      ?? baseRecord.channel_account_key
      ?? publication?.account_key,
    ),
    template_id: normalizeText(
      patch.template_id
      ?? baseRecord.template_id
      ?? publication?.metadata?.template_id,
    ),
    video_id: normalizeText(
      patch.video_id
      ?? baseRecord.video_id
      ?? publication?.external_id,
    ),
  };
}

async function updateAutoCommentRecord({
  store,
  publication,
  record,
}) {
  const patch = {
    metadata: {
      ...(publication?.metadata || {}),
      youtube_auto_comment: record,
    },
  };
  const updated = store?.updatePublication
    ? await store.updatePublication(publication.id, patch)
    : null;
  return updated || mergePublicationPatch(publication, patch);
}

function buildUnsupportedChannelResult(publication, record, config, asOf) {
  return {
    action: 'skipped',
    status: 'skipped',
    reason: 'unsupported_channel',
    publication: mergePublicationPatch(publication, {
      metadata: {
        ...(publication?.metadata || {}),
        youtube_auto_comment: buildAutoCommentRecord(publication, record, {
          status: 'skipped',
          reason: 'unsupported_channel',
          enabled: config.enabled,
        }, asOf),
      },
    }),
  };
}

function classifyYoutubeCommentFailure(error) {
  const status = Number(error?.status || 0);
  const reason = normalizeText(error?.reason).toLowerCase();
  const bodyText = normalizeText(error?.bodyText || error?.message).toLowerCase();

  if (reason.includes('commentsdisabled') || bodyText.includes('commentsdisabled')) {
    return {
      reason: 'comments_disabled',
      retryable: false,
      status: 'skipped',
    };
  }

  if (status === 401 || status === 403) {
    return {
      reason: reason || 'unauthorized',
      retryable: false,
      status: 'failed',
    };
  }

  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return {
      reason: reason || 'transient_api_error',
      retryable: true,
      status: 'pending',
    };
  }

  if (error?.name === 'TypeError') {
    return {
      reason: 'network_error',
      retryable: true,
      status: 'pending',
    };
  }

  return {
    reason: reason || 'comment_post_failed',
    retryable: false,
    status: 'failed',
  };
}

async function fetchRecentPublishedPublications({
  store,
  publication,
  channelProfile,
  config,
}) {
  if (!store?.fetchPublishedPublicationsByChannel) {
    return [];
  }

  return store.fetchPublishedPublicationsByChannel({
    platform: publication?.platform || channelProfile?.platform || 'youtube_shorts',
    accountKey: channelProfile?.account_key || publication?.account_key || '',
    limit: config.lookbackLimit,
  });
}

export async function syncYoutubeAutoCommentState({
  store,
  publication,
  channelProfile,
  clientConfig,
  refreshToken,
  asOf = new Date().toISOString(),
  liveStatus = null,
  recentPublications = null,
  random = Math.random,
  postYoutubeTopLevelCommentImpl = postYoutubeTopLevelComment,
} = {}) {
  if (!publication || !channelProfile) {
    return {
      publication,
      action: 'skipped',
      status: 'skipped',
      reason: 'missing_context',
      updated: false,
    };
  }

  const config = resolveYoutubeAutoCommentConfig(channelProfile);
  const existingRecord = normalizeYoutubeAutoCommentRecord(publication);
  const accountMatches = normalizeText(publication.account_key) === normalizeText(channelProfile.account_key);
  const platformMatches = normalizeText(publication.platform) === normalizeText(channelProfile.platform || 'youtube_shorts');
  if (!accountMatches || !platformMatches) {
    const result = buildUnsupportedChannelResult(publication, existingRecord, config, asOf);
    const updatedPublication = await updateAutoCommentRecord({
      store,
      publication,
      record: result.publication.metadata.youtube_auto_comment,
    });
    return {
      ...result,
      publication: updatedPublication,
      updated: true,
    };
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

  const publicVideo = isPublicationPublic(publication, liveStatus);
  const scheduledVideo = isPublicationScheduled(publication, liveStatus);
  const videoId = normalizeText(publication.external_id);

  const upsertRecord = async (patch) => {
    const record = buildAutoCommentRecord(publication, existingRecord, {
      enabled: config.enabled,
      max_attempts: config.maxAttempts,
      video_id: videoId,
      ...patch,
    }, asOf);
    const updatedPublication = await updateAutoCommentRecord({
      store,
      publication,
      record,
    });
    return {
      publication: updatedPublication,
      record,
      updated: true,
    };
  };

  if (!config.enabled) {
    if (!existingRecord.status) {
      return {
        publication,
        action: 'disabled',
        status: '',
        reason: 'automatic_comments_disabled',
        updated: false,
        record: existingRecord,
      };
    }
    const result = await upsertRecord({
      status: 'skipped',
      reason: 'automatic_comments_disabled',
      last_error: '',
    });
    return {
      ...result,
      action: 'disabled',
      status: 'skipped',
      reason: 'automatic_comments_disabled',
    };
  }

  if (!videoId) {
    const result = await upsertRecord({
      status: 'skipped',
      reason: 'no_video_id',
      last_error: '',
    });
    return {
      ...result,
      action: 'missing_video_id',
      status: 'skipped',
      reason: 'no_video_id',
    };
  }

  const variants = collectYoutubeAutoCommentVariants({ publication, channelProfile });
  if (variants.length === 0) {
    const result = await upsertRecord({
      status: 'skipped',
      reason: 'no_variants_configured',
      last_error: '',
    });
    return {
      ...result,
      action: 'no_variants',
      status: 'skipped',
      reason: 'no_variants_configured',
    };
  }

  if (!publicVideo) {
    if (!scheduledVideo) {
      return {
        publication,
        action: 'preview_only',
        status: existingRecord.status || '',
        reason: 'preview_video',
        updated: false,
        record: existingRecord,
      };
    }

    const result = await upsertRecord({
      status: 'pending',
      reason: 'waiting_for_scheduled_publication',
      pending_since: existingRecord.pending_since || asOf,
      last_error: '',
    });
    return {
      ...result,
      action: 'waiting_for_publication',
      status: 'pending',
      reason: 'waiting_for_scheduled_publication',
    };
  }

  const attemptCount = Number(existingRecord.attempt_count || 0);
  if (attemptCount >= config.maxAttempts) {
    const result = await upsertRecord({
      status: 'failed',
      reason: existingRecord.reason || 'max_attempts_reached',
    });
    return {
      ...result,
      action: 'max_attempts_reached',
      status: 'failed',
      reason: existingRecord.reason || 'max_attempts_reached',
    };
  }

  const publicationHistory = Array.isArray(recentPublications)
    ? recentPublications
    : await fetchRecentPublishedPublications({
      store,
      publication,
      channelProfile,
      config,
    });
  const selectedVariant = selectYoutubeAutoCommentVariant({
    publication,
    channelProfile,
    recentPublications: publicationHistory,
    random,
  }) || variants[0];

  const postingRecord = buildAutoCommentRecord(publication, existingRecord, {
    status: 'posting',
    reason: 'posting',
    attempt_count: attemptCount + 1,
    variant_id: selectedVariant.id,
    text: selectedVariant.text,
    last_attempted_at: asOf,
    last_error: '',
  }, asOf);
  const postingPublication = await updateAutoCommentRecord({
    store,
    publication,
    record: postingRecord,
  });

  try {
    const posted = await postYoutubeTopLevelCommentImpl({
      externalId: videoId,
      textOriginal: selectedVariant.text,
      clientConfig,
      refreshToken,
    });
    const postedRecord = buildAutoCommentRecord(postingPublication, postingRecord, {
      status: 'posted',
      reason: 'posted',
      comment_id: normalizeText(posted.commentId),
      comment_url: buildCommentUrl(videoId, posted.commentId),
      posted_at: normalizeText(posted.postedAt || asOf),
      last_error: '',
    }, asOf);
    const updatedPublication = await updateAutoCommentRecord({
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
    const classified = classifyYoutubeCommentFailure(error);
    const reachedMaxAttempts = postingRecord.attempt_count >= config.maxAttempts;
    const nextStatus = classified.status === 'pending' && !reachedMaxAttempts
      ? 'pending'
      : classified.status === 'skipped'
        ? 'skipped'
        : 'failed';
    const nextReason = reachedMaxAttempts && nextStatus === 'failed'
      ? 'max_attempts_reached'
      : classified.reason;
    const failedRecord = buildAutoCommentRecord(postingPublication, postingRecord, {
      status: nextStatus,
      reason: nextReason,
      last_error: normalizeText(error?.message || error),
    }, asOf);
    const updatedPublication = await updateAutoCommentRecord({
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
      error: normalizeText(error?.message || error),
      retryable: classified.retryable === true && nextStatus === 'pending',
    };
  }
}

export function formatYoutubeAutoCommentStatusLabel(autoComment = {}) {
  const status = normalizeText(autoComment?.status).toLowerCase();
  const reason = normalizeText(autoComment?.reason).toLowerCase();
  switch (status) {
    case 'posted':
      return 'Posted';
    case 'posting':
      return 'Posting';
    case 'pending':
      if (reason === 'waiting_for_scheduled_publication') {
        return 'Waiting for scheduled publication';
      }
      return 'Pending retry';
    case 'failed':
      return 'Failed';
    case 'skipped':
      if (reason === 'automatic_comments_disabled') {
        return 'Disabled';
      }
      if (reason === 'comments_disabled') {
        return 'Comments disabled';
      }
      if (reason === 'unsupported_channel') {
        return 'Unsupported channel';
      }
      if (reason === 'no_variants_configured') {
        return 'No variants configured';
      }
      return 'Skipped';
    default:
      return '';
  }
}
