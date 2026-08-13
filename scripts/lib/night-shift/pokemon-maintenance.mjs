import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../../../services/product-video-agent/src/publication-channels.mjs';
import {
  buildChannelPublicationQueue,
  listAvailableScheduleSlots,
  selectReviewApprovalCandidates,
} from '../../../services/product-video-agent/src/publication-queue.mjs';
import { reconcilePokeQuizzPreviewFallbackStorage } from '../../../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
  syncPokeQuizzQueueStatusMessage,
} from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import { resolveVideoTemplateRuntime } from '../../../services/product-video-agent/src/video-template-context.mjs';
import { executeProductVideoAction } from '../../../services/task-router/src/product-video-executor.mjs';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';
import {
  collectChildError,
  parseLastJsonObject,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

export const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
export const REVIEW_READY_TARGET_COUNT = POKE_QUIZZ_REVIEW_TARGET_COUNT;
const CHANNEL_CONFIGS_DIR = resolve(projectRoot, 'services', 'product-video-agent', 'config', 'channels');

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
}

function normalizeProjectRelativePath(absolutePath) {
  return relative(projectRoot, absolutePath).replaceAll('\\', '/');
}

function parsePositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
    : [];
}

function normalizeNightShiftSettings(channelConfig = {}) {
  const nightShift = channelConfig?.night_shift && typeof channelConfig.night_shift === 'object'
    ? channelConfig.night_shift
    : {};
  const reviewBacklog = nightShift.review_backlog && typeof nightShift.review_backlog === 'object'
    ? nightShift.review_backlog
    : {};
  const reviewRefresh = nightShift.review_refresh && typeof nightShift.review_refresh === 'object'
    ? nightShift.review_refresh
    : {};
  const publicationAutomation = nightShift.publication_automation && typeof nightShift.publication_automation === 'object'
    ? nightShift.publication_automation
    : {};
  const rawPublicationAutomationMode = String(publicationAutomation.mode || '').trim().toLowerCase();
  const publicationAutomationEnabled = publicationAutomation.enabled === true
    || (
      publicationAutomation.enabled !== false
      && rawPublicationAutomationMode === 'auto'
    );
  return {
    reviewBacklogEnabled: reviewBacklog.enabled === true,
    targetReviewReadyCount: parsePositiveInteger(
      reviewBacklog.target_review_ready_count,
      REVIEW_READY_TARGET_COUNT,
    ),
    reviewBacklogMixChannelConfigPaths: normalizeStringArray(
      reviewBacklog.mix_channel_config_paths,
    ),
    reviewRefreshEnabled: reviewRefresh.enabled === true,
    reviewRefreshPendingOnly: reviewRefresh.pending_only !== false,
    publicationAutomationEnabled,
    publicationAutomationMode: publicationAutomationEnabled ? 'auto' : 'manual',
    publicationAutomationMaxScheduledDays: parsePositiveInteger(
      publicationAutomation.max_scheduled_days,
      3,
    ),
  };
}

async function discoverNightShiftChannelRuntimes() {
  const entries = await readdir(CHANNEL_CONFIGS_DIR, { withFileTypes: true });
  const runtimes = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    const absolutePath = resolve(CHANNEL_CONFIGS_DIR, entry.name);
    const rawChannelConfig = JSON.parse(await readFile(absolutePath, 'utf8'));
    const nightShift = normalizeNightShiftSettings(rawChannelConfig);
    if (
      !nightShift.reviewBacklogEnabled
      && !nightShift.reviewRefreshEnabled
      && !nightShift.publicationAutomationEnabled
    ) {
      continue;
    }

    const channelConfigPath = normalizeProjectRelativePath(absolutePath);
    const templateRuntime = await resolveVideoTemplateRuntime({
      projectRoot,
      channelConfigPath,
    });
    runtimes.push({
      ...templateRuntime,
      nightShift,
    });
  }

  return runtimes.sort((left, right) => (
    `${left.channelSelector}:${left.channelConfigPath}`.localeCompare(
      `${right.channelSelector}:${right.channelConfigPath}`,
    )
  ));
}

