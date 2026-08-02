import { mkdir, readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { runLocalProcess } from '../../product-video-agent/src/process-runner.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../product-video-agent/src/poke-quizz-asset-layout.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../../product-video-agent/src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../product-video-agent/src/publication-store.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_TEMPLATE_PATH,
  buildPokeQuizzDeleteTask,
  buildPokeQuizzPublicationReviewPayload,
  buildPokeQuizzPublicationReviewTask,
  deriveFeedbackRevisionSeed,
  formatTypePairLabel,
} from '../../product-video-agent/src/poke-quizz-publication-review.mjs';
import {
  deleteYoutubeVideo,
  loadYoutubeClientCredentials,
} from '../../product-video-agent/src/youtube-publication-executor.mjs';
import { editDiscordChannelMessage } from '../../../scripts/lib/discord-post.mjs';

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

function parseTrailingJsonArray(stdout) {
  const text = String(stdout || '').trim();
  if (!text) {
    return [];
  }

  for (let index = text.lastIndexOf('['); index >= 0; index = text.lastIndexOf('[', index - 1)) {
    const candidate = text.slice(index);
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Keep scanning backwards until a valid trailing JSON array is found.
    }
  }

  return [];
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

function assertDeleteTask(task) {
  const deletion = task?.poke_quizz_delete;
  if (!deletion?.publicationId) {
    throw new Error('Poke Quizz delete task is missing a publication payload.');
  }
  return deletion;
}

function isActionableReviewWorkflowState(workflowState) {
  const normalizedState = String(workflowState || '').trim().toLowerCase();
  return normalizedState === 'preview_uploaded' || normalizedState === 'delete_failed';
}

async function refreshPublicationReviewMessage({
  config,
  publication,
  videoRow,
  channelSelector = DEFAULT_CHANNEL_SELECTOR,
}) {
  const reviewThreadId = String(publication?.metadata?.review_thread_id || '').trim();
  const reviewMessageId = String(publication?.metadata?.review_message_id || '').trim();
  if (!reviewThreadId || !reviewMessageId || !videoRow) {
    return null;
  }

  const profiles = await loadPublicationChannelProfiles(
    'services/product-video-agent/publication-channels.example.json',
    { projectRoot },
  );
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const reviewTask = buildPokeQuizzPublicationReviewTask({
    publication,
    video: videoRow,
    channelProfile,
    reviewThreadId,
    planPath: '',
    renderPath: publication?.metadata?.render_path || videoRow?.render?.output_path || '',
    catalogJsonPath: '',
    channelSelector,
    submittedAt: publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
  });
  const { payload } = buildPokeQuizzPublicationReviewPayload(reviewTask);
  if (!isActionableReviewWorkflowState(publication?.metadata?.workflow_state)) {
    payload.components = [];
  }
  return editDiscordChannelMessage(config, reviewThreadId, reviewMessageId, payload);
}

