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
import { resolvePokeQuizzSelectionStateScope } from '../../../services/product-video-agent/src/poke-quizz-selection-state.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  POKE_QUIZZ_REVIEW_TARGET_COUNT,
  syncPokeQuizzQueueStatusMessage,
} from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import { resolveVideoTemplateRuntime } from '../../../services/product-video-agent/src/video-template-context.mjs';
import { executeProductVideoAction } from '../../../services/task-router/src/product-video-executor.mjs';
import { loadRuntimeConfig, projectRoot } from '../../../services/lib/runtime-config.mjs';
import { discoverNightShiftChannelRuntimes } from './pokemon-maintenance-runtime.mjs';
import {
  collectChildError,
  parseLastJsonObject,
  parseTrailingJsonArray,
  runProjectNodeScript,
} from './process-utils.mjs';

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

function normalizePublicationWorkflowState(publication = {}) {
  return String(
    publication?.metadata?.workflow_state
      || publication?.status
      || '',
  ).trim().toLowerCase();
}

function normalizeTemplateIdForQueue(value = '') {
  const normalizedTemplateId = String(value || '').trim().toLowerCase();
  if (!normalizedTemplateId) {
    return '';
  }
  if (normalizedTemplateId.includes('find-the-shiny')) {
    return 'pokemon.find-the-shiny.v1';
  }
  if (normalizedTemplateId.includes('know-your-shiny')) {
    return 'pokemon.know-your-shiny.v1';
  }
  if (normalizedTemplateId.includes('memory')) {
    return 'pokemon.memory.v1';
  }
  if (normalizedTemplateId.includes('type-quiz') || normalizedTemplateId.includes('type-speed-quiz')) {
    return 'pokemon.type-quiz.v1';
  }
  if (normalizedTemplateId.includes('dual-type-reveal') || normalizedTemplateId.includes('type-challenge')) {
    return 'pokemon.dual-type-reveal.v1';
  }
  return normalizedTemplateId;
}

function normalizeTemplateWeightsForQueue(templateWeights = {}) {
  return Object.fromEntries(
    Object.entries(
      templateWeights && typeof templateWeights === 'object' && !Array.isArray(templateWeights)
        ? templateWeights
        : {},
    )
      .map(([templateId, weight]) => {
        const normalizedTemplateId = normalizeTemplateIdForQueue(templateId);
        const parsedWeight = Number.parseFloat(String(weight || ''));
        return [
          normalizedTemplateId,
          Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 1,
        ];
      })
      .filter(([templateId]) => Boolean(templateId)),
  );
}

export function countActiveTemplateQueueItems(publications = [], templateId = '') {
  const normalizedTemplateScope = resolvePokeQuizzSelectionStateScope(templateId, '');
  if (!normalizedTemplateScope) {
    return 0;
  }
  return publications.filter((publication) => (
    resolvePokeQuizzSelectionStateScope(publication?.metadata?.template_id || '', '') === normalizedTemplateScope
    && ['preview_upload_pending', 'preview_uploaded', 'preview_approved', 'scheduled'].includes(
      normalizePublicationWorkflowState(publication),
    )
  )).length;
}

function summarizeRecentGeneratedTemplates(templateIds = []) {
  const normalizedTemplateIds = (Array.isArray(templateIds) ? templateIds : [])
    .map((templateId) => normalizeTemplateIdForQueue(templateId))
    .filter(Boolean);
  const counts = normalizedTemplateIds.reduce((summary, templateId) => {
    summary[templateId] = Number(summary[templateId] || 0) + 1;
    return summary;
  }, {});

  return {
    mostRecentTemplateId: normalizedTemplateIds.at(-1) || '',
    counts,
  };
}

function summarizeActiveTemplateQueue(publications = [], templateId = '') {
  const normalizedTemplateId = normalizeTemplateIdForQueue(templateId);
  if (!normalizedTemplateId) {
    return {
      count: 0,
      latestCreatedAtMs: Number.NEGATIVE_INFINITY,
    };
  }

  let count = 0;
  let latestCreatedAtMs = Number.NEGATIVE_INFINITY;
  for (const publication of publications) {
    if (
      normalizeTemplateIdForQueue(publication?.metadata?.template_id || '') !== normalizedTemplateId
      || !['preview_upload_pending', 'preview_uploaded', 'preview_approved', 'scheduled'].includes(
        normalizePublicationWorkflowState(publication),
      )
    ) {
      continue;
    }

    count += 1;
    const createdAtMs = Date.parse(String(publication?.created_at || publication?.submitted_at || ''));
    if (Number.isFinite(createdAtMs) && createdAtMs > latestCreatedAtMs) {
      latestCreatedAtMs = createdAtMs;
    }
  }

  return {
    count,
    latestCreatedAtMs,
  };
}

