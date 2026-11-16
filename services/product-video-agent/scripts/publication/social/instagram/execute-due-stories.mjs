#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../../../lib/runtime-config.mjs';
import {
  InstagramGraphApiError,
  InstagramPublicationUncertainError,
} from '../../../../src/instagram-publication-executor.mjs';
import { InstagramPublicationValidationError } from '../../../../src/instagram-publication.mjs';
import { publishInstagramStory } from '../../../../src/instagram-story-executor.mjs';
import { INSTAGRAM_STORY_PLATFORM } from '../../../../src/instagram-story-publication.mjs';
import {
  persistAndDeliverPublicationFailureAlert,
} from '../../../../src/social-publication-alerts.mjs';
import {
  SOCIAL_RUNTIME_PUBLICATION_SELECT,
  hydratePublication,
  normalizeRuntimePublication,
} from '../../../../src/publication-runtime-snapshot.mjs';
import {
  buildSocialMetadataPatch as buildMetadataPatch,
  createSocialPublicationStore as createPublicationStore,
  isSocialPublicationPastDeliveryWindow,
  limitSocialItems as withLimit,
  nextSocialStatusPollAt as nextStatusPollAt,
  normalizeSocialBoolean as normalizeBoolean,
  normalizeSocialText as normalizeText,
  normalizeSocialWorkflowState as normalizeWorkflowState,
  resolveSocialPublicationMaxLatenessHours,
} from '../../../../src/social-publication-runtime.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../../../../scripts/lib/ruflo-wrapper-utils.mjs';

const CANCELLED_SOURCE_STATES = new Set(['deleted', 'revision_requested', 'withdrawn']);
const PENDING_STORY_STATES = new Set(['queued', 'scheduled', 'waiting_source_publication']);
const STORY_SOURCE_SELECT = [
  'id', 'video_id', 'platform', 'account_key', 'status', 'external_id', 'published_at',
  'workflow_state:metadata->>workflow_state',
  'instagram_media_id:metadata->>instagram_media_id',
].join(',');

function sourceState(publication = {}) {
  return normalizeText(publication.metadata?.workflow_state || publication.status).toLowerCase();
}

function storyDelaySeconds(publication = {}) {
  const value = Number(publication.metadata?.instagram_story?.delay_seconds || 0);
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), 86_400)) : 0;
}

function scheduledFromSource(publication = {}, sourcePublication = {}) {
  const publishedAt = new Date(sourcePublication.published_at || '');
  if (Number.isNaN(publishedAt.getTime())) return '';
  return new Date(
    publishedAt.getTime() + storyDelaySeconds(publication) * 1000,
  ).toISOString();
}

export function resolveInstagramStoryDueAction(
  publication = {},
  sourcePublication = {},
  asOf = new Date().toISOString(),
  maxLatenessHours,
) {
  if (normalizeText(publication.platform) !== INSTAGRAM_STORY_PLATFORM) return '';
  const state = normalizeWorkflowState(publication);
  if (state === 'publishing' && normalizeText(publication.external_id)) {
    const nextPoll = normalizeText(publication.metadata?.next_status_poll_at);
    return !nextPoll || new Date(nextPoll).getTime() <= new Date(asOf).getTime()
      ? 'status'
      : '';
  }
  if (!PENDING_STORY_STATES.has(state)) return '';
  const upstreamState = sourceState(sourcePublication);
  if (CANCELLED_SOURCE_STATES.has(upstreamState)) return 'withdraw';
  if (upstreamState !== 'published') return '';
  const scheduledFor = normalizeText(publication.scheduled_for)
    || scheduledFromSource(publication, sourcePublication);
  if (!scheduledFor) return '';
  if (isSocialPublicationPastDeliveryWindow(scheduledFor, asOf, maxLatenessHours)) {
    return 'expire';
  }
  return new Date(scheduledFor).getTime() <= new Date(asOf).getTime() ? 'upload' : 'schedule';
}