async function executePublishPreviewTask(task, config, dependencies = {}) {
  const review = assertPublicationReviewTask(task);
  const store = dependencies.publicationStore || createPublicationStore(config);
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

  const channelSelector = review.channelSelector || DEFAULT_CHANNEL_SELECTOR;
  const runProcess = dependencies.runProcess || runLocalProcess;
  const executePublicationScriptPath = dependencies.executePublicationScriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/execute-youtube-publication.mjs');

  let scheduleSyncError = '';
  let refreshedPublication = updated || publication;
  try {
    const scheduleResult = await runProcess({
      executable: process.execPath,
      args: [
        executePublicationScriptPath,
        '--channel',
        channelSelector,
        '--schedule-approved',
        '--as-of',
        approvedAt,
      ],
      cwd: projectRoot,
      timeoutMs: 1_200_000,
    });
    const scheduledResults = parseTrailingJsonArray(scheduleResult.stdout);
    const scheduledCurrentPublication = scheduledResults.find((entry) => entry?.publication_id === publication.id);
    if (scheduledCurrentPublication) {
      const latestPublication = await store.fetchPublicationById(publication.id);
      if (latestPublication) {
        refreshedPublication = latestPublication;
      }
    } else {
      const latestPublication = await store.fetchPublicationById(publication.id);
      if (latestPublication) {
        refreshedPublication = latestPublication;
      }
    }
  } catch (error) {
    scheduleSyncError = error.message || String(error);
    refreshedPublication = await store.updatePublication(publication.id, {
      metadata: {
        ...((updated || publication).metadata || {}),
        schedule_sync_error: scheduleSyncError,
      },
    }) || refreshedPublication;
  }

  const refreshedWorkflowState = refreshedPublication?.metadata?.workflow_state || 'preview_approved';
  const scheduledFor = refreshedPublication?.scheduled_for || '';
  if (refreshedWorkflowState === 'scheduled' && scheduledFor) {
    return {
      rawStdout: '',
      report: {
        state: 'scheduled',
        severity: 'success',
        summary: `Approved ${publication.id} and scheduled it for ${scheduledFor}.`,
        publicationId: refreshedPublication?.id || publication.id,
        previewUrl: refreshedPublication?.preview_url || publication.preview_url || '',
        workflowState: refreshedWorkflowState,
        approvedAt,
        scheduledFor,
      },
    };
  }

  return {
    rawStdout: '',
    report: {
      state: 'preview_approved',
      severity: scheduleSyncError ? 'warning' : 'success',
      summary: scheduleSyncError
        ? `Marked ${publication.id} as approved, but immediate schedule sync failed: ${scheduleSyncError}`
        : `Marked ${publication.id} as approved for the Poke Quizz publish queue.`,
      publicationId: refreshedPublication?.id || publication.id,
      previewUrl: refreshedPublication?.preview_url || publication.preview_url || '',
      workflowState: refreshedWorkflowState,
      approvedAt,
      scheduledFor,
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
    timeoutMs: 1_200_000,
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
  const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;

  let deleteReport = {
    deleted: false,
    error: '',
  };

  try {
    const profiles = await loadPublicationChannelProfiles(
      'services/product-video-agent/publication-channels.example.json',
      { projectRoot },
    );
    const channelProfile = findPublicationChannelProfile(
      profiles,
      feedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    );
    const refreshToken = config?.env?.[channelProfile.youtube.oauth_refresh_token_env] || '';
    if (
      channelProfile.workflow?.delete_preview_on_reject
      && publication.external_id
      && refreshToken
    ) {
      const clientConfig = await loadYoutubeClientCredentials(
        channelProfile.youtube.oauth_client_secret_path,
        projectRoot,
      );
      const deleted = await deleteYoutubeVideo({
        externalId: publication.external_id,
        clientConfig,
        refreshToken,
      });
      deleteReport = {
        deleted: true,
        deletedAt: deleted.deletedAt,
      };
    }
  } catch (error) {
    deleteReport = {
      deleted: false,
      error: error.message || 'unknown delete error',
    };
  }

  const updatedPublication = await store.updatePublication(publication.id, {
    status: deleteReport.deleted ? 'deleted' : publication.status,
    preview_url: publication.preview_url,
    public_url: deleteReport.deleted ? null : publication.public_url,
    external_id: deleteReport.deleted ? null : publication.external_id,
    uploaded_at: publication.uploaded_at,
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: 'revision_requested',
      revision_feedback: feedback.feedback || '',
      revision_requested_by: feedback.actor || '',
      revision_requested_by_id: feedback.actorId || '',
      revision_requested_at: new Date().toISOString(),
      rejected_preview_url: publication.preview_url || '',
      rejected_preview_external_id: publication.external_id || '',
      rejected_preview_deleted_at: deleteReport.deleted ? deleteReport.deletedAt : '',
      rejected_preview_delete_error: deleteReport.error || '',
    },
  });
  await refreshPublicationReviewMessage({
    config,
    publication: updatedPublication || publication,
    videoRow,
    channelSelector: feedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
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

  const reviewResult = await runLocalProcess({
    executable: process.execPath,
    args: [
      resolve(projectRoot, 'services/product-video-agent/scripts/generate-poke-quizz-review.mjs'),
      '--plan',
      planPath,
      '--thread-id',
      feedback.reviewThreadId,
      '--output',
      outputPath,
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
    timeoutMs: 1_200_000,
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

async function executeDeletePreviewTask(task, config) {
  const deletion = assertDeleteTask(task);
  const store = createPublicationStore(config);
  const publication = await store.fetchPublicationById(deletion.publicationId);
  if (!publication) {
    throw new Error(`Publication ${deletion.publicationId} was not found.`);
  }
  const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;

  let deleteReport = {
    deleted: false,
    error: '',
  };

  try {
    const profiles = await loadPublicationChannelProfiles(
      'services/product-video-agent/publication-channels.example.json',
      { projectRoot },
    );
    const channelProfile = findPublicationChannelProfile(
      profiles,
      deletion.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    );
    const refreshToken = config?.env?.[channelProfile.youtube.oauth_refresh_token_env] || '';
    if (!publication.external_id) {
      throw new Error('Preview has no YouTube video id to delete.');
    }
    if (!refreshToken) {
      throw new Error('YouTube refresh token is unavailable for this channel.');
    }
    const clientConfig = await loadYoutubeClientCredentials(
      channelProfile.youtube.oauth_client_secret_path,
      projectRoot,
    );
    const deleted = await deleteYoutubeVideo({
      externalId: publication.external_id,
      clientConfig,
      refreshToken,
    });
    deleteReport = {
      deleted: true,
      deletedAt: deleted.deletedAt,
    };
  } catch (error) {
    deleteReport = {
      deleted: false,
      error: error.message || 'unknown delete error',
    };
  }

  const updatedPublication = await store.updatePublication(publication.id, {
    status: deleteReport.deleted ? 'deleted' : publication.status,
    preview_url: publication.preview_url,
    public_url: deleteReport.deleted ? null : publication.public_url,
    external_id: deleteReport.deleted ? null : publication.external_id,
    uploaded_at: publication.uploaded_at,
    metadata: {
      ...(publication.metadata || {}),
      workflow_state: deleteReport.deleted ? 'deleted' : 'delete_failed',
      deleted_by: deletion.actor || '',
      deleted_by_id: deletion.actorId || '',
      deleted_at: deleteReport.deleted ? new Date().toISOString() : '',
      delete_attempted_at: new Date().toISOString(),
      deleted_preview_url: publication.preview_url || '',
      deleted_preview_external_id: publication.external_id || '',
      deleted_preview_deleted_at: deleteReport.deleted ? deleteReport.deletedAt : '',
      deleted_preview_delete_error: deleteReport.error || '',
    },
  });
  await refreshPublicationReviewMessage({
    config,
    publication: updatedPublication || publication,
    videoRow,
    channelSelector: deletion.channelSelector || DEFAULT_CHANNEL_SELECTOR,
  });

  return {
    rawStdout: '',
    report: {
      state: deleteReport.deleted ? 'deleted' : 'delete_failed',
      severity: deleteReport.deleted ? 'success' : 'warning',
      summary: deleteReport.deleted
        ? `Deleted preview ${publication.id} from YouTube and marked it as removed.`
        : `Could not delete preview ${publication.id} from YouTube: ${deleteReport.error || 'unknown error'}`,
      publicationId: publication.id,
      previewUrl: publication.preview_url || '',
      workflowState: deleteReport.deleted ? 'deleted' : 'delete_failed',
      deletedAt: deleteReport.deleted ? deleteReport.deletedAt : '',
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

  if (action === 'poke_quizz_delete_preview') {
    return {
      action,
      description: 'Delete a reviewed Poke Quizz preview without generating a replacement.',
    };
  }

  return null;
}

export async function executeProductVideoAction(action, task, config, dependencies = {}) {
  if (action === 'poke_quizz_publish_preview') {
    return executePublishPreviewTask(task, config, dependencies);
  }

  if (action === 'poke_quizz_feedback_regenerate') {
    return executeFeedbackRegenerationTask(task, config);
  }

  if (action === 'poke_quizz_delete_preview') {
    return executeDeletePreviewTask(task, config);
  }

  throw new Error(`Unsupported product-video action '${action}'.`);
}