function summarizeVideoQueueMaintenance(profiles, runs) {
  const summary = {
    attemptedChannels: profiles.length,
    processedChannels: 0,
    failedChannels: 0,
    scheduled: 0,
    published: 0,
    withdrawn: 0,
    returnedToApproval: 0,
    deleted: 0,
    changedSchedule: 0,
    autoApproved: 0,
    autoScheduled: 0,
    statusLookupFailures: 0,
    errors: [],
    channels: runs,
  };

  for (const run of runs) {
    if (run.status === 'failed') {
      summary.failedChannels += 1;
      summary.errors.push(`${run.accountKey}: ${run.error || 'unknown queue maintenance error'}`);
      continue;
    }

    summary.processedChannels += 1;
    summary.autoApproved += Number(run.autoApproved || 0);
    summary.autoScheduled += Number(run.autoScheduled || 0);
    for (const result of run.results) {
      const action = String(result?.action || '');
      const workflowState = String(result?.workflow_state || '');
      const reason = String(result?.reason || '');
      if (action === 'schedule_update' || workflowState === 'scheduled') {
        summary.scheduled += 1;
      }
      if (workflowState === 'published') {
        summary.published += 1;
      }
      if (workflowState === 'withdrawn') {
        summary.withdrawn += 1;
      }
      if (workflowState === 'deleted') {
        summary.deleted += 1;
      }
      if (workflowState === 'preview_approved') {
        summary.returnedToApproval += 1;
      }
      if (reason === 'youtube_publish_time_changed') {
        summary.changedSchedule += 1;
      }
      if (reason === 'status_lookup_failed') {
        summary.statusLookupFailures += 1;
      }
    }
  }

  return summary;
}

function buildNightShiftAutoPublishTask(publication, channelSelector, maxScheduledDays, asOf) {
  return {
    task_id: `TASK-ORION-PQ-AUTO-PUBLISH-${publication.id}`,
    approved_by: 'Night Shift Auto',
    approved_by_id: 'night-shift-auto',
    submitted_at: asOf,
    poke_quizz_publication_review: {
      publicationId: publication.id,
      channelSelector,
      scheduleMaxDays: maxScheduledDays,
    },
  };
}

export function planNightShiftAutoPublicationAutomation({
  publications = [],
  channelProfile,
  asOf = new Date().toISOString(),
  maxScheduledDays = 3,
} = {}) {
  const availableSlots = listAvailableScheduleSlots(
    channelProfile,
    asOf,
    [],
    {
      maxScheduledDays,
    },
  );
  const scheduledQueue = buildChannelPublicationQueue(
    publications,
    channelProfile,
    asOf,
    {
      maxScheduledDays,
    },
  );
  const headroom = Math.max(0, availableSlots.length - scheduledQueue.length);
  const approvalCandidates = selectReviewApprovalCandidates(publications, channelProfile)
    .slice(0, headroom);

  return {
    availableSlots,
    scheduledQueue,
    headroom,
    approvalCandidates,
  };
}

