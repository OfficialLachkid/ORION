import { stableHash } from '../../../../ids.mjs';
import { buildApprovalButtons } from '../../../../../../discord-bot/src/approval-buttons.mjs';
import { buildOutboundEventDiscordPayload } from '../../../../../../discord-bot/src/message-formatting.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_REVIEW_PRESENTATION,
  DEFAULT_GENRE_LABEL,
  DEFAULT_TEMPLATE_PATH,
} from '../../../../video-template-context.mjs';

// Publications in these workflow states still need the operator's Publish /
// Give Feedback / Delete buttons on the Discord review card. Any other state
// means the review is past the decision point (already approved, scheduled,
// published, or terminal), so the buttons are correctly stripped.
//
// Exported so every call site that PATCHes a review message uses the same
// rule. Before this was shared, execute-youtube-publication.mjs's
// updatePublicationReviewMessage blindly wiped components to [] every time it
// touched a message, which meant every publication reconcile silently stripped
// the buttons off actionable preview_uploaded reviews.
export function isActionableReviewPublication(publication) {
  const workflowState = String(publication?.metadata?.workflow_state || '').trim().toLowerCase();
  return workflowState === 'preview_uploaded' || workflowState === 'delete_failed';
}

function normalizeTypePair(typePair = []) {
  return typePair
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function titleCase(value) {
  const text = String(value || '').trim().toLowerCase();
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : '';
}

function formatTypePairLabel(typePair = []) {
  const normalized = normalizeTypePair(typePair);
  return normalized.map((value) => titleCase(value)).join(' / ');
}

function normalizeReviewPresentation(reviewPresentation = {}) {
  const effectivePresentation = {
    ...DEFAULT_REVIEW_PRESENTATION,
    ...(reviewPresentation && typeof reviewPresentation === 'object' ? reviewPresentation : {}),
  };
  effectivePresentation.genre_label = String(
    effectivePresentation.genre_label || DEFAULT_GENRE_LABEL,
  ).trim() || DEFAULT_GENRE_LABEL;
  effectivePresentation.response_patterns = Array.isArray(effectivePresentation.response_patterns)
    ? [...effectivePresentation.response_patterns]
    : [...DEFAULT_REVIEW_PRESENTATION.response_patterns];
  return effectivePresentation;
}

function formatTaskTimestamp(isoString) {
  return String(isoString || new Date().toISOString())
    .replace(/[^0-9]/gu, '')
    .slice(0, 14);
}

function createTaskId(kind, payload, submittedAt) {
  return [
    'TASK',
    'ORION',
    'PQ',
    kind,
    formatTaskTimestamp(submittedAt),
    stableHash(payload, 12).toUpperCase(),
  ].join('-');
}

function buildStablePublicationReviewIdentity({
  publication,
  video,
  channelSelector,
  reviewThreadId,
  typePair,
  seed,
}) {
  return {
    publicationId: publication?.id || '',
    videoId: publication?.video_id || video?.id || '',
    channelSelector: String(channelSelector || DEFAULT_CHANNEL_SELECTOR).trim(),
    reviewThreadId: String(reviewThreadId || '').trim(),
    typePair: normalizeTypePair(typePair || []),
    seed: String(seed || '').trim(),
  };
}

function createPublicationReviewTaskId({
  publication,
  video,
  channelSelector,
  reviewThreadId,
  typePair,
  seed,
  submittedAt,
}) {
  const persistedTaskId = String(publication?.metadata?.review_task_id || '').trim();
  if (persistedTaskId) {
    return persistedTaskId;
  }
  return createTaskId('PUBLISH', buildStablePublicationReviewIdentity({
    publication,
    video,
    channelSelector,
    reviewThreadId,
    typePair,
    seed,
  }), submittedAt);
}

function buildReviewSummary(publication = {}, reviewPresentation = DEFAULT_REVIEW_PRESENTATION) {
  const effectivePresentation = normalizeReviewPresentation(reviewPresentation);
  const typePairLabel = formatTypePairLabel(publication.metadata?.type_pair || []);
  if (typePairLabel) {
    return `${effectivePresentation.summary_with_pair_prefix} ${typePairLabel}.`;
  }
  return `${effectivePresentation.summary_without_pair_prefix} ${publication.id || ''}.`.trim();
}

function buildYoutubeChannelUrl(channelProfile = {}) {
  const channelId = String(channelProfile?.youtube?.channel_id || '').trim();
  return channelId ? `https://www.youtube.com/channel/${channelId}` : '';
}

function formatGenerationDurationLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '';
  }
  if (numeric < 1) {
    return '<1 min';
  }
  return `${Math.round(numeric)} min`;
}

