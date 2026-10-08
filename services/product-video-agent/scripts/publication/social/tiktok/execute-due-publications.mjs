#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../../../lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../../../../src/publication-store.mjs';
import {
  BUFFER_DELIVERY_PROVIDER,
  TIKTOK_VIDEO_PLATFORM,
  TIKTOK_DIRECT_DELIVERY_PROVIDER,
  reconcileAdditionalPlatformPublicationLifecycles,
} from '../../../../src/social-publication-targets.mjs';
import {
  BufferPublicationUncertainError,
  BufferPublicationValidationError,
  createSupabaseStagingClient,
  fetchBufferPublicationStatus,
  publishBufferVideo,
} from '../../../../src/buffer-publication-executor.mjs';
import {
  TikTokPublicationAuthRequiredError,
  fetchTikTokPublicationStatus,
  publishTikTokVideo,
} from '../../../../src/tiktok-publication-executor.mjs';
import { TikTokDirectPostValidationError } from '../../../../src/tiktok-publication.mjs';
import {
  deliverSocialPublicationLifecycleAlerts,
  resolveSocialPublicationLifecycleAction,
} from '../../../../src/social-publication-alerts.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../../../../scripts/lib/ruflo-wrapper-utils.mjs';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function isDueAt(value, asOf) {
  const timestamp = normalizeText(value);
  if (!timestamp) {
    return true;
  }
  return new Date(timestamp).getTime() <= new Date(asOf).getTime();
}

function resolveTikTokDueAction(publication = {}, asOf = new Date().toISOString()) {
  if (normalizeText(publication.platform) !== TIKTOK_VIDEO_PLATFORM) {
    return '';
  }
  const state = normalizeWorkflowState(publication);
  const provider = resolveDeliveryProvider(publication);
  const canPoll = normalizeText(publication.external_id)
    || (
      provider === BUFFER_DELIVERY_PROVIDER
      && publication.metadata?.buffer_create_uncertain === true
      && normalizeText(publication.metadata?.buffer_staging_public_url)
    );
  if (state === 'publishing' && canPoll) {
    return isDueAt(publication.metadata?.next_status_poll_at, asOf) ? 'status' : '';
  }
  if (!['queued', 'scheduled'].includes(state)) {
    return '';
  }
  return isDueAt(publication.scheduled_for, asOf) ? 'upload' : '';
}

function withLimit(items, limit) {
  const normalizedLimit = Number(limit);
  if (!Number.isFinite(normalizedLimit) || normalizedLimit <= 0) {
    return items;
  }
  return items.slice(0, Math.floor(normalizedLimit));
}

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config?.env?.SUPABASE_URL || '',
    apiKey: config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '',
  });
}

function resolveStoredTarget(publication = {}) {
  const target = publication.metadata?.publisher_target;
  return target && typeof target === 'object'
    ? {
      platform: TIKTOK_VIDEO_PLATFORM,
      accountKey: normalizeText(target.account_key || publication.account_key),
      deliveryProvider: normalizeText(target.delivery_provider) || TIKTOK_DIRECT_DELIVERY_PROVIDER,
      visibility: normalizeText(target.visibility || publication.visibility || 'private'),
      tiktok: target.tiktok && typeof target.tiktok === 'object' ? target.tiktok : {},
      buffer: target.buffer && typeof target.buffer === 'object' ? target.buffer : {},
      metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {},
    }
    : {
      platform: TIKTOK_VIDEO_PLATFORM,
      accountKey: normalizeText(publication.account_key),
      deliveryProvider: resolveDeliveryProvider(publication),
      visibility: normalizeText(publication.visibility || 'private'),
      tiktok: {},
      buffer: {},
      metadata: {},
    };
}

function buildMetadataPatch(publication, patch = {}) {
  return {
    ...(publication.metadata || {}),
    ...patch,
  };
}

function nextStatusPollAt(asOf) {
  const date = new Date(asOf);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Date(date.getTime() + 15 * 60 * 1000).toISOString();
}

