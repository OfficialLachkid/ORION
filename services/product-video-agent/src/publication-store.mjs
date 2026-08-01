import { toVideoChannelRow } from './publication-channels.mjs';

export class SupabasePublicationStore {
  constructor(options = {}) {
    this.supabaseUrl = options.supabaseUrl || '';
    this.apiKey = options.apiKey || '';
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
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
    return {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    };
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
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 600);
      throw new Error(`Supabase ${table} request failed (${response.status}): ${detail}`);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
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

  async fetchPublicationById(id) {
    const rows = await this.request('video_publications', {
      params: {
        select: '*',
        id: `eq.${id}`,
      },
    });
    return rows?.[0] || null;
  }

  async fetchPublicationsByChannel({
    platform,
    accountKey,
    order = 'created_at.asc',
    limit = null,
  }) {
    return this.request('video_publications', {
      params: {
        select: '*',
        platform: `eq.${platform}`,
        account_key: `eq.${accountKey}`,
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
}
