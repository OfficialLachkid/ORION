import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { runLocalProcess } from '../../product-video-agent/src/process-runner.mjs';
import { POKE_QUIZZ_ASSET_LAYOUT } from '../../product-video-agent/src/poke-quizz-asset-layout.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../../product-video-agent/src/publication-channels.mjs';
import {
  ensurePreferredPokeQuizzCatalogJsonPath,
  resolvePokeQuizzReviewTaskPaths,
} from '../../product-video-agent/src/poke-quizz-review-paths.mjs';
import { syncPokeQuizzQueueStatusMessage } from '../../product-video-agent/src/poke-quizz-queue-status.mjs';
import { isManagedPokeQuizzPreviewPath as isManagedPokeQuizzPreviewStoragePath } from '../../product-video-agent/src/poke-quizz-preview-storage.mjs';
import { SupabasePublicationStore } from '../../product-video-agent/src/publication-store.mjs';
import {
  DEFAULT_CHANNEL_SELECTOR,
  DEFAULT_CONFIG_PATH,
  DEFAULT_TEMPLATE_PATH,
  buildPokeQuizzDeleteTask,
  buildPokeQuizzPublicationMessagePayload,
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

function resolvePublicationRenderPath(publication, videoRow, explicitRenderPath = '') {
  return String(
    explicitRenderPath
    || publication?.metadata?.render_path
    || videoRow?.render?.output_path
    || '',
  ).trim();
}

function isManagedPokeQuizzPreviewPath(filePath) {
  return isManagedPokeQuizzPreviewStoragePath(filePath);
}

async function deleteManagedPokeQuizzPreviewFile(filePath) {
  if (!isManagedPokeQuizzPreviewPath(filePath)) {
    return {
      deleted: false,
      error: '',
      skipped: true,
    };
  }

  try {
    await rm(filePath);
    return {
      deleted: true,
      error: '',
      skipped: false,
      deletedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return {
        deleted: false,
        error: '',
        skipped: true,
      };
    }
    return {
      deleted: false,
      error: error.message || String(error),
      skipped: false,
    };
  }
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
  return feedback;
}

function assertDeleteTask(task) {
  const deletion = task?.poke_quizz_delete;
  if (!deletion?.publicationId) {
    throw new Error('Poke Quizz delete task is missing a publication payload.');
  }
  return deletion;
}

function assertGenerateReviewTask(task) {
  const generation = task?.poke_quizz_generate_review;
  if (!generation?.channelConfigPath || !generation?.channelSelector) {
    throw new Error('Poke Quizz generation task is missing channel routing metadata.');
  }
  return generation;
}

function assertAnalyticsDigestTask(task) {
  const request = task?.video_analytics_request;
  if (!request?.channelSelector || !request?.windowDays) {
    throw new Error('Analytics digest task is missing channel or day-window metadata.');
  }
  return request;
}

function resolveTaskPublicationId(task) {
  return String(
    task?.poke_quizz_publication_review?.publicationId
    || task?.poke_quizz_feedback?.publicationId
    || task?.poke_quizz_delete?.publicationId
    || '',
  ).trim();
}

function resolveTaskChannelSelector(task) {
  return String(
    task?.poke_quizz_publication_review?.channelSelector
    || task?.poke_quizz_feedback?.channelSelector
    || task?.poke_quizz_delete?.channelSelector
    || task?.poke_quizz_generate_review?.channelSelector
    || DEFAULT_CHANNEL_SELECTOR,
  ).trim() || DEFAULT_CHANNEL_SELECTOR;
}

function isActionableReviewWorkflowState(workflowState) {
  const normalizedState = String(workflowState || '').trim().toLowerCase();
  return normalizedState === 'preview_uploaded' || normalizedState === 'delete_failed';
}

async function resolveChannelProfileForSelector(channelSelector, dependencies = {}) {
  const profilesLoader = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const channelFinder = dependencies.findPublicationChannelProfile || findPublicationChannelProfile;
  const profiles = await profilesLoader(
    'services/product-video-agent/publication-channels.example.json',
    { projectRoot },
  );
  return channelFinder(profiles, channelSelector);
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
  const reviewPaths = await resolvePokeQuizzReviewTaskPaths(publication);

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
    planPath: reviewPaths.planPath,
    renderPath: publication?.metadata?.render_path || videoRow?.render?.output_path || '',
    catalogJsonPath: reviewPaths.catalogJsonPath,
    templatePath: reviewPaths.templatePath,
    configPath: reviewPaths.configPath,
    channelSelector,
    submittedAt: publication?.metadata?.review_requested_at || publication?.created_at || new Date().toISOString(),
  });
  const payload = buildPokeQuizzPublicationMessagePayload(reviewTask);
  if (!isActionableReviewWorkflowState(publication?.metadata?.workflow_state)) {
    payload.components = [];
  }
  return editDiscordChannelMessage(config, reviewThreadId, reviewMessageId, payload);
}