async function runNightShiftAutoPublicationAutomation(
  config,
  templateRuntime,
  channelProfile,
  asOf,
  dependencies = {},
) {
  if (!templateRuntime?.nightShift?.publicationAutomationEnabled) {
    return {
      status: 'skipped',
      autoMode: 'manual',
      maxScheduledDays: 0,
      availableSlotCount: 0,
      scheduledQueueCount: 0,
      headroom: 0,
      approvedCount: 0,
      scheduledCount: 0,
      results: [],
      errors: [],
    };
  }

  const store = dependencies.publicationStore || createPublicationStore(config);
  const executePublicationAction = dependencies.executeProductVideoAction || executeProductVideoAction;
  const publicationProfiles = dependencies.publicationProfiles || [];
  const fetchedPublications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
  });
  const plan = planNightShiftAutoPublicationAutomation({
    publications: fetchedPublications,
    channelProfile,
    asOf,
    maxScheduledDays: templateRuntime.nightShift.publicationAutomationMaxScheduledDays,
  });

  if (plan.approvalCandidates.length === 0) {
    return {
      status: 'skipped',
      autoMode: templateRuntime.nightShift.publicationAutomationMode,
      maxScheduledDays: templateRuntime.nightShift.publicationAutomationMaxScheduledDays,
      availableSlotCount: plan.availableSlots.length,
      scheduledQueueCount: plan.scheduledQueue.length,
      headroom: plan.headroom,
      approvedCount: 0,
      scheduledCount: 0,
      results: [],
      errors: [],
    };
  }

  const results = [];
  const errors = [];
  for (const publication of plan.approvalCandidates) {
    try {
      const execution = await executePublicationAction(
        'poke_quizz_publish_preview',
        buildNightShiftAutoPublishTask(
          publication,
          templateRuntime.channelSelector,
          templateRuntime.nightShift.publicationAutomationMaxScheduledDays,
          asOf,
        ),
        config,
        {
          publicationStore: store,
          loadPublicationChannelProfiles: async () => publicationProfiles,
          findPublicationChannelProfile: () => channelProfile,
          queueStatusChannelProfile: channelProfile,
          scheduleMaxDays: templateRuntime.nightShift.publicationAutomationMaxScheduledDays,
        },
      );
      results.push({
        publication_id: publication.id,
        action: 'auto_publish_approval',
        workflow_state: execution?.report?.workflowState || '',
        scheduled_for: execution?.report?.scheduledFor || '',
        reason: 'night_shift_auto_publish',
      });
    } catch (error) {
      errors.push(`Auto-publish failed for ${publication.id}: ${error.message || String(error)}`);
    }
  }

  const scheduledCount = results.filter((result) => result.workflow_state === 'scheduled').length;
  return {
    status: errors.length > 0 && results.length === 0 ? 'failed' : 'completed',
    autoMode: templateRuntime.nightShift.publicationAutomationMode,
    maxScheduledDays: templateRuntime.nightShift.publicationAutomationMaxScheduledDays,
    availableSlotCount: plan.availableSlots.length,
    scheduledQueueCount: plan.scheduledQueue.length,
    headroom: plan.headroom,
    approvedCount: results.length,
    scheduledCount,
    results,
    errors,
  };
}

export async function reconcilePreviewFallbackStorage() {
  return reconcilePokeQuizzPreviewFallbackStorage();
}

export async function runVideoQueueMaintenance(asOf = new Date().toISOString(), dependencies = {}) {
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const discoverRuntimes = dependencies.discoverNightShiftChannelRuntimes || discoverNightShiftChannelRuntimes;
  const runNodeScript = dependencies.runProjectNodeScript || runProjectNodeScript;
  const profiles = await loadProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const channelRuntimes = await discoverRuntimes();
  const runtimeByChannelSelector = new Map(
    channelRuntimes.map((runtime) => [runtime.channelSelector, runtime]),
  );
  const results = [];

  for (const profile of activeProfiles) {
    const templateRuntime = runtimeByChannelSelector.get(profile.account_key) || null;
    const maxScheduledDays = templateRuntime?.nightShift?.publicationAutomationEnabled
      ? templateRuntime.nightShift.publicationAutomationMaxScheduledDays
      : 0;
    const scheduleArgs = [
      '--channel',
      profile.account_key,
      '--channels',
      DEFAULT_PUBLICATION_CHANNELS_PATH,
      '--schedule-approved',
      '--as-of',
      asOf,
      ...(
        maxScheduledDays > 0
          ? ['--max-scheduled-days', String(maxScheduledDays)]
          : []
      ),
    ];
    const child = runNodeScript(
      'services/product-video-agent/scripts/execute-youtube-publication.mjs',
      scheduleArgs,
      {
        timeoutMs: 20 * 60 * 1000,
      },
    );
    const runResult = {
      channelId: profile.id,
      accountKey: profile.account_key,
      channelName: profile.name,
      autoMode: templateRuntime?.nightShift?.publicationAutomationMode || 'manual',
      maxScheduledDays,
      status: collectChildError(child) ? 'failed' : 'completed',
      exitCode: child.status ?? 0,
      error: collectChildError(child),
      results: parseTrailingJsonArray(child.stdout),
      autoApproved: 0,
      autoScheduled: 0,
      autoHeadroom: 0,
      autoErrors: [],
    };
    if (
      runResult.status === 'completed'
      && templateRuntime?.nightShift?.publicationAutomationEnabled
    ) {
      const autoRun = await runNightShiftAutoPublicationAutomation(
        dependencies.runtimeConfig || config,
        templateRuntime,
        profile,
        asOf,
        {
          publicationStore: dependencies.publicationStore || createPublicationStore(config),
          executeProductVideoAction: dependencies.executeProductVideoAction,
          publicationProfiles: profiles,
        },
      );
      runResult.autoApproved = autoRun.approvedCount;
      runResult.autoScheduled = autoRun.scheduledCount;
      runResult.autoHeadroom = autoRun.headroom;
      runResult.autoErrors = autoRun.errors;
      runResult.results.push(...autoRun.results);
      if (autoRun.errors.length > 0) {
        runResult.status = runResult.results.length > 0 ? 'completed' : 'failed';
        runResult.error = [runResult.error, ...autoRun.errors].filter(Boolean).join(' | ');
      }
    }
    results.push(runResult);
  }

  return summarizeVideoQueueMaintenance(activeProfiles, results);
}

