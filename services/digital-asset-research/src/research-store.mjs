import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';

function headers(apiKey, prefer = 'return=representation') {
  return createSupabaseApiHeaders(apiKey, {
    'Content-Type': 'application/json',
    Prefer: prefer,
  });
}

export class DigitalAssetResearchStore {
  constructor(options = {}) {
    this.supabaseUrl = String(options.supabaseUrl || '').replace(/\/+$/u, '');
    this.apiKey = String(options.apiKey || '');
    this.fetchImpl = options.fetchImpl || fetch;
    if (!this.supabaseUrl || !this.apiKey) {
      throw new Error('Research persistence requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    }
  }

  async request(table, options = {}) {
    const url = new URL(`/rest/v1/${table}`, this.supabaseUrl);
    for (const [key, value] of Object.entries(options.query || {})) url.searchParams.set(key, value);
    const response = await this.fetchImpl(url, {
      method: options.method || 'GET',
      headers: headers(this.apiKey, options.prefer),
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Supabase research ${table} request failed (${response.status}): ${text}`);
    return text ? JSON.parse(text) : [];
  }

  insertRun(run) {
    return this.request('digital_asset_research_runs', { method: 'POST', body: run });
  }

  updateRun(runId, patch) {
    return this.request('digital_asset_research_runs', {
      method: 'PATCH',
      query: { run_id: `eq.${runId}` },
      body: patch,
    });
  }

  insertObservations(observations) {
    return this.request('digital_asset_research_observations', {
      method: 'POST',
      body: observations,
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
  }

  async countCompletedRuns(sourceId) {
    const rows = await this.request('digital_asset_research_runs', {
      query: {
        select: 'run_id',
        source_id: `eq.${sourceId}`,
        status: 'eq.completed',
      },
    });
    return rows.length;
  }

  listRecentObservations(sourceId, limit = 240) {
    return this.request('digital_asset_research_observations', {
      query: {
        select: '*',
        source_id: `eq.${sourceId}`,
        order: 'observed_at.desc,rank.asc',
        limit: String(limit),
      },
    });
  }

  insertRecommendation(row) {
    return this.request('digital_asset_research_opportunities', {
      method: 'POST',
      body: row,
      prefer: 'resolution=merge-duplicates,return=representation',
      query: { on_conflict: 'recommendation_id' },
    });
  }

  async getRecommendation(recommendationId) {
    const rows = await this.request('digital_asset_research_opportunities', {
      query: { select: '*', recommendation_id: `eq.${recommendationId}`, limit: '1' },
    });
    return rows[0] || null;
  }

  updateRecommendation(recommendationId, patch) {
    return this.request('digital_asset_research_opportunities', {
      method: 'PATCH',
      query: { recommendation_id: `eq.${recommendationId}` },
      body: patch,
    });
  }

  insertReview(row) {
    return this.request('digital_asset_research_reviews', {
      method: 'POST',
      query: { on_conflict: 'discord_interaction_id' },
      prefer: 'resolution=ignore-duplicates,return=representation',
      body: row,
    });
  }
}
