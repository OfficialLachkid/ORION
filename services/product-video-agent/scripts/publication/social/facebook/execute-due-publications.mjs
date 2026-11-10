#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRuntimeConfig } from '../../../../../lib/runtime-config.mjs';
import {
  FACEBOOK_REEL_PLATFORM,
  listConfiguredPlatformPublicationTargets,
  reconcileAdditionalPlatformPublicationLifecycles,
} from '../../../../src/social-publication-targets.mjs';
import {
  FacebookGraphApiError,
  FacebookPublicationUncertainError,
  createFacebookGraphClient,
  publishFacebookReel,
} from '../../../../src/facebook-publication-executor.mjs';
import { FacebookPublicationValidationError } from '../../../../src/facebook-publication.mjs';
import {
  deliverPublicationFailureAlerts,
  deliverSocialPublicationLifecycleAlerts,
  persistAndDeliverPublicationFailureAlert,
} from '../../../../src/social-publication-alerts.mjs';
import { loadPublicationChannelProfiles } from '../../../../src/publication-channels.mjs';
import {
  buildSocialMissedWindowPatch,
  buildSocialMetadataPatch,
  createSocialPublicationStore,
  isSocialPublicationDueAt,
  limitSocialItems,
  nextSocialStatusPollAt,
  normalizeSocialBoolean,
  normalizeSocialText,
  normalizeSocialWorkflowState,
  resolveSocialPublicationMaxLatenessHours,
  resolveSocialUploadAction,
} from '../../../../src/social-publication-runtime.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../../../../scripts/lib/ruflo-wrapper-utils.mjs';

function resolveStoredTarget(publication = {}) {
  const target = publication.metadata?.publisher_target || {};
  return {
    platform: FACEBOOK_REEL_PLATFORM,
    accountKey: normalizeSocialText(target.account_key || publication.account_key),
    deliveryProvider: normalizeSocialText(target.delivery_provider || 'facebook_graph'),
    visibility: normalizeSocialText(target.visibility || publication.visibility || 'public'),
    facebook: target.facebook && typeof target.facebook === 'object' ? target.facebook : {},
    metadata: target.metadata && typeof target.metadata === 'object' ? target.metadata : {},
  };
}

function isFacebookAuthFailure(error) {
  return (
    error instanceof FacebookPublicationValidationError
      && error.code === 'facebook_auth_required'
  ) || (
    error instanceof FacebookGraphApiError
      && (error.status === 401 || Number(error.payload?.error?.code) === 190)
  );
}

export function resolveFacebookDueAction(
  publication = {},
  asOf = new Date().toISOString(),
  maxLatenessHours,
) {
  if (normalizeSocialText(publication.platform) !== FACEBOOK_REEL_PLATFORM) return '';
  const state = normalizeSocialWorkflowState(publication);
  if (state === 'publishing' && normalizeSocialText(publication.external_id)) {
    return isSocialPublicationDueAt(publication.metadata?.next_status_poll_at, asOf)
      ? 'continue'
      : '';
  }
  if (!['queued', 'scheduled'].includes(state)) return '';
  return resolveSocialUploadAction(publication, asOf, maxLatenessHours);
}