function statusPatchForResult(publication, statusResult, asOf, provider) {
  const status = statusResult.status || 'publishing';
  const workflowState = status === 'published'
    ? 'published'
    : status === 'failed'
      ? 'failed'
      : 'publishing';
  return {
    status,
    ...(statusResult.externalId ? { external_id: statusResult.externalId } : {}),
    ...(workflowState === 'published' ? { published_at: statusResult.publishedAt || asOf } : {}),
    ...(statusResult.publicUrl ? { public_url: statusResult.publicUrl } : {}),
    metadata: buildMetadataPatch(publication, provider === BUFFER_DELIVERY_PROVIDER
      ? {
        workflow_state: workflowState,
        delivery_provider: BUFFER_DELIVERY_PROVIDER,
        buffer_status: statusResult.rawStatus || status,
        buffer_status_checked_at: asOf,
        buffer_fail_reason: statusResult.failReason || '',
        buffer_post_id: statusResult.postId || publication.external_id || '',
        buffer_public_url: statusResult.publicUrl || '',
        buffer_create_uncertain: false,
        buffer_staging_removed_at: statusResult.stagingRemoved ? asOf : '',
        next_status_poll_at: workflowState === 'publishing' ? nextStatusPollAt(asOf) : '',
      }
      : {
        workflow_state: workflowState,
        tiktok_status: statusResult.rawStatus || status,
        tiktok_status_checked_at: asOf,
        tiktok_fail_reason: statusResult.failReason || '',
        tiktok_post_id: statusResult.postId || '',
        tiktok_public_url: statusResult.publicUrl || '',
        next_status_poll_at: workflowState === 'publishing' ? nextStatusPollAt(asOf) : '',
      }),
  };
}

function normalizeBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeText(value).toLowerCase());
}

function resolveDeliveryProvider(publication = {}) {
  const provider = normalizeText(
    publication.metadata?.publisher_target?.delivery_provider
      || publication.metadata?.tiktok_direct_post_approval?.delivery_provider,
  ).toLowerCase();
  return provider === BUFFER_DELIVERY_PROVIDER
    ? BUFFER_DELIVERY_PROVIDER
    : TIKTOK_DIRECT_DELIVERY_PROVIDER;
}

export async function retryTikTokPublication(options = {}, dependencies = {}) {
  const publicationId = getStringOption(options, 'retry-publication-id', '');
  if (!publicationId) {
    throw new Error('TikTok retry requires --retry-publication-id <id>.');
  }
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const publication = await store.fetchPublicationById(publicationId);
  if (!publication || normalizeText(publication.platform) !== TIKTOK_VIDEO_PLATFORM) {
    throw new Error(`TikTok publication ${publicationId} was not found.`);
  }
  const deliveryProvider = resolveDeliveryProvider(publication);
  const externalId = normalizeText(publication.external_id);
  const isKnownBufferFailure = deliveryProvider === BUFFER_DELIVERY_PROVIDER
    && normalizeWorkflowState(publication) === 'failed'
    && normalizeText(publication.metadata?.buffer_status).toLowerCase() === 'error';
  if (externalId && !isKnownBufferFailure) {
    throw new Error(
      `TikTok publication ${publicationId} already has publish id ${publication.external_id}; poll status instead of retrying the upload.`,
    );
  }
  if (publication.metadata?.buffer_create_uncertain === true) {
    throw new Error(
      `TikTok publication ${publicationId} has an uncertain Buffer create attempt; recover or resolve it before retrying.`,
    );
  }
  if (publication.metadata?.tiktok_direct_post_approval?.approved !== true) {
    throw new Error(`TikTok publication ${publicationId} has no reusable shared-review approval.`);
  }

  const updated = await store.updatePublication(publicationId, {
    status: publication.scheduled_for ? 'scheduled' : 'queued',
    ...(isKnownBufferFailure ? { external_id: null } : {}),
    metadata: buildMetadataPatch(publication, {
      workflow_state: publication.scheduled_for ? 'scheduled' : 'queued',
      publish_claim_token: '',
      publish_claimed_at: '',
      publish_attempt_error: '',
      publish_retry_requested_at: asOf,
      next_status_poll_at: '',
      ...(isKnownBufferFailure
        ? {
          buffer_previous_post_ids: [
            ...new Set([
              ...(Array.isArray(publication.metadata?.buffer_previous_post_ids)
                ? publication.metadata.buffer_previous_post_ids
                : []),
              externalId,
            ].filter(Boolean)),
          ],
          buffer_post_id: '',
          buffer_create_uncertain: false,
        }
        : {}),
    }),
  });
  return {
    publication_id: publicationId,
    action: 'tiktok_upload_retry_queued',
    workflow_state: updated?.metadata?.workflow_state || (publication.scheduled_for ? 'scheduled' : 'queued'),
  };
}

