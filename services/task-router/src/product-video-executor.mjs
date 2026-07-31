import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { runLocalProcess } from '../../product-video-agent/src/process-runner.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../product-video-agent/src/poke-quizz-asset-layout.mjs';
import { SupabasePublicationStore } from '../../product-video-agent/src/publication-store.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_TEMPLATE_PATH,
  deriveFeedbackRevisionSeed,
  formatTypePairLabel,
} from '../../product-video-agent/src/poke-quizz-publication-review.mjs';

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config?.env?.SUPABASE_URL || '',
    apiKey: config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '',
  });
}

function parseLastJsonObject(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return null;
  }

  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    const candidate = text.slice(index);
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep scanning backwards until a valid trailing JSON object is found.
    }
  }

  return null;
}

function assertPublicationReviewTask(task) {
  const review = task?.poke_quizz_publication_review;
  if (!review?.publicationId) {
    throw new Error('Poke Quizz publish task is missing a publication review payload.');
  }
  return review;
}

function assertFeedbackTask(task) {
  const feedback = task?.poke_quizz_feedback;
  if (!feedback?.reviewThreadId) {
    throw new Error('Poke Quizz feedback task is missing the review thread id.');
  }
  if (!feedback?.planPath) {
    throw new Error('Poke Quizz feedback task is missing the original plan path.');
  }
  return feedback;
}

async function executePublishPreviewTask(task, config) {
  const review = assertPublicationReviewTask(task);
  const store = createPublicationStore(config);
  const publication = await store.fetchPublicationById(review.publicationId);
  if (!publication) {
    throw new Error(`Publication ${review.publicationId} was not found.`);
  }

  const approvedAt = new Date().toISOString();
  const updated = await store.updatePublication(publication.id, {
    status: 'approved',
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: 'preview_approved',
      preview_approved_at: approvedAt,
      preview_approved_by: task.approved_by || '',
      preview_approved_by_id: task.approved_by_id || '',
      review_task_id: task.task_id,
    },
  });

  return {
    rawStdout: '',
    report: {
      state: 'preview_approved',
      severity: 'success',
      summary: `Marked ${publication.id} as approved for the Poke Quizz publish queue.`,
      publicationId: updated?.id || publication.id,
      previewUrl: updated?.preview_url || publication.preview_url || '',
      workflowState: updated?.metadata?.workflow_state || 'preview_approved',
      approvedAt,
    },
  };
}

async function buildRevisionPlan({
  feedback,
  revisionSeed,
  reviewRuntimeRoot,
}) {
  const typePair = Array.isArray(feedback.typePair) ? feedback.typePair : [];
  const planPath = feedback.catalogJsonPath
    ? resolve(reviewRuntimeRoot, `${slugify(typePair.join('-') || 'poke-quizz')}-${slugify(revisionSeed)}.plan.json`)
    : resolve(projectRoot, feedback.planPath);

  if (!feedback.catalogJsonPath) {
    return {
      planPath,
      createdPlanPath: false,
    };
  }

  await mkdir(reviewRuntimeRoot, { recursive: true });
  await runLocalProcess({
    executable: process.execPath,
    args: [
      resolve(projectRoot, 'services/product-video-agent/scripts/plan-pokemon-type-challenge.mjs'),
      '--catalog-json',
      resolve(projectRoot, feedback.catalogJsonPath),
      '--template',
      resolve(projectRoot, feedback.templatePath || DEFAULT_TEMPLATE_PATH),
      '--output',
      planPath,
      '--seed',
      revisionSeed,
      '--type-pair',
      typePair.join(','),
    ],
    cwd: projectRoot,
    timeoutMs: 300_000,
  });

  return {
    planPath,
    createdPlanPath: true,
  };
}

async function updatePriorPublicationForRevision(feedback, config) {
  if (!feedback.publicationId) {
    return;
  }

  const store = createPublicationStore(config);
  const publication = await store.fetchPublicationById(feedback.publicationId);
  if (!publication) {
    return;
  }

  await store.updatePublication(publication.id, {
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: 'revision_requested',
      revision_feedback: feedback.feedback || '',
      revision_requested_by: feedback.actor || '',
      revision_requested_by_id: feedback.actorId || '',
      revision_requested_at: new Date().toISOString(),
    },
  });
}

