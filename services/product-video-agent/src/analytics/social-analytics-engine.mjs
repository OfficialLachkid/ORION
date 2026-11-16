import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  indexLatestAnalyticsSnapshotsByPublicationId,
  resolveVideoAnalyticsCapturePlan,
} from '../video-analytics.mjs';
import {
  fetchAnalyticsSnapshotHistory,
  retryAnalyticsOperation,
} from './snapshot-reader.mjs';

const STATE_SCHEMA_VERSION = '1.0';
const DEFAULT_LIMIT_PER_ACCOUNT = 100;
const DEFAULT_SINCE_DAYS = 14;
const DEFAULT_SLEEP_MS = 300;
const PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'external_id',
  'public_url',
  'title',
  'published_at',
  'uploaded_at',
  'created_at',
].join(',');

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function targetAccountKey(target = {}) {
  return normalizeText(target.accountKey || target.account_key);
}

function sleep(delayMs) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

function emptyState() {
  return {
    schema_version: STATE_SCHEMA_VERSION,
    platforms: {},
  };
}

function normalizeState(state) {
  if (state?.schema_version !== STATE_SCHEMA_VERSION || !state.platforms || typeof state.platforms !== 'object') {
    return emptyState();
  }
  return state;
}

export async function loadSocialAnalyticsState(statePath) {
  try {
    return normalizeState(JSON.parse(await readFile(statePath, 'utf8')));
  } catch {
    return emptyState();
  }
}

export async function saveSocialAnalyticsState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function resolvePlatformState(state, platform) {
  const existing = state.platforms[platform];
  if (existing && typeof existing === 'object') {
    existing.latest_snapshots ||= {};
    existing.failures ||= {};
    return existing;
  }
  const created = {
    latest_snapshots: {},
    failures: {},
    last_run_at: '',
  };
  state.platforms[platform] = created;
  return created;
}

function stateSnapshotsToMap(platformState) {
  return indexLatestAnalyticsSnapshotsByPublicationId(
    Object.entries(platformState.latest_snapshots || {}).map(([publicationId, value]) => ({
      publication_id: publicationId,
      captured_at: value?.captured_at,
    })),
  );
}

function uniqueTargets(targets = [], accountKey = '') {
  const requestedAccountKey = normalizeText(accountKey);
  const byAccount = new Map();
  for (const target of Array.isArray(targets) ? targets : []) {
    const key = targetAccountKey(target);
    if (!key || target?.enabled === false || (requestedAccountKey && key !== requestedAccountKey)) {
      continue;
    }
    byAccount.set(key, target);
  }
  return [...byAccount.values()];
}

function isWithinWindow(publication, sinceTimestamp) {
  const value = normalizeText(
    publication?.published_at || publication?.uploaded_at || publication?.created_at,
  );
  const timestamp = new Date(value).valueOf();
  return Number.isFinite(timestamp) && timestamp >= sinceTimestamp;
}

function dedupePublications(publications = []) {
  const byId = new Map();
  for (const publication of publications) {
    const id = normalizeText(publication?.id);
    if (id && normalizeText(publication?.external_id)) {
      byId.set(id, publication);
    }
  }
  return [...byId.values()];
}

async function fetchCandidates({
  store,
  platform,
  targets,
  sinceIso,
  limitPerAccount,
  retryOptions,
  failures,
}) {
  const publications = [];
  for (const target of targets) {
    const accountKey = targetAccountKey(target);
    try {
      const rows = await retryAnalyticsOperation(
        () => store.fetchPublicationsByChannel({
          platform,
          accountKey,
          status: 'eq.published',
          select: PUBLICATION_SELECT,
          order: 'published_at.desc',
          limit: limitPerAccount,
          publishedAfter: sinceIso,
          queryClass: `${platform}_analytics_candidates`,
        }),
        retryOptions,
      );
      publications.push(...(Array.isArray(rows) ? rows : []));
    } catch (error) {
      failures.push({
        phase: 'candidate_fetch',
        account_key: accountKey,
        reason: error?.message || String(error),
      });
    }
  }
  const sinceTimestamp = new Date(sinceIso).valueOf();
  return dedupePublications(publications).filter((publication) => (
    isWithinWindow(publication, sinceTimestamp)
  ));
}

async function hydrateMissingLatestSnapshots({
  store,
  publications,
  latestByPublicationId,
  sinceIso,
  retryOptions,
}) {
  const missing = publications.filter((publication) => (
    !latestByPublicationId.has(normalizeText(publication?.id))
  ));
  if (missing.length === 0) {
    return latestByPublicationId;
  }
  const history = await fetchAnalyticsSnapshotHistory({
    store,
    publications: missing,
    capturedAfter: sinceIso,
    maxAttempts: retryOptions.maxAttempts,
    baseDelayMs: retryOptions.baseDelayMs,
    sleep: retryOptions.sleep,
    onRetry: retryOptions.onRetry,
  });
  for (const [publicationId, snapshot] of history.latestByPublicationId.entries()) {
    latestByPublicationId.set(publicationId, snapshot);
  }
  return latestByPublicationId;
}

function prunePlatformState(platformState, activePublicationIds) {
  for (const publicationId of Object.keys(platformState.latest_snapshots || {})) {
    if (!activePublicationIds.has(publicationId)) {
      delete platformState.latest_snapshots[publicationId];
      delete platformState.failures[publicationId];
    }
  }
}

