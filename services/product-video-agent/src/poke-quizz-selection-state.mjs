import { createTypePairKey, normalizeTypePair } from './pokemon-type-pairs.mjs';

const MAX_USED_VIDEO_SIGNATURES = 160;
const MAX_TYPE_PAIR_USAGE_KEYS = 256;
const MAX_LAST_REVEAL_METHODS = 32;
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

function normalizeRevealMethodList(methods) {
  if (!Array.isArray(methods)) return [];
  return [...new Set(methods
    .map((method) => String(method || '').trim().toLowerCase().replaceAll('-', '_'))
    .filter(Boolean))]
    .slice(0, MAX_LAST_REVEAL_METHODS);
}

function normalizeChannelStateScope(channelProfile) {
  const value = typeof channelProfile === 'string'
    ? channelProfile
    : channelProfile?.account_key || channelProfile?.id || '';
  return String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
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
  if (normalized.includes('progressive-reveal')) {
    return 'progressive-reveal';
  }
  if (normalized.includes('pixelated-reveal')) {
    return 'pixelated-reveal';
  }
  if (normalized.includes('stat-clash') || normalized.includes('stat-battle')) {
    return 'stat-clash';
  }
  if (normalized.includes('build-your-team') || normalized.includes('team-builder')) {
    return 'build-your-team';
  }
  if (normalized.includes('tournament') || normalized.includes('showdown')) {
    return 'tournament';
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

function extractHistoryRevealMethods(entry = {}) {
  return normalizeRevealMethodList(
    entry?.video?.source_data?.reveal_methods
      || entry?.video?.render?.reveal_methods
      || entry?.publication?.metadata?.reveal_methods,
  );
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
  channelProfile = null,
) {
  const scope = resolvePokeQuizzSelectionStateScope(template, DEFAULT_SELECTION_STATE_SCOPE);
  const channelScope = normalizeChannelStateScope(channelProfile);
  const normalizedRuntimeRoot = String(runtimeRoot || 'data/runtime/product-video-agent/poke-quizz')
    .trim()
    .replace(/\/+$/u, '');
  const channelSuffix = channelScope ? `-${channelScope}` : '';
  return `${normalizedRuntimeRoot}/selection-state-${scope}${channelSuffix}.json`;
}

export function normalizePokeQuizzSelectionState(selectionState) {
  const lastTypePairKey = normalizeTypePairKeyString(selectionState?.last_type_pair_key) || null;
  const lastBackgroundPath = normalizeBackgroundPath(selectionState?.last_background_path);
  const usedVideoSignatures = normalizeSignatureList(selectionState?.used_video_signatures);
  const typePairUsageCounts = normalizeTypePairUsageCounts(selectionState?.type_pair_usage_counts);
  const lastRevealMethods = normalizeRevealMethodList(selectionState?.last_reveal_methods);
  const lastVideoSignature = createPokeQuizzVideoSignatureKey(
    lastTypePairKey,
    lastBackgroundPath,
  );

  const normalized = {
    last_type_pair_key: lastTypePairKey,
    last_background_path: lastBackgroundPath || null,
    used_video_signatures: normalizeSignatureList([
      lastVideoSignature,
      ...usedVideoSignatures,
    ]),
    type_pair_usage_counts: typePairUsageCounts,
  };
  return lastRevealMethods.length > 0
    ? { ...normalized, last_reveal_methods: lastRevealMethods }
    : normalized;
}

export function mergePokeQuizzSelectionStates(...states) {
  const normalizedStates = states
    .map((state) => normalizePokeQuizzSelectionState(state))
    .filter(Boolean);
  const preferredState = normalizedStates.find((state) => state.last_type_pair_key || state.last_background_path) || {};
  const previousRevealState = normalizedStates.find((state) => state.last_reveal_methods?.length > 0) || {};

  const merged = {
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
  return previousRevealState.last_reveal_methods?.length > 0
    ? { ...merged, last_reveal_methods: previousRevealState.last_reveal_methods }
    : merged;
}

export function buildPokeQuizzSelectionStateFromHistory(historyEntries = []) {
  const [latestEntry] = historyEntries;
  const latestTypePairKey = latestEntry ? extractHistoryTypePairKey(latestEntry) : null;
  const latestBackgroundPath = latestEntry ? extractHistoryBackgroundPath(latestEntry) : null;
  const latestRevealMethods = latestEntry ? extractHistoryRevealMethods(latestEntry) : [];
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

  const state = {
    last_type_pair_key: latestTypePairKey,
    last_background_path: latestBackgroundPath,
    used_video_signatures: usedVideoSignatures,
    type_pair_usage_counts: normalizeTypePairUsageCounts(typePairUsageCounts),
  };
  return latestRevealMethods.length > 0
    ? { ...state, last_reveal_methods: latestRevealMethods }
    : state;
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