export async function resolveTikTokLifecycleAction(options = {}, dependencies = {}) {
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  return resolveSocialPublicationLifecycleAction({
    store,
    publicationId: getStringOption(options, 'resolve-lifecycle-publication-id', ''),
    resolution: getStringOption(options, 'resolution', ''),
    note: getStringOption(options, 'resolution-note', ''),
    resolvedBy: getStringOption(options, 'resolved-by', ''),
    asOf: getStringOption(options, 'as-of', new Date().toISOString()),
  });
}

export async function provisionBufferStaging(options = {}, dependencies = {}) {
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const stagingClient = dependencies.stagingClient
    || createSupabaseStagingClient(runtimeConfig.env || {});
  return stagingClient.provisionBucket();
}

export async function cleanupBufferStaging(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const maxAgeHours = Number(getStringOption(options, 'max-age-hours', '48'));
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 1) {
    throw new Error('Buffer staging cleanup requires --max-age-hours >= 1.');
  }
  const cutoff = new Date(new Date(asOf).getTime() - maxAgeHours * 60 * 60 * 1000);
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error('Buffer staging cleanup requires a valid --as-of timestamp.');
  }
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const stagingClient = dependencies.stagingClient
    || createSupabaseStagingClient(runtimeConfig.env || {});
  const publications = await store.fetchPublicationsByPlatform({
    platform: TIKTOK_VIDEO_PLATFORM,
    order: 'created_at.asc',
  });
  const protectedPaths = publications
    .filter((publication) => !normalizeText(publication.metadata?.buffer_staging_removed_at))
    .map((publication) => normalizeText(publication.metadata?.buffer_staging_object_path))
    .filter(Boolean);
  return stagingClient.cleanupStaleObjects({
    prefix: 'buffer',
    olderThan: cutoff.toISOString(),
    protectedPaths,
  });
}

