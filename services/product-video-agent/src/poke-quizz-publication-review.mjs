import { stableHash } from './ids.mjs';
import { buildApprovalButtons } from '../../discord-bot/src/approval-buttons.mjs';
import { buildOutboundEventDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';

const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';
const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/pokemon-type-challenge-v1.template.json';
const DEFAULT_CONFIG_PATH = 'services/product-video-agent/config.example.json';
const DEFAULT_GENRE_LABEL = 'Type Combination';

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

function buildReviewSummary(publication = {}) {
  const typePairLabel = formatTypePairLabel(publication.metadata?.type_pair || []);
  if (typePairLabel) {
    return `Publish Poke Quizz preview for ${typePairLabel}.`;
  }
  return `Publish Poke Quizz preview ${publication.id || ''}.`.trim();
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
  if (deleteError) {
    return `Delete failed: ${deleteError}`;
  }
  return '';
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
  genreLabel = DEFAULT_GENRE_LABEL,
  generationDurationMinutes = null,
  submittedBy = 'O.R.I.O.N.',
  submittedAt = new Date().toISOString(),
}) {
  const reviewPayload = {
    publicationId: publication?.id || '',
    videoId: publication?.video_id || video?.id || '',
    channelSelector,
    previewUrl: publication?.preview_url
      || publication?.metadata?.rejected_preview_url
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
    genreLabel: String(genreLabel || DEFAULT_GENRE_LABEL).trim(),
    channelName: String(channelProfile?.name || '').trim(),
    channelUrl: buildYoutubeChannelUrl(channelProfile),
    publicationTitle: String(publication?.title || '').trim(),
    publicationDescription: String(publication?.description || '').trim(),
    generationDurationLabel: formatGenerationDurationLabel(generationDurationMinutes),
    approvalState: String(publication?.metadata?.workflow_state || '').trim(),
    scheduledForLabel: formatScheduledForLabel(publication?.scheduled_for, channelProfile?.timezone || 'UTC'),
    previewDeletionLabel: formatPreviewDeletionLabel(publication?.metadata || {}, channelProfile?.timezone || 'UTC'),
  };

  return {
    task_id: createTaskId('PUBLISH', reviewPayload, submittedAt),
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
    summary: buildReviewSummary(publication),
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
    summary: `Regenerate Poke Quizz preview with operator feedback for ${formatTypePairLabel(payload.typePair) || 'the current type pair'}.`,
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
    summary: `Delete the current Poke Quizz preview for ${formatTypePairLabel(payload.typePair) || 'the current type pair'} without regenerating it.`,
    poke_quizz_delete: payload,
  };
}

export function buildPokeQuizzPublicationReviewEvent(task) {
  const review = task?.poke_quizz_publication_review || {};
  const typePairLabel = formatTypePairLabel(review.typePair || []);

  return {
    channelKey: 'pokeQuizzReview',
    type: 'approval_request',
    body: `Approval needed for ${task.task_id}: ${task.summary || 'Publish this Poke Quizz preview.'}`,
    metadata: {
      taskId: task.task_id,
      summary: task.summary || 'Publish this Poke Quizz preview.',
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
      approveLabel: 'Publish',
      rejectLabel: 'Give Feedback',
      deleteLabel: 'Delete',
      responsePattern: [
        'approve TASK-123',
        'reject TASK-123 because <feedback to use in the next preview>',
        'delete TASK-123',
      ],
    },
  };
}

export function buildPokeQuizzPublicationReviewPayload(task) {
  const event = buildPokeQuizzPublicationReviewEvent(task);
  const payload = buildOutboundEventDiscordPayload(event);
  payload.components = buildApprovalButtons(task.task_id, {
    approveLabel: 'Publish',
    rejectLabel: 'Give Feedback',
    deleteLabel: 'Delete',
  });
  return {
    event,
    payload,
  };
}

export function deriveFeedbackRevisionSeed(reviewTask, feedback, submittedAt = new Date().toISOString()) {
  const review = reviewTask?.poke_quizz_publication_review || {};
  const baseSeed = String(review.seed || 'poke-quizz-feedback').trim() || 'poke-quizz-feedback';
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
  DEFAULT_TEMPLATE_PATH,
  DEFAULT_GENRE_LABEL,
  formatTypePairLabel,
  formatPreviewDeletionLabel,
};