function summarizeReviewBacklogRuns(runs = []) {
  const summary = {
    status: 'skipped',
    configuredChannels: runs.length,
    generated: 0,
    generatedItems: [],
    initialReviewReadyCount: 0,
    finalReviewReadyCount: 0,
    targetReviewReadyCount: 0,
    failedChannels: 0,
    errors: [],
    channels: runs,
  };

  for (const run of runs) {
    summary.generated += Number(run.generated || 0);
    summary.initialReviewReadyCount += Number(run.initialReviewReadyCount || 0);
    summary.finalReviewReadyCount += Number(run.finalReviewReadyCount || 0);
    summary.targetReviewReadyCount += Number(run.targetReviewReadyCount || 0);
    summary.generatedItems.push(...(Array.isArray(run.generatedItems) ? run.generatedItems : []));
    if (run.status === 'failed') {
      summary.failedChannels += 1;
    }
    for (const error of run.errors || []) {
      summary.errors.push(`${run.channel}: ${error}`);
    }
  }

  if (summary.failedChannels === runs.length && runs.length > 0) {
    summary.status = 'failed';
  } else if (summary.generated > 0) {
    summary.status = 'completed';
  } else if (summary.finalReviewReadyCount < summary.targetReviewReadyCount) {
    summary.status = 'failed';
  }

  return summary;
}

function normalizePublicationWorkflowState(publication = {}) {
  return String(
    publication?.metadata?.workflow_state
      || publication?.status
      || '',
  ).trim().toLowerCase();
}

function countActiveTemplateQueueItems(publications = [], templateId = '') {
  const normalizedTemplateId = String(templateId || '').trim();
  if (!normalizedTemplateId) {
    return 0;
  }
  return publications.filter((publication) => (
    String(publication?.metadata?.template_id || '').trim() === normalizedTemplateId
    && ['preview_upload_pending', 'preview_uploaded', 'preview_approved', 'scheduled'].includes(
      normalizePublicationWorkflowState(publication),
    )
  )).length;
}

async function resolveReviewBacklogGenerationRuntimes(templateRuntime) {
  const configuredPaths = templateRuntime?.nightShift?.reviewBacklogMixChannelConfigPaths || [];
  const uniquePaths = new Set([
    templateRuntime.channelConfigPath,
    ...configuredPaths,
  ]);
  const runtimes = [];

  for (const channelConfigPath of uniquePaths) {
    const runtime = await resolveVideoTemplateRuntime({
      projectRoot,
      channelConfigPath,
      channelSelector: templateRuntime.channelSelector,
    });
    if (runtime.channelSelector !== templateRuntime.channelSelector) {
      continue;
    }
    runtimes.push(runtime);
  }

  return runtimes;
}

