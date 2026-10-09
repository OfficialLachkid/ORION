#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../../../lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../../../../src/publication-store.mjs';
import {
  INSTAGRAM_REEL_PLATFORM,
  listConfiguredPlatformPublicationTargets,
  reconcileAdditionalPlatformPublicationLifecycles,
} from '../../../../src/social-publication-targets.mjs';
import {
  InstagramGraphApiError,
  InstagramPublicationUncertainError,
  createInstagramGraphClient,
  createInstagramStagingClient,
  publishInstagramReel,
} from '../../../../src/instagram-publication-executor.mjs';
import { InstagramPublicationValidationError } from '../../../../src/instagram-publication.mjs';
import {
  deliverSocialPublicationLifecycleAlerts,
} from '../../../../src/social-publication-alerts.mjs';
import { loadPublicationChannelProfiles } from '../../../../src/publication-channels.mjs';
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

function normalizeBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeText(value).toLowerCase());
}

function normalizeWorkflowState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function isDueAt(value, asOf) {
  const timestamp = normalizeText(value);
  return !timestamp || new Date(timestamp).getTime() <= new Date(asOf).getTime();
}

function withLimit(items, limit) {
  const count = Number(limit);
  return Number.isFinite(count) && count > 0 ? items.slice(0, Math.floor(count)) : items;
}

function nextStatusPollAt(asOf) {
  const date = new Date(asOf);
  return Number.isNaN(date.getTime())
    ? ''
    : new Date(date.getTime() + 15 * 60 * 1000).toISOString();
}

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config?.env?.SUPABASE_URL || '',
    apiKey: config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '',
  });
}

function buildMetadataPatch(publication, patch = {}) {
  return { ...(publication.metadata || {}), ...patch };
}

function resolveStoredTarget(publication = {}) {
  const target = publication.metadata?.publisher_target || {};
  return {
    platform: INSTAGRAM_REEL_PLATFORM,
    accountKey: normalizeText(target.account_key || publication.account_key),
    deliveryProvider: normalizeText(target.delivery_provider || 'instagram_graph'),
    visibility: normalizeText(target.visibility || publication.visibility || 'public'),
    instagram: target.instagram && typeof target.instagram === 'object' ? target.instagram : {},
    metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {},
  };
}

export function resolveInstagramDueAction(publication = {}, asOf = new Date().toISOString()) {
  if (normalizeText(publication.platform) !== INSTAGRAM_REEL_PLATFORM) return '';
  const state = normalizeWorkflowState(publication);
  if (state === 'publishing' && normalizeText(publication.external_id)) {
    return isDueAt(publication.metadata?.next_status_poll_at, asOf) ? 'status' : '';
  }
  if (!['queued', 'scheduled'].includes(state)) return '';
  return isDueAt(publication.scheduled_for, asOf) ? 'upload' : '';
}

export async function diagnoseInstagramAccount(options = {}, dependencies = {}) {
  const accountKey = getStringOption(options, 'diagnose-account', '');
  if (!accountKey) {
    throw new Error('Instagram diagnosis requires --diagnose-account <account-key>.');
  }
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const profiles = await (dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles)(
    channelsPath,
    { projectRoot },
  );
  const targets = profiles.flatMap((profile) => listConfiguredPlatformPublicationTargets(profile));
  const target = targets.find((item) => (
    item.platform === INSTAGRAM_REEL_PLATFORM && item.accountKey === accountKey
  ));
  if (!target) {
    throw new Error(`Instagram target ${accountKey} was not found in ${channelsPath}.`);
  }
  const client = dependencies.graphClient
    || createInstagramGraphClient(runtimeConfig.env || {}, target);
  const profile = await client.fetchAuthenticatedProfile();
  const expectedId = normalizeText(target.instagram?.user_id || target.instagram?.userId);
  const expectedUsername = normalizeText(
    target.instagram?.expected_username || target.instagram?.expectedUsername,
  ).replace(/^@/u, '').toLowerCase();
  if (!profile.id || profile.id !== expectedId || profile.username !== expectedUsername) {
    throw new InstagramPublicationValidationError(
      `Instagram identity mismatch: expected @${expectedUsername} (${expectedId}), received @${profile.username || 'unknown'} (${profile.id || 'unknown'}).`,
      { code: 'instagram_identity_mismatch' },
    );
  }
  return {
    account_key: accountKey,
    instagram_user_id: profile.id,
    username: profile.username,
    account_type: profile.accountType,
    identity_verified: true,
    delivery_enabled: normalizeBoolean(runtimeConfig.env?.INSTAGRAM_DELIVERY_ENABLED),
  };
}

