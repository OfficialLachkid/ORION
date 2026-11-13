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
  'youtube_playlist_backfill_template_key:metadata->youtube_playlists->backfill_classification->>template_key',
  'youtube_playlist_backfill_template_title:metadata->youtube_playlists->backfill_classification->>template_title',
  'youtube_playlist_backfill_difficulty_key:metadata->youtube_playlists->backfill_classification->>difficulty_key',
].join(',');

export const POKE_QUIZZ_RUNTIME_PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'preview_url',
  'public_url',
  'external_id',
  'scheduled_for',
  'uploaded_at',
  'published_at',
  'created_at',
  'updated_at',
  'workflow_state:metadata->>workflow_state',
  'template_id:metadata->>template_id',
  'review_task_id:metadata->>review_task_id',
  'review_message_id:metadata->>review_message_id',
  'review_thread_id:metadata->>review_thread_id',
  'preview_render_path:metadata->>preview_render_path',
  'review_requested_at:metadata->>review_requested_at',
].join(',');

export const SOCIAL_RUNTIME_PUBLICATION_SELECT = [
  'id',
  'video_id',
  'platform',
  'account_key',
  'status',
  'visibility',
  'title',
  'public_url',
  'external_id',
  'scheduled_for',
  'uploaded_at',
  'published_at',
  'created_at',
  'updated_at',
  'workflow_state:metadata->>workflow_state',
  'next_status_poll_at:metadata->>next_status_poll_at',
  'source_publication_id:metadata->>source_publication_id',
  'source_lifecycle_action_required:metadata->source_lifecycle_action_required',
  'source_lifecycle_alert_status:metadata->>source_lifecycle_alert_status',
  'publication_failure_alert_required:metadata->publication_failure_alert_required',
  'publication_failure_alert_status:metadata->>publication_failure_alert_status',
  'publication_failure_alert_fingerprint:metadata->>publication_failure_alert_fingerprint',
  'instagram_auto_comment:metadata->instagram_auto_comment',
  'buffer_create_uncertain:metadata->buffer_create_uncertain',
  'buffer_staging_public_url:metadata->>buffer_staging_public_url',
  'buffer_status:metadata->>buffer_status',
  'publisher_target:metadata->publisher_target',
  'tiktok_direct_post_approval:metadata->tiktok_direct_post_approval',
].join(',');

export const SOCIAL_STAGING_PUBLICATION_SELECT = [
  'id',
  'buffer_staging_object_path:metadata->>buffer_staging_object_path',
  'buffer_staging_removed_at:metadata->>buffer_staging_removed_at',
  'instagram_staging_object_path:metadata->>instagram_staging_object_path',
  'instagram_staging_removed_at:metadata->>instagram_staging_removed_at',
].join(',');

export const SOCIAL_SOURCE_PUBLICATION_SELECT = [
  'id',
  'status',
  'scheduled_for',
  'workflow_state:metadata->>workflow_state',
].join(',');

const PROJECTED_METADATA_FIELDS = Object.freeze([
  'workflow_state',
  'template_id',
  'review_task_id',
  'review_message_id',
  'review_thread_id',
  'preview_render_path',
  'review_requested_at',
  'next_status_poll_at',
  'source_publication_id',
  'source_lifecycle_action_required',
  'source_lifecycle_alert_status',
  'publication_failure_alert_required',
  'publication_failure_alert_status',
  'publication_failure_alert_fingerprint',
  'instagram_auto_comment',
  'buffer_create_uncertain',
  'buffer_staging_public_url',
  'buffer_staging_object_path',
  'buffer_staging_removed_at',
  'buffer_status',
  'publisher_target',
  'tiktok_direct_post_approval',
  'instagram_staging_object_path',
  'instagram_staging_removed_at',
]);

export function isReconciliationStatus(status = '') {
  return ['published', 'withdrawn'].includes(String(status || '').trim().toLowerCase());
}

export function normalizeRuntimePublication(publication = {}) {
  if (publication?._metadata_complete === false) return publication;
  if (publication?.metadata && !publication.workflow_state) return publication;

  const metadata = { ...(publication.metadata || {}) };
  for (const field of PROJECTED_METADATA_FIELDS) {
    if (publication[field] !== undefined && publication[field] !== null) {
      metadata[field] = publication[field];
    }
  }
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
  if (publication.youtube_playlist_status || publication.youtube_playlist_backfill_template_key) {
    metadata.youtube_playlists = {
      status: publication.youtube_playlist_status || '',
      configuration_version: publication.youtube_playlist_configuration_version || '',
      target_signature: publication.youtube_playlist_target_signature || '',
      ...(publication.youtube_playlist_backfill_template_key ? {
        backfill_classification: {
          template_key: publication.youtube_playlist_backfill_template_key,
          template_title: publication.youtube_playlist_backfill_template_title || '',
          difficulty_key: publication.youtube_playlist_backfill_difficulty_key || '',
        },
      } : {}),
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

export async function hydratePublications(store, publications = [], predicate = () => true) {
  return Promise.all((Array.isArray(publications) ? publications : []).map(async (publication) => (
    predicate(publication) ? hydratePublication(store, publication) : publication
  )));
}

export function needsFailureAlertHydration(publication = {}) {
  const metadata = publication.metadata || {};
  return publication._metadata_complete === false
    && metadata.publication_failure_alert_required === true
    && metadata.publication_failure_alert_status !== 'sent';
}

export function needsLifecycleAlertHydration(publication = {}) {
  const metadata = publication.metadata || {};
  return publication._metadata_complete === false
    && metadata.source_lifecycle_action_required === true
    && !['sent', 'resolved'].includes(String(metadata.source_lifecycle_alert_status || ''));
}