function selectNextReviewBacklogRuntime(generationRuntimes, publications = []) {
  let selectedRuntime = generationRuntimes[0] || null;
  let selectedCount = Number.POSITIVE_INFINITY;

  for (const runtime of generationRuntimes) {
    const activeCount = countActiveTemplateQueueItems(publications, runtime.templateId);
    if (activeCount < selectedCount) {
      selectedCount = activeCount;
      selectedRuntime = runtime;
    }
  }

  return selectedRuntime;
}

async function replenishReviewBacklogForRuntime(config, templateRuntime, asOf) {
  const profiles = await loadPublicationChannelProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const channelProfile = findPublicationChannelProfile(profiles, templateRuntime.channelSelector);
  const reviewThreadId = resolvePublicationReviewThreadId(config, channelProfile);
  const targetReviewReadyCount = templateRuntime.nightShift.targetReviewReadyCount;

  if (!reviewThreadId) {
    return {
      status: 'failed',
      channel: templateRuntime.channelSelector,
      channelConfigPath: templateRuntime.channelConfigPath,
      genreLabel: templateRuntime.genreLabel,
      generated: 0,
      generatedItems: [],
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount,
      errors: [`Missing review thread id for ${channelProfile.account_key}.`],
    };
  }

  const catalogJsonPath = await ensurePreferredPokeQuizzCatalogJsonPath();
  if (!catalogJsonPath) {
    return {
      status: 'failed',
      channel: templateRuntime.channelSelector,
      channelConfigPath: templateRuntime.channelConfigPath,
      genreLabel: templateRuntime.genreLabel,
      generated: 0,
      generatedItems: [],
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount,
      errors: ['No localized Poke Quizz catalog JSON could be found.'],
    };
  }

  const store = createPublicationStore(config);
  const generationRuntimes = await resolveReviewBacklogGenerationRuntimes(templateRuntime);
  const fetchQueueStatus = async () => {
    const publications = await store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    });
    return computePokeQuizzQueueStatus(publications, channelProfile, asOf);
  };
  const fetchChannelPublications = async () => (
    store.fetchPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    })
  );

  const initialQueueStatus = await fetchQueueStatus();
  const generated = [];
  const errors = [];
  let reviewReadyCount = initialQueueStatus.reviewReadyCount;
  let consecutiveFailures = 0;

  while (reviewReadyCount < targetReviewReadyCount && consecutiveFailures < 3) {
    const currentPublications = await fetchChannelPublications();
    const generationRuntime = selectNextReviewBacklogRuntime(
      generationRuntimes,
      currentPublications,
    );
    const child = runProjectNodeScript(
      'services/product-video-agent/scripts/generate-poke-quizz-review.mjs',
      [
        '--thread-id',
        reviewThreadId,
        '--catalog-json',
        catalogJsonPath,
        '--channel-config',
        generationRuntime?.channelConfigPath || templateRuntime.channelConfigPath,
        '--channel',
        templateRuntime.channelSelector,
        '--as-of',
        new Date().toISOString(),
      ],
      {
        timeoutMs: 40 * 60 * 1000,
      },
    );
    const payload = parseLastJsonObject(child.stdout);
    if (child.error || child.status !== 0 || !payload?.publication_id) {
      consecutiveFailures += 1;
      errors.push(
        child.error?.message
          || String(child.stderr || '').trim()
          || 'Poke Quizz review replenishment generation failed.',
      );
      continue;
    }

    consecutiveFailures = 0;
    generated.push({
      publicationId: payload.publication_id,
      previewUrl: payload.preview_url || '',
      messageId: payload.message_id || '',
      templateId: generationRuntime?.templateId || templateRuntime.templateId,
      channelConfigPath: generationRuntime?.channelConfigPath || templateRuntime.channelConfigPath,
      genreLabel: generationRuntime?.genreLabel || templateRuntime.genreLabel,
    });
    reviewReadyCount = (await fetchQueueStatus()).reviewReadyCount;
  }

  const finalQueueStatus = await fetchQueueStatus();
  await syncPokeQuizzQueueStatusMessage({
    runtimeConfig: config,
    store,
    channelProfile,
    channelSelector: templateRuntime.channelSelector,
    asOf,
  });

  return {
    status: errors.length > 0 && generated.length === 0 ? 'failed' : generated.length > 0 ? 'completed' : 'skipped',
    channel: templateRuntime.channelSelector,
    channelConfigPath: templateRuntime.channelConfigPath,
    genreLabel: templateRuntime.genreLabel,
    generated: generated.length,
    generatedItems: generated,
    initialReviewReadyCount: initialQueueStatus.reviewReadyCount,
    finalReviewReadyCount: finalQueueStatus.reviewReadyCount,
    targetReviewReadyCount,
    errors,
  };
}

