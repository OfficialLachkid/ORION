#!/usr/bin/env node

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  assignScheduleSlots,
  DEFAULT_SCHEDULE_PUBLISH_GRACE_MINUTES,
  hasCommittedScheduledSlot,
  listCommittedScheduledPublications,
  listTrackedPublishedPublications,
  listTrackedScheduledPublications,
  selectPreviewUploadCandidates,
  selectScheduleCandidates,
} from '../../src/publication-queue.mjs';
import { findPublicationChannelProfile, loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { syncPokeQuizzQueueStatusMessage } from '../../src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import { syncPublicationReviewMessage } from '../../src/publication-review-message-sync.mjs';
import { planRelatedVideoSelection } from '../../src/related-video/selector.mjs';
import { applyYoutubeRelatedVideoSelection } from '../../src/related-video/youtube-studio-automation.mjs';
import { syncYoutubeAutoCommentState } from '../../src/youtube-auto-comments.mjs';
import {
  fetchYoutubeVideoStatus,
  fetchYoutubeVideoStatuses,
  loadYoutubeClientCredentials,
  scheduleYoutubePublication,
  uploadYoutubePreviewVideo,
} from '../../src/youtube-publication-executor.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

function withLimit(items, limit) {
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
    return items;
  }
  return items.slice(0, normalizedLimit);
}