export async function runSocialAnalyticsSweep(options = {}) {
  const platform = normalizeText(options.platform);
  if (!platform) throw new Error('Social analytics sweep requires a platform.');
  if (!options.store) throw new Error('Social analytics sweep requires a publication store.');
  if (typeof options.captureMetrics !== 'function') {
    throw new Error('Social analytics sweep requires a captureMetrics adapter.');
  }
  if (!normalizeText(options.statePath)) {
    throw new Error('Social analytics sweep requires a local statePath.');
  }

  const capturedAt = new Date(options.capturedAt || Date.now()).toISOString();
  const sinceDays = normalizePositiveInteger(options.sinceDays, DEFAULT_SINCE_DAYS);
  const limitPerAccount = normalizePositiveInteger(options.limitPerAccount, DEFAULT_LIMIT_PER_ACCOUNT);
  const delayMs = Number.isFinite(Number(options.sleepMs))
    ? Math.max(0, Number(options.sleepMs))
    : DEFAULT_SLEEP_MS;
  const sinceIso = new Date(new Date(capturedAt).valueOf() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const targets = uniqueTargets(options.targets, options.accountKey);
  const targetByAccountKey = new Map(targets.map((target) => [targetAccountKey(target), target]));
  const state = await loadSocialAnalyticsState(options.statePath);
  const platformState = resolvePlatformState(state, platform);
  const failures = [];
  const results = [];
  const retryOptions = {
    maxAttempts: options.maxAttempts,
    baseDelayMs: options.retryBaseDelayMs,
    sleep: options.retrySleep,
    onRetry: options.onRetry,
  };

  const publications = await fetchCandidates({
    store: options.store,
    platform,
    targets,
    sinceIso,
    limitPerAccount,
    retryOptions,
    failures,
  });
  const activePublicationIds = new Set(publications.map((publication) => normalizeText(publication.id)));
  if (!failures.some((failure) => failure.phase === 'candidate_fetch')) {
    prunePlatformState(platformState, activePublicationIds);
  }

  let latestByPublicationId = stateSnapshotsToMap(platformState);
  try {
    latestByPublicationId = await hydrateMissingLatestSnapshots({
      store: options.store,
      publications,
      latestByPublicationId,
      sinceIso,
      retryOptions,
    });
  } catch (error) {
    failures.push({ phase: 'snapshot_history', reason: error?.message || String(error) });
  }
  for (const [publicationId, snapshot] of latestByPublicationId.entries()) {
    if (activePublicationIds.has(publicationId) && normalizeText(snapshot?.captured_at)) {
      platformState.latest_snapshots[publicationId] = {
        captured_at: snapshot.captured_at,
      };
    }
  }

  const capturePlan = resolveVideoAnalyticsCapturePlan({
    publications,
    latestSnapshotsByPublicationId: latestByPublicationId,
    capturedAt,
  });
  const dueEntries = capturePlan.filter((entry) => options.force === true || entry.due);

  for (const [index, entry] of dueEntries.entries()) {
    const publication = entry.publication;
    const publicationId = normalizeText(publication.id);
    const accountKey = normalizeText(publication.account_key);
    const target = targetByAccountKey.get(accountKey);
    if (!target) {
      const failure = { phase: 'capture', publication_id: publicationId, account_key: accountKey, reason: 'target_not_configured' };
      failures.push(failure);
      platformState.failures[publicationId] = { ...failure, failed_at: capturedAt };
      await saveSocialAnalyticsState(options.statePath, state);
      continue;
    }

    try {
      const snapshot = await retryAnalyticsOperation(
        () => options.captureMetrics({ publication, target, capturedAt }),
        retryOptions,
      );
      const snapshotRow = {
        publication_id: publicationId,
        captured_at: capturedAt,
        metrics: snapshot.metrics,
        raw_payload: snapshot.raw_payload,
      };
      await retryAnalyticsOperation(
        () => options.store.upsertVideoAnalyticsSnapshot(snapshotRow, {
          returnRepresentation: false,
          queryClass: `${platform}_analytics_snapshot_upsert`,
        }),
        retryOptions,
      );
      platformState.latest_snapshots[publicationId] = { captured_at: capturedAt };
      delete platformState.failures[publicationId];
      results.push({ publication_id: publicationId, account_key: accountKey, action: 'captured' });
    } catch (error) {
      const failure = {
        phase: 'capture',
        publication_id: publicationId,
        account_key: accountKey,
        reason: error?.message || String(error),
      };
      failures.push(failure);
      platformState.failures[publicationId] = { ...failure, failed_at: capturedAt };
      results.push({ publication_id: publicationId, account_key: accountKey, action: 'failed' });
    }

    platformState.last_run_at = capturedAt;
    await saveSocialAnalyticsState(options.statePath, state);
    options.onProgress?.({
      processed: index + 1,
      due: dueEntries.length,
      captured: results.filter((result) => result.action === 'captured').length,
      failed: failures.length,
    });
    if (delayMs > 0 && index < dueEntries.length - 1) {
      await (options.sleep || sleep)(delayMs);
    }
  }

  platformState.last_run_at = capturedAt;
  await saveSocialAnalyticsState(options.statePath, state);
  return {
    platform,
    captured_at: capturedAt,
    since_iso: sinceIso,
    target_count: targets.length,
    candidate_count: publications.length,
    due_count: dueEntries.length,
    captured_count: results.filter((result) => result.action === 'captured').length,
    failed_count: failures.length,
    skipped_count: capturePlan.length - dueEntries.length,
    retry_recommended: failures.length > 0,
    state_path: options.statePath,
    results,
    failures,
  };
}

export const SOCIAL_ANALYTICS_PUBLICATION_SELECT = PUBLICATION_SELECT;
