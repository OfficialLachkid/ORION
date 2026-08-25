import {
  loadPublicationChannelProfiles,
} from '../../../services/product-video-agent/src/publication-channels.mjs';
import {
  buildChannelPublicationQueue,
  listAvailableScheduleSlots,
  selectReviewApprovalCandidates,
} from '../../../services/product-video-agent/src/publication-queue.mjs';
import { reconcilePokeQuizzPreviewFallbackStorage } from '../../../services/product-video-agent/src/poke-quizz-preview-storage.mjs';
import { POKE_QUIZZ_REVIEW_TARGET_COUNT } from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import { executeProductVideoAction } from '../../../services/task-router/src/product-video-executor.mjs';
import { loadRuntimeConfig, projectRoot } from '../../../services/lib/runtime-config.mjs';
import { discoverNightShiftChannelRuntimes } from './pokemon-maintenance-runtime.mjs';
import {
  replenishReviewBacklogForRuntime,
} from './pokemon-maintenance-review-backlog.mjs';
import {
  collectChildError,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

export {
  countActiveTemplateQueueItems,
  selectNextReviewBacklogRuntime,
} from './pokemon-maintenance-review-backlog.mjs';

export const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
export const REVIEW_READY_TARGET_COUNT = POKE_QUIZZ_REVIEW_TARGET_COUNT;

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
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

function normalizeNightShiftChannelKey(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizeNightShiftConfigBasename(channelConfigPath = '') {
  const normalizedPath = String(channelConfigPath || '').replaceAll('\\', '/');
  const filename = normalizedPath.split('/').at(-1) || '';
  return filename.replace(/\.json$/i, '').trim().toLowerCase();
}

function scoreNightShiftPrimaryRuntime(runtime = {}) {
  const basename = normalizeNightShiftConfigBasename(runtime.channelConfigPath);
  const channelKey = normalizeNightShiftChannelKey(runtime.channelSelector);
  let score = 0;
  if (basename && channelKey && basename === channelKey) {
    score += 1000;
  }
  if ((runtime?.nightShift?.reviewBacklogMixChannelConfigPaths || []).length > 0) {
    score += 100;
  }
  if (runtime?.nightShift?.publicationAutomationEnabled) {
    score += 10;
  }
  if (runtime?.nightShift?.reviewBacklogEnabled) {
    score += 5;
  }
  if (runtime?.nightShift?.reviewRefreshEnabled) {
    score += 3;
  }
  return score;
}

export function selectPrimaryNightShiftRuntimes(runtimes = []) {
  const selectedByChannel = new Map();

  for (const runtime of Array.isArray(runtimes) ? runtimes : []) {
    const channelKey = normalizeNightShiftChannelKey(runtime?.channelSelector);
    if (!channelKey) {
      continue;
    }

    const current = selectedByChannel.get(channelKey) || null;
    if (!current) {
      selectedByChannel.set(channelKey, runtime);
      continue;
    }

    const candidateScore = scoreNightShiftPrimaryRuntime(runtime);
    const currentScore = scoreNightShiftPrimaryRuntime(current);
    if (candidateScore > currentScore) {
      selectedByChannel.set(channelKey, runtime);
      continue;
    }
    if (candidateScore < currentScore) {
      continue;
    }

    const candidatePath = String(runtime?.channelConfigPath || '');
    const currentPath = String(current?.channelConfigPath || '');
    if (candidatePath.localeCompare(currentPath) > 0) {
      selectedByChannel.set(channelKey, runtime);
    }
  }

  return Array.from(selectedByChannel.values()).sort((left, right) => (
    `${left.channelSelector}:${left.channelConfigPath}`.localeCompare(
      `${right.channelSelector}:${right.channelConfigPath}`,
    )
  ));
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
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const profiles = await loadProfiles(DEFAULT_PUBLICATION_CHANNELS_PATH, { projectRoot });
  const activeProfiles = profiles.filter((profile) => profile.status === 'active');
  const channelRuntimes = selectPrimaryNightShiftRuntimes(await discoverRuntimes());
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
        runtimeConfig,
        templateRuntime,
        profile,
        asOf,
        {
          publicationStore: dependencies.publicationStore || createPublicationStore(runtimeConfig),
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

function aggregateReviewBacklogRunsByChannel(runs = []) {
  const groupedRuns = new Map();

  for (const run of Array.isArray(runs) ? runs : []) {
    const channelKey = normalizeNightShiftChannelKey(run?.channel)
      || `__missing_channel__:${groupedRuns.size}`;
    const existing = groupedRuns.get(channelKey);
    if (!existing) {
      groupedRuns.set(channelKey, {
        status: String(run?.status || 'skipped'),
        channel: run?.channel || '',
        channelConfigPath: run?.channelConfigPath || '',
        genreLabel: run?.genreLabel || '',
        generated: Number(run?.generated || 0),
        generatedItems: Array.isArray(run?.generatedItems) ? [...run.generatedItems] : [],
        initialReviewReadyCount: Number(run?.initialReviewReadyCount || 0),
        finalReviewReadyCount: Number(run?.finalReviewReadyCount || 0),
        targetReviewReadyCount: Number(run?.targetReviewReadyCount || 0),
        errors: Array.isArray(run?.errors) ? [...run.errors] : [],
        runCount: 1,
        failedRunCount: String(run?.status || '') === 'failed' ? 1 : 0,
      });
      continue;
    }

    existing.generated += Number(run?.generated || 0);
    if (Array.isArray(run?.generatedItems)) {
      existing.generatedItems.push(...run.generatedItems);
    }
    existing.finalReviewReadyCount = Number(run?.finalReviewReadyCount || existing.finalReviewReadyCount || 0);
    existing.targetReviewReadyCount = Math.max(
      Number(existing.targetReviewReadyCount || 0),
      Number(run?.targetReviewReadyCount || 0),
    );
    if (Array.isArray(run?.errors)) {
      existing.errors.push(...run.errors);
    }
    existing.runCount += 1;
    if (String(run?.status || '') === 'failed') {
      existing.failedRunCount += 1;
    }
  }

  return Array.from(groupedRuns.values()).map((run) => ({
    ...run,
    status: run.failedRunCount === run.runCount && run.runCount > 0
      ? 'failed'
      : (run.generated > 0
        ? 'completed'
        : (run.finalReviewReadyCount < run.targetReviewReadyCount ? 'failed' : 'skipped')),
  }));
}

export function summarizeReviewBacklogRuns(runs = []) {
  const groupedRuns = aggregateReviewBacklogRunsByChannel(runs);
  const summary = {
    status: 'skipped',
    configuredChannels: groupedRuns.length,
    generated: 0,
    generatedItems: [],
    initialReviewReadyCount: 0,
    finalReviewReadyCount: 0,
    targetReviewReadyCount: 0,
    failedChannels: 0,
    errors: [],
    channels: groupedRuns,
  };

  for (const run of groupedRuns) {
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

function aggregateReviewRefreshRunsByChannel(runs = []) {
  const groupedRuns = new Map();

  for (const run of Array.isArray(runs) ? runs : []) {
    const channelKey = normalizeNightShiftChannelKey(run?.channel)
      || `__missing_channel__:${groupedRuns.size}`;
    const existing = groupedRuns.get(channelKey);
    if (!existing) {
      groupedRuns.set(channelKey, {
        status: String(run?.status || 'completed'),
        exitCode: run?.exitCode ?? 0,
        error: run?.error || '',
        channel: run?.channel || '',
        channelConfigPath: run?.channelConfigPath || '',
        inspected: Number(run?.inspected || 0),
        refreshed: Number(run?.refreshed || 0),
        actionable: Number(run?.actionable || 0),
        retried: Number(run?.retried || 0),
        failed: Number(run?.failed || 0),
        failures: Array.isArray(run?.failures) ? [...run.failures] : [],
        runCount: 1,
        failedRunCount: String(run?.status || '') === 'failed' ? 1 : 0,
      });
      continue;
    }

    existing.inspected = Math.max(existing.inspected, Number(run?.inspected || 0));
    existing.refreshed = Math.max(existing.refreshed, Number(run?.refreshed || 0));
    existing.actionable = Math.max(existing.actionable, Number(run?.actionable || 0));
    existing.retried = Math.max(existing.retried, Number(run?.retried || 0));
    existing.failed = Math.max(existing.failed, Number(run?.failed || 0));
    if (existing.status !== 'completed' && String(run?.status || '') === 'completed') {
      existing.status = 'completed';
      existing.error = '';
      existing.exitCode = run?.exitCode ?? existing.exitCode;
    } else if (!existing.error && run?.error) {
      existing.error = run.error;
    }
    if (Array.isArray(run?.failures)) {
      existing.failures.push(...run.failures);
    }
    existing.runCount += 1;
    if (String(run?.status || '') === 'failed') {
      existing.failedRunCount += 1;
    }
  }

  return Array.from(groupedRuns.values()).map((run) => {
    const seenFailures = new Set();
    const failures = run.failures.filter((failure) => {
      const key = JSON.stringify([
        failure?.publicationId || '',
        failure?.messageId || '',
        failure?.reason || '',
      ]);
      if (seenFailures.has(key)) {
        return false;
      }
      seenFailures.add(key);
      return true;
    });
    return {
      ...run,
      status: run.failedRunCount === run.runCount && run.runCount > 0 ? 'failed' : 'completed',
      failed: failures.length,
      failures,
    };
  });
}

export function summarizeReviewRefreshRuns(runs = []) {
  const groupedRuns = aggregateReviewRefreshRunsByChannel(runs);
  return {
    status: groupedRuns.every((run) => run.status === 'failed') ? 'failed' : 'completed',
    configuredChannels: groupedRuns.length,
    inspected: groupedRuns.reduce((sum, run) => sum + Number(run.inspected || 0), 0),
    refreshed: groupedRuns.reduce((sum, run) => sum + Number(run.refreshed || 0), 0),
    actionable: groupedRuns.reduce((sum, run) => sum + Number(run.actionable || 0), 0),
    retried: groupedRuns.reduce((sum, run) => sum + Number(run.retried || 0), 0),
    failed: groupedRuns.reduce((sum, run) => sum + Number(run.failed || 0), 0),
    failures: groupedRuns.flatMap((run) => (
      Array.isArray(run.failures)
        ? run.failures.map((failure) => ({
          channel: run.channel,
          ...failure,
        }))
        : []
    )),
    channels: groupedRuns,
  };
}

export async function replenishPokeQuizzReviewBacklog(config, asOf = new Date().toISOString()) {
  const channelRuntimes = selectPrimaryNightShiftRuntimes(
    (await discoverNightShiftChannelRuntimes())
      .filter((runtime) => runtime.nightShift.reviewBacklogEnabled),
  );
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
  const channelRuntimes = selectPrimaryNightShiftRuntimes(
    (await discoverNightShiftChannelRuntimes())
      .filter((runtime) => runtime.nightShift.reviewRefreshEnabled),
  );
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

  return summarizeReviewRefreshRuns(runs);
}
