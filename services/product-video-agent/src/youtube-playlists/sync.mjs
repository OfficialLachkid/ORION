import { randomUUID } from 'node:crypto';
import { refreshYoutubeAccessToken } from '../youtube-oauth.mjs';
import { resolvePublicationPlaylistClassification } from './classification.mjs';
import {
  createYoutubePlaylist,
  findYoutubePlaylistByTitle,
  findYoutubePlaylistItem,
  insertYoutubePlaylistItem,
} from './youtube-api.mjs';

const DEFAULT_CONFIGURATION_VERSION = 'youtube-playlists-v1';
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_MINUTES = 30;
const DEFAULT_STALE_CLAIM_MINUTES = 15;

function normalizeToken(value = '') {
  return String(value || '').trim().toLowerCase();
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPublicPublication(publication = {}, liveStatus = null) {
  const livePrivacy = normalizeToken(liveStatus?.privacyStatus);
  if (livePrivacy) return livePrivacy === 'public';
  return normalizeToken(publication.visibility) === 'public'
    && normalizeToken(publication.status) === 'published';
}

export function resolveYoutubePlaylistConfig(channelProfile = {}) {
  const configured = channelProfile?.metadata?.youtube_playlists || {};
  const eligibleChannel = normalizeToken(channelProfile.status) === 'active'
    && normalizeToken(channelProfile.platform) === 'youtube_shorts'
    && Boolean(String(channelProfile?.youtube?.channel_id || '').trim());
  return {
    enabled: eligibleChannel && configured.enabled !== false,
    templatePlaylistsEnabled: configured.template_playlists_enabled !== false,
    difficultyPlaylistsEnabled: configured.difficulty_playlists_enabled !== false,
    privacy: ['public', 'unlisted', 'private'].includes(normalizeToken(configured.privacy))
      ? normalizeToken(configured.privacy)
      : 'public',
    configurationVersion: String(configured.configuration_version || DEFAULT_CONFIGURATION_VERSION).trim(),
    maxAttempts: positiveInteger(configured.max_attempts, DEFAULT_MAX_ATTEMPTS),
    retryMinutes: positiveInteger(configured.retry_minutes, DEFAULT_RETRY_MINUTES),
    staleClaimMinutes: positiveInteger(configured.stale_claim_minutes, DEFAULT_STALE_CLAIM_MINUTES),
  };
}

export function buildYoutubePlaylistTargets({ publication, channelProfile } = {}) {
  const config = resolveYoutubePlaylistConfig(channelProfile);
  const classification = resolvePublicationPlaylistClassification(publication);
  if (!config.enabled || !classification) return [];
  const channelName = String(channelProfile?.name || channelProfile?.account_key || 'this channel').trim();
  const targets = [];
  if (config.templatePlaylistsEnabled) {
    targets.push({
      playlist_key: `template:${classification.template_key}`,
      title: `${classification.template_title} — All Difficulties`,
      description: `All ${classification.template_title} videos published by ${channelName}. Managed automatically by ORION.`,
      privacy: config.privacy,
      configuration_version: config.configurationVersion,
    });
  }
  if (config.difficultyPlaylistsEnabled && classification.difficulty_key) {
    const title = `${classification.difficulty_key[0].toUpperCase()}${classification.difficulty_key.slice(1)} Challenges`;
    targets.push({
      playlist_key: `difficulty:${classification.difficulty_key}`,
      title,
      description: `${title} across video formats published by ${channelName}. Managed automatically by ORION.`,
      privacy: config.privacy,
      configuration_version: config.configurationVersion,
    });
  }
  return targets;
}

function isRetryDue(row, asOfMs) {
  if (row.status === 'pending') return true;
  if (row.status !== 'retry') return false;
  const retryMs = new Date(row.next_retry_at || 0).getTime();
  return !Number.isFinite(retryMs) || retryMs <= asOfMs;
}

function isStaleClaim(row, asOfMs, staleMinutes) {
  if (!['creating', 'processing'].includes(row.status)) return false;
  const claimedMs = new Date(row.claimed_at || 0).getTime();
  return !Number.isFinite(claimedMs)
    || claimedMs <= asOfMs - staleMinutes * 60_000;
}

function nextRetryAt(asOfMs, attemptCount, retryMinutes) {
  const multiplier = Math.min(48, 2 ** Math.max(0, attemptCount - 1));
  return new Date(asOfMs + retryMinutes * multiplier * 60_000).toISOString();
}

function failurePatch(error, attemptCount, config, asOfMs) {
  const finalAttempt = attemptCount >= config.maxAttempts && error?.code !== 'quota_exceeded';
  return {
    status: finalAttempt ? 'review' : 'retry',
    claim_token: null,
    claimed_at: null,
    next_retry_at: finalAttempt ? null : nextRetryAt(asOfMs, attemptCount, config.retryMinutes),
    last_error: String(error?.message || error || 'Unknown YouTube playlist error').slice(0, 1200),
  };
}

async function resolveRegistryEntry({
  store,
  target,
  accountKey,
  accessToken,
  config,
  asOf,
  dependencies,
}) {
  const asOfMs = new Date(asOf).getTime();
  await store.ensureYoutubePlaylistRegistryEntry({
    account_key: accountKey,
    playlist_key: target.playlist_key,
    title: target.title,
    description: target.description,
    privacy: target.privacy,
    configuration_version: target.configuration_version,
    status: 'pending',
  });
  let entry = await store.fetchYoutubePlaylistRegistryEntry(accountKey, target.playlist_key);
  if (!entry) return null;
  if (entry.status === 'active' && entry.youtube_playlist_id) return entry;
  if (isStaleClaim(entry, asOfMs, config.staleClaimMinutes)) {
    entry = await store.updateYoutubePlaylistRegistryEntry(entry.id, {
      status: 'retry', claim_token: null, claimed_at: null, next_retry_at: asOf,
    });
  }
  if (!isRetryDue(entry, asOfMs)) return null;

  const attemptCount = Number(entry.attempt_count || 0) + 1;
  const claimToken = randomUUID();
  const claimed = await store.claimYoutubePlaylistRegistryEntry(entry.id, {
    status: 'creating',
    claim_token: claimToken,
    claimed_at: asOf,
    attempt_count: attemptCount,
    next_retry_at: null,
    last_error: '',
  });
  if (!claimed) {
    const latest = await store.fetchYoutubePlaylistRegistryEntry(accountKey, target.playlist_key);
    return latest?.status === 'active' && latest.youtube_playlist_id ? latest : null;
  }

  try {
    const existing = await dependencies.findYoutubePlaylistByTitleImpl({
      accessToken,
      title: target.title,
    });
    const resolved = existing?.found
      ? existing
      : await dependencies.createYoutubePlaylistImpl({
        accessToken,
        title: target.title,
        description: target.description,
        privacy: target.privacy,
      });
    if (!resolved?.playlistId) throw new Error('YouTube returned no playlist id.');
    return await store.updateYoutubePlaylistRegistryEntry(claimed.id, {
      youtube_playlist_id: resolved.playlistId,
      title: resolved.title || target.title,
      privacy: resolved.privacy || target.privacy,
      configuration_version: target.configuration_version,
      status: 'active',
      claim_token: null,
      claimed_at: null,
      next_retry_at: null,
      last_error: '',
    });
  } catch (error) {
    await store.updateYoutubePlaylistRegistryEntry(claimed.id, failurePatch(
      error, attemptCount, config, asOfMs,
    ));
    return null;
  }
}

async function processAssignment({
  store,
  assignment,
  target,
  publication,
  registryEntry,
  accessToken,
  config,
  asOf,
  dependencies,
}) {
  const asOfMs = new Date(asOf).getTime();
  let current = assignment;
  if (isStaleClaim(current, asOfMs, config.staleClaimMinutes)) {
    current = await store.updateYoutubePlaylistAssignment(current.id, {
      status: 'retry', claim_token: null, claimed_at: null, next_retry_at: asOf,
    });
  }
  if (!isRetryDue(current, asOfMs)) return current;
  const attemptCount = Number(current.attempt_count || 0) + 1;
  const claimed = await store.claimYoutubePlaylistAssignment(current.id, {
    status: 'processing',
    claim_token: randomUUID(),
    claimed_at: asOf,
    attempt_count: attemptCount,
    youtube_playlist_id: registryEntry.youtube_playlist_id,
    next_retry_at: null,
    last_error: '',
  });
  if (!claimed) return current;

  try {
    const inserted = await dependencies.insertYoutubePlaylistItemImpl({
      accessToken,
      playlistId: registryEntry.youtube_playlist_id,
      videoId: publication.external_id,
    });
    if (!inserted?.playlistItemId) throw new Error('YouTube returned no playlist item id.');
    return await store.updateYoutubePlaylistAssignment(claimed.id, {
      status: 'verified',
      youtube_playlist_id: registryEntry.youtube_playlist_id,
      youtube_playlist_item_id: inserted.playlistItemId,
      claim_token: null,
      claimed_at: null,
      next_retry_at: null,
      last_error: '',
      verified_at: asOf,
    });
  } catch (error) {
    if (error?.ambiguous || error?.reason === 'videoAlreadyInPlaylist') {
      try {
        const existing = await dependencies.findYoutubePlaylistItemImpl({
          accessToken,
          playlistId: registryEntry.youtube_playlist_id,
          videoId: publication.external_id,
        });
        if (existing?.found) {
          return await store.updateYoutubePlaylistAssignment(claimed.id, {
            status: 'verified',
            youtube_playlist_id: registryEntry.youtube_playlist_id,
            youtube_playlist_item_id: existing.playlistItemId,
            claim_token: null,
            claimed_at: null,
            next_retry_at: null,
            last_error: '',
            verified_at: asOf,
          });
        }
      } catch { /* retain the original insertion failure */ }
    }
    return await store.updateYoutubePlaylistAssignment(
      claimed.id,
      failurePatch(error, attemptCount, config, asOfMs),
    );
  }
}

function buildSummary(assignments, targets, config, asOf, publication) {
  const expectedKeys = targets.map((target) => target.playlist_key).sort();
  const relevant = assignments.filter((row) => expectedKeys.includes(row.playlist_key));
  const verified = relevant.filter((row) => row.status === 'verified');
  const status = verified.length === expectedKeys.length
    ? 'verified'
    : relevant.some((row) => row.status === 'review') ? 'review' : 'pending';
  return {
    status,
    configuration_version: config.configurationVersion,
    expected_count: expectedKeys.length,
    verified_count: verified.length,
    target_keys: expectedKeys,
    target_signature: expectedKeys.join('|'),
    updated_at: asOf,
    ...(status === 'verified' ? { verified_at: asOf } : {}),
    ...(publication?.metadata?.youtube_playlists?.backfill_classification ? {
      backfill_classification: publication.metadata.youtube_playlists.backfill_classification,
      backfill_receipt: publication.metadata.youtube_playlists.backfill_receipt || {},
    } : {}),
  };
}

function summaryAlreadyVerified(publication, targets, config) {
  const summary = publication?.metadata?.youtube_playlists || {};
  const expected = targets.map((target) => target.playlist_key).sort();
  const stored = Array.isArray(summary.target_keys) ? [...summary.target_keys].sort() : [];
  return summary.status === 'verified'
    && summary.configuration_version === config.configurationVersion
    && (
      summary.target_signature === expected.join('|')
      || JSON.stringify(expected) === JSON.stringify(stored)
    );
}

export async function syncYoutubePlaylistState({
  store,
  publication,
  channelProfile,
  clientConfig,
  refreshToken,
  asOf = new Date().toISOString(),
  liveStatus = null,
} = {}, dependencies = {}) {
  const config = resolveYoutubePlaylistConfig(channelProfile);
  const targets = buildYoutubePlaylistTargets({ publication, channelProfile });
  if (!store || !publication || !config.enabled || targets.length === 0) {
    return { publication, updated: false, status: 'skipped', reason: 'playlist_automation_disabled' };
  }
  if (normalizeToken(publication.account_key) !== normalizeToken(channelProfile.account_key)) {
    return { publication, updated: false, status: 'skipped', reason: 'unsupported_channel' };
  }
  if (!isPublicPublication(publication, liveStatus) || !publication.external_id) {
    return { publication, updated: false, status: 'pending', reason: 'waiting_for_publication' };
  }
  if (summaryAlreadyVerified(publication, targets, config)) {
    return { publication, updated: false, status: 'verified', reason: 'already_verified' };
  }

  await store.ensureYoutubePlaylistAssignments(targets.map((target) => ({
    publication_id: publication.id,
    account_key: channelProfile.account_key,
    playlist_key: target.playlist_key,
    configuration_version: target.configuration_version,
    status: 'pending',
  })));
  let assignments = await store.fetchYoutubePlaylistAssignments(publication.id);
  const assignmentByKey = new Map(assignments.map((row) => [row.playlist_key, row]));
  const asOfMs = new Date(asOf).getTime();
  const hasDueWork = targets.some((target) => {
    const row = assignmentByKey.get(target.playlist_key);
    return row && row.status !== 'verified' && (
      isRetryDue(row, asOfMs) || isStaleClaim(row, asOfMs, config.staleClaimMinutes)
    );
  });

  const deps = {
    refreshYoutubeAccessTokenImpl: dependencies.refreshYoutubeAccessTokenImpl || refreshYoutubeAccessToken,
    createYoutubePlaylistImpl: dependencies.createYoutubePlaylistImpl || createYoutubePlaylist,
    findYoutubePlaylistByTitleImpl: dependencies.findYoutubePlaylistByTitleImpl || findYoutubePlaylistByTitle,
    findYoutubePlaylistItemImpl: dependencies.findYoutubePlaylistItemImpl || findYoutubePlaylistItem,
    insertYoutubePlaylistItemImpl: dependencies.insertYoutubePlaylistItemImpl || insertYoutubePlaylistItem,
  };

  if (hasDueWork) {
    const token = await deps.refreshYoutubeAccessTokenImpl(clientConfig, refreshToken, {
      channelKey: channelProfile.account_key,
      action: 'playlist_assignment',
    });
    for (const target of targets) {
      const assignment = assignmentByKey.get(target.playlist_key);
      if (!assignment || assignment.status === 'verified') continue;
      const registryEntry = await resolveRegistryEntry({
        store,
        target,
        accountKey: channelProfile.account_key,
        accessToken: token.accessToken,
        config,
        asOf,
        dependencies: deps,
      });
      if (!registryEntry?.youtube_playlist_id) continue;
      const updated = await processAssignment({
        store,
        assignment,
        target,
        publication,
        registryEntry,
        accessToken: token.accessToken,
        config,
        asOf,
        dependencies: deps,
      });
      if (updated) assignmentByKey.set(target.playlist_key, updated);
    }
    assignments = [...assignmentByKey.values()];
  }

  const summary = buildSummary(assignments, targets, config, asOf, publication);
  await store.setYoutubePlaylistSummary(publication.id, summary);
  return {
    publication: {
      ...publication,
      metadata: { ...(publication.metadata || {}), youtube_playlists: summary },
    },
    updated: true,
    status: summary.status,
    reason: summary.status === 'verified' ? 'playlist_assignments_verified' : 'playlist_assignments_pending',
    summary,
  };
}
