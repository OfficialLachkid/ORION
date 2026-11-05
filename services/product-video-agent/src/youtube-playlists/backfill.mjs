import {
  buildPlaylistTemplateTitle,
  normalizePlaylistDifficulty,
  normalizePlaylistTemplateKey,
} from './classification.mjs';
import {
  buildYoutubePlaylistTargets,
  resolveYoutubePlaylistConfig,
  syncYoutubePlaylistState,
} from './sync.mjs';

export const DEFAULT_PLAYLIST_BACKFILL_LIMIT = 10;
export const MAX_PLAYLIST_BACKFILL_LIMIT = 25;

function normalizeToken(value = '') {
  return String(value || '').trim().toLowerCase();
}

function parseStoredBoolean(value, fallback = true) {
  const normalized = normalizeToken(value);
  if (!normalized) return fallback;
  return normalized !== 'false';
}

export function normalizePlaylistBackfillLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PLAYLIST_BACKFILL_LIMIT;
  return Math.min(parsed, MAX_PLAYLIST_BACKFILL_LIMIT);
}

export function deriveLegacyPlaylistClassification(row = {}) {
  if (normalizeToken(row.status) !== 'published' || normalizeToken(row.visibility) !== 'public') {
    return { classification: null, reason: 'publication_not_public' };
  }
  if (!String(row.external_id || '').trim()) {
    return { classification: null, reason: 'youtube_video_id_missing' };
  }
  const contentSurface = normalizeToken(row.content_surface || 'youtube_shorts');
  if (contentSurface !== 'youtube_shorts') {
    return { classification: null, reason: 'content_surface_not_youtube_shorts' };
  }
  if (!parseStoredBoolean(row.playlist_enabled, true)) {
    return { classification: null, reason: 'playlist_automation_disabled' };
  }

  const templateId = String(row.template_id || '').trim();
  const storedTemplateKey = row.playlist_template_key || row.backfill_template_key;
  const templateKey = normalizePlaylistTemplateKey(storedTemplateKey || templateId);
  if (!templateKey) {
    return { classification: null, reason: 'template_id_missing' };
  }
  const difficultyKey = normalizePlaylistDifficulty(
    row.playlist_difficulty_key || row.backfill_difficulty_key || row.video_difficulty,
  );
  return {
    classification: {
      schema_version: 'youtube-playlist-classification-v1',
      template_key: templateKey,
      template_title: buildPlaylistTemplateTitle(
        templateId || templateKey,
        row.playlist_template_title || row.backfill_template_title,
      ),
      ...(difficultyKey ? { difficulty_key: difficultyKey } : {}),
    },
    reason: storedTemplateKey ? 'stored_classification' : 'legacy_classification_derived',
  };
}

export function hydratePlaylistBackfillPublication(row = {}, classification = null) {
  const backfillClassification = classification || ((row.backfill_template_key || row.playlist_template_key) ? {
    template_key: row.backfill_template_key || row.playlist_template_key,
    template_title: row.backfill_template_title || row.playlist_template_title || '',
    difficulty_key: row.backfill_difficulty_key || row.playlist_difficulty_key || '',
  } : null);
  const playlistSummary = {
    status: String(row.youtube_playlist_status || '').trim(),
    configuration_version: String(row.youtube_playlist_configuration_version || '').trim(),
    target_signature: String(row.youtube_playlist_target_signature || '').trim(),
    ...(backfillClassification ? { backfill_classification: backfillClassification } : {}),
  };
  return {
    ...row,
    metadata: {
      content_surface: String(row.content_surface || 'youtube_shorts').trim(),
      publication_policy: {
        playlist_enabled: parseStoredBoolean(row.playlist_enabled, true),
      },
      template_id: String(row.template_id || '').trim(),
      ...(classification ? { playlist_classification: classification } : {}),
      ...((playlistSummary.status || backfillClassification)
        ? { youtube_playlists: playlistSummary }
        : {}),
    },
  };
}

function targetSignature(targets = []) {
  return targets.map((target) => target.playlist_key).sort().join('|');
}