export async function executeDueSocialPublications(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const accountKey = getStringOption(options, 'account-key', '');
  const publicationId = getStringOption(options, 'publication-id', '');
  const limit = getStringOption(options, 'limit', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  if (getBooleanOption(options, 'allow-buffer-live', false) && !publicationId) {
    throw new Error('--allow-buffer-live requires --publication-id <id>.');
  }
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const publishTikTokVideoImpl = dependencies.publishTikTokVideo || publishTikTokVideo;
  const fetchTikTokPublicationStatusImpl =
    dependencies.fetchTikTokPublicationStatus || fetchTikTokPublicationStatus;
  const publishBufferVideoImpl = dependencies.publishBufferVideo || publishBufferVideo;
  const fetchBufferPublicationStatusImpl =
    dependencies.fetchBufferPublicationStatus || fetchBufferPublicationStatus;
  const deliverLifecycleAlertsImpl = dependencies.deliverSocialPublicationLifecycleAlerts
    || deliverSocialPublicationLifecycleAlerts;
  const fetchedPublications = accountKey
    ? await store.fetchPublicationsByChannel({
      platform: TIKTOK_VIDEO_PLATFORM,
      accountKey,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    })
    : await store.fetchPublicationsByPlatform({
      platform: TIKTOK_VIDEO_PLATFORM,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    });
  const storedPublications = publicationId
    ? fetchedPublications.filter((publication) => publication.id === publicationId)
    : fetchedPublications;
  const lifecycleReconciliation = await reconcileAdditionalPlatformPublicationLifecycles({
    store,
    publications: storedPublications,
    asOf,
    dryRun,
  });
  const lifecycleAlerts = await deliverLifecycleAlertsImpl({
    store,
    publications: lifecycleReconciliation.publications,
    runtimeConfig,
    asOf,
    dryRun,
    ...(dependencies.sendDiscordMessage
      ? { sendDiscordMessage: dependencies.sendDiscordMessage }
      : {}),
  });
  const publications = lifecycleAlerts.publications;
  const duePublications = withLimit(
    publications
      .map((publication) => ({
        publication,
        dueAction: resolveTikTokDueAction(publication, asOf),
      }))
      .filter((item) => item.dueAction),
    limit,
  );
  const results = [...lifecycleReconciliation.results, ...lifecycleAlerts.results];

  for (const { publication, dueAction } of duePublications) {
    const videoRow = publication.video_id
      ? await store.fetchVideoById(publication.video_id)
      : null;
    const target = resolveStoredTarget(publication);
    const deliveryProvider = resolveDeliveryProvider(publication);
    if (dryRun) {
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: dueAction === 'status' ? 'tiktok_status_due' : 'tiktok_publish_due',
        workflow_state: normalizeWorkflowState(publication),
        scheduled_for: publication.scheduled_for || '',
        external_id: publication.external_id || '',
      });
      continue;
    }

    const bufferLiveOverride = publicationId === publication.id
      && getBooleanOption(options, 'allow-buffer-live', false);
    const bufferDeliveryEnabled = normalizeBoolean(
      runtimeConfig.env?.BUFFER_TIKTOK_DELIVERY_ENABLED,
    ) || bufferLiveOverride;
    if (
      dueAction === 'upload'
      && deliveryProvider === BUFFER_DELIVERY_PROVIDER
      && !bufferDeliveryEnabled
    ) {
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: 'buffer_publish_blocked',
        workflow_state: normalizeWorkflowState(publication),
        reason: 'buffer_live_delivery_disabled',
      });
      continue;
    }

    if (dueAction === 'status') {
      try {
        const statusResult = deliveryProvider === BUFFER_DELIVERY_PROVIDER
          ? await fetchBufferPublicationStatusImpl({
            postId: publication.external_id,
            publication,
            target,
            runtimeEnv: runtimeConfig.env || {},
            asOf,
          })
          : await fetchTikTokPublicationStatusImpl({
            publishId: publication.external_id,
            target,
            runtimeEnv: runtimeConfig.env || {},
          });
        const updatedPublication = await store.updatePublication(
          publication.id,
          statusPatchForResult(publication, statusResult, asOf, deliveryProvider),
        ) || publication;
        results.push({
          publication_id: publication.id,
          platform: TIKTOK_VIDEO_PLATFORM,
          account_key: publication.account_key,
          action: deliveryProvider === BUFFER_DELIVERY_PROVIDER
            ? 'buffer_status_fetch'
            : 'tiktok_status_fetch',
          workflow_state: updatedPublication.metadata?.workflow_state || statusResult.status || 'publishing',
          external_id: publication.external_id || '',
          tiktok_status: statusResult.rawStatus || statusResult.status || '',
          fail_reason: statusResult.failReason || '',
          tiktok_post_id: statusResult.postId || '',
          public_url: statusResult.publicUrl || '',
        });
      } catch (error) {
        const isAuthRequired = error instanceof TikTokPublicationAuthRequiredError
          || error?.code === 'tiktok_auth_required';
        const isBufferUncertain = error instanceof BufferPublicationUncertainError
          || error?.code === 'buffer_create_uncertain';
        const workflowState = isAuthRequired ? 'auth_required' : 'publishing';
        const status = isAuthRequired ? 'blocked' : 'publishing';
        const updatedPublication = await store.updatePublication(publication.id, {
          status,
          metadata: buildMetadataPatch(publication, {
            workflow_state: workflowState,
            tiktok_status_check_error: error.message || String(error),
            ...(deliveryProvider === BUFFER_DELIVERY_PROVIDER
              ? {
                buffer_status_check_error: error.message || String(error),
                buffer_create_uncertain: isBufferUncertain,
              }
              : {}),
            tiktok_status_checked_at: asOf,
            next_status_poll_at: isAuthRequired ? '' : nextStatusPollAt(asOf),
          }),
        }) || publication;
        results.push({
          publication_id: publication.id,
          platform: TIKTOK_VIDEO_PLATFORM,
          account_key: publication.account_key,
          action: deliveryProvider === BUFFER_DELIVERY_PROVIDER
            ? 'buffer_status_failed'
            : 'tiktok_status_failed',
          workflow_state: updatedPublication.metadata?.workflow_state || workflowState,
          reason: isAuthRequired ? 'auth_required' : 'status_fetch_failed',
          error: error.message || String(error),
        });
      }
      continue;
    }

    const claimToken = randomUUID();
    let publishingPublication = await store.claimPublicationForUpload(publication.id, {
      status: 'publishing',
      metadata: buildMetadataPatch(publication, {
        workflow_state: 'publishing',
        publish_claim_token: claimToken,
        publish_claimed_at: asOf,
        publish_attempted_at: asOf,
        publish_attempt_error: '',
      }),
    });
    if (!publishingPublication) {
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: 'tiktok_claim_skipped',
        workflow_state: normalizeWorkflowState(publication),
        reason: 'already_claimed_or_not_uploadable',
      });
      continue;
    }

    try {
      const commonPublishInput = {
        publication: publishingPublication,
        videoRow,
        target,
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
      };
      const published = deliveryProvider === BUFFER_DELIVERY_PROVIDER
        ? await publishBufferVideoImpl({
          ...commonPublishInput,
          onStaged: async (staged) => {
            const persisted = await store.updatePublication(publication.id, {
              status: 'publishing',
              metadata: buildMetadataPatch(publishingPublication, {
                workflow_state: 'publishing',
                delivery_provider: BUFFER_DELIVERY_PROVIDER,
                buffer_staging_object_path: staged.objectPath,
                buffer_staging_public_url: staged.publicUrl,
                buffer_staged_at: staged.stagedAt || asOf,
                buffer_staged_video_sha256: staged.videoSha256 || '',
                buffer_create_attempted_at: asOf,
                buffer_create_uncertain: false,
              }),
            });
            if (!persisted?.metadata?.buffer_staging_public_url) {
              throw new Error('Buffer upload blocked because staging metadata could not be persisted.');
            }
            publishingPublication = persisted;
          },
          onInitialized: async (initialized) => {
            const persisted = await store.updatePublication(publication.id, {
              status: 'publishing',
              external_id: initialized.externalId,
              metadata: buildMetadataPatch(publishingPublication, {
                workflow_state: 'publishing',
                delivery_provider: BUFFER_DELIVERY_PROVIDER,
                buffer_post_id: initialized.postId,
                buffer_status: initialized.rawStatus || 'publishing',
                buffer_initialized_at: initialized.initializedAt || asOf,
                buffer_recovered_after_create: initialized.recovered === true,
                buffer_create_uncertain: false,
                next_status_poll_at: nextStatusPollAt(asOf),
              }),
            });
            if (!persisted?.external_id) {
              throw new Error(
                `Buffer delivery blocked because post id ${initialized.postId} could not be persisted.`,
              );
            }
            publishingPublication = persisted;
          },
        })
        : await publishTikTokVideoImpl({
          ...commonPublishInput,
          onInitialized: async (initialized) => {
          const persisted = await store.updatePublication(publication.id, {
            status: 'publishing',
            external_id: initialized.externalId,
            metadata: buildMetadataPatch(publishingPublication, {
              workflow_state: 'publishing',
              tiktok_publish_id: initialized.publishId,
              tiktok_initialized_at: initialized.initializedAt || asOf,
              tiktok_token_env: initialized.tokenEnv || '',
              next_status_poll_at: nextStatusPollAt(asOf),
            }),
          });
          if (!persisted?.external_id) {
            throw new Error(
              `TikTok upload blocked because publish id ${initialized.publishId} could not be persisted.`,
            );
          }
          publishingPublication = persisted;
          },
        });
      publishingPublication = await store.updatePublication(publication.id, {
        status: published.status || 'publishing',
        external_id: publishingPublication.external_id || published.externalId || '',
        uploaded_at: published.uploadedAt || asOf,
        ...(published.workflowState === 'published'
          ? { published_at: published.publishedAt || asOf }
          : {}),
        ...(published.publicUrl ? { public_url: published.publicUrl } : {}),
        metadata: buildMetadataPatch(publishingPublication,
          deliveryProvider === BUFFER_DELIVERY_PROVIDER
            ? {
              workflow_state: published.workflowState || 'publishing',
              delivery_provider: BUFFER_DELIVERY_PROVIDER,
              buffer_post_id: published.postId || published.externalId || '',
              buffer_status: published.rawStatus || published.status || 'publishing',
              buffer_uploaded_at: published.uploadedAt || asOf,
              buffer_create_uncertain: false,
              buffer_staging_removed_at: published.stagingRemoved ? asOf : '',
              next_status_poll_at: published.workflowState === 'published'
                ? ''
                : nextStatusPollAt(asOf),
            }
            : {
              workflow_state: published.workflowState || 'publishing',
              tiktok_publish_id: published.publishId || '',
              tiktok_status: published.status || 'publishing',
              tiktok_uploaded_at: published.uploadedAt || asOf,
              tiktok_token_env: published.tokenEnv || '',
              next_status_poll_at: nextStatusPollAt(asOf),
            }),
      }) || publishingPublication;
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: deliveryProvider === BUFFER_DELIVERY_PROVIDER
          ? 'buffer_publish_upload'
          : 'tiktok_publish_upload',
        workflow_state: publishingPublication.metadata?.workflow_state || 'publishing',
        external_id: publishingPublication.external_id || '',
      });
    } catch (error) {
      const initializedPublishId = normalizeText(publishingPublication.external_id);
      const isAuthRequired = error instanceof TikTokPublicationAuthRequiredError
        || error?.code === 'tiktok_auth_required';
      const isBufferUncertain = error instanceof BufferPublicationUncertainError
        || error?.code === 'buffer_create_uncertain';
      const isValidationBlocked = error instanceof TikTokDirectPostValidationError
        || error instanceof BufferPublicationValidationError;
      const deliveryMayExist = initializedPublishId || isBufferUncertain;
      const workflowState = deliveryMayExist
        ? 'publishing'
        : isAuthRequired
          ? 'auth_required'
          : isValidationBlocked
            ? 'approval_required'
            : 'failed';
      const status = deliveryMayExist
        ? 'publishing'
        : isAuthRequired || isValidationBlocked
          ? 'blocked'
          : 'failed';
      publishingPublication = await store.updatePublication(publication.id, {
        status,
        metadata: buildMetadataPatch(publishingPublication, {
          workflow_state: workflowState,
          publish_attempt_error: error.message || String(error),
          publish_failed_at: asOf,
          ...(deliveryProvider === BUFFER_DELIVERY_PROVIDER
            ? {
              delivery_provider: BUFFER_DELIVERY_PROVIDER,
              buffer_create_uncertain: isBufferUncertain,
              buffer_create_uncertain_at: isBufferUncertain ? asOf : '',
            }
            : {}),
          next_status_poll_at: deliveryMayExist ? nextStatusPollAt(asOf) : '',
        }),
      }) || publishingPublication;
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: isBufferUncertain
          ? 'buffer_create_uncertain'
          : initializedPublishId
            ? deliveryProvider === BUFFER_DELIVERY_PROVIDER
              ? 'buffer_upload_interrupted'
              : 'tiktok_upload_interrupted'
            : deliveryProvider === BUFFER_DELIVERY_PROVIDER
              ? 'buffer_publish_failed'
              : 'tiktok_publish_failed',
        workflow_state: workflowState,
        reason: isBufferUncertain
          ? 'buffer_create_uncertain'
          : initializedPublishId
          ? 'upload_interrupted_after_init'
          : isAuthRequired
            ? 'auth_required'
            : isValidationBlocked
              ? error.code || 'tiktok_direct_post_validation_failed'
              : 'publish_failed',
        error: error.message || String(error),
      });
    }
  }

  return results;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/publication/social/tiktok/execute-due-publications.mjs [options]',
      '',
      'Options:',
      '  --account-key <key>   Limit TikTok execution to one account key.',
      '  --publication-id <id> Limit execution to one publication id.',
      '  --limit <n>           Maximum due publications to process.',
      '  --dry-run             Print due TikTok publications without uploading.',
      '  --allow-buffer-live    Permit one targeted Buffer upload; requires --publication-id.',
      '  --provision-buffer-staging  Create or validate the isolated Supabase staging bucket.',
      '  --cleanup-buffer-staging    Remove only stale, unreferenced Buffer staging objects.',
      '  --max-age-hours <n>     Staging cleanup age threshold. Default: 48.',
      '  --retry-publication-id <id>  Requeue one approved row only when no TikTok publish id exists.',
      '  --resolve-lifecycle-publication-id <id>  Record a completed manual TikTok lifecycle action.',
      '  --resolution <value>  One of: removed, made_private, kept, not_found.',
      '  --resolution-note <text>  Optional operator note for the manual outcome.',
      '  --resolved-by <name>  Optional operator identity for the audit trail.',
      '  --as-of <ISO>         Deterministic timestamp. Default: now.',
    ]);
    return;
  }

  if (getStringOption(options, 'retry-publication-id', '')) {
    const result = await retryTikTokPublication(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (getStringOption(options, 'resolve-lifecycle-publication-id', '')) {
    const result = await resolveTikTokLifecycleAction(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (getBooleanOption(options, 'provision-buffer-staging', false)) {
    const result = await provisionBufferStaging(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (getBooleanOption(options, 'cleanup-buffer-staging', false)) {
    const result = await cleanupBufferStaging(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  const results = await executeDueSocialPublications(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