function findMostRecentActiveTemplateId(publications = []) {
  let selectedTemplateId = '';
  let selectedCreatedAtMs = Number.NEGATIVE_INFINITY;

  for (const publication of publications) {
    if (!['preview_upload_pending', 'preview_uploaded', 'preview_approved', 'scheduled'].includes(
      normalizePublicationWorkflowState(publication),
    )) {
      continue;
    }

    const normalizedTemplateId = normalizeTemplateIdForQueue(publication?.metadata?.template_id || '');
    if (!normalizedTemplateId) {
      continue;
    }

    const createdAtMs = Date.parse(String(publication?.created_at || publication?.submitted_at || ''));
    if (Number.isFinite(createdAtMs) && createdAtMs > selectedCreatedAtMs) {
      selectedCreatedAtMs = createdAtMs;
      selectedTemplateId = normalizedTemplateId;
    }
  }

  return selectedTemplateId;
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

export function selectNextReviewBacklogRuntime(generationRuntimes, publications = [], options = {}) {
  const normalizedTemplateWeights = normalizeTemplateWeightsForQueue(options.templateWeights);
  const recentGenerationSummary = summarizeRecentGeneratedTemplates(options.recentTemplateIds);
  const rankedRuntimes = generationRuntimes
    .map((runtime) => {
      const queueSummary = summarizeActiveTemplateQueue(publications, runtime.templateId);
      const normalizedTemplateId = normalizeTemplateIdForQueue(runtime.templateId);
      const inRunGeneratedCount = Number(recentGenerationSummary.counts[normalizedTemplateId] || 0);
      const activeCount = queueSummary.count + inRunGeneratedCount;
      const weight = Number(normalizedTemplateWeights[normalizedTemplateId] || 1);
      return {
        runtime,
        activeCount,
        persistedActiveCount: queueSummary.count,
        inRunGeneratedCount,
        weight,
        weightedLoad: activeCount / weight,
        latestCreatedAtMs: Number.isFinite(queueSummary.latestCreatedAtMs)
          ? queueSummary.latestCreatedAtMs
          : Number.NEGATIVE_INFINITY,
        normalizedTemplateId,
      };
    })
    .sort((left, right) => {
      if (left.weightedLoad !== right.weightedLoad) {
        return left.weightedLoad - right.weightedLoad;
      }
      if (left.weight !== right.weight) {
        return right.weight - left.weight;
      }
      if (left.activeCount !== right.activeCount) {
        return left.activeCount - right.activeCount;
      }
      if (left.inRunGeneratedCount !== right.inRunGeneratedCount) {
        return left.inRunGeneratedCount - right.inRunGeneratedCount;
      }
      if (left.latestCreatedAtMs !== right.latestCreatedAtMs) {
        return left.latestCreatedAtMs - right.latestCreatedAtMs;
      }
      return String(left.runtime?.channelConfigPath || '').localeCompare(
        String(right.runtime?.channelConfigPath || ''),
      );
    });

  const selectedRuntime = rankedRuntimes[0]?.runtime || null;
  const mostRecentActiveTemplateId = recentGenerationSummary.mostRecentTemplateId
    || findMostRecentActiveTemplateId(publications);
  if (!selectedRuntime || rankedRuntimes.length <= 1 || !mostRecentActiveTemplateId) {
    return selectedRuntime;
  }

  if (rankedRuntimes[0].normalizedTemplateId !== mostRecentActiveTemplateId) {
    return selectedRuntime;
  }

  const alternativeRuntime = rankedRuntimes.find((candidate) => (
    candidate.normalizedTemplateId
    && candidate.normalizedTemplateId !== mostRecentActiveTemplateId
  ));

  return alternativeRuntime?.runtime || selectedRuntime;
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
  const recentGeneratedTemplateIds = [];
  let reviewReadyCount = initialQueueStatus.reviewReadyCount;
  let consecutiveFailures = 0;

  while (reviewReadyCount < targetReviewReadyCount && consecutiveFailures < 3) {
    const currentPublications = await fetchChannelPublications();
    const generationRuntime = selectNextReviewBacklogRuntime(
      generationRuntimes,
      currentPublications,
      {
        templateWeights: templateRuntime.nightShift.reviewBacklogTemplateWeights,
        recentTemplateIds: recentGeneratedTemplateIds,
      },
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
    recentGeneratedTemplateIds.push(generationRuntime?.templateId || templateRuntime.templateId);
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