async function loadStorySources(store, publications) {
  const ids = [...new Set(publications
    .map((publication) => normalizeText(publication.metadata?.source_instagram_publication_id))
    .filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await store.fetchPublicationsByIds(ids, {
    select: STORY_SOURCE_SELECT,
    queryClass: 'instagram_story_source_receipts',
  });
  return new Map(rows.map(normalizeRuntimePublication).map((row) => [row.id, row]));
}

function resolveStoredTarget(publication = {}) {
  const target = publication.metadata?.publisher_target || {};
  return {
    platform: 'instagram_reels',
    accountKey: normalizeText(target.account_key || publication.account_key),
    deliveryProvider: normalizeText(target.delivery_provider || 'instagram_graph'),
    instagram: target.instagram && typeof target.instagram === 'object' ? target.instagram : {},
    metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {},
  };
}

export async function executeDueInstagramStories(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const accountKey = getStringOption(options, 'account-key', '');
  const publicationId = getStringOption(options, 'publication-id', '');
  const limit = getStringOption(options, 'limit', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const liveOverride = getBooleanOption(options, 'allow-instagram-live', false);
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const store = dependencies.publicationStore || createPublicationStore(
    runtimeConfig,
    'instagram-story-publication',
  );
  const publishImpl = dependencies.publishInstagramStory || publishInstagramStory;
  const maxLatenessHours = resolveSocialPublicationMaxLatenessHours(runtimeConfig.env);
  const fetched = accountKey
    ? await store.fetchPublicationsByChannel({
      platform: INSTAGRAM_STORY_PLATFORM,
      accountKey,
      order: 'created_at.asc',
      status: 'not.in.(published,withdrawn,deleted,failed,blocked)',
      select: SOCIAL_RUNTIME_PUBLICATION_SELECT,
      queryClass: 'instagram_story_active_rows',
    })
    : await store.fetchPublicationsByPlatform({
      platform: INSTAGRAM_STORY_PLATFORM,
      order: 'created_at.asc',
      status: 'not.in.(published,withdrawn,deleted,failed,blocked)',
      select: SOCIAL_RUNTIME_PUBLICATION_SELECT,
      queryClass: 'instagram_story_active_rows',
    });
  const selected = fetched.map(normalizeRuntimePublication)
    .filter((publication) => !publicationId || publication.id === publicationId);
  const sourceMap = await loadStorySources(store, selected);
  const candidates = withLimit(selected.map((publication) => {
    const sourceId = normalizeText(publication.metadata?.source_instagram_publication_id);
    const sourcePublication = sourceMap.get(sourceId) || null;
    return {
      publication,
      sourcePublication,
      dueAction: resolveInstagramStoryDueAction(
        publication,
        sourcePublication,
        asOf,
        maxLatenessHours,
      ),
    };
  }).filter((candidate) => candidate.dueAction), limit);
  const results = [];

  for (const candidate of candidates) {
    const { dueAction } = candidate;
    let publication = candidate.publication;
    const sourceId = normalizeText(publication.metadata?.source_instagram_publication_id);
    if (dryRun) {
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        account_key: publication.account_key,
        action: `instagram_story_${dueAction}_due`,
        source_publication_id: sourceId,
      });
      continue;
    }
    if (dueAction === 'withdraw' || dueAction === 'expire') {
      const workflowState = dueAction === 'withdraw' ? 'withdrawn' : 'withdrawn';
      await store.updatePublication(publication.id, {
        status: workflowState,
        scheduled_for: null,
        metadata: buildMetadataPatch(publication, {
          workflow_state: workflowState,
          instagram_story_terminal_reason: dueAction === 'withdraw'
            ? 'source_reel_cancelled'
            : 'missed_delivery_window',
          instagram_story_terminal_at: asOf,
        }),
      });
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        action: `instagram_story_${workflowState}`,
        reason: dueAction === 'withdraw' ? 'source_reel_cancelled' : 'missed_delivery_window',
      });
      continue;
    }
    const scheduledFor = normalizeText(publication.scheduled_for)
      || scheduledFromSource(publication, candidate.sourcePublication);
    if (!normalizeText(publication.scheduled_for)) {
      publication = await store.updatePublication(publication.id, {
        status: 'scheduled',
        scheduled_for: scheduledFor,
        metadata: buildMetadataPatch(publication, {
          workflow_state: 'scheduled',
          source_instagram_published_at: candidate.sourcePublication.published_at || '',
          source_instagram_media_id: candidate.sourcePublication.metadata?.instagram_media_id
            || candidate.sourcePublication.external_id
            || '',
          story_scheduled_from_source_at: asOf,
        }),
      }) || publication;
    }
    if (dueAction === 'schedule') {
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        action: 'instagram_story_scheduled',
        scheduled_for: scheduledFor,
      });
      continue;
    }
    const deliveryEnabled = normalizeBoolean(runtimeConfig.env?.INSTAGRAM_DELIVERY_ENABLED)
      || (liveOverride && publication.id === publicationId);
    if (dueAction === 'upload' && !deliveryEnabled) {
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        action: 'instagram_story_publish_blocked',
        reason: 'instagram_live_delivery_disabled',
      });
      continue;
    }

    publication = await hydratePublication(store, publication);
    const sourcePublication = await store.fetchPublicationById(sourceId);
    if (!sourcePublication) continue;
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
      if (!activePublication) continue;
    }

    try {
      const target = resolveStoredTarget(activePublication);
      const delivered = await publishImpl({
        publication: activePublication,
        sourcePublication,
        target,
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
        onRendered: async (asset) => {
          activePublication = await store.updatePublication(publication.id, {
            metadata: buildMetadataPatch(activePublication, {
              story_asset_path: asset.outputPath,
              story_asset_sha256: asset.videoSha256,
              story_asset_source_sha256: asset.sourceVideoSha256,
              story_asset_duration_seconds: asset.durationSeconds,
              story_asset_rendered_at: asset.renderedAt || asOf,
            }),
          }) || activePublication;
        },
        onStaged: async (staged) => {
          activePublication = await store.updatePublication(publication.id, {
            metadata: buildMetadataPatch(activePublication, {
              instagram_story_staging_object_path: staged.objectPath,
              instagram_story_staging_public_url: staged.publicUrl,
              instagram_story_staged_at: staged.stagedAt || asOf,
            }),
          }) || activePublication;
        },
        onInitialized: async (initialized) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            external_id: initialized.containerId,
            metadata: buildMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              instagram_story_container_id: initialized.containerId,
              instagram_story_initialized_at: initialized.initializedAt || asOf,
              next_status_poll_at: nextStatusPollAt(asOf),
            }),
          }) || activePublication;
          if (!normalizeText(activePublication.external_id)) {
            throw new Error(
              `Instagram Story container ${initialized.containerId} was not persisted.`,
            );
          }
        },
        onPublished: async (published) => {
          activePublication = await store.updatePublication(publication.id, {
            metadata: buildMetadataPatch(activePublication, {
              instagram_story_media_id: published.mediaId,
              instagram_story_media_id_persisted_at: published.publishedAt || asOf,
            }),
          }) || activePublication;
          if (!normalizeText(activePublication.metadata?.instagram_story_media_id)) {
            throw new Error(
              `Instagram Story media ${published.mediaId} was not persisted.`,
            );
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
          instagram_story_status: delivered.status || '',
          instagram_story_status_checked_at: asOf,
          instagram_story_staging_removed_at: delivered.stagingRemoved ? asOf : '',
          next_status_poll_at: published ? '' : nextStatusPollAt(asOf),
        }),
      }) || activePublication;
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        account_key: publication.account_key,
        action: published ? 'instagram_story_published' : 'instagram_story_processing',
        external_id: activePublication.external_id || '',
        public_url: activePublication.public_url || '',
      });
    } catch (error) {
      const uncertain = error instanceof InstagramPublicationUncertainError;
      const validation = error instanceof InstagramPublicationValidationError;
      const authRequired = validation && error.code === 'instagram_auth_required';
      const hasContainer = Boolean(normalizeText(activePublication.external_id));
      const workflowState = uncertain
        ? 'reconciliation_required'
        : authRequired
          ? 'auth_required'
          : validation
            ? 'blocked'
            : hasContainer
              ? 'publishing'
              : 'failed';
      const failureAlert = await persistAndDeliverPublicationFailureAlert({
        store,
        publication: activePublication,
        patch: {
          status: ['auth_required', 'blocked', 'reconciliation_required'].includes(workflowState)
            ? 'blocked'
            : workflowState,
          metadata: buildMetadataPatch(activePublication, {
            workflow_state: workflowState,
            publish_attempt_error: error.message || String(error),
            instagram_graph_error: error instanceof InstagramGraphApiError,
            next_status_poll_at: hasContainer && !uncertain ? nextStatusPollAt(asOf) : '',
          }),
        },
        failure: {
          action: uncertain ? 'instagram_story_publish_uncertain' : 'instagram_story_publish_failed',
          workflowState,
          reason: error.code || 'instagram_story_publish_failed',
          error: error.message || String(error),
        },
        runtimeConfig,
        asOf,
        dryRun,
        ...(dependencies.sendDiscordMessage
          ? { sendDiscordMessage: dependencies.sendDiscordMessage }
          : {}),
      });
      activePublication = failureAlert.publication || activePublication;
      results.push({
        publication_id: publication.id,
        platform: INSTAGRAM_STORY_PLATFORM,
        account_key: publication.account_key,
        action: uncertain ? 'instagram_story_publish_uncertain' : 'instagram_story_publish_failed',
        workflow_state: workflowState,
        reason: error.code || 'instagram_story_publish_failed',
        error: error.message || String(error),
      });
      results.push(...failureAlert.results);
    }
  }
  return results;
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/publication/social/instagram/execute-due-stories.mjs [options]',
      '',
      'Publishes account-enabled Instagram Stories after their exact source Reel is verified.',
    ]);
    return;
  }
  const results = await executeDueInstagramStories(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