export async function replenishPokeQuizzReviewBacklog(config, asOf = new Date().toISOString()) {
  const channelRuntimes = (await discoverNightShiftChannelRuntimes())
    .filter((runtime) => runtime.nightShift.reviewBacklogEnabled);
  if (channelRuntimes.length === 0) {
    return {
      status: 'skipped',
      configuredChannels: 0,
      generated: 0,
      generatedItems: [],
      initialReviewReadyCount: 0,
      finalReviewReadyCount: 0,
      targetReviewReadyCount: 0,
      failedChannels: 0,
      errors: [],
      channels: [],
    };
  }

  const runs = [];
  for (const templateRuntime of channelRuntimes) {
    runs.push(await replenishReviewBacklogForRuntime(config, templateRuntime, asOf));
  }
  return summarizeReviewBacklogRuns(runs);
}

export async function refreshPokeQuizzReviewMessages() {
  const channelRuntimes = (await discoverNightShiftChannelRuntimes())
    .filter((runtime) => runtime.nightShift.reviewRefreshEnabled);
  if (channelRuntimes.length === 0) {
    return {
      status: 'skipped',
      configuredChannels: 0,
      inspected: 0,
      refreshed: 0,
      actionable: 0,
      retried: 0,
      failed: 0,
      failures: [],
      channels: [],
    };
  }

  const runs = [];
  for (const templateRuntime of channelRuntimes) {
    const args = [
      '--channel-config',
      templateRuntime.channelConfigPath,
      '--channel',
      templateRuntime.channelSelector,
      '--delay-ms',
      '1200',
      '--max-retries',
      '3',
    ];
    if (templateRuntime.nightShift.reviewRefreshPendingOnly) {
      args.push('--pending-only');
    }
    const child = runProjectNodeScript(
      'services/product-video-agent/scripts/refresh-poke-quizz-review-messages.mjs',
      args,
      {
        timeoutMs: 20 * 60 * 1000,
      },
    );
    const summary = parseLastJsonObject(child.stdout) || {};
    runs.push({
      status: collectChildError(child) ? 'failed' : 'completed',
      exitCode: child.status ?? 0,
      error: collectChildError(child),
      channel: templateRuntime.channelSelector,
      channelConfigPath: templateRuntime.channelConfigPath,
      ...summary,
    });
  }

  return {
    status: runs.every((run) => run.status === 'failed') ? 'failed' : 'completed',
    configuredChannels: runs.length,
    inspected: runs.reduce((sum, run) => sum + Number(run.inspected || 0), 0),
    refreshed: runs.reduce((sum, run) => sum + Number(run.refreshed || 0), 0),
    actionable: runs.reduce((sum, run) => sum + Number(run.actionable || 0), 0),
    retried: runs.reduce((sum, run) => sum + Number(run.retried || 0), 0),
    failed: runs.reduce((sum, run) => sum + Number(run.failed || 0), 0),
    failures: runs.flatMap((run) => (
      Array.isArray(run.failures)
        ? run.failures.map((failure) => ({
          channel: run.channel,
          ...failure,
        }))
        : []
    )),
    channels: runs,
  };
}