async function restorePublicationReviewMessageOnFailure(task, config, dependencies = {}) {
  const publicationId = resolveTaskPublicationId(task);
  if (!publicationId) {
    return null;
  }

  try {
    const store = dependencies.publicationStore || createPublicationStore(config);
    const publication = await store.fetchPublicationById(publicationId);
    if (!publication) {
      return null;
    }
    const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;
    if (!videoRow) {
      return null;
    }
    return await refreshPublicationReviewMessage({
      config,
      publication,
      videoRow,
      channelSelector: resolveTaskChannelSelector(task),
    });
  } catch (error) {
    process.stderr.write(
      `Could not restore review card for ${publicationId} after task failure: ${error.message}\n`
    );
    return null;
  }
}

async function syncPokeQuizzQueueStatus({
  config,
  store,
  channelSelector = DEFAULT_CHANNEL_SELECTOR,
  asOf = new Date().toISOString(),
  channelProfile = null,
  dependencies = {},
}) {
  const syncQueueStatusMessage = dependencies.syncQueueStatusMessage || syncPokeQuizzQueueStatusMessage;
  let effectiveChannelProfile = channelProfile || dependencies.queueStatusChannelProfile || null;
  if (!effectiveChannelProfile) {
    const profilesLoader = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
    const channelFinder = dependencies.findPublicationChannelProfile || findPublicationChannelProfile;
    const profiles = await profilesLoader(
      'services/product-video-agent/publication-channels.example.json',
      { projectRoot },
    );
    effectiveChannelProfile = channelFinder(profiles, channelSelector);
  }

  return syncQueueStatusMessage({
    runtimeConfig: config,
    store,
    channelProfile: effectiveChannelProfile,
    channelSelector,
    asOf,
  });
}

async function executePublishPreviewTask(task, config, dependencies = {}) {
  const review = assertPublicationReviewTask(task);
  const store = dependencies.publicationStore || createPublicationStore(config);
  const publication = await store.fetchPublicationById(review.publicationId);
  if (!publication) {
    throw new Error(`Publication ${review.publicationId} was not found.`);
  }
  const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;

  const approvedAt = new Date().toISOString();
  const channelSelector = review.channelSelector || DEFAULT_CHANNEL_SELECTOR;
  const channelProfile = await resolveChannelProfileForSelector(channelSelector, dependencies);
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
    const latestPublication = await store.fetchPublicationById(publication.id);
    if (latestPublication) {
      refreshedPublication = latestPublication;
    }
  }

  const refreshedWorkflowState = refreshedPublication?.metadata?.workflow_state || 'preview_approved';
  const scheduledFor = refreshedPublication?.scheduled_for || '';
  if (refreshedWorkflowState === 'scheduled' && scheduledFor) {
    try {
      await refreshPublicationReviewMessage({
        config,
        publication: refreshedPublication,
        videoRow,
        channelSelector,
      });
    } catch (error) {
      process.stderr.write(`Could not refresh scheduled review card ${publication.id}: ${error.message}\n`);
    }
    await syncPokeQuizzQueueStatus({
      config,
      store,
      channelSelector,
      asOf: approvedAt,
      channelProfile,
      dependencies,
    });
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

  const publishAttemptError = scheduleSyncError
    || `Publish approval did not move ${publication.id} into a scheduled slot.`;
  const revertedPublication = await store.updatePublication(publication.id, {
    status: publication.status,
    metadata: {
      ...(publication.metadata || {}),
      review_task_id: task.task_id,
      workflow_state: publication?.metadata?.workflow_state || 'preview_uploaded',
      publish_attempted_at: approvedAt,
      publish_attempt_error: publishAttemptError,
      preview_approved_at: '',
      preview_approved_by: '',
      preview_approved_by_id: '',
      schedule_sync_error: scheduleSyncError,
    },
  }) || publication;

  try {
    await refreshPublicationReviewMessage({
      config,
      publication: revertedPublication,
      videoRow,
      channelSelector,
    });
  } catch (error) {
    process.stderr.write(`Could not restore review card ${publication.id} after failed publish: ${error.message}\n`);
  }

  try {
    await syncPokeQuizzQueueStatus({
      config,
      store,
      channelSelector,
      asOf: approvedAt,
      channelProfile,
      dependencies,
    });
  } catch (error) {
    process.stderr.write(`Could not sync queue status after failed publish ${publication.id}: ${error.message}\n`);
  }

  throw new Error(publishAttemptError);
}