async function executeFeedbackRegenerationTask(task, config) {
  const feedback = assertFeedbackTask(task);
  const submittedAt = task.submitted_at || new Date().toISOString();
  const revisionSeed = deriveFeedbackRevisionSeed(
    { poke_quizz_publication_review: feedback },
    feedback.feedback || '',
    submittedAt,
  );
  const reviewRuntimeRoot = resolve(projectRoot, 'data/runtime/product-video-agent/poke-quizz/reviews');
  const { planPath } = await buildRevisionPlan({
    feedback,
    revisionSeed,
    reviewRuntimeRoot,
  });
  const typePairSlug = slugify((feedback.typePair || []).join('-')) || 'pokemon-type-challenge';
  const outputPath = `${POKE_QUIZZ_ASSET_LAYOUT.previews}/${typePairSlug}-${slugify(revisionSeed)}.mp4`;

  await updatePriorPublicationForRevision(feedback, config);

  await runLocalProcess({
    executable: process.execPath,
    args: [
      resolve(projectRoot, 'services/product-video-agent/scripts/render-poke-quizz-video.mjs'),
      '--plan',
      planPath,
      '--template',
      resolve(projectRoot, feedback.templatePath || DEFAULT_TEMPLATE_PATH),
      '--config',
      resolve(projectRoot, feedback.configPath || DEFAULT_CONFIG_PATH),
      '--output',
      outputPath,
    ],
    cwd: projectRoot,
    timeoutMs: 900_000,
  });

  const reviewResult = await runLocalProcess({
    executable: process.execPath,
    args: [
      resolve(projectRoot, 'services/product-video-agent/scripts/review-poke-quizz-publication.mjs'),
      '--plan',
      planPath,
      '--render',
      outputPath,
      '--thread-id',
      feedback.reviewThreadId,
      '--catalog-json',
      feedback.catalogJsonPath ? resolve(projectRoot, feedback.catalogJsonPath) : '',
      '--channel',
      feedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
      '--template',
      resolve(projectRoot, feedback.templatePath || DEFAULT_TEMPLATE_PATH),
      '--config',
      resolve(projectRoot, feedback.configPath || DEFAULT_CONFIG_PATH),
      '--as-of',
      submittedAt,
      ...(feedback.catalogJsonPath
        ? ['--catalog-json', resolve(projectRoot, feedback.catalogJsonPath)]
        : []),
    ],
    cwd: projectRoot,
    timeoutMs: 300_000,
  });

  const reviewPayload = parseLastJsonObject(reviewResult.stdout) || {};
  return {
    rawStdout: reviewResult.stdout || '',
    report: {
      state: 'preview_regenerated',
      severity: 'success',
      summary: `Generated a revised Poke Quizz preview for ${formatTypePairLabel(feedback.typePair || []) || 'the requested type pair'} and posted it back to the review thread.`,
      publicationId: reviewPayload.publication_id || '',
      previewUrl: reviewPayload.preview_url || '',
      reviewTaskId: reviewPayload.task_id || '',
      reviewMessageId: reviewPayload.message_id || '',
      renderPath: reviewPayload.render_path || outputPath,
      feedback: feedback.feedback || '',
    },
  };
}

export function describeExplicitProductVideoAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'poke_quizz_publish_preview') {
    return {
      action,
      description: 'Mark a reviewed Poke Quizz preview as approved for the publication queue.',
    };
  }

  if (action === 'poke_quizz_feedback_regenerate') {
    return {
      action,
      description: 'Generate a revised Poke Quizz preview from operator feedback and repost it for review.',
    };
  }

  return null;
}

export async function executeProductVideoAction(action, task, config) {
  if (action === 'poke_quizz_publish_preview') {
    return executePublishPreviewTask(task, config);
  }

  if (action === 'poke_quizz_feedback_regenerate') {
    return executeFeedbackRegenerationTask(task, config);
  }

  throw new Error(`Unsupported product-video action '${action}'.`);
}
