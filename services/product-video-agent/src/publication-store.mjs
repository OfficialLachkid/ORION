import { toVideoChannelRow } from './publication-channels.mjs';
import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';
import { recordSupabaseEgress } from '../../lib/supabase-egress-ledger.mjs';
import { basename } from 'node:path';

export class SupabasePublicationStore {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || '';
    this.apiKey = options.apiKey || '';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.egressLedgerDir = options.egressLedgerDir || '';
    this.telemetryService = options.telemetryService || basename(process.argv[1] || 'product-video-runtime');
  }

  assertConfigured() {
    if (!this.supabaseUrl || !this.apiKey) {
      throw new Error('Supabase publication flow requires SUPABASE_URL and a backend API key.');
    }
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('Supabase publication flow requires fetch support.');
    }
  }

  createHeaders(prefer = '') {
    return createSupabaseApiHeaders(this.apiKey, {
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    });
  }

  createUrl(table, params = {}) {
    const url = new URL(`/rest/v1/${table}`, this.supabaseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
    return url;
  }

  async request(table, options = {}) {
    this.assertConfigured();
    const response = await this.fetchImpl(this.createUrl(table, options.params), {
      method: options.method || 'GET',
      headers: this.createHeaders(options.prefer),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = response.status === 204 ? '' : await response.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    await recordSupabaseEgress({
      ledgerDir: this.egressLedgerDir,
      service: this.telemetryService,
      resource: table,
      queryClass: options.queryClass || `${table}_${String(options.method || 'GET').toLowerCase()}`,
      method: options.method || 'GET',
      response,
      responseText: text,
      body,
    });
    if (!response.ok) {
      const detail = text.slice(0, 600);
      throw new Error(`Supabase ${table} request failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return null;
    return body;
  }

  async upsert(table, rows) {
    if (!Array.isArray(rows) || rows.length === 0) return [];
    return this.request(table, {
      method: 'POST',
      params: { on_conflict: 'id' },
      prefer: 'resolution=merge-duplicates,return=representation',
      body: rows,
    });
  }

  async upsertChannelProfile(channelProfile) {
    const [row] = await this.upsert('video_channels', [toVideoChannelRow(channelProfile)]);
    return row || null;
  }

  async upsertVideo(videoRow) {
    const [row] = await this.upsert('videos', [videoRow]);
    return row || null;
  }

  async upsertPublication(publicationRow) {
    const [row] = await this.upsert('video_publications', [publicationRow]);
    return row || null;
  }

  async fetchVideoById(id) {
    const rows = await this.request('videos', {
      params: {
        select: '*',
        id: `eq.${id}`,
      },
    });
    return rows?.[0] || null;
  }

  async fetchVideosByIds(ids = [], options = {}) {
    const normalizedIds = [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    )];
    if (normalizedIds.length === 0) {
      return [];
    }

    return this.request('videos', {
      params: {
        select: options.select || '*',
        id: `in.(${normalizedIds.map((value) => `"${value}"`).join(',')})`,
      },
    });
  }

  async fetchPublicationById(id) {
    const rows = await this.request('video_publications', {
      params: {
        select: '*',
        id: `eq.${id}`,
      },
    });
    return rows?.[0] || null;
  }

  async fetchPublicationsByIds(ids = [], options = {}) {
    const normalizedIds = [...new Set(
      (Array.isArray(ids) ? ids : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    )];
    if (normalizedIds.length === 0) return [];
    const chunkSize = Math.max(1, Number(options.chunkSize) || 100);
    const rows = [];
    for (let offset = 0; offset < normalizedIds.length; offset += chunkSize) {
      const chunk = normalizedIds.slice(offset, offset + chunkSize);
      rows.push(...await this.request('video_publications', {
        params: {
          select: options.select || '*',
          id: `in.(${chunk.map((value) => `"${value}"`).join(',')})`,
        },
        queryClass: options.queryClass || 'video_publications_by_ids',
      }));
    }
    return rows;
  }

  async fetchPublicationsByChannel({
    platform,
    accountKey,
    order = 'created_at.asc',
    limit = null,
    select = '*',
    status = '',
  }) {
    return this.request('video_publications', {
      params: {
        select,
        platform: `eq.${platform}`,
        account_key: `eq.${accountKey}`,
        status,
        order,
        limit,
      },
    });
  }

  async fetchPublicationsByPlatform({
    platform,
    order = 'created_at.asc',
    limit = null,
    select = '*',
    status = '',
  }) {
    return this.request('video_publications', {
      params: {
        select,
        platform: `eq.${platform}`,
        status,
        order,
        limit,
      },
    });
  }

  async updatePublication(id, patch) {
    const rows = await this.request('video_publications', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        select: '*',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async claimPublicationForUpload(id, patch) {
    const rows = await this.request('video_publications', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        status: 'in.(queued,scheduled)',
        external_id: 'is.null',
        select: '*',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async fetchPublishedPublicationsByChannel({
    platform,
    accountKey,
    order = 'published_at.desc',
    limit = null,
    select = '*',
  }) {
    return this.request('video_publications', {
      params: {
        select,
        platform: `eq.${platform}`,
        account_key: `eq.${accountKey}`,
        status: 'eq.published',
        order,
        limit,
      },
    });
  }

  async fetchYoutubePlaylistBackfillCandidates({ accountKey, limit = 10, cursor = null }) {
    const publishedAt = String(cursor?.published_at || '').trim();
    const publicationId = String(cursor?.publication_id || '').trim();
    const cursorFilter = publishedAt && publicationId
      ? `(published_at.lt.${publishedAt},and(published_at.eq.${publishedAt},id.lt.${publicationId}))`
      : '';
    return this.request('video_publications', {
      params: {
        select: [
          'id',
          'account_key',
          'platform',
          'status',
          'external_id',
          'visibility',
          'published_at',
          'content_surface:metadata->>content_surface',
          'playlist_enabled:metadata->publication_policy->>playlist_enabled',
          'template_id:metadata->>template_id',
          'playlist_template_key:metadata->playlist_classification->>template_key',
          'playlist_template_title:metadata->playlist_classification->>template_title',
          'playlist_difficulty_key:metadata->playlist_classification->>difficulty_key',
          'video_difficulty:metadata->video_signals->variant->>difficulty',
          'youtube_playlist_status:metadata->youtube_playlists->>status',
          'youtube_playlist_configuration_version:metadata->youtube_playlists->>configuration_version',
          'youtube_playlist_target_signature:metadata->youtube_playlists->>target_signature',
          'backfill_template_key:metadata->youtube_playlists->backfill_classification->>template_key',
          'backfill_template_title:metadata->youtube_playlists->backfill_classification->>template_title',
          'backfill_difficulty_key:metadata->youtube_playlists->backfill_classification->>difficulty_key',
        ].join(','),
        platform: 'eq.youtube_shorts',
        account_key: `eq.${accountKey}`,
        status: 'eq.published',
        visibility: 'eq.public',
        external_id: 'not.is.null',
        order: 'published_at.desc,id.desc',
        or: cursorFilter,
        limit,
      },
      queryClass: 'youtube_playlist_backfill_candidates',
    });
  }

  async verifyYoutubePlaylistAutomationSchema() {
    await Promise.all([
      this.request('youtube_playlist_registry', {
        params: { select: 'id', limit: 1 },
        queryClass: 'youtube_playlist_schema_preflight',
      }),
      this.request('youtube_playlist_assignments', {
        params: { select: 'id', limit: 1 },
        queryClass: 'youtube_playlist_schema_preflight',
      }),
    ]);
  }

  async setYoutubePlaylistBackfillClassification(publicationId, classification, receipt) {
    await this.setYoutubePlaylistSummary(publicationId, {
      status: 'pending',
      backfill_classification: classification,
      backfill_receipt: receipt,
    });
  }

  async ensureYoutubePlaylistAssignments(rows = []) {
    if (!Array.isArray(rows) || rows.length === 0) return;
    await this.request('youtube_playlist_assignments', {
      method: 'POST',
      params: { on_conflict: 'publication_id,playlist_key' },
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: rows,
    });
  }

  async fetchYoutubePlaylistAssignments(publicationId) {
    return this.request('youtube_playlist_assignments', {
      params: {
        select: 'id,publication_id,account_key,playlist_key,youtube_playlist_id,youtube_playlist_item_id,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error,verified_at',
        publication_id: `eq.${publicationId}`,
        order: 'created_at.asc',
        limit: 10,
      },
    });
  }

  async claimYoutubePlaylistAssignment(id, patch) {
    const rows = await this.request('youtube_playlist_assignments', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        status: 'in.(pending,retry)',
        select: 'id,publication_id,account_key,playlist_key,youtube_playlist_id,youtube_playlist_item_id,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error,verified_at',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async updateYoutubePlaylistAssignment(id, patch) {
    const rows = await this.request('youtube_playlist_assignments', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        select: 'id,publication_id,account_key,playlist_key,youtube_playlist_id,youtube_playlist_item_id,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error,verified_at',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async ensureYoutubePlaylistRegistryEntry(row) {
    await this.request('youtube_playlist_registry', {
      method: 'POST',
      params: { on_conflict: 'account_key,playlist_key' },
      prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [row],
    });
  }

  async fetchYoutubePlaylistRegistryEntry(accountKey, playlistKey) {
    const rows = await this.request('youtube_playlist_registry', {
      params: {
        select: 'id,account_key,playlist_key,youtube_playlist_id,title,description,privacy,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error',
        account_key: `eq.${accountKey}`,
        playlist_key: `eq.${playlistKey}`,
        limit: 1,
      },
    });
    return rows?.[0] || null;
  }

  async fetchYoutubePlaylistRegistryEntries(accountKey, limit = 100) {
    return this.request('youtube_playlist_registry', {
      params: {
        select: 'id,account_key,playlist_key,youtube_playlist_id,title,description,privacy,configuration_version,status,last_error',
        account_key: `eq.${accountKey}`,
        order: 'created_at.asc',
        limit,
      },
      queryClass: 'youtube_playlist_registry_reconciliation',
    });
  }

  async claimYoutubePlaylistRegistryEntry(id, patch) {
    const rows = await this.request('youtube_playlist_registry', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        status: 'in.(pending,retry)',
        select: 'id,account_key,playlist_key,youtube_playlist_id,title,description,privacy,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async updateYoutubePlaylistRegistryEntry(id, patch) {
    const rows = await this.request('youtube_playlist_registry', {
      method: 'PATCH',
      params: {
        id: `eq.${id}`,
        select: 'id,account_key,playlist_key,youtube_playlist_id,title,description,privacy,configuration_version,status,claim_token,claimed_at,attempt_count,next_retry_at,last_error',
      },
      prefer: 'return=representation',
      body: patch,
    });
    return rows?.[0] || null;
  }

  async setYoutubePlaylistSummary(publicationId, summary) {
    await this.request('rpc/set_youtube_playlist_summary', {
      method: 'POST',
      prefer: 'return=minimal',
      body: {
        p_publication_id: publicationId,
        p_summary: summary,
      },
    });
  }

  async upsertVideoAnalyticsSnapshot(snapshotRow) {
    const rows = await this.request('video_analytics', {
      method: 'POST',
      params: {
        on_conflict: 'publication_id,captured_at',
      },
      prefer: 'resolution=merge-duplicates,return=representation',
      body: [snapshotRow],
    });
    return rows?.[0] || null;
  }

  async fetchLatestAnalyticsSnapshot(publicationId) {
    const rows = await this.request('video_analytics', {
      params: {
        select: '*',
        publication_id: `eq.${publicationId}`,
        order: 'captured_at.desc',
        limit: 1,
      },
    });
    return rows?.[0] || null;
  }

  async fetchAnalyticsSnapshotsByPublicationIds(publicationIds = [], options = {}) {
    const ids = [...new Set(
      (Array.isArray(publicationIds) ? publicationIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    )];
    if (ids.length === 0) {
      return [];
    }

    return this.request('video_analytics', {
      params: {
        select: options.select || '*',
        publication_id: `in.(${ids.map((value) => `"${value}"`).join(',')})`,
        captured_at: options.capturedAfter ? `gte.${options.capturedAfter}` : null,
        order: options.order || 'captured_at.desc',
        limit: options.limit || null,
      },
    });
  }
}
