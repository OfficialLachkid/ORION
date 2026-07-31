import { stableHash } from './ids.mjs';
import { buildApprovalButtons } from '../../discord-bot/src/approval-buttons.mjs';
import { buildOutboundEventDiscordPayload } from '../../discord-bot/src/message-formatting.mjs';

const DEFAULT_CHANNEL_SELECTOR = 'poke-quizz-youtube';
const DEFAULT_TEMPLATE_PATH = 'services/product-video-agent/pokemon-type-challenge-v1.template.json';
const DEFAULT_CONFIG_PATH = 'services/product-video-agent/config.example.json';

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
  reviewThreadId,
  planPath,
  renderPath,
  catalogJsonPath,
  templatePath = DEFAULT_TEMPLATE_PATH,
  configPath = DEFAULT_CONFIG_PATH,
  channelSelector = DEFAULT_CHANNEL_SELECTOR,
  submittedBy = 'O.R.I.O.N.',
  submittedAt = new Date().toISOString(),
}) {
  const reviewPayload = {
    publicationId: publication?.id || '',
    videoId: publication?.video_id || video?.id || '',
    channelSelector,
    previewUrl: publication?.preview_url || '',
    reviewThreadId: String(reviewThreadId || '').trim(),
    typePair: normalizeTypePair(publication?.metadata?.type_pair || video?.render?.type_pair || []),
    seed: String(publication?.metadata?.seed || video?.render?.seed || '').trim(),
    planPath: String(planPath || '').trim(),
    renderPath: String(renderPath || publication?.metadata?.render_path || video?.render?.output_path || '').trim(),
    catalogJsonPath: String(catalogJsonPath || '').trim(),
    templatePath: String(templatePath || DEFAULT_TEMPLATE_PATH).trim(),
    configPath: String(configPath || DEFAULT_CONFIG_PATH).trim(),
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

export function buildPokeQuizzPublicationReviewEvent(task) {
  const review = task?.poke_quizz_publication_review || {};
  const typePairLabel = formatTypePairLabel(review.typePair || []);

  return {
    channelKey: 'approvals',
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
      approveLabel: 'Publish',
      rejectLabel: 'Give Feedback',
      responsePattern: [
        'approve TASK-123',
        'reject TASK-123 because <feedback to use in the next preview>',
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
  formatTypePairLabel,
};
