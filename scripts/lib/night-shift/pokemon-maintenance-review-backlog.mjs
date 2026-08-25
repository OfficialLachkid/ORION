import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
  resolvePublicationReviewThreadId,
} from '../../../services/product-video-agent/src/publication-channels.mjs';
import { resolvePokeQuizzSelectionStateScope } from '../../../services/product-video-agent/src/poke-quizz-selection-state.mjs';
import {
  computePokeQuizzQueueStatus,
  ensurePreferredPokeQuizzCatalogJsonPath,
  syncPokeQuizzQueueStatusMessage,
} from '../../../services/product-video-agent/src/poke-quizz-queue-status.mjs';
import { SupabasePublicationStore } from '../../../services/product-video-agent/src/publication-store.mjs';
import { resolveVideoTemplateRuntime } from '../../../services/product-video-agent/src/video-template-context.mjs';
import { projectRoot } from '../../../services/lib/runtime-config.mjs';
import { parseLastJsonObject, runProjectNodeScript } from './process-utils.mjs';

const DEFAULT_PUBLICATION_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';

function createPublicationStore(config) {
  return new SupabasePublicationStore({
    supabaseUrl: config.env.SUPABASE_URL,
    apiKey: config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY,
  });
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

export async function replenishReviewBacklogForRuntime(config, templateRuntime, asOf) {
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
        runtimeConfig: config,
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
