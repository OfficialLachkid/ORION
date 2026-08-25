import { createTypePairKey, normalizeTypePair } from './pokemon-type-pairs.mjs';

const MAX_USED_VIDEO_SIGNATURES = 160;
const MAX_TYPE_PAIR_USAGE_KEYS = 256;
const DEFAULT_SELECTION_STATE_SCOPE = 'dual-type-reveal';

const NON_COUNTING_PUBLICATION_STATUSES = new Set([
  'deleted',
  'failed',
  'rejected',
  'withdrawn',
  'cancelled',
]);

function normalizeBackgroundPath(backgroundPath) {
  return String(backgroundPath || '')
    .trim()
    .replaceAll('\\', '/')
    .toLowerCase();
}

function normalizeSignatureList(signatureList) {
  if (!Array.isArray(signatureList)) {
    return [];
  }

  return [...new Set(
    signatureList
      .map((signature) => normalizeVideoSignature(signature))
      .filter(Boolean),
  )].slice(0, MAX_USED_VIDEO_SIGNATURES);
}

function normalizeTypePairUsageCounts(typePairUsageCounts) {
  if (!typePairUsageCounts || typeof typePairUsageCounts !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(typePairUsageCounts)
      .map(([typePairKey, value]) => {
        const normalizedKey = normalizeTypePairKeyString(typePairKey);
        const normalizedValue = Number.parseInt(String(value ?? ''), 10);
        return [normalizedKey, normalizedValue];
      })
      .filter(([typePairKey, value]) => typePairKey && Number.isFinite(value) && value >= 0)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(0, MAX_TYPE_PAIR_USAGE_KEYS),
  );
}

function normalizeTypePairKey(typePair) {
  if (!Array.isArray(typePair) || typePair.length !== 2) {
    return null;
  }

  try {
    return createTypePairKey(normalizeTypePair(typePair));
  } catch {
    return null;
  }
}

function normalizeTypePairKeyString(typePairKey) {
  const normalizedInput = String(typePairKey || '').trim().toLowerCase();
  if (!normalizedInput) {
    return null;
  }
  if (!normalizedInput.includes('|')) {
    return normalizedInput;
  }
  return normalizeTypePairKey(normalizedInput.split('|'));
}

function normalizeTemplateScopeValue(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('find-the-shiny')) {
    return 'find-the-shiny';
  }
  if (normalized.includes('know-your-shiny')) {
    return 'know-your-shiny';
  }
  if (normalized.includes('showdown')) {
    return 'showdown';
  }
  if (normalized.includes('memory')) {
    return 'memory';
  }
  if (normalized.includes('type-quiz') || normalized.includes('type-speed-quiz')) {
    return 'type-quiz';
  }
  if (normalized.includes('dual-type-reveal')) {
    return 'dual-type-reveal';
  }
  return '';
}

function extractTemplateScope(input = {}, fallbackScope = '') {
  if (typeof input === 'string') {
    return normalizeTemplateScopeValue(input) || fallbackScope;
  }

  return (
    normalizeTemplateScopeValue(input?.template_key)
    || normalizeTemplateScopeValue(input?.templateKey)
    || normalizeTemplateScopeValue(input?.template_id)
    || normalizeTemplateScopeValue(input?.templateId)
    || fallbackScope
  );
}

function normalizeVideoSignature(signature) {
  const normalizedInput = String(signature || '').trim();
  if (!normalizedInput) {
    return '';
  }
  const [typePairKey, backgroundPath] = normalizedInput.split('::');
  if (!backgroundPath) {
    return normalizedInput;
  }
  return createPokeQuizzVideoSignatureKey(typePairKey, backgroundPath) || '';
}

function extractHistoryTemplateScope(entry = {}) {
  return (
    normalizeTemplateScopeValue(entry?.publication?.metadata?.template_id)
    || normalizeTemplateScopeValue(entry?.publication?.metadata?.template_key)
    || normalizeTemplateScopeValue(entry?.video?.render?.template_id)
    || normalizeTemplateScopeValue(entry?.video?.render?.template_key)
    || normalizeTemplateScopeValue(entry?.video?.template_key)
    || ''
  );
}

function extractHistoryTypePairKey(entry = {}) {
  const videoPair = entry?.video?.source_data?.type_pair;
  const publicationPair = entry?.publication?.metadata?.type_pair;
  return normalizeTypePairKey(videoPair || publicationPair || []);
}

function extractHistoryBackgroundPath(entry = {}) {
  const videoBackgroundPath = entry?.video?.source_data?.background_path;
  const publicationBackgroundPath = entry?.publication?.metadata?.background_path;
  const normalized = normalizeBackgroundPath(videoBackgroundPath || publicationBackgroundPath || '');
  return normalized || null;
}

function extractHistoryPublicationStatus(entry = {}) {
  return String(entry?.publication?.status || '').trim().toLowerCase();
}

function shouldCountHistoryEntryForUsage(entry = {}) {
  const status = extractHistoryPublicationStatus(entry);
  return !NON_COUNTING_PUBLICATION_STATUSES.has(status);
}

export function createPokeQuizzVideoSignatureKey(typePair, backgroundPath) {
  const typePairKey = Array.isArray(typePair)
    ? normalizeTypePairKey(typePair)
    : normalizeTypePairKeyString(typePair) || null;
  const normalizedBackgroundPath = normalizeBackgroundPath(backgroundPath);
  if (!typePairKey || !normalizedBackgroundPath) {
    return null;
  }
  return `${typePairKey}::${normalizedBackgroundPath}`;
}

