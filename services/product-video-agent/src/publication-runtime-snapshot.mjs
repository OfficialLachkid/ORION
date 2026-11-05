import { readFileSync } from 'node:fs';

export const ACTIVE_RUNTIME_EXCLUDED_STATUSES = 'published,withdrawn,deleted,failed,blocked';
export const RECONCILIATION_RUNTIME_STATUSES = 'published,withdrawn';

export const ACTIVE_RUNTIME_PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'visibility',
  'title',
  'description',
  'hashtags',
  'disclosure',
  'preview_url',
  'public_url',
  'external_id',
  'scheduled_for',
  'uploaded_at',
  'published_at',
  'created_at',
  'updated_at',
  'workflow_state:metadata->>workflow_state',
].join(',');

export const RECONCILIATION_RUNTIME_PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'visibility',
  'preview_url',
  'public_url',
  'external_id',
  'scheduled_for',
  'uploaded_at',
  'published_at',
  'created_at',
  'updated_at',
  'workflow_state:metadata->>workflow_state',
  'youtube_auto_comment_status:metadata->youtube_auto_comment->>status',
  'youtube_auto_comment_comment_id:metadata->youtube_auto_comment->>comment_id',
  'content_surface:metadata->>content_surface',
  'template_id:metadata->>template_id',
  'playlist_enabled:metadata->publication_policy->>playlist_enabled',
  'playlist_template_key:metadata->playlist_classification->>template_key',
  'playlist_template_title:metadata->playlist_classification->>template_title',
  'playlist_difficulty_key:metadata->playlist_classification->>difficulty_key',
  'playlist_signal_difficulty:metadata->video_signals->variant->>difficulty',
  'youtube_playlist_status:metadata->youtube_playlists->>status',
  'youtube_playlist_configuration_version:metadata->youtube_playlists->>configuration_version',
  'youtube_playlist_target_signature:metadata->youtube_playlists->>target_signature',
].join(',');

export function isReconciliationStatus(status = '') {
  return ['published', 'withdrawn'].includes(String(status || '').trim().toLowerCase());
}

export function normalizeRuntimePublication(publication = {}) {
  if (publication?._metadata_complete === false) return publication;
  if (publication?.metadata && !publication.workflow_state) return publication;

  const metadata = { ...(publication.metadata || {}) };
  if (publication.workflow_state) metadata.workflow_state = publication.workflow_state;
  if (publication.youtube_auto_comment_status || publication.youtube_auto_comment_comment_id) {
    metadata.youtube_auto_comment = {
      status: publication.youtube_auto_comment_status || '',
      comment_id: publication.youtube_auto_comment_comment_id || '',
    };
  }
  if (publication.content_surface) metadata.content_surface = publication.content_surface;
  if (publication.template_id) metadata.template_id = publication.template_id;
  if (publication.playlist_enabled) {
    metadata.publication_policy = {
      ...(metadata.publication_policy || {}),
      playlist_enabled: String(publication.playlist_enabled).toLowerCase() !== 'false',
    };
  }
  if (publication.playlist_template_key) {
    metadata.playlist_classification = {
      template_key: publication.playlist_template_key,
      template_title: publication.playlist_template_title || '',
      difficulty_key: publication.playlist_difficulty_key || '',
    };
  }
  if (publication.playlist_signal_difficulty) {
    metadata.video_signals = {
      variant: { difficulty: publication.playlist_signal_difficulty },
    };
  }
  if (publication.youtube_playlist_status) {
    metadata.youtube_playlists = {
      status: publication.youtube_playlist_status,
      configuration_version: publication.youtube_playlist_configuration_version || '',
      target_signature: publication.youtube_playlist_target_signature || '',
    };
  }
  return {
    ...publication,
    metadata,
    _metadata_complete: Boolean(publication.metadata),
  };
}

export function loadPublicationSnapshot(snapshotPath = '') {
  const normalizedPath = String(snapshotPath || '').trim();
  if (!normalizedPath) return null;
  const parsed = JSON.parse(readFileSync(normalizedPath, 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error('Publication snapshot must contain a JSON array.');
  }
  return parsed.map(normalizeRuntimePublication);
}

export async function hydratePublication(store, publication) {
  if (!publication || publication._metadata_complete !== false) return publication;
  if (typeof store?.fetchPublicationById !== 'function') return publication;
  return await store.fetchPublicationById(publication.id) || publication;
}