export async function diagnoseFacebookAccount(options = {}, dependencies = {}) {
  const accountKey = getStringOption(options, 'diagnose-account', '');
  if (!accountKey) {
    throw new Error('Facebook diagnosis requires --diagnose-account <account-key>.');
  }
  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const profiles = await (dependencies.loadPublicationChannelProfiles
    || loadPublicationChannelProfiles)(channelsPath, { projectRoot });
  const targets = profiles.flatMap((profile) => listConfiguredPlatformPublicationTargets(profile));
  const target = targets.find((item) => (
    item.platform === FACEBOOK_REEL_PLATFORM && item.accountKey === accountKey
  ));
  if (!target) {
    throw new Error(`Facebook target ${accountKey} was not found in ${channelsPath}.`);
  }
  const client = dependencies.graphClient
    || createFacebookGraphClient(runtimeConfig.env || {}, target);
  const expectedId = normalizeSocialText(target.facebook?.page_id || target.facebook?.pageId);
  const expectedName = normalizeSocialText(
    target.facebook?.expected_page_name || target.facebook?.expectedPageName,
  );
  const identity = await client.fetchPageIdentity(expectedId);
  if (
    !identity.pageId
    || identity.pageId !== expectedId
    || identity.name.toLowerCase() !== expectedName.toLowerCase()
  ) {
    throw new FacebookPublicationValidationError(
      `Facebook identity mismatch: expected ${expectedName} (${expectedId}), received ${identity.name || 'unknown'} (${identity.pageId || 'unknown'}).`,
      { code: 'facebook_identity_mismatch' },
    );
  }
  return {
    account_key: accountKey,
    page_id: identity.pageId,
    page_name: identity.name,
    username: identity.username,
    link: identity.link,
    identity_verified: true,
    media_delivery: 'direct_upload',
    delivery_enabled: normalizeSocialBoolean(runtimeConfig.env?.FACEBOOK_DELIVERY_ENABLED),
  };
}