function chunkItems(items, size = 25) {
  const normalizedSize = Number(size);
  const chunkSize = Number.isFinite(normalizedSize) && normalizedSize > 0
    ? Math.floor(normalizedSize)
    : 25;
  const chunks = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeWorkflowState(publication = {}) {
  if (publication.metadata?.workflow_state) {
    return String(publication.metadata.workflow_state).trim().toLowerCase();
  }
  return String(publication.status || '').trim().toLowerCase();
}

function isWithinScheduledPublishGrace(
  publication,
  asOf = new Date().toISOString(),
  graceMinutes = DEFAULT_SCHEDULE_PUBLISH_GRACE_MINUTES,
) {
  if (!hasCommittedScheduledSlot(publication, asOf, graceMinutes)) {
    return false;
  }
  const scheduledFor = String(publication?.scheduled_for || '').trim();
  if (!scheduledFor) {
    return false;
  }
  return new Date(scheduledFor).getTime() <= new Date(asOf).getTime();
}

async function updatePublicationReviewMessage({
  runtimeConfig,
  store,
  publication,
  videoRow,
  channelProfile,
  channelSelector,
}) {
  if (!videoRow) {
    return null;
  }
  return syncPublicationReviewMessage({
    runtimeConfig,
    store,
    publication,
    videoRow,
    channelProfile,
    channelSelector,
  });
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

function replacePublication(publications, updatedPublication) {
  return publications.map((publication) => (
    publication.id === updatedPublication.id ? updatedPublication : publication
  ));
}

function mergeAutoCommentResult(result = {}, autoCommentResult = {}) {
  const status = String(autoCommentResult?.status || '').trim();
  const reason = String(autoCommentResult?.reason || '').trim();
  const variantId = String(
    autoCommentResult?.variantId
      || autoCommentResult?.record?.variant_id
      || '',
  ).trim();
  const commentId = String(
    autoCommentResult?.commentId
      || autoCommentResult?.record?.comment_id
      || '',
  ).trim();
  if (!status && !variantId && !commentId) {
    return result;
  }

  return {
    ...result,
    youtube_auto_comment_status: status,
    youtube_auto_comment_reason: reason,
    youtube_auto_comment_variant_id: variantId,
    youtube_auto_comment_comment_id: commentId,
  };
}

async function persistPublicationState({
  store,
  runtimeConfig,
  publication,
  patch,
  channelProfile,
  channelSelector,
}) {
  const updatedPublication = await store.updatePublication(publication.id, patch)
    || mergePublicationPatch(publication, patch);
  const videoRow = publication.video_id
    ? await store.fetchVideoById(publication.video_id)
    : null;
  await updatePublicationReviewMessage({
    runtimeConfig,
    store,
    publication: updatedPublication,
    videoRow,
    channelProfile,
    channelSelector,
  });
  return updatedPublication;
}

async function syncPublicationYoutubeAutoComment({
  store,
  runtimeConfig,
  publication,
  videoRow = null,
  channelProfile,
  channelSelector,
  clientConfig,
  refreshToken,
  asOf = new Date().toISOString(),
  liveStatus = null,
  syncYoutubeAutoCommentImpl = syncYoutubeAutoCommentState,
}) {
  if (typeof syncYoutubeAutoCommentImpl !== 'function') {
    return {
      publication,
      updated: false,
      action: 'skipped',
      status: '',
      reason: 'missing_sync_function',
    };
  }

  try {
    const result = await syncYoutubeAutoCommentImpl({
      store,
      publication,
      channelProfile,
      clientConfig,
      refreshToken,
      asOf,
      liveStatus,
    });
    const updatedPublication = result?.publication || publication;
    if (result?.updated) {
      let resolvedVideoRow = videoRow;
      if (!resolvedVideoRow && publication?.video_id && store?.fetchVideoById) {
        resolvedVideoRow = await store.fetchVideoById(publication.video_id);
      }
      if (resolvedVideoRow) {
        await updatePublicationReviewMessage({
          runtimeConfig,
          store,
          publication: updatedPublication,
          videoRow: resolvedVideoRow,
          channelProfile,
          channelSelector,
        });
      }
    }
    return {
      ...result,
      publication: updatedPublication,
    };
  } catch (error) {
    return {
      publication,
      updated: false,
      action: 'sync_failed',
      status: 'failed',
      reason: 'sync_exception',
      error: error.message || String(error),
    };
  }
}

async function refreshPlannedRelatedVideo({
  store,
  publication,
  videoRow,
  channelProfile,
  asOf,
}) {
  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
  const { relatedVideo } = planRelatedVideoSelection({
    publications,
    targetPublication: publication,
    targetVideo: videoRow,
    channelProfile,
    asOf,
  });
  const updatedPublication = await store.updatePublication(publication.id, {
    metadata: {
      ...(publication.metadata || {}),
      related_video: relatedVideo,
    },
  });
  return updatedPublication || {
    ...publication,
    metadata: {
      ...(publication.metadata || {}),
      related_video: relatedVideo,
    },
  };
}

function buildRelatedVideoRuntimePatch(publication, applyResult, asOf) {
  const existingRelatedVideo = publication?.metadata?.related_video || {};
  return {
    ...existingRelatedVideo,
    capability_status: String(applyResult?.capability?.status || existingRelatedVideo.capability_status || 'pending').trim(),
    capability_checked_at: String(applyResult?.lastAttemptedAt || asOf || '').trim(),
    apply_status: String(applyResult?.applyStatus || existingRelatedVideo.apply_status || 'pending').trim(),
    applied_at: String(applyResult?.appliedAt || '').trim(),
    last_attempted_at: String(applyResult?.lastAttemptedAt || asOf || '').trim(),
    last_error: String(applyResult?.lastError || '').trim(),
    studio_edit_url: String(applyResult?.studioEditUrl || existingRelatedVideo.studio_edit_url || '').trim(),
  };
}

function isRelatedVideoRefreshCandidate(publication) {
  return ['preview_uploaded', 'preview_approved', 'scheduled'].includes(normalizeWorkflowState(publication));
}

export async function refreshRelatedVideoAssignments({
  publications,
  store,
  runtimeConfig,
  channelProfile,
  channelSelector,
  asOf = new Date().toISOString(),
  dryRun = false,
  applyScheduled = true,
  applyYoutubeRelatedVideoSelectionImpl = applyYoutubeRelatedVideoSelection,
} = {}) {
  let refreshedPublications = [...publications];
  const results = [];
  const candidates = refreshedPublications.filter((publication) => isRelatedVideoRefreshCandidate(publication));

  for (const publication of candidates) {
    const videoRow = publication.video_id
      ? await store.fetchVideoById(publication.video_id)
      : null;
    const { relatedVideo } = planRelatedVideoSelection({
      publications: refreshedPublications,
      targetPublication: publication,
      targetVideo: videoRow,
      channelProfile,
      asOf,
    });

    let updatedPublication = {
      ...publication,
      metadata: {
        ...(publication.metadata || {}),
        related_video: relatedVideo,
      },
    };

    if (!dryRun) {
      updatedPublication = await store.updatePublication(publication.id, {
        metadata: {
          ...(publication.metadata || {}),
          related_video: relatedVideo,
        },
      }) || updatedPublication;
    }

    let applyStatus = '';
    let capabilityStatus = '';
    // Apply during preview_uploaded / preview_approved too, not just scheduled
    // — the operator preferred private previews to already carry the related
    // video so it's set from the moment the video first appears in Studio,
    // rather than only at schedule time. Safe because the schedule-time flow
    // (execute-youtube-publication.mjs:1193) re-plans and re-applies from
    // fresh channel state anyway, so a preview-time apply can only ever be
    // overwritten by a later, more-informed pick — never locked in.
    const applyableStates = ['preview_uploaded', 'preview_approved', 'scheduled'];
    if (
      applyScheduled
      && applyableStates.includes(normalizeWorkflowState(updatedPublication))
      && String(updatedPublication?.external_id || '').trim()
    ) {
      const applyResult = dryRun
        ? {
          capability: { status: 'dry_run' },
          applyStatus: 'dry_run',
          appliedAt: '',
          lastAttemptedAt: asOf,
          lastError: '',
          studioEditUrl: '',
        }
        : await applyYoutubeRelatedVideoSelectionImpl({
          channelProfile,
          publication: updatedPublication,
          relatedVideo: updatedPublication?.metadata?.related_video || {},
          cwd: projectRoot,
          env: process.env,
          asOf,
        });
      applyStatus = String(applyResult?.applyStatus || '').trim();
      capabilityStatus = String(applyResult?.capability?.status || '').trim();

      updatedPublication = {
        ...updatedPublication,
        metadata: {
          ...(updatedPublication.metadata || {}),
          related_video: buildRelatedVideoRuntimePatch(updatedPublication, applyResult, asOf),
        },
      };
      if (!dryRun) {
        updatedPublication = await store.updatePublication(publication.id, {
          metadata: {
            ...(updatedPublication?.metadata || {}),
            related_video: buildRelatedVideoRuntimePatch(updatedPublication, applyResult, asOf),
          },
        }) || updatedPublication;
      }
    }

    if (!dryRun && videoRow) {
      await updatePublicationReviewMessage({
        runtimeConfig,
        store,
        publication: updatedPublication,
        videoRow,
        channelProfile,
        channelSelector,
      });
    }

    refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
    results.push({
      publication_id: publication.id,
      action: 'related_video_refresh',
      workflow_state: normalizeWorkflowState(updatedPublication),
      related_video_selection_status: updatedPublication?.metadata?.related_video?.selection_status || '',
      related_video_target_publication_id: updatedPublication?.metadata?.related_video?.target_publication_id || '',
      related_video_capability_status: capabilityStatus || updatedPublication?.metadata?.related_video?.capability_status || '',
      related_video_apply_status: applyStatus || updatedPublication?.metadata?.related_video?.apply_status || '',
    });
  }

  return {
    publications: refreshedPublications,
    results,
  };
}

export async function reconcilePreviewPublications({
  publications,
  store,
  runtimeConfig,
  channelProfile,
  channelSelector,
  clientConfig,
  refreshToken,
  fetchYoutubeStatuses = fetchYoutubeVideoStatuses,
  asOf = new Date().toISOString(),
  syncYoutubeAutoCommentImpl = syncYoutubeAutoCommentState,
}) {
  let refreshedPublications = [...publications];
  const results = [];
  const trackedPreviewPublications = refreshedPublications.filter((publication) => (
    ['preview_uploaded', 'preview_approved'].includes(normalizeWorkflowState(publication))
    && Boolean(String(publication?.external_id || '').trim())
  ));
  if (trackedPreviewPublications.length === 0) {
    return {
      publications: refreshedPublications,
      results,
    };
  }

  for (const batch of chunkItems(trackedPreviewPublications, 25)) {
    const externalIds = batch
      .map((publication) => String(publication?.external_id || '').trim())
      .filter(Boolean);
    if (externalIds.length === 0) {
      continue;
    }

    let liveStatuses = [];
    try {
      liveStatuses = await fetchYoutubeStatuses({
        externalIds,
        clientConfig,
        refreshToken,
      });
    } catch (error) {
      for (const publication of batch) {
        results.push({
          publication_id: publication.id,
          action: 'preview_reconcile',
          workflow_state: normalizeWorkflowState(publication) || 'preview_uploaded',
          reason: 'status_lookup_failed',
          error: error.message || String(error),
        });
      }
      continue;
    }

    const liveStatusesById = new Map(
      liveStatuses.map((status) => [String(status?.externalId || '').trim(), status]),
    );

    for (const publication of batch) {
      const workflowState = normalizeWorkflowState(publication) || 'preview_uploaded';
      const liveStatus = liveStatusesById.get(String(publication?.external_id || '').trim()) || {
        externalId: publication.external_id,
        found: false,
        privacyStatus: '',
        publishAt: null,
        publishedAt: null,
        title: '',
        publicUrl: publication.public_url || publication.preview_url || '',
      };
      const liveUrl = publication.public_url || publication.preview_url || liveStatus.publicUrl || '';

      if (!liveStatus?.found) {
        const updatedPublication = await persistPublicationState({
          store,
          runtimeConfig,
          publication,
          patch: {
            status: 'deleted',
            visibility: 'private',
            scheduled_for: null,
            public_url: null,
            external_id: null,
            metadata: {
              ...(publication.metadata || {}),
              workflow_state: 'deleted',
              deleted_preview_url: liveUrl,
              deleted_preview_external_id: publication.external_id || '',
              deleted_preview_deleted_at: asOf,
              preview_state_reconciled_at: asOf,
              preview_state_reconciled_reason: 'youtube_video_missing',
            },
          },
          channelProfile,
          channelSelector,
        });
        refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
        results.push({
          publication_id: publication.id,
          action: 'preview_reconcile',
          workflow_state: 'deleted',
          reason: 'youtube_video_missing',
        });
        continue;
      }

      if (liveStatus.privacyStatus === 'public') {
        let updatedPublication = await persistPublicationState({
          store,
          runtimeConfig,
          publication,
          patch: {
            status: 'published',
            visibility: 'public',
            scheduled_for: null,
            public_url: liveUrl,
            published_at: publication.published_at || liveStatus.publishedAt || asOf,
            metadata: {
              ...(publication.metadata || {}),
              workflow_state: 'published',
              youtube_live_title: liveStatus.title || '',
              youtube_live_published_at: liveStatus.publishedAt || '',
              preview_state_reconciled_at: asOf,
              preview_state_reconciled_reason: workflowState === 'preview_approved'
                ? 'approved_preview_made_public'
                : 'preview_made_public',
            },
          },
          channelProfile,
          channelSelector,
        });
        const autoCommentResult = await syncPublicationYoutubeAutoComment({
          store,
          runtimeConfig,
          publication: updatedPublication,
          channelProfile,
          channelSelector,
          clientConfig,
          refreshToken,
          asOf,
          liveStatus,
          syncYoutubeAutoCommentImpl,
        });
        updatedPublication = autoCommentResult.publication || updatedPublication;
        refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
        results.push(mergeAutoCommentResult({
          publication_id: publication.id,
          action: 'preview_reconcile',
          workflow_state: 'published',
          reason: workflowState === 'preview_approved'
            ? 'approved_preview_made_public'
            : 'preview_made_public',
        }, autoCommentResult));
        continue;
      }

      if (liveStatus.publishAt) {
        const liveScheduledFor = new Date(liveStatus.publishAt).toISOString();
        let updatedPublication = await persistPublicationState({
          store,
          runtimeConfig,
          publication,
          patch: {
            status: 'scheduled',
            visibility: String(liveStatus.privacyStatus || publication.visibility || 'private').trim().toLowerCase() || 'private',
            scheduled_for: liveScheduledFor,
            public_url: liveUrl,
            metadata: {
              ...(publication.metadata || {}),
              workflow_state: 'scheduled',
              preview_state_reconciled_at: asOf,
              preview_state_reconciled_reason: 'preview_scheduled_on_youtube',
              youtube_live_privacy_status: liveStatus.privacyStatus || '',
            },
          },
          channelProfile,
          channelSelector,
        });
        const autoCommentResult = await syncPublicationYoutubeAutoComment({
          store,
          runtimeConfig,
          publication: updatedPublication,
          channelProfile,
          channelSelector,
          clientConfig,
          refreshToken,
          asOf,
          liveStatus,
          syncYoutubeAutoCommentImpl,
        });
        updatedPublication = autoCommentResult.publication || updatedPublication;
        refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
        results.push(mergeAutoCommentResult({
          publication_id: publication.id,
          action: 'preview_reconcile',
          workflow_state: 'scheduled',
          scheduled_for: liveScheduledFor,
          reason: 'preview_scheduled_on_youtube',
        }, autoCommentResult));
      }
    }
  }

  return {
    publications: refreshedPublications,
    results,
  };
}

export async function reconcilePublishedPublications({
  publications,
  store,
  runtimeConfig,
  channelProfile,
  channelSelector,
  clientConfig,
  refreshToken,
  fetchYoutubeStatuses = fetchYoutubeVideoStatuses,
  asOf = new Date().toISOString(),
  syncYoutubeAutoCommentImpl = syncYoutubeAutoCommentState,
}) {
  let refreshedPublications = [...publications];
  const results = [];
  const trackedPublications = listTrackedPublishedPublications(
    refreshedPublications,
    channelProfile,
  );
  if (trackedPublications.length === 0) {
    return {
      publications: refreshedPublications,
      results,
    };
  }

  for (const batch of chunkItems(trackedPublications, 25)) {
    const externalIds = batch
      .map((publication) => String(publication?.external_id || '').trim())
      .filter(Boolean);
    if (externalIds.length === 0) {
      continue;
    }

    let liveStatuses = [];
    try {
      liveStatuses = await fetchYoutubeStatuses({
        externalIds,
        clientConfig,
        refreshToken,
      });
    } catch (error) {
      for (const publication of batch) {
        results.push({
          publication_id: publication.id,
          action: 'published_reconcile',
          workflow_state: normalizeWorkflowState(publication) || 'published',
          reason: 'status_lookup_failed',
          error: error.message || String(error),
        });
      }
      continue;
    }

    const liveStatusesById = new Map(
      liveStatuses.map((status) => [String(status?.externalId || '').trim(), status]),
    );

    for (const publication of batch) {
      const workflowState = normalizeWorkflowState(publication) || 'published';
      const liveStatus = liveStatusesById.get(String(publication?.external_id || '').trim()) || {
        externalId: publication.external_id,
        found: false,
        privacyStatus: '',
        publishAt: null,
        publishedAt: null,
        title: '',
        publicUrl: publication.public_url || publication.preview_url || '',
      };
      const liveUrl = publication.public_url || publication.preview_url || liveStatus.publicUrl || '';

      if (!liveStatus?.found) {
        const updatedPublication = await persistPublicationState({
          store,
          runtimeConfig,
          publication,
          patch: {
            status: 'deleted',
            visibility: 'private',
            scheduled_for: null,
            public_url: null,
            external_id: null,
            metadata: {
              ...(publication.metadata || {}),
              workflow_state: 'deleted',
              deleted_preview_url: liveUrl,
              deleted_preview_external_id: publication.external_id || '',
              deleted_preview_deleted_at: asOf,
              published_state_reconciled_at: asOf,
              published_state_reconciled_reason: 'youtube_video_missing',
            },
          },
          channelProfile,
          channelSelector,
        });
        refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
        results.push({
          publication_id: publication.id,
          action: 'published_reconcile',
          workflow_state: 'deleted',
          reason: 'youtube_video_missing',
        });
        continue;
      }

      if (liveStatus.privacyStatus === 'public') {
        const needsPublishedRefresh = workflowState !== 'published'
          || publication.status !== 'published'
          || publication.visibility !== 'public'
          || !String(publication.public_url || '').trim()
          || !String(publication.published_at || '').trim();
        let updatedPublication = publication;
        if (needsPublishedRefresh) {
          updatedPublication = await persistPublicationState({
            store,
            runtimeConfig,
            publication,
            patch: {
              status: 'published',
              visibility: 'public',
              public_url: liveUrl,
              published_at: publication.published_at || liveStatus.publishedAt || asOf,
              metadata: {
                ...(publication.metadata || {}),
                workflow_state: 'published',
                youtube_live_title: liveStatus.title || '',
                youtube_live_published_at: liveStatus.publishedAt || '',
                published_state_reconciled_at: asOf,
                published_state_reconciled_reason: workflowState === 'withdrawn'
                  ? 'youtube_public_restored'
                  : 'published_metadata_refreshed',
              },
            },
            channelProfile,
            channelSelector,
          });
        }
        const autoCommentResult = await syncPublicationYoutubeAutoComment({
          store,
          runtimeConfig,
          publication: updatedPublication,
          channelProfile,
          channelSelector,
          clientConfig,
          refreshToken,
          asOf,
          liveStatus,
          syncYoutubeAutoCommentImpl,
        });
        updatedPublication = autoCommentResult.publication || updatedPublication;
        refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
        if (!needsPublishedRefresh && !autoCommentResult.updated) {
          continue;
        }

        results.push(mergeAutoCommentResult({
          publication_id: publication.id,
          action: 'published_reconcile',
          workflow_state: 'published',
          reason: workflowState === 'withdrawn'
            ? 'youtube_public_restored'
            : 'published_metadata_refreshed',
        }, autoCommentResult));
        continue;
      }

      const normalizedPrivacy = String(liveStatus.privacyStatus || 'private').trim().toLowerCase() || 'private';
      const isAlreadyWithdrawn = workflowState === 'withdrawn'
        && publication.status === 'withdrawn'
        && String(publication.visibility || '').trim().toLowerCase() === normalizedPrivacy;
      if (isAlreadyWithdrawn) {
        continue;
      }

      const updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'withdrawn',
          visibility: normalizedPrivacy,
          scheduled_for: null,
          public_url: liveUrl,
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'withdrawn',
            withdrawn_preview_url: liveUrl,
            withdrawn_preview_external_id: publication.external_id || '',
            withdrawn_preview_withdrawn_at: asOf,
            withdrawn_preview_visibility: normalizedPrivacy,
            youtube_live_title: liveStatus.title || '',
            youtube_live_published_at: liveStatus.publishedAt || '',
            published_state_reconciled_at: asOf,
            published_state_reconciled_reason: `youtube_visibility_${normalizedPrivacy}`,
          },
        },
        channelProfile,
        channelSelector,
      });
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push({
        publication_id: publication.id,
        action: 'published_reconcile',
        workflow_state: 'withdrawn',
        reason: `youtube_visibility_${normalizedPrivacy}`,
      });
    }
  }

  return {
    publications: refreshedPublications,
    results,
  };
}

