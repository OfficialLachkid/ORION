import { loadRuntimeConfig } from '../../services/lib/runtime-config.mjs';
import {
  createHeaders,
  fetchJson,
  getRuntimeApiKey,
  retryTransientSupabaseOperation,
} from './supabase-bridge-api.mjs';
import { recordSupabaseEgress } from '../../services/lib/supabase-egress-ledger.mjs';

export const DEFAULT_LEADS_TABLE = 'leads';
export const FOLLOW_UP_LEAD_SELECT = 'id,business_name,source_url,niche,domain,contact_email,responded_at,sent_at,qualification';
export const REPLY_DETECTION_LEAD_SELECT = 'id,business_name,responded_at,qualification';

function requestOptions(config, queryClass) {
  return {
    fetchImpl: config.fetchImpl || globalThis.fetch,
    egressTelemetry: {
      ledgerDir: config.egressLedgerDir,
      service: 'leadgen',
      queryClass,
    },
  };
}

export function getLeadgenPersistenceConfig() {
  const runtimeConfig = loadRuntimeConfig();
  const env = runtimeConfig.env || {};

  return {
    supabaseUrl: env.SUPABASE_URL || '',
    apiKey: getRuntimeApiKey(env),
    leadsTable: env.LEADGEN_LEADS_TABLE || DEFAULT_LEADS_TABLE,
    egressLedgerDir: runtimeConfig.runtimePaths?.supabaseEgressLedgerDir || '',
    fetchImpl: globalThis.fetch,
  };
}

export function isLeadgenPersistenceConfigured(config = getLeadgenPersistenceConfig()) {
  return Boolean(config.supabaseUrl && config.apiKey);
}

export async function upsertLeads(rows, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const nextRows = Array.isArray(rows) ? rows.filter((row) => row?.source_url && row?.domain) : [];
  if (nextRows.length < 1) {
    return [];
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('on_conflict', 'domain');

  await fetchJson(url.toString(), {
    ...requestOptions(config, 'lead_upsert'),
    method: 'POST',
    headers: createHeaders(config.apiKey, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(nextRows),
  });
  // The scraper falls back to the submitted row count when no representation
  // is returned, preserving its Discord/runtime totals without downloading rows.
  return null;
}

export async function fetchExistingLeadKeys(config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', 'domain,kvk_number,contact_email,contact_phone,website_quality');
  url.searchParams.set('limit', '10000');

  const rows = await fetchJson(url.toString(), {
    ...requestOptions(config, 'existing_lead_keys'),
    headers: createHeaders(config.apiKey),
  });

  const byDomain = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.domain) {
      byDomain.set(row.domain, row);
    }
  }

  return {
    domains: [...byDomain.keys()],
    kvkNumbers: [...byDomain.values()].map((row) => row.kvk_number).filter(Boolean),
    // Existing values per domain — used so a re-upsert can always carry every
    // optional column (PostgREST bulk upsert requires uniform keys across
    // the whole row array) without a missing new value clobbering a value
    // captured on a previous run.
    byDomain,
  };
}

export async function fetchBlockedDomains(filters = {}, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/blocked_domains', config.supabaseUrl);
  url.searchParams.set('select', 'domain');
  url.searchParams.set('limit', '10000');
  // Optional ordering — the leadgen worker asks for newest-first so the
  // most-recently-blocked domains sit at the top of the file it writes,
  // which is what the search-query `-site:` prefilter reads.
  if (filters.order === 'newest') {
    url.searchParams.set('order', 'created_at.desc');
  } else if (filters.order === 'oldest') {
    url.searchParams.set('order', 'created_at.asc');
  }

  const rows = await fetchJson(url.toString(), {
    ...requestOptions(config, 'blocked_domains'),
    headers: createHeaders(config.apiKey),
  });

  return Array.isArray(rows) ? rows.map((row) => row.domain).filter(Boolean) : [];
}