export async function executeDueFacebookPublications(options = {}, dependencies = {}) {
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const accountKey = getStringOption(options, 'account-key', '');
  const publicationId = getStringOption(options, 'publication-id', '');
  const limit = getStringOption(options, 'limit', '');
  const dryRun = getBooleanOption(options, 'dry-run', false);
  const liveOverride = getBooleanOption(options, 'allow-facebook-live', false);
  const publishNow = getBooleanOption(options, 'publish-now', false);
  if (liveOverride && !publicationId) {
    throw new Error('--allow-facebook-live requires --publication-id <id>.');
  }
  if (publishNow && (!liveOverride || !publicationId)) {
    throw new Error('--publish-now requires --publication-id <id> and --allow-facebook-live.');
  }
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const maxLatenessHours = resolveSocialPublicationMaxLatenessHours(runtimeConfig.env);
  const store = dependencies.publicationStore
    || createSocialPublicationStore(runtimeConfig, 'facebook-publication');
  const publishImpl = dependencies.publishFacebookReel || publishFacebookReel;
  const deliverAlerts = dependencies.deliverSocialPublicationLifecycleAlerts
    || deliverSocialPublicationLifecycleAlerts;
  const deliverFailureAlerts = dependencies.deliverPublicationFailureAlerts
    || deliverPublicationFailureAlerts;
  const fetched = accountKey
    ? await store.fetchPublicationsByChannel({
      platform: FACEBOOK_REEL_PLATFORM,
      accountKey,
      order: 'scheduled_for.asc.nullsfirst,created_at.asc',
    })
    : await store.fetchPublicationsByPlatform({
      platform: FACEBOOK_REEL_PLATFORM,
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
  const failureAlerts = await deliverFailureAlerts({
    store,
    publications: lifecycle.publications,
    runtimeConfig,
    asOf,
    dryRun,
    ...(dependencies.sendDiscordMessage
      ? { sendDiscordMessage: dependencies.sendDiscordMessage }
      : {}),
  });
  const alerts = await deliverAlerts({
    store,
    publications: failureAlerts.publications,
    runtimeConfig,
    asOf,
    dryRun,
    ...(dependencies.sendDiscordMessage
      ? { sendDiscordMessage: dependencies.sendDiscordMessage }
      : {}),
  });
  const due = limitSocialItems(
    alerts.publications
      .map((publication) => ({
        publication,
        dueAction: publishNow
          && publication.id === publicationId
          && ['queued', 'scheduled'].includes(normalizeSocialWorkflowState(publication))
          ? 'upload'
          : resolveFacebookDueAction(publication, asOf, maxLatenessHours),
      }))
      .filter((item) => item.dueAction),
    limit,
  );
  const results = [...lifecycle.results, ...failureAlerts.results, ...alerts.results];

  for (const { publication, dueAction } of due) {
    if (dryRun) {
      results.push({
        publication_id: publication.id,
        platform: FACEBOOK_REEL_PLATFORM,
        account_key: publication.account_key,
        action: publishNow && publication.id === publicationId && dueAction === 'upload'
          ? 'facebook_supervised_publish_now_due'
          : dueAction === 'continue'
          ? 'facebook_status_due'
          : dueAction === 'expire'
            ? 'facebook_missed_window_due'
            : 'facebook_publish_due',
        workflow_state: normalizeSocialWorkflowState(publication),
        scheduled_for: publication.scheduled_for || '',
        external_id: publication.external_id || '',
      });
      continue;
    }
    if (dueAction === 'expire') {
      await store.updatePublication(publication.id, buildSocialMissedWindowPatch(
        publication,
        asOf,
        maxLatenessHours,
      ));
      results.push({
        publication_id: publication.id,
        platform: FACEBOOK_REEL_PLATFORM,
        account_key: publication.account_key,
        action: 'facebook_missed_window_withdrawn',
        workflow_state: 'withdrawn',
        reason: 'missed_delivery_window',
        scheduled_for: publication.scheduled_for || '',
      });
      continue;
    }
    const deliveryEnabled = normalizeSocialBoolean(runtimeConfig.env?.FACEBOOK_DELIVERY_ENABLED)
      || (liveOverride && publication.id === publicationId);
    if (dueAction === 'upload' && !deliveryEnabled) {
      results.push({
        publication_id: publication.id,
        platform: FACEBOOK_REEL_PLATFORM,
        account_key: publication.account_key,
        action: 'facebook_publish_blocked',
        workflow_state: normalizeSocialWorkflowState(publication),
        reason: 'facebook_live_delivery_disabled',
      });
      continue;
    }

    let activePublication = publication;
    if (dueAction === 'upload') {
      activePublication = await store.claimPublicationForUpload(publication.id, {
        status: 'publishing',
        metadata: buildSocialMetadataPatch(publication, {
          workflow_state: 'publishing',
          publish_claim_token: randomUUID(),
          publish_claimed_at: asOf,
          publish_attempted_at: asOf,
          publish_attempt_error: '',
          ...(publishNow && publication.id === publicationId ? {
            facebook_supervised_publish_now_at: asOf,
            facebook_supervised_original_scheduled_for: publication.scheduled_for || '',
          } : {}),
        }),
      });
      if (!activePublication) {
        results.push({
          publication_id: publication.id,
          platform: FACEBOOK_REEL_PLATFORM,
          account_key: publication.account_key,
          action: 'facebook_claim_skipped',
          workflow_state: normalizeSocialWorkflowState(publication),
          reason: 'already_claimed_or_not_uploadable',
        });
        continue;
      }
    }

    try {
      const videoRow = activePublication.video_id
        ? await store.fetchVideoById(activePublication.video_id)
        : null;
      const delivered = await publishImpl({
        publication: activePublication,
        videoRow,
        target: resolveStoredTarget(activePublication),
        runtimeEnv: runtimeConfig.env || {},
        projectRoot,
        asOf,
        onInitialized: async (initialized) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            external_id: initialized.videoId,
            metadata: buildSocialMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              facebook_video_id: initialized.videoId,
              facebook_upload_url: initialized.uploadUrl,
              facebook_initialized_at: initialized.initializedAt || asOf,
              next_status_poll_at: nextSocialStatusPollAt(asOf),
            }),
          }) || activePublication;
          if (!normalizeSocialText(activePublication.external_id)) {
            throw new Error(`Facebook upload session ${initialized.videoId} was not persisted.`);
          }
        },
        onUploaded: async (uploaded) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            uploaded_at: activePublication.uploaded_at || uploaded.uploadedAt || asOf,
            metadata: buildSocialMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              facebook_upload_completed_at: uploaded.uploadedAt || asOf,
              next_status_poll_at: nextSocialStatusPollAt(asOf),
            }),
          }) || activePublication;
        },
        onFinishRequested: async (finished) => {
          activePublication = await store.updatePublication(publication.id, {
            status: 'publishing',
            metadata: buildSocialMetadataPatch(activePublication, {
              workflow_state: 'publishing',
              facebook_finish_requested_at: finished.requestedAt || asOf,
              next_status_poll_at: nextSocialStatusPollAt(asOf),
            }),
          }) || activePublication;
          if (!normalizeSocialText(activePublication.metadata?.facebook_finish_requested_at)) {
            throw new Error(`Facebook Reel ${finished.videoId} receipt was not persisted.`);
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
        metadata: buildSocialMetadataPatch(activePublication, {
          workflow_state: published ? 'published' : 'publishing',
          facebook_video_id: delivered.videoId
            || activePublication.metadata?.facebook_video_id
            || '',
          facebook_status: delivered.status || '',
          facebook_status_checked_at: asOf,
          facebook_publish_uncertain: false,
          next_status_poll_at: published ? '' : nextSocialStatusPollAt(asOf),
        }),
      }) || activePublication;
      results.push({
        publication_id: publication.id,
        platform: FACEBOOK_REEL_PLATFORM,
        account_key: publication.account_key,
        action: published ? 'facebook_published' : 'facebook_processing',
        workflow_state: normalizeSocialWorkflowState(activePublication),
        external_id: activePublication.external_id || '',
        public_url: activePublication.public_url || '',
      });
    } catch (error) {
      const uncertain = error instanceof FacebookPublicationUncertainError;
      const validation = error instanceof FacebookPublicationValidationError;
      const authRequired = isFacebookAuthFailure(error);
      const hasVideoId = Boolean(normalizeSocialText(activePublication.external_id));
      const workflowState = uncertain
        ? 'reconciliation_required'
        : authRequired
          ? 'auth_required'
          : validation
            ? 'approval_required'
            : hasVideoId
              ? 'publishing'
              : 'failed';
      const status = ['auth_required', 'approval_required', 'reconciliation_required'].includes(
        workflowState,
      ) ? 'blocked' : workflowState;
      const failureAlert = await persistAndDeliverPublicationFailureAlert({
        store,
        publication: activePublication,
        patch: {
          status,
          metadata: buildSocialMetadataPatch(activePublication, {
            workflow_state: workflowState,
            publish_attempt_error: error.message || String(error),
            facebook_publish_uncertain: uncertain,
            facebook_publish_uncertain_at: uncertain ? asOf : '',
            facebook_graph_error: error instanceof FacebookGraphApiError,
            next_status_poll_at: hasVideoId && !uncertain
              ? nextSocialStatusPollAt(asOf)
              : '',
          }),
        },
        failure: {
          action: uncertain ? 'facebook_publish_uncertain' : 'facebook_publish_failed',
          workflowState,
          reason: error.code || 'facebook_publish_failed',
          error: error.message || String(error),
        },
        runtimeConfig,
        asOf,
        dryRun,
        ...(dependencies.sendDiscordMessage
          ? { sendDiscordMessage: dependencies.sendDiscordMessage }
          : {}),
      });
      activePublication = failureAlert.publication;
      results.push({
        publication_id: publication.id,
        platform: FACEBOOK_REEL_PLATFORM,
        account_key: publication.account_key,
        action: uncertain ? 'facebook_publish_uncertain' : 'facebook_publish_failed',
        workflow_state: workflowState,
        reason: error.code || 'facebook_publish_failed',
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
      'Usage: node services/product-video-agent/scripts/publication/social/facebook/execute-due-publications.mjs [options]',
      '',
      'Options:',
      '  --diagnose-account <key> Verify the configured Page token identity without publishing.',
      '  --channels <path>         Channel registry used by account diagnosis.',
      '  --account-key <key>       Limit execution to one Facebook Page account key.',
      '  --publication-id <id>     Limit execution to one publication id.',
      '  --limit <n>               Maximum due publications to process.',
      '  --dry-run                 Report due rows without publishing.',
      '  --allow-facebook-live     Permit one targeted live publication; requires --publication-id.',
      '  --publish-now             Publish that targeted row before its inherited slot; requires the live override.',
      '  --as-of <ISO>             Deterministic timestamp. Default: now.',
    ]);
    return;
  }
  if (getStringOption(options, 'diagnose-account', '')) {
    const result = await diagnoseFacebookAccount(options);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const results = await executeDueFacebookPublications(options);
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

if (!process.argv.includes('--test') && process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