function formatScheduledForLabel(value, timeZone = 'UTC') {
  const iso = String(value || '').trim();
  if (!iso) {
    return '';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)} ${timeZone}`;
}

function formatPreviewDeletionLabel(metadata = {}, timeZone = 'UTC') {
  const withdrawnAt = String(
    metadata?.withdrawn_preview_withdrawn_at
    || '',
  ).trim();
  const withdrawnVisibility = String(
    metadata?.withdrawn_preview_visibility
    || '',
  ).trim();
  const deletedAt = String(
    metadata?.deleted_preview_deleted_at
    || metadata?.rejected_preview_deleted_at
    || '',
  ).trim();
  const deleteError = String(
    metadata?.deleted_preview_delete_error
    || metadata?.rejected_preview_delete_error
    || '',
  ).trim();
  if (deletedAt) {
    return `Deleted from YouTube on ${formatScheduledForLabel(deletedAt, timeZone)}`;
  }
  if (withdrawnAt) {
    const visibilitySuffix = withdrawnVisibility
      ? ` (${titleCase(withdrawnVisibility)})`
      : '';
    return `Withdrawn from public view on ${formatScheduledForLabel(withdrawnAt, timeZone)}${visibilitySuffix}`;
  }
  if (deleteError) {
    return `Delete failed: ${deleteError}`;
  }
  return '';
}

function formatStatusToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/gu, ' ');
}

function formatRelatedVideoStatusLabel(relatedVideo = {}) {
  const applyStatus = formatStatusToken(relatedVideo.apply_status);
  if (applyStatus && applyStatus !== 'pending') {
    return applyStatus;
  }
  const capabilityStatus = formatStatusToken(relatedVideo.capability_status);
  const selectionStatus = formatStatusToken(relatedVideo.selection_status);
  if (selectionStatus && capabilityStatus && capabilityStatus !== 'pending') {
    return `${selectionStatus} / ${capabilityStatus}`;
  }
  return selectionStatus || capabilityStatus || '';
}

function formatRelatedVideoLabel(relatedVideo = {}) {
  const title = String(relatedVideo?.target_title || '').trim();
  if (title) {
    return title;
  }
  return String(relatedVideo?.target_url || '').trim();
}

function normalizeReviewPaths(review = {}) {
  return {
    planPath: String(review.planPath || '').trim(),
    renderPath: String(review.renderPath || '').trim(),
    catalogJsonPath: String(review.catalogJsonPath || '').trim(),
    templatePath: String(review.templatePath || DEFAULT_TEMPLATE_PATH).trim(),
    configPath: String(review.configPath || DEFAULT_CONFIG_PATH).trim(),
  };
}

function buildCollapsedReviewContent(task) {
  const review = task?.poke_quizz_publication_review || {};
  const reviewPresentation = normalizeReviewPresentation(review.reviewPresentation);
  const typePairLabel = formatTypePairLabel(review.typePair || []);
  const workflowState = String(review.approvalState || '').trim().toLowerCase();
  const subjectLabel = typePairLabel || 'the current type pair';
  const previewLabel = review.previewUrl
    ? `Previous preview: ${review.previewUrl}`
    : '';
  if (workflowState === 'deleted') {
    return [
      `${reviewPresentation.collapsed_deleted_prefix} ${subjectLabel}.`,
      review.previewDeletionLabel || 'Removed from YouTube.',
      previewLabel,
    ].filter(Boolean).join(' ');
  }
  if (workflowState === 'withdrawn') {
    return [
      `${reviewPresentation.collapsed_withdrawn_prefix} ${subjectLabel}.`,
      review.previewDeletionLabel || 'Hidden from public view on YouTube.',
      previewLabel,
    ].filter(Boolean).join(' ');
  }
  if (workflowState === 'revision_requested') {
    return [
      `${reviewPresentation.collapsed_revision_prefix} ${subjectLabel}.`,
      review.previewDeletionLabel || 'The previous preview was removed before regeneration.',
      previewLabel,
    ].filter(Boolean).join(' ');
  }
  return '';
}

export function buildPokeQuizzPublicationReviewTask({
  publication,
  video,
  channelProfile = null,
  reviewThreadId,
  planPath,
  renderPath,
  catalogJsonPath,
  templatePath = DEFAULT_TEMPLATE_PATH,
  configPath = DEFAULT_CONFIG_PATH,
  channelSelector = DEFAULT_CHANNEL_SELECTOR,
  genreLabel = '',
  reviewPresentation = DEFAULT_REVIEW_PRESENTATION,
  generationDurationMinutes = null,
  submittedBy = 'O.R.I.O.N.',
  submittedAt = new Date().toISOString(),
}) {
  const effectiveReviewPresentation = normalizeReviewPresentation({
    ...reviewPresentation,
    genre_label: genreLabel || reviewPresentation?.genre_label || DEFAULT_GENRE_LABEL,
  });
  const reviewPayload = {
    publicationId: publication?.id || '',
    videoId: publication?.video_id || video?.id || '',
    channelSelector,
    previewUrl: publication?.preview_url
      || publication?.metadata?.rejected_preview_url
      || publication?.metadata?.withdrawn_preview_url
      || publication?.metadata?.deleted_preview_url
      || '',
    reviewThreadId: String(reviewThreadId || '').trim(),
    reviewMessageId: String(publication?.metadata?.review_message_id || '').trim(),
    typePair: normalizeTypePair(publication?.metadata?.type_pair || video?.render?.type_pair || []),
    seed: String(publication?.metadata?.seed || video?.render?.seed || '').trim(),
    planPath: String(planPath || '').trim(),
    renderPath: String(renderPath || publication?.metadata?.render_path || video?.render?.output_path || '').trim(),
    catalogJsonPath: String(catalogJsonPath || '').trim(),
    templatePath: String(templatePath || DEFAULT_TEMPLATE_PATH).trim(),
    configPath: String(configPath || DEFAULT_CONFIG_PATH).trim(),
    genreLabel: effectiveReviewPresentation.genre_label,
    reviewPresentation: effectiveReviewPresentation,
    channelName: String(channelProfile?.name || '').trim(),
    channelUrl: buildYoutubeChannelUrl(channelProfile),
    publicationTitle: String(publication?.title || '').trim(),
    publicationDescription: String(publication?.description || '').trim(),
    generationDurationLabel: formatGenerationDurationLabel(generationDurationMinutes),
    approvalState: String(publication?.metadata?.workflow_state || '').trim(),
    scheduledForLabel: formatScheduledForLabel(publication?.scheduled_for, channelProfile?.timezone || 'UTC'),
    previewDeletionLabel: formatPreviewDeletionLabel(publication?.metadata || {}, channelProfile?.timezone || 'UTC'),
    relatedVideoLabel: formatRelatedVideoLabel(publication?.metadata?.related_video || {}),
    relatedVideoUrl: String(publication?.metadata?.related_video?.target_url || '').trim(),
    relatedVideoStatusLabel: formatRelatedVideoStatusLabel(publication?.metadata?.related_video || {}),
    relatedVideoReason: String(publication?.metadata?.related_video?.match_reason || '').trim(),
  };

  return {
    task_id: createPublicationReviewTaskId({
      publication,
      video,
      channelSelector,
      reviewThreadId,
      typePair: reviewPayload.typePair,
      seed: reviewPayload.seed,
      submittedAt,
    }),
    status: 'awaiting_approval',
    approval_required: true,
    approval_reason: 'poke_quizz_publish_preview: preview uploaded and awaiting explicit publish approval',
    runtime_action: 'poke_quizz_publish_preview',
    automation_type: 'poke_quizz_publication_review',
    source_type: 'automation',
    target_agent: 'product-video-agent',
    domain: 'content',
    priority: 'normal',
    submitted_by: submittedBy,
    submitted_at: submittedAt,
    summary: buildReviewSummary(publication, effectiveReviewPresentation),
    poke_quizz_publication_review: reviewPayload,
  };
}

export function buildPokeQuizzFeedbackRegenerationTask({
  reviewTask,
  feedback,
  actor,
  actorId = '',
  submittedAt = new Date().toISOString(),
}) {
  const review = reviewTask?.poke_quizz_publication_review || {};
  const reviewPresentation = normalizeReviewPresentation(review.reviewPresentation);
  const payload = {
    publicationId: review.publicationId || '',
    videoId: review.videoId || '',
    channelSelector: review.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    reviewThreadId: String(review.reviewThreadId || '').trim(),
    feedback: String(feedback || '').trim(),
    actor: String(actor || '').trim(),
    actorId: String(actorId || '').trim(),
    typePair: normalizeTypePair(review.typePair || []),
    seed: String(review.seed || '').trim(),
    ...normalizeReviewPaths(review),
    priorReviewTaskId: reviewTask?.task_id || '',
  };

  return {
    task_id: createTaskId('REGENERATE', payload, submittedAt),
    status: 'queued',
    approval_required: false,
    runtime_action: 'poke_quizz_feedback_regenerate',
    automation_type: 'poke_quizz_publication_feedback',
    source_type: 'automation',
    target_agent: 'product-video-agent',
    domain: 'content',
    priority: 'normal',
    submitted_by: String(actor || reviewTask?.submitted_by || 'operator').trim(),
    submitted_at: submittedAt,
    summary: `${reviewPresentation.feedback_summary_prefix} ${formatTypePairLabel(payload.typePair) || 'the current type pair'}.`,
    poke_quizz_feedback: payload,
  };
}

export function buildPokeQuizzDeleteTask({
  reviewTask,
  actor,
  actorId = '',
  submittedAt = new Date().toISOString(),
}) {
  const review = reviewTask?.poke_quizz_publication_review || {};
  const reviewPresentation = normalizeReviewPresentation(review.reviewPresentation);
  const payload = {
    publicationId: review.publicationId || '',
    videoId: review.videoId || '',
    channelSelector: review.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    reviewThreadId: String(review.reviewThreadId || '').trim(),
    reviewMessageId: String(review.reviewMessageId || '').trim(),
    actor: String(actor || '').trim(),
    actorId: String(actorId || '').trim(),
    typePair: normalizeTypePair(review.typePair || []),
    seed: String(review.seed || '').trim(),
    ...normalizeReviewPaths(review),
    priorReviewTaskId: reviewTask?.task_id || '',
  };

  return {
    task_id: createTaskId('DELETE', payload, submittedAt),
    status: 'queued',
    approval_required: false,
    runtime_action: 'poke_quizz_delete_preview',
    automation_type: 'poke_quizz_publication_delete',
    source_type: 'automation',
    target_agent: 'product-video-agent',
    domain: 'content',
    priority: 'normal',
    submitted_by: String(actor || reviewTask?.submitted_by || 'operator').trim(),
    submitted_at: submittedAt,
    summary: `${reviewPresentation.delete_summary_prefix} ${formatTypePairLabel(payload.typePair) || 'the current type pair'} without regenerating it.`,
    poke_quizz_delete: payload,
  };
}

export function buildPokeQuizzPublicationReviewEvent(task) {
  const review = task?.poke_quizz_publication_review || {};
  const reviewPresentation = normalizeReviewPresentation(review.reviewPresentation);
  const typePairLabel = formatTypePairLabel(review.typePair || []);

  return {
    channelKey: 'pokeQuizzReview',
    type: 'approval_request',
    body: `Approval needed for ${task.task_id}: ${task.summary || reviewPresentation.event_body_fallback}`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary || reviewPresentation.event_summary_fallback,
      targetAgent: task.target_agent || 'product-video-agent',
      domain: task.domain || 'content',
      priority: task.priority || 'normal',
      submittedBy: task.submitted_by || '',
      approvalReason: task.approval_reason || '',
      automationType: task.automation_type || '',
      publicationReview: true,
      publicationId: review.publicationId || '',
      videoId: review.videoId || '',
      previewUrl: review.previewUrl || '',
      renderPath: review.renderPath || '',
      planPath: review.planPath || '',
      typePairLabel,
      seed: review.seed || '',
      genreLabel: review.genreLabel || DEFAULT_GENRE_LABEL,
      channelName: review.channelName || '',
      channelUrl: review.channelUrl || '',
      publicationTitle: review.publicationTitle || '',
      publicationDescription: review.publicationDescription || '',
      generationDurationLabel: review.generationDurationLabel || '',
      approvalState: review.approvalState || '',
      scheduledForLabel: review.scheduledForLabel || '',
      previewDeletionLabel: review.previewDeletionLabel || '',
      relatedVideoLabel: review.relatedVideoLabel || '',
      relatedVideoUrl: review.relatedVideoUrl || '',
      relatedVideoStatusLabel: review.relatedVideoStatusLabel || '',
      relatedVideoReason: review.relatedVideoReason || '',
      approveLabel: reviewPresentation.approve_label,
      rejectLabel: reviewPresentation.reject_label,
      deleteLabel: reviewPresentation.delete_label,
      responsePattern: reviewPresentation.response_patterns,
    },
  };
}

export function buildPokeQuizzPublicationReviewPayload(task) {
  const reviewPresentation = normalizeReviewPresentation(
    task?.poke_quizz_publication_review?.reviewPresentation,
  );
  const event = buildPokeQuizzPublicationReviewEvent(task);
  const payload = buildOutboundEventDiscordPayload(event);
  payload.components = buildApprovalButtons(task.task_id, {
    approveLabel: reviewPresentation.approve_label,
    rejectLabel: reviewPresentation.reject_label,
    deleteLabel: reviewPresentation.delete_label,
  });
  return {
    event,
    payload,
  };
}

export function buildPokeQuizzCollapsedReviewPayload(task) {
  return {
    content: buildCollapsedReviewContent(task),
    embeds: [],
    components: [],
  };
}

export function buildPokeQuizzPublicationMessagePayload(task) {
  const workflowState = String(task?.poke_quizz_publication_review?.approvalState || '')
    .trim()
    .toLowerCase();
  if (workflowState === 'deleted' || workflowState === 'revision_requested' || workflowState === 'withdrawn') {
    return buildPokeQuizzCollapsedReviewPayload(task);
  }
  return buildPokeQuizzPublicationReviewPayload(task).payload;
}

export function deriveFeedbackRevisionSeed(reviewTask, feedback, submittedAt = new Date().toISOString()) {
  const review = reviewTask?.poke_quizz_publication_review || {};
  const reviewPresentation = normalizeReviewPresentation(review.reviewPresentation);
  const baseSeed = String(
    review.seed || reviewPresentation.feedback_seed_prefix || DEFAULT_REVIEW_PRESENTATION.feedback_seed_prefix,
  ).trim() || DEFAULT_REVIEW_PRESENTATION.feedback_seed_prefix;
  const feedbackHash = stableHash({
    feedback: String(feedback || '').trim(),
    publicationId: review.publicationId || '',
    submittedAt,
  }, 8);
  return `${baseSeed}-feedback-${formatTaskTimestamp(submittedAt).toLowerCase()}-${feedbackHash}`;
}

export {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_REVIEW_PRESENTATION,
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_GENRE_LABEL,
  formatTypePairLabel,
  formatPreviewDeletionLabel,
};