export function resolvePokeQuizzSelectionStateScope(
  template = {},
  fallbackScope = DEFAULT_SELECTION_STATE_SCOPE,
) {
  return extractTemplateScope(template, fallbackScope);
}

export function resolvePokeQuizzSelectionStatePath(
  template = {},
  runtimeRoot = 'data/runtime/product-video-agent/poke-quizz',
) {
  const scope = resolvePokeQuizzSelectionStateScope(template, DEFAULT_SELECTION_STATE_SCOPE);
  const normalizedRuntimeRoot = String(runtimeRoot || 'data/runtime/product-video-agent/poke-quizz')
    .trim()
    .replace(/\/+$/u, '');
  return `${normalizedRuntimeRoot}/selection-state-${scope}.json`;
}

export function normalizePokeQuizzSelectionState(selectionState) {
  const lastTypePairKey = normalizeTypePairKeyString(selectionState?.last_type_pair_key) || null;
  const lastBackgroundPath = normalizeBackgroundPath(selectionState?.last_background_path);
  const usedVideoSignatures = normalizeSignatureList(selectionState?.used_video_signatures);
  const typePairUsageCounts = normalizeTypePairUsageCounts(selectionState?.type_pair_usage_counts);
  const lastVideoSignature = createPokeQuizzVideoSignatureKey(
    lastTypePairKey,
    lastBackgroundPath,
  );

  return {
    last_type_pair_key: lastTypePairKey,
    last_background_path: lastBackgroundPath || null,
    used_video_signatures: normalizeSignatureList([
      lastVideoSignature,
      ...usedVideoSignatures,
    ]),
    type_pair_usage_counts: typePairUsageCounts,
  };
}

export function mergePokeQuizzSelectionStates(...states) {
  const normalizedStates = states
    .map((state) => normalizePokeQuizzSelectionState(state))
    .filter(Boolean);
  const preferredState = normalizedStates.find((state) => state.last_type_pair_key || state.last_background_path) || {};

  return {
    last_type_pair_key: preferredState.last_type_pair_key || null,
    last_background_path: preferredState.last_background_path || null,
    used_video_signatures: normalizeSignatureList(
      normalizedStates.flatMap((state) => state.used_video_signatures || []),
    ),
    type_pair_usage_counts: normalizedStates.reduce((mergedCounts, state) => {
      const counts = normalizeTypePairUsageCounts(state.type_pair_usage_counts);
      for (const [typePairKey, value] of Object.entries(counts)) {
        mergedCounts[typePairKey] = Math.max(mergedCounts[typePairKey] || 0, value);
      }
      return mergedCounts;
    }, {}),
  };
}

export function buildPokeQuizzSelectionStateFromHistory(historyEntries = []) {
  const [latestEntry] = historyEntries;
  const latestTypePairKey = latestEntry ? extractHistoryTypePairKey(latestEntry) : null;
  const latestBackgroundPath = latestEntry ? extractHistoryBackgroundPath(latestEntry) : null;
  const usedVideoSignatures = normalizeSignatureList(
    historyEntries.map((entry) => createPokeQuizzVideoSignatureKey(
      extractHistoryTypePairKey(entry),
      extractHistoryBackgroundPath(entry),
    )),
  );
  const typePairUsageCounts = {};
  for (const entry of historyEntries) {
    if (!shouldCountHistoryEntryForUsage(entry)) {
      continue;
    }
    const typePairKey = extractHistoryTypePairKey(entry);
    if (!typePairKey) {
      continue;
    }
    typePairUsageCounts[typePairKey] = (typePairUsageCounts[typePairKey] || 0) + 1;
  }

  return {
    last_type_pair_key: latestTypePairKey,
    last_background_path: latestBackgroundPath,
    used_video_signatures: usedVideoSignatures,
    type_pair_usage_counts: normalizeTypePairUsageCounts(typePairUsageCounts),
  };
}

export async function loadPokeQuizzSelectionStateFromStore({
  store,
  channelProfile,
  limit = 24,
  template = null,
  templateId = '',
  templateKey = '',
}) {
  if (!store || !channelProfile) {
    return normalizePokeQuizzSelectionState(null);
  }

  const publications = await store.fetchPublicationsByChannel({
    platform: channelProfile.platform,
    accountKey: channelProfile.account_key,
    order: 'created_at.desc',
    limit,
  });
  const uniqueVideoIds = [...new Set(
    (publications || [])
      .map((publication) => String(publication?.video_id || '').trim())
      .filter(Boolean),
  )];
  const videos = await Promise.all(uniqueVideoIds.map((videoId) => store.fetchVideoById(videoId)));
  const videosById = new Map(
    videos
      .filter(Boolean)
      .map((video) => [video.id, video]),
  );
  const templateScope = (
    extractTemplateScope(template)
    || extractTemplateScope({ template_id: templateId, template_key: templateKey }, '')
  );
  const historyEntries = (publications || [])
    .map((publication) => ({
      publication,
      video: videosById.get(publication.video_id) || null,
    }));
  const filteredHistoryEntries = templateScope
    ? historyEntries.filter((entry) => extractHistoryTemplateScope(entry) === templateScope)
    : historyEntries;

  return buildPokeQuizzSelectionStateFromHistory(filteredHistoryEntries);
}
