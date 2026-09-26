#!/usr/bin/env node

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
  if (!['queued', 'scheduled', 'publishing'].includes(state)) {
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

    let publishingPublication = await store.updatePublication(publication.id, {
      status: 'publishing',
      metadata: buildMetadataPatch(publication, {
        workflow_state: 'publishing',
        publish_attempted_at: asOf,
        publish_attempt_error: '',
      }),
    }) || publication;

    try {
      const published = await publishTikTokVideoImpl({
        publication: publishingPublication,
        videoRow,
        target,
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
      });
      publishingPublication = await store.updatePublication(publication.id, {
        status: published.status || 'publishing',
        external_id: published.externalId || '',
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
      const isAuthRequired = error instanceof TikTokPublicationAuthRequiredError
        || error?.code === 'tiktok_auth_required';
      const workflowState = isAuthRequired ? 'auth_required' : 'failed';
      const status = isAuthRequired ? 'blocked' : 'failed';
      publishingPublication = await store.updatePublication(publication.id, {
        status,
        metadata: buildMetadataPatch(publishingPublication, {
          workflow_state: workflowState,
          publish_attempt_error: error.message || String(error),
          publish_failed_at: asOf,
        }),
      }) || publishingPublication;
      results.push({
        publication_id: publication.id,
        platform: TIKTOK_VIDEO_PLATFORM,
        account_key: publication.account_key,
        action: 'tiktok_publish_failed',
        workflow_state: workflowState,
        reason: isAuthRequired ? 'auth_required' : 'publish_failed',
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
      '  --as-of <ISO>         Deterministic timestamp. Default: now.',
    ]);
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