async function buildRevisionPlan({
  feedback,
  revisionSeed,
  reviewRuntimeRoot,
  processRunner = runLocalProcess,
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
  await processRunner({
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

async function updatePriorPublicationForRevision(feedback, config, dependencies = {}) {
  if (!feedback.publicationId) {
    return;
  }

  const store = createPublicationStore(config);
  const publication = await store.fetchPublicationById(feedback.publicationId);
  if (!publication) {
    return;
  }
  const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;
  const renderPath = resolvePublicationRenderPath(publication, videoRow, feedback.renderPath);

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
      const clientConfig = await (dependencies.loadYoutubeClientCredentials || loadYoutubeClientCredentials)(
        channelProfile.youtube.oauth_client_secret_path,
        projectRoot,
      );
      const deleted = await (dependencies.deleteYoutubeVideo || deleteYoutubeVideo)({
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
  const renderDeleteReport = await deleteManagedPokeQuizzPreviewFile(renderPath);

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
      rejected_preview_render_path: renderPath,
      rejected_preview_render_deleted_at: renderDeleteReport.deleted ? renderDeleteReport.deletedAt : '',
      rejected_preview_render_delete_error: renderDeleteReport.error || '',
    },
  });
  await refreshPublicationReviewMessage({
    config,
    publication: updatedPublication || publication,
    videoRow,
    channelSelector: feedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
  });
  await syncPokeQuizzQueueStatus({
    config,
    store,
    channelSelector: feedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    asOf: new Date().toISOString(),
    dependencies,
  });
}

async function executeFeedbackRegenerationTask(task, config, dependencies = {}) {
  const feedback = assertFeedbackTask(task);
  const resolvePreferredCatalogJsonPath =
    dependencies.ensurePreferredPokeQuizzCatalogJsonPath
    || ensurePreferredPokeQuizzCatalogJsonPath;
  const effectiveCatalogJsonPath = feedback.catalogJsonPath || await resolvePreferredCatalogJsonPath();
  if (!feedback.planPath && !effectiveCatalogJsonPath) {
    throw new Error('Poke Quizz feedback task is missing both the original plan path and a localized catalog path.');
  }
  const normalizedFeedback = {
    ...feedback,
    catalogJsonPath: effectiveCatalogJsonPath,
  };
  const submittedAt = task.submitted_at || new Date().toISOString();
  const revisionSeed = deriveFeedbackRevisionSeed(
    { poke_quizz_publication_review: normalizedFeedback },
    normalizedFeedback.feedback || '',
    submittedAt,
  );
  const reviewRuntimeRoot = resolve(projectRoot, 'data/runtime/product-video-agent/poke-quizz/reviews');
  const processRunner = dependencies.runProcess || runLocalProcess;
  const { planPath } = await buildRevisionPlan({
    feedback: normalizedFeedback,
    revisionSeed,
    reviewRuntimeRoot,
    processRunner,
  });
  const typePairSlug = slugify((normalizedFeedback.typePair || []).join('-')) || 'pokemon-type-challenge';
  const outputPath = `${POKE_QUIZZ_ASSET_LAYOUT.previews}/${typePairSlug}-${slugify(revisionSeed)}.mp4`;

  const updatePriorPublication =
    dependencies.updatePriorPublicationForRevision
    || updatePriorPublicationForRevision;

  const reviewResult = await processRunner({
    executable: process.execPath,
    args: [
      resolve(projectRoot, 'services/product-video-agent/scripts/generate-poke-quizz-review.mjs'),
      '--plan',
      planPath,
      '--thread-id',
      normalizedFeedback.reviewThreadId,
      '--output',
      outputPath,
      '--channel',
      normalizedFeedback.channelSelector || DEFAULT_CHANNEL_SELECTOR,
      '--template',
      resolve(projectRoot, normalizedFeedback.templatePath || DEFAULT_TEMPLATE_PATH),
      '--config',
      resolve(projectRoot, normalizedFeedback.configPath || DEFAULT_CONFIG_PATH),
      '--as-of',
      submittedAt,
      ...(normalizedFeedback.catalogJsonPath
        ? ['--catalog-json', resolve(projectRoot, normalizedFeedback.catalogJsonPath)]
        : []),
    ],
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });

  const reviewPayload = parseLastJsonObject(reviewResult.stdout) || {};
  let priorPublicationUpdateError = '';
  try {
    await updatePriorPublication(normalizedFeedback, config, dependencies);
  } catch (error) {
    priorPublicationUpdateError = error.message || String(error);
  }
  return {
    rawStdout: reviewResult.stdout || '',
    report: {
      state: 'preview_regenerated',
      severity: priorPublicationUpdateError ? 'warning' : 'success',
      summary: priorPublicationUpdateError
        ? `Generated a revised Poke Quizz preview for ${formatTypePairLabel(normalizedFeedback.typePair || []) || 'the requested type pair'}, but could not collapse the prior review card: ${priorPublicationUpdateError}`
        : `Generated a revised Poke Quizz preview for ${formatTypePairLabel(normalizedFeedback.typePair || []) || 'the requested type pair'} and posted it back to the review thread.`,
      publicationId: reviewPayload.publication_id || '',
      previewUrl: reviewPayload.preview_url || '',
      reviewTaskId: reviewPayload.task_id || '',
      reviewMessageId: reviewPayload.message_id || '',
      renderPath: reviewPayload.render_path || outputPath,
      feedback: normalizedFeedback.feedback || '',
      priorPublicationUpdateError,
    },
  };
}

async function executeDeletePreviewTask(task, config, dependencies = {}) {
  const deletion = assertDeleteTask(task);
  const store = dependencies.publicationStore || createPublicationStore(config);
  const publication = await store.fetchPublicationById(deletion.publicationId);
  if (!publication) {
    throw new Error(`Publication ${deletion.publicationId} was not found.`);
  }
  const videoRow = publication.video_id ? await store.fetchVideoById(publication.video_id) : null;
  const renderPath = resolvePublicationRenderPath(publication, videoRow, deletion.renderPath);

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
    const clientConfig = await (dependencies.loadYoutubeClientCredentials || loadYoutubeClientCredentials)(
      channelProfile.youtube.oauth_client_secret_path,
      projectRoot,
    );
    const deleted = await (dependencies.deleteYoutubeVideo || deleteYoutubeVideo)({
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
  const renderDeleteReport = await deleteManagedPokeQuizzPreviewFile(renderPath);

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
      deleted_preview_render_path: renderPath,
      deleted_preview_render_deleted_at: renderDeleteReport.deleted ? renderDeleteReport.deletedAt : '',
      deleted_preview_render_delete_error: renderDeleteReport.error || '',
    },
  });
  await refreshPublicationReviewMessage({
    config,
    publication: updatedPublication || publication,
    videoRow,
    channelSelector: deletion.channelSelector || DEFAULT_CHANNEL_SELECTOR,
  });
  await syncPokeQuizzQueueStatus({
    config,
    store,
    channelSelector: deletion.channelSelector || DEFAULT_CHANNEL_SELECTOR,
    asOf: new Date().toISOString(),
    dependencies,
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

async function executeGenerateReviewTask(task, _config, dependencies = {}) {
  const generation = assertGenerateReviewTask(task);
  const resolvePreferredCatalogJsonPath =
    dependencies.ensurePreferredPokeQuizzCatalogJsonPath
    || ensurePreferredPokeQuizzCatalogJsonPath;
  const catalogJsonPath = await resolvePreferredCatalogJsonPath();
  if (!catalogJsonPath) {
    throw new Error('No localized Poke Quizz catalog JSON could be found.');
  }

  const submittedAt = task.submitted_at || new Date().toISOString();
  const runProcess = dependencies.runProcess || runLocalProcess;
  const generateReviewScriptPath = dependencies.generateReviewScriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/generate-poke-quizz-review.mjs');
  const profilesLoader = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const channelFinder = dependencies.findPublicationChannelProfile || findPublicationChannelProfile;
  const profiles = await profilesLoader(
    'services/product-video-agent/publication-channels.example.json',
    { projectRoot },
  );
  const channelProfile = channelFinder(profiles, generation.channelSelector);
  const reviewThreadId = resolvePublicationReviewThreadId(_config, channelProfile);
  const reviewResult = await runProcess({
    executable: process.execPath,
    args: [
      generateReviewScriptPath,
      '--catalog-json',
      resolve(projectRoot, catalogJsonPath),
      '--channel-config',
      resolve(projectRoot, generation.channelConfigPath),
      '--channel',
      generation.channelSelector,
      ...(reviewThreadId ? ['--thread-id', reviewThreadId] : []),
      '--as-of',
      submittedAt,
    ],
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });

  const reviewPayload = parseLastJsonObject(reviewResult.stdout) || {};
  if (!reviewPayload?.publication_id) {
    throw new Error('Poke Quizz manual generation did not return a publication id.');
  }

  return {
    rawStdout: reviewResult.stdout || '',
    report: {
      state: 'preview_generated',
      severity: 'success',
      summary: `Generated a ${generation.templateLabel || 'Poke Quizz'} review video for ${generation.channelLabel || generation.channelSelector} and posted it to the configured review thread.`,
      publicationId: reviewPayload.publication_id || '',
      previewUrl: reviewPayload.preview_url || '',
      reviewTaskId: reviewPayload.task_id || '',
      reviewMessageId: reviewPayload.message_id || '',
      renderPath: reviewPayload.render_path || '',
      channelSelector: generation.channelSelector,
      channelConfigPath: generation.channelConfigPath,
      templateKey: generation.templateKey || '',
    },
  };
}

async function executeAnalyticsDigestTask(task, _config, dependencies = {}) {
  const request = assertAnalyticsDigestTask(task);
  const runProcess = dependencies.runProcess || runLocalProcess;
  const analyticsScriptPath = dependencies.analyticsScriptPath
    || resolve(projectRoot, 'services/product-video-agent/scripts/run-video-analytics-sweep.mjs');
  const normalizedChannelSelector = String(request.channelSelector || '').trim().toLowerCase();
  const shouldPostToCorrespondingChannel = normalizedChannelSelector && normalizedChannelSelector !== 'all';
  const analyticsResult = await runProcess({
    executable: process.execPath,
    args: [
      analyticsScriptPath,
      '--post-discord',
      '--digest-mode',
      'on_demand',
      '--digest-window-days',
      String(request.windowDays),
      '--post-target',
      shouldPostToCorrespondingChannel ? 'corresponding' : 'shared',
      ...(shouldPostToCorrespondingChannel ? ['--channel', request.channelSelector] : []),
    ],
    cwd: projectRoot,
    timeoutMs: 1_200_000,
  });

  const analyticsPayload = parseLastJsonObject(analyticsResult.stdout) || {};
  if (analyticsPayload?.digest_posted !== true) {
    throw new Error('Video analytics digest did not post successfully.');
  }

  return {
    rawStdout: analyticsResult.stdout || '',
    report: {
      state: 'analytics_posted',
      severity: 'success',
      summary: shouldPostToCorrespondingChannel
        ? `Posted a ${request.windowDays}-day YouTube analytics digest for ${request.channelLabel || request.channelSelector} into its corresponding analytics thread.`
        : `Posted a ${request.windowDays}-day YouTube analytics digest for all configured channels into the shared analytics channel.`,
      channelSelector: request.channelSelector,
      channelLabel: request.channelLabel || request.channelSelector,
      windowDays: Number(request.windowDays),
      analyticsChannelId: analyticsPayload.analytics_channel_id || '',
      postedChannelId: analyticsPayload.posted_channel_id || '',
      digestMode: analyticsPayload.digest_mode || 'on_demand',
      postTarget: analyticsPayload.post_target || (shouldPostToCorrespondingChannel ? 'corresponding' : 'shared'),
    },
  };
}

export function describeExplicitProductVideoAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'poke_quizz_generate_review') {
    return {
      action,
      description: 'Generate and post a fresh Poke Quizz review video for the selected template and channel.',
    };
  }

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

  if (action === 'video_analytics_post_digest') {
    return {
      action,
      description: 'Post an on-demand YouTube analytics digest into the shared analytics channel or the selected channel thread.',
    };
  }

  return null;
}

export async function executeProductVideoAction(action, task, config, dependencies = {}) {
  try {
    if (action === 'poke_quizz_generate_review') {
      return executeGenerateReviewTask(task, config, dependencies);
    }

    if (action === 'poke_quizz_publish_preview') {
      return executePublishPreviewTask(task, config, dependencies);
    }

    if (action === 'poke_quizz_feedback_regenerate') {
      return executeFeedbackRegenerationTask(task, config, dependencies);
    }

    if (action === 'poke_quizz_delete_preview') {
      return executeDeletePreviewTask(task, config, dependencies);
    }

    if (action === 'video_analytics_post_digest') {
      return executeAnalyticsDigestTask(task, config, dependencies);
    }

    throw new Error(`Unsupported product-video action '${action}'.`);
  } catch (error) {
    if (
      action === 'poke_quizz_publish_preview'
      || action === 'poke_quizz_feedback_regenerate'
      || action === 'poke_quizz_delete_preview'
    ) {
      await restorePublicationReviewMessageOnFailure(task, config, dependencies);
    }
    throw error;
  }
}