export async function cleanupInstagramStaging(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const maxAgeHours = Number(getStringOption(options, 'max-age-hours', '48'));
  if (!Number.isFinite(maxAgeHours) || maxAgeHours < 1) {
    throw new Error('Instagram staging cleanup requires --max-age-hours >= 1.');
  }
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const stagingClient = dependencies.stagingClient
    || createInstagramStagingClient(runtimeConfig.env || {});
  const publications = await store.fetchPublicationsByPlatform({
    platform: INSTAGRAM_REEL_PLATFORM,
    order: 'created_at.asc',
  });
  const protectedPaths = publications
    .filter((publication) => !normalizeText(publication.metadata?.instagram_staging_removed_at))
    .map((publication) => normalizeText(publication.metadata?.instagram_staging_object_path))
    .filter(Boolean);
  const cutoff = new Date(new Date(asOf).getTime() - maxAgeHours * 60 * 60 * 1000);
  return stagingClient.cleanupStaleObjects({
    prefix: 'instagram',
    olderThan: cutoff.toISOString(),
    protectedPaths,
  });
}

export async function executeDueInstagramPublications(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const accountKey = getStringOption(options, 'account-key', '');
  const publicationId = getStringOption(options, 'publication-id', '');
  const limit = getStringOption(options, 'limit', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const liveOverride = getBooleanOption(options, 'allow-instagram-live', false);
  if (liveOverride && !publicationId) {
    throw new Error('--allow-instagram-live requires --publication-id <id>.');
  }
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(runtimeConfig);
  const publishImpl = dependencies.publishInstagramReel || publishInstagramReel;
  const deliverAlerts = dependencies.deliverSocialPublicationLifecycleAlerts
    || deliverSocialPublicationLifecycleAlerts;
  const fetched = accountKey
    ? await store.fetchPublicationsByChannel({
      platform: INSTAGRAM_REEL_PLATFORM,
      accountKey,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    })
    : await store.fetchPublicationsByPlatform({
      platform: INSTAGRAM_REEL_PLATFORM,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    });
  const selected = publicationId
    ? fetched.filter((publication) => publication.id === publicationId)
    : fetched;
  const lifecycle = await reconcileAdditionalPlatformPublicationLifecycles({
    store,
    publications: selected,
    asOf,
    dryRun,
  });
  const alerts = await deliverAlerts({
    store,
    publications: lifecycle.publications,
    runtimeConfig,
    asOf,
    dryRun,
    ...(dependencies.sendDiscordMessage
      ? { sendDiscordMessage: dependencies.sendDiscordMessage }
      : {}),
  });
  const due = withLimit(
    alerts.publications
      .map((publication) => ({
        publication,
        dueAction: resolveInstagramDueAction(publication, asOf),
      }))
      .filter((item) => item.dueAction),
    limit,
  );
  const results = [...lifecycle.results, ...alerts.results];

  for (const { publication, dueAction } of due) {
    if (dryRun) {
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_REEL_PLATFORM,
        account_key: publication.account_key,
        action: dueAction === 'status' ? 'instagram_status_due' : 'instagram_publish_due',
        workflow_state: normalizeWorkflowState(publication),
        scheduled_for: publication.scheduled_for || '',
        external_id: publication.external_id || '',
      });
      continue;
    }
    const deliveryEnabled = normalizeBoolean(runtimeConfig.env?.INSTAGRAM_DELIVERY_ENABLED)
      || (liveOverride && publication.id === publicationId);
    if (dueAction === 'upload' && !deliveryEnabled) {
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_REEL_PLATFORM,
        account_key: publication.account_key,
        action: 'instagram_publish_blocked',
        workflow_state: normalizeWorkflowState(publication),
        reason: 'instagram_live_delivery_disabled',
      });
      continue;
    }

    let activePublication = publication;
    if (dueAction === 'upload') {
      activePublication = await store.claimPublicationForUpload(publication.id, {
        status: 'publishing',
        metadata: buildMetadataPatch(publication, {
          workflow_state: 'publishing',
          publish_claim_token: randomUUID(),
          publish_claimed_at: asOf,
          publish_attempted_at: asOf,
          publish_attempt_error: '',
        }),
      });
      if (!activePublication) {
        results.push({
          publication_id: publication.id,
          platform: INSTAGRAM_REEL_PLATFORM,
          account_key: publication.account_key,
          action: 'instagram_claim_skipped',
          workflow_state: normalizeWorkflowState(publication),
          reason: 'already_claimed_or_not_uploadable',
        });
        continue;
      }
    }

    try {
      const videoRow = activePublication.video_id
        ? await store.fetchVideoById(activePublication.video_id)
        : null;
      const target = resolveStoredTarget(activePublication);
      const delivered = await publishImpl({
        publication: activePublication,
        videoRow,
        target,
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
        onStaged: async (staged) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            metadata: buildMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              instagram_staging_object_path: staged.objectPath,
              instagram_staging_public_url: staged.publicUrl,
              instagram_staged_at: staged.stagedAt || asOf,
              instagram_staged_video_sha256: staged.videoSha256 || '',
            }),
          }) || activePublication;
        },
        onInitialized: async (initialized) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            external_id: initialized.containerId,
            metadata: buildMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              instagram_container_id: initialized.containerId,
              instagram_initialized_at: initialized.initializedAt || asOf,
              next_status_poll_at: nextStatusPollAt(asOf),
            }),
          }) || activePublication;
          if (!normalizeText(activePublication.external_id)) {
            throw new Error(`Instagram container ${initialized.containerId} was not persisted.`);
          }
        },
        onPublished: async (published) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            metadata: buildMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              instagram_media_id: published.mediaId,
              instagram_media_id_persisted_at: published.publishedAt || asOf,
            }),
          }) || activePublication;
          if (!normalizeText(activePublication.metadata?.instagram_media_id)) {
            throw new Error(`Instagram media ${published.mediaId} was not persisted.`);
          }
        },
      });
      const published = delivered.workflowState === 'published';
      activePublication = await store.updatePublication(publication.id, {
        status: published ? 'published' : 'publishing',
        external_id: delivered.externalId || activePublication.external_id || '',
        uploaded_at: activePublication.uploaded_at || delivered.uploadedAt || asOf,
        ...(published ? { published_at: delivered.publishedAt || asOf } : {}),
        ...(delivered.publicUrl ? { public_url: delivered.publicUrl } : {}),
        metadata: buildMetadataPatch(activePublication, {
          workflow_state: published ? 'published' : 'publishing',
          instagram_container_id: delivered.containerId
            || activePublication.metadata?.instagram_container_id
            || '',
          instagram_media_id: delivered.mediaId
            || activePublication.metadata?.instagram_media_id
            || '',
          instagram_status: delivered.status || '',
          instagram_status_checked_at: asOf,
          instagram_staging_removed_at: delivered.stagingRemoved ? asOf : '',
          instagram_publish_uncertain: false,
          next_status_poll_at: published ? '' : nextStatusPollAt(asOf),
        }),
      }) || activePublication;
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_REEL_PLATFORM,
        account_key: publication.account_key,
        action: published ? 'instagram_published' : 'instagram_processing',
        workflow_state: normalizeWorkflowState(activePublication),
        external_id: activePublication.external_id || '',
        public_url: activePublication.public_url || '',
      });
    } catch (error) {
      const uncertain = error instanceof InstagramPublicationUncertainError;
      const validation = error instanceof InstagramPublicationValidationError;
      const hasContainer = Boolean(normalizeText(activePublication.external_id));
      const authRequired = validation && error.code === 'instagram_auth_required';
      const workflowState = uncertain
        ? 'reconciliation_required'
        : authRequired
          ? 'auth_required'
          : validation
            ? 'approval_required'
            : hasContainer
              ? 'publishing'
              : 'failed';
      const status = ['auth_required', 'approval_required', 'reconciliation_required'].includes(workflowState)
        ? 'blocked'
        : workflowState;
      activePublication = await store.updatePublication(publication.id, {
        status,
        metadata: buildMetadataPatch(activePublication, {
          workflow_state: workflowState,
          publish_attempt_error: error.message || String(error),
          instagram_publish_uncertain: uncertain,
          instagram_publish_uncertain_at: uncertain ? asOf : '',
          instagram_graph_error: error instanceof InstagramGraphApiError,
          next_status_poll_at: hasContainer && !uncertain ? nextStatusPollAt(asOf) : '',
        }),
      }) || activePublication;
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_REEL_PLATFORM,
        account_key: publication.account_key,
        action: uncertain ? 'instagram_publish_uncertain' : 'instagram_publish_failed',
        workflow_state: workflowState,
        reason: error.code || 'instagram_publish_failed',
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
      'Usage: node services/product-video-agent/scripts/publication/social/instagram/execute-due-publications.mjs [options]',
      '',
      'Options:',
      '  --diagnose-account <key>  Verify the configured token identity without publishing.',
      '  --channels <path>          Channel registry used by account diagnosis.',
      '  --account-key <key>        Limit execution to one Instagram account key.',
      '  --publication-id <id>      Limit execution to one publication id.',
      '  --limit <n>                Maximum due publications to process.',
      '  --dry-run                  Report due rows without publishing.',
      '  --allow-instagram-live      Permit one targeted live publication; requires --publication-id.',
      '  --cleanup-instagram-staging Remove stale, unreferenced Instagram staging objects.',
      '  --max-age-hours <n>         Cleanup threshold. Default: 48.',
      '  --as-of <ISO>               Deterministic timestamp. Default: now.',
    ]);
    return;
  }
  if (getStringOption(options, 'diagnose-account', '')) {
    const result = await diagnoseInstagramAccount(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  if (getBooleanOption(options, 'cleanup-instagram-staging', false)) {
    const result = await cleanupInstagramStaging(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const results = await executeDueInstagramPublications(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
