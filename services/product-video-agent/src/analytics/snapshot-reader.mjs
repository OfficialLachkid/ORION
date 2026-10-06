import { indexLatestAnalyticsSnapshotsByPublicationId } from '../video-analytics.mjs';

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_BATCH_RESULT_LIMIT = 1000;
const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 1500;

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function sleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

export function isRetryableAnalyticsError(error) {
  const message = String(error?.message || error || '');
  const status = Number(message.match(/failed \((\d{3})\)/iu)?.[1]);
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return true;
  }
  return /\b(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|ENOTFOUND|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b|fetch failed|network error|socket hang up/iu.test(message);
}

export async function retryAnalyticsOperation(operation, options = {}) {
  const maxAttempts = normalizePositiveInteger(options.maxAttempts, DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = normalizePositiveInteger(options.baseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS);
  const wait = options.sleep || sleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableAnalyticsError(error)) {
        throw error;
      }
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      options.onRetry?.({ attempt, delayMs, error });
      await wait(delayMs);
    }
  }
  throw new Error('Analytics operation exhausted its retry attempts.');
}

async function fetchSnapshotBatch(store, publicationIds, options) {
  const rows = await retryAnalyticsOperation(
    () => store.fetchAnalyticsSnapshotsByPublicationIds(publicationIds, {
      select: 'publication_id,captured_at,metrics',
      order: 'captured_at.desc',
      limit: options.batchResultLimit,
    }),
    options,
  );
  const snapshots = Array.isArray(rows) ? rows : [];

  if (snapshots.length < options.batchResultLimit || publicationIds.length === 1) {
    return snapshots;
  }

  const midpoint = Math.ceil(publicationIds.length / 2);
  const left = await fetchSnapshotBatch(store, publicationIds.slice(0, midpoint), options);
  const right = await fetchSnapshotBatch(store, publicationIds.slice(midpoint), options);
  return [...left, ...right];
}

function indexSnapshotHistory(snapshots) {
  const snapshotsByPublicationId = new Map();
  for (const snapshot of snapshots) {
    const publicationId = String(snapshot?.publication_id || '').trim();
    if (!publicationId) {
      continue;
    }
    const history = snapshotsByPublicationId.get(publicationId) || [];
    history.push(snapshot);
    snapshotsByPublicationId.set(publicationId, history);
  }
  return snapshotsByPublicationId;
}

export async function fetchAnalyticsSnapshotHistory({
  store,
  publications = [],
  batchSize = DEFAULT_BATCH_SIZE,
  batchResultLimit = DEFAULT_BATCH_RESULT_LIMIT,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  sleep: sleepImpl,
  onRetry,
} = {}) {
  const publicationIds = [...new Set(
    publications
      .map((publication) => String(publication?.id || '').trim())
      .filter(Boolean),
  )];
  const retryOptions = {
    maxAttempts,
    baseDelayMs,
    batchResultLimit: normalizePositiveInteger(batchResultLimit, DEFAULT_BATCH_RESULT_LIMIT),
    sleep: sleepImpl,
    onRetry,
  };

  let snapshots = [];
  if (typeof store?.fetchAnalyticsSnapshotsByPublicationIds === 'function') {
    const chunks = chunkValues(publicationIds, normalizePositiveInteger(batchSize, DEFAULT_BATCH_SIZE));
    for (const ids of chunks) {
      snapshots.push(...await fetchSnapshotBatch(store, ids, retryOptions));
    }
  } else if (typeof store?.fetchLatestAnalyticsSnapshot === 'function') {
    for (const publicationId of publicationIds) {
      const snapshot = await retryAnalyticsOperation(
        () => store.fetchLatestAnalyticsSnapshot(publicationId),
        retryOptions,
      );
      if (snapshot) {
        snapshots.push(snapshot);
      }
    }
  }

  return {
    snapshots,
    snapshotsByPublicationId: indexSnapshotHistory(snapshots),
    latestByPublicationId: indexLatestAnalyticsSnapshotsByPublicationId(snapshots),
  };
}

export function appendAnalyticsSnapshot(snapshotsByPublicationId, snapshot) {
  const publicationId = String(snapshot?.publication_id || '').trim();
  if (!publicationId) {
    return;
  }
  const history = snapshotsByPublicationId.get(publicationId) || [];
  history.push(snapshot);
  snapshotsByPublicationId.set(publicationId, history);
}
