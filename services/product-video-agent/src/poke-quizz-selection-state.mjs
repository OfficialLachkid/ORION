import { createTypePairKey, normalizeTypePair } from './pokemon-type-pairs.mjs';

const MAX_USED_VIDEO_SIGNATURES = 160;

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
      .map((signature) => String(signature || '').trim())
      .filter(Boolean),
  )].slice(0, MAX_USED_VIDEO_SIGNATURES);
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

export function createPokeQuizzVideoSignatureKey(typePair, backgroundPath) {
  const typePairKey = Array.isArray(typePair)
    ? normalizeTypePairKey(typePair)
    : String(typePair || '').trim().toLowerCase() || null;
  const normalizedBackgroundPath = normalizeBackgroundPath(backgroundPath);
  if (!typePairKey || !normalizedBackgroundPath) {
    return null;
  }
  return `${typePairKey}::${normalizedBackgroundPath}`;
}

export function normalizePokeQuizzSelectionState(selectionState) {
  const lastTypePairKey = String(selectionState?.last_type_pair_key || '').trim().toLowerCase() || null;
  const lastBackgroundPath = normalizeBackgroundPath(selectionState?.last_background_path);
  const usedVideoSignatures = normalizeSignatureList(selectionState?.used_video_signatures);
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

  return {
    last_type_pair_key: latestTypePairKey,
    last_background_path: latestBackgroundPath,
    used_video_signatures: usedVideoSignatures,
  };
}

export async function loadPokeQuizzSelectionStateFromStore({
  store,
  channelProfile,
  limit = 24,
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

  return buildPokeQuizzSelectionStateFromHistory(
    (publications || [])
      .map((publication) => ({
        publication,
        video: videosById.get(publication.video_id) || null,
      })),
  );
}