export async function reconcileScheduledPublications({
  publications,
  store,
  runtimeConfig,
  channelProfile,
  channelSelector,
  clientConfig,
  refreshToken,
  asOf = new Date().toISOString(),
  fetchYoutubeStatus = fetchYoutubeVideoStatus,
  syncYoutubeAutoCommentImpl = syncYoutubeAutoCommentState,
}) {
  let refreshedPublications = [...publications];
  const results = [];
  const scheduledPublications = listTrackedScheduledPublications(
    refreshedPublications,
    channelProfile,
  );

  for (const publication of scheduledPublications) {
    if (!publication.external_id) {
      const updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'approved',
          scheduled_for: null,
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'preview_approved',
            schedule_reconciled_at: new Date().toISOString(),
            schedule_reconciled_reason: 'missing_external_id',
          },
        },
        channelProfile,
        channelSelector,
      });
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: 'preview_approved',
        reason: 'missing_external_id',
      });
      continue;
    }

    let liveStatus;
    try {
      liveStatus = await fetchYoutubeStatus({
        externalId: publication.external_id,
        clientConfig,
        refreshToken,
      });
    } catch (error) {
      results.push({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: publication.metadata?.workflow_state || 'scheduled',
        reason: 'status_lookup_failed',
        error: error.message || String(error),
      });
      continue;
    }

    if (liveStatus?.privacyStatus === 'public') {
      let updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'published',
          visibility: 'public',
          public_url: publication.public_url || publication.preview_url || liveStatus.publicUrl || '',
          published_at: publication.published_at || liveStatus.publishedAt || new Date().toISOString(),
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'published',
            youtube_live_title: liveStatus.title || '',
            youtube_live_published_at: liveStatus.publishedAt || '',
          },
        },
        channelProfile,
        channelSelector,
      });
      const autoCommentResult = await syncPublicationYoutubeAutoComment({
        store,
        runtimeConfig,
        publication: updatedPublication,
        channelProfile,
        channelSelector,
        clientConfig,
        refreshToken,
        asOf,
        liveStatus,
        syncYoutubeAutoCommentImpl,
      });
      updatedPublication = autoCommentResult.publication || updatedPublication;
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push(mergeAutoCommentResult({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: 'published',
        reason: 'already_public',
      }, autoCommentResult));
      continue;
    }

    if (!liveStatus?.found) {
      const updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'deleted',
          visibility: 'private',
          scheduled_for: null,
          public_url: null,
          external_id: null,
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'deleted',
            deleted_preview_url: publication.preview_url || publication.public_url || '',
            deleted_preview_external_id: publication.external_id || '',
            deleted_preview_deleted_at: new Date().toISOString(),
            schedule_reconciled_at: new Date().toISOString(),
            schedule_reconciled_reason: 'youtube_video_missing',
          },
        },
        channelProfile,
        channelSelector,
      });
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: 'deleted',
        reason: 'youtube_video_missing',
      });
      continue;
    }

    if (
      !liveStatus.publishAt
      && String(liveStatus.privacyStatus || '').trim().toLowerCase() === 'private'
      && isWithinScheduledPublishGrace(publication, asOf)
    ) {
      results.push({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: publication.metadata?.workflow_state || 'scheduled',
        scheduled_for: publication.scheduled_for || '',
        reason: 'awaiting_youtube_publish_grace',
      });
      continue;
    }

    if (!liveStatus.publishAt) {
      const updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'approved',
          visibility: liveStatus.privacyStatus || publication.visibility || 'private',
          scheduled_for: null,
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'preview_approved',
            schedule_reconciled_at: new Date().toISOString(),
            schedule_reconciled_reason: 'youtube_publish_time_missing',
            youtube_live_privacy_status: liveStatus.privacyStatus || '',
          },
        },
        channelProfile,
        channelSelector,
      });
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: 'preview_approved',
        reason: 'youtube_publish_time_missing',
      });
      continue;
    }

    const liveScheduledFor = new Date(liveStatus.publishAt).toISOString();
    const storedScheduledFor = String(publication.scheduled_for || '').trim();
    if (storedScheduledFor !== liveScheduledFor) {
      let updatedPublication = await persistPublicationState({
        store,
        runtimeConfig,
        publication,
        patch: {
          status: 'scheduled',
          visibility: 'private',
          scheduled_for: liveScheduledFor,
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'scheduled',
            schedule_reconciled_at: new Date().toISOString(),
            schedule_reconciled_reason: 'youtube_publish_time_changed',
          },
        },
        channelProfile,
        channelSelector,
      });
      const autoCommentResult = await syncPublicationYoutubeAutoComment({
        store,
        runtimeConfig,
        publication: updatedPublication,
        channelProfile,
        channelSelector,
        clientConfig,
        refreshToken,
        asOf,
        liveStatus,
        syncYoutubeAutoCommentImpl,
      });
      updatedPublication = autoCommentResult.publication || updatedPublication;
      refreshedPublications = replacePublication(refreshedPublications, updatedPublication);
      results.push(mergeAutoCommentResult({
        publication_id: publication.id,
        action: 'queue_reconcile',
        workflow_state: 'scheduled',
        scheduled_for: liveScheduledFor,
        reason: 'youtube_publish_time_changed',
      }, autoCommentResult));
    }
  }

  return {
    publications: refreshedPublications,
    results,
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/execute-youtube-publication.mjs [options]',
      '',
      'Options:',
      '  --channel <id>             Channel id or account_key. Default: poke-quizz-youtube',
      '  --channels <path>          Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --publication-id <id>      Limit execution to one publication id.',
      '  --limit <n>                Maximum publications to process in this run.',
      '  --refresh-related-videos   Re-plan related-video metadata for existing preview/scheduled rows.',
      '  --schedule-approved        Apply schedule updates instead of preview uploads.',
      '  --max-scheduled-days <n>   Limit schedule assignment to the next N days from --as-of.',
      '  --dry-run                  Print the planned work without calling YouTube.',
      '  --as-of <ISO>              Deterministic schedule planning timestamp. Default: now.',
    ]);
    return;
  }

  const previewUploadMode = !getBooleanOption(options, 'schedule-approved', false);
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const channelSelector = getStringOption(options, 'channel', 'poke-quizz-youtube');
  const publicationId = getStringOption(options, 'publication-id', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const refreshRelatedVideosOnly = getBooleanOption(options, 'refresh-related-videos', false);
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const maxScheduledDays = Number.parseFloat(
    getStringOption(options, 'max-scheduled-days', ''),
  );

  const runtimeConfig = loadRuntimeConfig();
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, channelSelector);
  const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
  if (!refreshToken) {
    throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
  }

  const store = new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
  });
  const [clientConfig, publications] = await Promise.all([
    loadYoutubeClientCredentials(channelProfile.youtube.oauth_client_secret_path, projectRoot),
    store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    }),
  ]);

  const scopedPublications = publicationId
    ? publications.filter((publication) => publication.id === publicationId)
    : publications;

  if (refreshRelatedVideosOnly) {
    const refreshed = await refreshRelatedVideoAssignments({
      publications: scopedPublications,
      store,
      runtimeConfig,
      channelProfile,
      channelSelector,
      asOf,
      dryRun,
      applyScheduled: true,
    });
    if (!dryRun) {
      await syncPokeQuizzQueueStatusMessage({
        runtimeConfig,
        store,
        channelProfile,
        channelSelector,
        asOf,
      });
    }
    process.stdout.write(`${JSON.stringify(refreshed.results, null, 2)}\n`);
    return;
  }

  let effectivePublications = scopedPublications;
  let preflightResults = [];
  if (!previewUploadMode) {
    const previewReconciled = await reconcilePreviewPublications({
      publications: scopedPublications,
      store,
      runtimeConfig,
      channelProfile,
      channelSelector,
      clientConfig,
      refreshToken,
      asOf,
    });
    const publishedReconciled = await reconcilePublishedPublications({
      publications: previewReconciled.publications,
      store,
      runtimeConfig,
      channelProfile,
      channelSelector,
      clientConfig,
      refreshToken,
      asOf,
    });
    const scheduledReconciled = await reconcileScheduledPublications({
      publications: publishedReconciled.publications,
      store,
      runtimeConfig,
      channelProfile,
      channelSelector,
      clientConfig,
      refreshToken,
      asOf,
    });
    effectivePublications = scheduledReconciled.publications;
    preflightResults = [
      ...previewReconciled.results,
      ...publishedReconciled.results,
      ...scheduledReconciled.results,
    ];
  }
  const candidates = previewUploadMode
    ? selectPreviewUploadCandidates(effectivePublications, channelProfile)
    : assignScheduleSlots(
      selectScheduleCandidates(effectivePublications, channelProfile, asOf),
      channelProfile,
      asOf,
      listCommittedScheduledPublications(effectivePublications, channelProfile, asOf),
      {
        maxScheduledDays,
      },
    );
  const workItems = withLimit(candidates, getStringOption(options, 'limit', ''));

  if (workItems.length === 0 && preflightResults.length === 0) {
    printWarn(`No ${previewUploadMode ? 'preview upload' : 'schedule'} candidates were found for ${channelProfile.account_key}.`);
    process.stdout.write('[]\n');
    return;
  }

  const results = [...preflightResults];
  for (const item of workItems) {
    const publication = previewUploadMode
      ? item
      : scopedPublications.find((row) => row.id === item.id) || item;
    if (!publication) continue;
    const videoRow = publication.video_id
      ? await store.fetchVideoById(publication.video_id)
      : null;

    if (previewUploadMode) {
      if (!videoRow) {
        throw new Error(`Video row not found for publication ${publication.id}.`);
      }

      if (dryRun) {
        results.push({
          publication_id: publication.id,
          action: 'preview_upload',
          render_path: publication.metadata?.render_path || videoRow.render?.output_path || null,
          title: publication.title,
        });
        continue;
      }

      const uploaded = await uploadYoutubePreviewVideo({
        publication,
        videoRow,
        channelProfile,
        clientConfig,
        refreshToken,
      });
      const updatedPublication = await store.updatePublication(publication.id, {
        external_id: uploaded.externalId,
        preview_url: uploaded.previewUrl,
        visibility: channelProfile.workflow.preview_visibility,
        uploaded_at: uploaded.uploadedAt,
        metadata: {
          ...(publication.metadata || {}),
          workflow_state: 'preview_uploaded',
          render_path: uploaded.renderPath,
          youtube_preview_upload: {
            completed_at: uploaded.uploadedAt,
            response_id: uploaded.externalId,
          },
        },
      });
      results.push({
        publication_id: publication.id,
        action: 'preview_upload',
        external_id: uploaded.externalId,
        preview_url: uploaded.previewUrl,
        uploaded_at: uploaded.uploadedAt,
        workflow_state: updatedPublication?.metadata?.workflow_state || 'preview_uploaded',
      });
      printInfo(`Uploaded preview ${publication.id} to ${uploaded.previewUrl}`);
      continue;
    }

    if (dryRun) {
      results.push({
        publication_id: publication.id,
        action: 'schedule_update',
        scheduled_for: item.scheduled_for,
        external_id: publication.external_id,
      });
      continue;
    }

    const liveStatus = publication.external_id
      ? await fetchYoutubeVideoStatus({
        externalId: publication.external_id,
        clientConfig,
        refreshToken,
      })
      : null;
    if (liveStatus?.privacyStatus === 'public') {
      let updatedPublication = await store.updatePublication(publication.id, {
        status: 'published',
        visibility: 'public',
        public_url: publication.public_url || publication.preview_url || liveStatus.publicUrl || '',
        published_at: publication.published_at || liveStatus.publishedAt || new Date().toISOString(),
        metadata: {
          ...(publication.metadata || {}),
          workflow_state: 'published',
          youtube_live_title: liveStatus.title || '',
          youtube_live_published_at: liveStatus.publishedAt || '',
        },
      });
      const autoCommentResult = await syncPublicationYoutubeAutoComment({
        store,
        runtimeConfig,
        publication: updatedPublication || {
          ...publication,
          status: 'published',
          visibility: 'public',
          public_url: publication.public_url || publication.preview_url || liveStatus.publicUrl || '',
          published_at: publication.published_at || liveStatus.publishedAt || new Date().toISOString(),
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'published',
            youtube_live_title: liveStatus.title || '',
            youtube_live_published_at: liveStatus.publishedAt || '',
          },
        },
        videoRow,
        channelProfile,
        channelSelector,
        clientConfig,
        refreshToken,
        asOf,
        liveStatus,
      });
      updatedPublication = autoCommentResult.publication || updatedPublication;
      await updatePublicationReviewMessage({
        runtimeConfig,
        store,
        publication: updatedPublication || {
          ...publication,
          status: 'published',
          visibility: 'public',
          public_url: publication.public_url || publication.preview_url || liveStatus.publicUrl || '',
          published_at: publication.published_at || liveStatus.publishedAt || new Date().toISOString(),
          metadata: {
            ...(publication.metadata || {}),
            workflow_state: 'published',
          },
        },
        videoRow,
        channelProfile,
        channelSelector,
      });
      results.push(mergeAutoCommentResult({
        publication_id: publication.id,
        action: 'reconcile_published',
        external_id: publication.external_id,
        public_url: updatedPublication?.public_url || publication.public_url || publication.preview_url || liveStatus.publicUrl || '',
        published_at: updatedPublication?.published_at || publication.published_at || liveStatus.publishedAt || '',
        workflow_state: updatedPublication?.metadata?.workflow_state || 'published',
      }, autoCommentResult));
      printInfo(`Marked publication ${publication.id} as published from live YouTube status.`);
      continue;
    }

    const scheduled = await scheduleYoutubePublication({
      publication,
      scheduledFor: item.scheduled_for,
      clientConfig,
      refreshToken,
    });
    let updatedPublication = await store.updatePublication(publication.id, {
      status: 'scheduled',
      visibility: 'private',
      scheduled_for: scheduled.scheduledFor,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
      },
    });
    updatedPublication = updatedPublication || {
      ...publication,
      status: 'scheduled',
      visibility: 'private',
      scheduled_for: scheduled.scheduledFor,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
      },
    };
    const autoCommentResult = await syncPublicationYoutubeAutoComment({
      store,
      runtimeConfig,
      publication: updatedPublication,
      videoRow,
      channelProfile,
      channelSelector,
      clientConfig,
      refreshToken,
      asOf,
      liveStatus: {
        privacyStatus: 'private',
        publishAt: scheduled.scheduledFor,
      },
    });
    updatedPublication = autoCommentResult.publication || updatedPublication;
    updatedPublication = await refreshPlannedRelatedVideo({
      store,
      publication: updatedPublication,
      videoRow,
      channelProfile,
      asOf,
    });
    const relatedVideoResult = await applyYoutubeRelatedVideoSelection({
      channelProfile,
      publication: updatedPublication,
      relatedVideo: updatedPublication?.metadata?.related_video || {},
      cwd: projectRoot,
      env: process.env,
      asOf,
    });
    updatedPublication = await store.updatePublication(publication.id, {
      metadata: {
        ...(updatedPublication?.metadata || publication.metadata || {}),
        related_video: buildRelatedVideoRuntimePatch(updatedPublication, relatedVideoResult, asOf),
      },
    }) || {
      ...updatedPublication,
      metadata: {
        ...(updatedPublication?.metadata || publication.metadata || {}),
        related_video: buildRelatedVideoRuntimePatch(updatedPublication, relatedVideoResult, asOf),
      },
    };
    await updatePublicationReviewMessage({
      runtimeConfig,
      store,
      publication: updatedPublication,
      videoRow,
      channelProfile,
      channelSelector,
    });
    results.push({
      publication_id: publication.id,
      action: 'schedule_update',
      external_id: publication.external_id,
      scheduled_for: scheduled.scheduledFor,
      workflow_state: updatedPublication?.metadata?.workflow_state || 'scheduled',
      related_video_selection_status: updatedPublication?.metadata?.related_video?.selection_status || '',
      related_video_target_publication_id: updatedPublication?.metadata?.related_video?.target_publication_id || '',
      related_video_capability_status: updatedPublication?.metadata?.related_video?.capability_status || '',
      related_video_apply_status: updatedPublication?.metadata?.related_video?.apply_status || '',
      ...mergeAutoCommentResult({}, autoCommentResult),
    });
    printInfo(`Scheduled publication ${publication.id} for ${scheduled.scheduledFor}`);
  }

  if (!dryRun) {
    await syncPokeQuizzQueueStatusMessage({
      runtimeConfig,
      store,
      channelProfile,
      channelSelector,
      asOf,
    });
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