function alreadyVerified(row, targets, configurationVersion) {
  return normalizeToken(row.youtube_playlist_status) === 'verified'
    && String(row.youtube_playlist_configuration_version || '') === configurationVersion
    && String(row.youtube_playlist_target_signature || '') === targetSignature(targets);
}

export function planYoutubePlaylistBackfill({ rows = [], channelProfile, limit } = {}) {
  const boundedLimit = normalizePlaylistBackfillLimit(limit);
  const config = resolveYoutubePlaylistConfig(channelProfile);
  const selectedRows = (Array.isArray(rows) ? rows : []).slice(0, boundedLimit);
  const items = [];
  const skipped = [];

  for (const row of selectedRows) {
    if (normalizeToken(row.account_key) !== normalizeToken(channelProfile?.account_key)) {
      skipped.push({ publication_id: row.id, reason: 'channel_scope_mismatch' });
      continue;
    }
    const { classification, reason } = deriveLegacyPlaylistClassification(row);
    if (!classification) {
      skipped.push({ publication_id: row.id, reason });
      continue;
    }
    const publication = hydratePlaylistBackfillPublication(row, classification);
    const targets = buildYoutubePlaylistTargets({ publication, channelProfile });
    if (targets.length === 0) {
      skipped.push({ publication_id: row.id, reason: 'no_playlist_targets' });
      continue;
    }
    items.push({
      publication,
      classification,
      classification_source: reason,
      targets,
      already_verified: alreadyVerified(row, targets, config.configurationVersion),
    });
  }

  const pending = items.filter((item) => !item.already_verified);
  const uniquePlaylistKeys = [...new Set(pending.flatMap((item) => (
    item.targets.map((target) => target.playlist_key)
  )))];
  const assignmentCount = pending.reduce((total, item) => total + item.targets.length, 0);
  return {
    account_key: channelProfile?.account_key || '',
    dry_run: true,
    requested_limit: limit ?? DEFAULT_PLAYLIST_BACKFILL_LIMIT,
    effective_limit: boundedLimit,
    rows_examined: selectedRows.length,
    eligible_videos: items.length,
    pending_videos: pending.length,
    already_verified_videos: items.length - pending.length,
    skipped,
    unique_playlist_keys: uniquePlaylistKeys,
    estimated_playlist_creates_upper_bound: uniquePlaylistKeys.length,
    estimated_assignment_inserts: assignmentCount,
    estimated_write_quota_units_upper_bound:
      (uniquePlaylistKeys.length + assignmentCount) * 50,
    items,
  };
}

export async function executeYoutubePlaylistBackfill({
  store,
  rows = [],
  channelProfile,
  clientConfig,
  refreshToken,
  limit,
  apply = false,
  asOf = new Date().toISOString(),
} = {}, dependencies = {}) {
  const plan = planYoutubePlaylistBackfill({ rows, channelProfile, limit });
  if (!apply) return plan;
  if (plan.pending_videos === 0) {
    return { ...plan, dry_run: false, applied_at: asOf, results: [] };
  }
  await store.verifyYoutubePlaylistAutomationSchema();

  const syncImpl = dependencies.syncYoutubePlaylistStateImpl || syncYoutubePlaylistState;
  const results = [];
  for (const item of plan.items) {
    if (item.already_verified) {
      results.push({ publication_id: item.publication.id, status: 'verified', reason: 'already_verified' });
      continue;
    }

    const receipt = {
      source: 'bounded_operator_backfill',
      account_key: channelProfile.account_key,
      classified_at: asOf,
    };
    await store.setYoutubePlaylistBackfillClassification(
      item.publication.id,
      item.classification,
      receipt,
    );
    const syncResult = await syncImpl({
      store,
      publication: item.publication,
      channelProfile,
      clientConfig,
      refreshToken,
      asOf,
    }, {
      ...(dependencies.refreshYoutubeAccessTokenImpl
        ? { refreshYoutubeAccessTokenImpl: dependencies.refreshYoutubeAccessTokenImpl }
        : {}),
    });
    results.push({
      publication_id: item.publication.id,
      status: syncResult.status,
      reason: syncResult.reason,
      summary: syncResult.summary || null,
    });
  }

  return {
    ...plan,
    dry_run: false,
    applied_at: asOf,
    results,
  };
}
