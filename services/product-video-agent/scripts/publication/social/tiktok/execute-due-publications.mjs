#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../../../lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../../../../src/publication-store.mjs';
import {
  TIKTOK_VIDEO_PLATFORM,
} from '../../../../src/social-publication-targets.mjs';
import {
  TikTokPublicationAuthRequiredError,
  fetchTikTokPublicationStatus,
  publishTikTokVideo,
} from '../../../../src/tiktok-publication-executor.mjs';
import { TikTokDirectPostValidationError } from '../../../../src/tiktok-publication.mjs';
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
  if (state === 'publishing' && normalizeText(publication.external_id)) {
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
      visibility: normalizeText(target.visibility || publication.visibility || 'private'),
      tiktok: target.tiktok && typeof target.tiktok === 'object' ? target.tiktok : {},
      metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {},
    }
    : {
      platform: TIKTOK_VIDEO_PLATFORM,
      accountKey: normalizeText(publication.account_key),
      visibility: normalizeText(publication.visibility || 'private'),
      tiktok: {},
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

function statusPatchForResult(publication, statusResult, asOf) {
  const status = statusResult.status || 'publishing';
  const workflowState = status === 'published'
    ? 'published'
    : status === 'failed'
      ? 'failed'
      : 'publishing';
  return {
    status,
    ...(workflowState === 'published' ? { published_at: asOf } : {}),
    metadata: buildMetadataPatch(publication, {
      workflow_state: workflowState,
      tiktok_status: statusResult.rawStatus || status,
      tiktok_status_checked_at: asOf,
      next_status_poll_at: workflowState === 'publishing' ? nextStatusPollAt(asOf) : '',
    }),
  };
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
  if (normalizeText(publication.external_id)) {
    throw new Error(
      `TikTok publication ${publicationId} already has publish id ${publication.external_id}; poll status instead of retrying the upload.`,
    );
  }
  if (publication.metadata?.tiktok_direct_post_approval?.approved !== true) {
    throw new Error(`TikTok publication ${publicationId} has no reusable shared-review approval.`);
  }

  const updated = await store.updatePublication(publicationId, {
    status: publication.scheduled_for ? 'scheduled' : 'queued',
    metadata: buildMetadataPatch(publication, {
      workflow_state: publication.scheduled_for ? 'scheduled' : 'queued',
      publish_claim_token: '',
      publish_claimed_at: '',
      publish_attempt_error: '',
      publish_retry_requested_at: asOf,
      next_status_poll_at: '',
    }),
  });
  return {
    publication_id: publicationId,
    action: 'tiktok_upload_retry_queued',
    workflow_state: updated?.metadata?.workflow_state || (publication.scheduled_for ? 'scheduled' : 'queued'),
  };
}

export async function executeDueSocialPublications(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const accountKey = getStringOption(options, 'account-key', '');
  const limit = getStringOption(options, 'limit', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const publishTikTokVideoImpl = dependencies.publishTikTokVideo || publishTikTokVideo;
  const fetchTikTokPublicationStatusImpl =
    dependencies.fetchTikTokPublicationStatus || fetchTikTokPublicationStatus;
  const publications = accountKey
    ? await store.fetchPublicationsByChannel({
      platform: TIKTOK_VIDEO_PLATFORM,
      accountKey,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    })
    : await store.fetchPublicationsByPlatform({
      platform: TIKTOK_VIDEO_PLATFORM,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    });
  const duePublications = withLimit(
    publications
      .map((publication) => ({
        publication,
        dueAction: resolveTikTokDueAction(publication, asOf),
      }))
      .filter((item) => item.dueAction),
    limit,
  );
  const results = [];

  for (const { publication, dueAction } of duePublications) {
    const videoRow = publication.video_id
      ? await store.fetchVideoById(publication.video_id)
      : null;
    const target = resolveStoredTarget(publication);
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

    if (dueAction === 'status') {
      try {
        const statusResult = await fetchTikTokPublicationStatusImpl({
          publishId: publication.external_id,
          target,
          runtimeEnv: runtimeConfig.env || {},
        });
        const updatedPublication = await store.updatePublication(
          publication.id,
          statusPatchForResult(publication, statusResult, asOf),
        ) || publication;
        results.push({
          publication_id: publication.id,
          platform: TIKTOK_VIDEO_PLATFORM,
          account_key: publication.account_key,
          action: 'tiktok_status_fetch',
          workflow_state: updatedPublication.metadata?.workflow_state || statusResult.status || 'publishing',
          external_id: publication.external_id || '',
          tiktok_status: statusResult.rawStatus || statusResult.status || '',
        });
      } catch (error) {
        const isAuthRequired = error instanceof TikTokPublicationAuthRequiredError
          || error?.code === 'tiktok_auth_required';
        const workflowState = isAuthRequired ? 'auth_required' : 'publishing';
        const status = isAuthRequired ? 'blocked' : 'publishing';
        const updatedPublication = await store.updatePublication(publication.id, {
          status,
          metadata: buildMetadataPatch(publication, {
            workflow_state: workflowState,
            tiktok_status_check_error: error.message || String(error),
            tiktok_status_checked_at: asOf,
            next_status_poll_at: isAuthRequired ? '' : nextStatusPollAt(asOf),
          }),
        }) || publication;
        results.push({
          publication_id: publication.id,
          platform: TIKTOK_VIDEO_PLATFORM,
          account_key: publication.account_key,
          action: 'tiktok_status_failed',
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
      const published = await publishTikTokVideoImpl({
        publication: publishingPublication,
        videoRow,
        target,
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
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
        metadata: buildMetadataPatch(publishingPublication, {
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
        action: 'tiktok_publish_upload',
        workflow_state: publishingPublication.metadata?.workflow_state || 'publishing',
        external_id: publishingPublication.external_id || '',
      });
    } catch (error) {
      const initializedPublishId = normalizeText(publishingPublication.external_id);
      const isAuthRequired = error instanceof TikTokPublicationAuthRequiredError
        || error?.code === 'tiktok_auth_required';
      const isValidationBlocked = error instanceof TikTokDirectPostValidationError;
      const workflowState = initializedPublishId
        ? 'publishing'
        : isAuthRequired
          ? 'auth_required'
          : isValidationBlocked
            ? 'approval_required'
            : 'failed';
      const status = initializedPublishId
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
          next_status_poll_at: initializedPublishId ? nextStatusPollAt(asOf) : '',
        }),
      }) || publishingPublication;
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: initializedPublishId ? 'tiktok_upload_interrupted' : 'tiktok_publish_failed',
        workflow_state: workflowState,
        reason: initializedPublishId
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
      '  --limit <n>           Maximum due publications to process.',
      '  --dry-run             Print due TikTok publications without uploading.',
      '  --retry-publication-id <id>  Requeue one approved row only when no TikTok publish id exists.',
      '  --as-of <ISO>         Deterministic timestamp. Default: now.',
    ]);
    return;
  }

  if (getStringOption(options, 'retry-publication-id', '')) {
    const result = await retryTikTokPublication(options);
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