export async function addBlockedDomain(domain, reason, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL('/rest/v1/blocked_domains', config.supabaseUrl);
  url.searchParams.set('on_conflict', 'domain');

  return fetchJson(url.toString(), {
    ...requestOptions(config, 'blocked_domain_upsert'),
    method: 'POST',
    headers: createHeaders(config.apiKey, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify([{ domain, reason: reason || '' }]),
  });
}

export async function updateLead(id, patch, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('id', `eq.${id}`);

  return retryTransientSupabaseOperation(() => fetchJson(url.toString(), {
    ...requestOptions(config, 'lead_update'),
    method: 'PATCH',
    headers: createHeaders(config.apiKey, {
      Prefer: 'return=minimal',
    }),
    body: JSON.stringify(patch),
  }));
}

// For rows that should never have been leads at all (directory/aggregator
// noise, not a real single business) — distinct from status transitions
// like rejected_fit/extraction_error, which keep the row as an audit trail
// of a real judgment call made about a real business.
export async function deleteLead(id, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('id', `eq.${id}`);

  return fetchJson(url.toString(), {
    ...requestOptions(config, 'lead_delete'),
    method: 'DELETE',
    headers: createHeaders(config.apiKey, {
      Prefer: 'return=minimal',
    }),
  });
}

export async function fetchLeadById(id, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('id', `eq.${id}`);
  url.searchParams.set('limit', '1');

  const rows = await fetchJson(url.toString(), {
    ...requestOptions(config, 'lead_by_id'),
    method: 'GET',
    headers: createHeaders(config.apiKey),
  });
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

// Exact total row count via PostgREST's Content-Range header (Prefer:
// count=exact). Uses a raw fetch because the shared fetchJson helper only
// returns the body, not headers. Returns null on any failure — callers treat
// the count as a display nicety, never a hard dependency.
export async function countLeads(filters = {}, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    return null;
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', 'id');
  url.searchParams.set('limit', '1');
  if (filters.status) {
    url.searchParams.set('status', `eq.${filters.status}`);
  }

  const response = await (config.fetchImpl || globalThis.fetch)(url.toString(), {
    method: 'GET',
    headers: createHeaders(config.apiKey, { Prefer: 'count=exact' }),
  });
  const responseText = await response.text();
  let responseBody = null;
  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }
  await recordSupabaseEgress({
    ledgerDir: config.egressLedgerDir,
    service: 'leadgen',
    queryClass: 'lead_count',
    url: url.toString(),
    method: 'GET',
    response,
    responseText,
    body: responseBody,
  });
  if (!response.ok) {
    return null;
  }
  // Content-Range looks like "0-0/393" (or "*/393"); the total is after the "/".
  const contentRange = response.headers.get('content-range') || '';
  const total = Number.parseInt(contentRange.split('/')[1] || '', 10);
  return Number.isFinite(total) ? total : null;
}

export async function fetchLeads(filters = {}, config = getLeadgenPersistenceConfig()) {
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', filters.select || '*');
  url.searchParams.set('order', filters.order === 'oldest' ? 'created_at.asc' : 'created_at.desc');
  url.searchParams.set('limit', String(filters.limit || 100));
  if (filters.status) {
    url.searchParams.set('status', `eq.${filters.status}`);
  }
  if (filters.niche) {
    url.searchParams.set('niche', `eq.${filters.niche}`);
  }

  return retryTransientSupabaseOperation(() => fetchJson(url.toString(), {
    ...requestOptions(config, filters.queryClass || 'lead_list'),
    headers: createHeaders(config.apiKey),
  }));
}

export async function fetchLeadIds(filters = {}, config = getLeadgenPersistenceConfig()) {
  const rows = await fetchLeads({
    ...filters,
    select: 'id',
    queryClass: filters.queryClass || 'qualification_candidate_ids',
  }, config);
  return (Array.isArray(rows) ? rows : []).map((row) => row?.id).filter(Boolean);
}

export async function fetchLeadsByIds(ids = [], filters = {}, config = getLeadgenPersistenceConfig()) {
  const orderedIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean)));
  if (orderedIds.length === 0) return [];
  if (!isLeadgenPersistenceConfigured(config)) {
    throw new Error('Supabase is not configured (missing SUPABASE_URL or API key).');
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', '*');
  const escaped = orderedIds.map((id) => `"${id.replace(/"/gu, '""')}"`).join(',');
  url.searchParams.set('id', `in.(${escaped})`);
  url.searchParams.set('limit', String(orderedIds.length));
  if (filters.status) url.searchParams.set('status', `eq.${filters.status}`);
  if (filters.niche) url.searchParams.set('niche', `eq.${filters.niche}`);
  const rows = await retryTransientSupabaseOperation(() => fetchJson(url.toString(), {
    ...requestOptions(config, 'qualification_selected_leads'),
    headers: createHeaders(config.apiKey),
  }));
  const byId = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.id), row]));
  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
}

export async function fetchLeadBatch(filters = {}, config = getLeadgenPersistenceConfig()) {
  const limit = Math.max(1, Math.min(Number(filters.limit || 30), 100));
  const ids = await fetchLeadIds({ ...filters, limit }, config);
  return fetchLeadsByIds(ids, filters, config);
}

// Domain-level suppression check for the qualifier's pre-draft gate.
// Given a list of domains, returns the subset that already has at least one
// lead with a suppressed status ('unsubscribed' or 'bounced'). Used to skip
// drafting for a lead whose sibling on the same domain already told us to
// stop. The qualifier calls this once per batch (single query instead of
// per-lead) to keep the loop cheap.
export async function fetchSuppressedDomains(domains = [], config = getLeadgenPersistenceConfig()) {
  const list = Array.from(new Set(
    (Array.isArray(domains) ? domains : [])
      .map((d) => String(d || '').trim().toLowerCase())
      .filter(Boolean),
  ));
  if (list.length === 0 || !isLeadgenPersistenceConfigured(config)) {
    return new Set();
  }

  const url = new URL(`/rest/v1/${config.leadsTable}`, config.supabaseUrl);
  url.searchParams.set('select', 'domain');
  url.searchParams.set('status', 'in.(unsubscribed,bounced)');
  // PostgREST `in.` filter needs the values wrapped in parens, comma-separated.
  const escaped = list.map((d) => `"${d.replace(/"/gu, '""')}"`).join(',');
  url.searchParams.set('domain', `in.(${escaped})`);
  url.searchParams.set('limit', String(list.length));

  const rows = await retryTransientSupabaseOperation(() => fetchJson(url.toString(), {
    ...requestOptions(config, 'suppressed_domains'),
    headers: createHeaders(config.apiKey),
  })).catch(() => []);
  return new Set((Array.isArray(rows) ? rows : [])
    .map((r) => String(r?.domain || '').trim().toLowerCase())
    .filter(Boolean));
}
