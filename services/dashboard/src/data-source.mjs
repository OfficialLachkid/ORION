import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadOpsEvents, summarizeOpsEvents } from '../../discord-bot/src/daily-summary.mjs';
import { loadPersistedPendingTasks } from '../../discord-bot/src/pending-task-store.mjs';
import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';

const PUBLICATION_LIMIT = 100;
const DIGITAL_ASSET_PRODUCT_LIMIT = 100;
const LEAD_PAGE_SIZE = 25;
const LEAD_PAGE_SIZE_MAX = 50;
const LEAD_CACHE_ENTRY_LIMIT = 20;

export const LEAD_STATUS_FILTERS = Object.freeze([
  'new',
  'qualified',
  'qualified_no_email',
  'rejected_fit',
  'draft_rejected',
  'sent',
  'responded',
  'bounced',
  'unsubscribed',
  'extraction_error',
]);

export function normalizeLeadQuery(query = {}) {
  const page = Number.parseInt(query.page, 10);
  const pageSize = Number.parseInt(query.pageSize, 10);
  const status = String(query.status || 'all').trim().toLowerCase();
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize)
      ? Math.min(Math.max(pageSize, 1), LEAD_PAGE_SIZE_MAX)
      : LEAD_PAGE_SIZE,
    status: LEAD_STATUS_FILTERS.includes(status) ? status : 'all',
  };
}

function safeJsonFile(filePath, fallback) {
  if (!filePath || !existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    const key = String(row?.[field] || 'unknown');
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function safeDate(value) {
  const parsed = new Date(value || '');
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function sanitizePendingTask(task) {
  return {
    id: String(task?.task_id || ''),
    summary: String(task?.summary || 'Approval required'),
    domain: String(task?.domain || 'general'),
    targetAgent: String(task?.target_agent || ''),
    status: String(task?.status || 'awaiting_approval'),
    reason: String(task?.approval_reason || ''),
    submittedAt: safeDate(task?.submitted_at),
  };
}

function sanitizeHealth(state) {
  const checks = Object.entries(state?.checks || {}).map(([id, check]) => ({
    id,
    severity: ['healthy', 'warning', 'critical'].includes(check?.severity)
      ? check.severity
      : 'unknown',
    state: String(check?.state || 'unknown'),
    summary: String(check?.summary || ''),
  }));
  return {
    updatedAt: safeDate(state?.updatedAt),
    checks,
    overall: checks.some((check) => check.severity === 'critical')
      ? 'critical'
      : checks.some((check) => check.severity === 'warning')
        ? 'warning'
        : checks.length > 0
          ? 'healthy'
          : 'unknown',
  };
}

function sanitizeEvent(event) {
  const payload = event?.payload || {};
  return {
    timestamp: safeDate(event?.timestamp),
    type: String(event?.type || 'unknown_event'),
    status: String(payload.status || payload.outcome || payload.severity || ''),
    domain: String(payload.domain || ''),
    action: String(payload.action || ''),
    taskId: String(payload.taskId || ''),
  };
}

function sanitizePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function loadDigitalAssetsOverview(runtimeConfig) {
  const archiveRoot = String(runtimeConfig.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!archiveRoot || !existsSync(archiveRoot)) {
    return {
      available: false,
      reason: 'The digital-asset archive is not mounted on this runtime.',
      totalProducts: 0,
      totalAssets: 0,
      generatedAssets: 0,
      byStatus: {},
      products: [],
    };
  }

  let entries;
  try {
    entries = readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    return {
      available: false,
      reason: 'The digital-asset archive could not be read.',
      totalProducts: 0,
      totalAssets: 0,
      generatedAssets: 0,
      byStatus: {},
      products: [],
    };
  }

  const products = entries
    .filter((entry) => entry.isDirectory())
    .slice(0, DIGITAL_ASSET_PRODUCT_LIMIT)
    .map((entry) => {
      const productRoot = resolve(archiveRoot, entry.name);
      const product = safeJsonFile(resolve(productRoot, 'product.json'), null);
      if (!product || typeof product !== 'object') return null;
      const assets = Array.isArray(product.assets) ? product.assets : [];
      const release = safeJsonFile(resolve(productRoot, 'review', 'itch-release.json'), null);
      const releasePublic = release?.status === 'verified_public';
      return {
        id: String(product.product_id || entry.name),
        slug: String(product.slug || entry.name),
        title: String(product.title || entry.name),
        version: String(product.version || ''),
        status: String(product.status || 'unknown'),
        category: String(product.category || ''),
        assetCount: assets.length,
        generatedCount: assets.filter((asset) => asset?.status === 'generated').length,
        failedCount: assets.filter((asset) => asset?.status === 'failed').length,
        marketplaces: Array.isArray(product.distribution?.marketplaces)
          ? product.distribution.marketplaces.map(String)
          : [],
        releaseStatus: releasePublic ? 'verified_public' : 'not_public',
        publicUrl: releasePublic
          ? sanitizePublicUrl(release.public_url || release.url || release.itch_url)
          : null,
        updatedAt: safeDate(product.updated_at),
      };
    })
    .filter(Boolean)
    .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));

  return {
    available: true,
    reason: '',
    totalProducts: products.length,
    totalAssets: products.reduce((total, product) => total + product.assetCount, 0),
    generatedAssets: products.reduce((total, product) => total + product.generatedCount, 0),
    byStatus: countBy(products, 'status'),
    products,
  };
}

function summarizeOperations(events, now) {
  const summary = summarizeOpsEvents(events, { now, windowHours: 24 });
  return {
    generatedAt: summary.generatedAt,
    workflowEvents: summary.workflowEvents,
    tasksAwaitingApproval: summary.tasksAwaitingApproval,
    tasksQueued: summary.tasksQueued,
    tasksRunning: summary.tasksRunning,
    executionsCompleted: summary.executionsCompleted,
    executionsFailed: summary.executionsFailed,
    alerts: (summary.alertCountByComponent || []).reduce((total, entry) => total + entry[1], 0),
    recoveries: (summary.recoveryCountByComponent || []).reduce((total, entry) => total + entry[1], 0),
  };
}

function buildModules(sources) {
  return [
    { id: 'overview', label: 'Overview', status: 'available' },
    { id: 'social', label: 'Social Media', status: sources.supabase.available ? 'read_only' : 'unavailable' },
    { id: 'digital-assets', label: 'Digital Assets', status: sources.digitalAssets.available ? 'read_only' : 'unavailable' },
    { id: 'leads', label: 'Lead Operations', status: sources.supabase.available ? 'read_only' : 'unavailable' },
    { id: 'jobs', label: 'Jobs & Scheduling', status: 'planned' },
    { id: 'infrastructure', label: 'Agents & Infrastructure', status: 'planned' },
    { id: 'approvals', label: 'Approvals & Activity', status: 'planned' },
    { id: 'commerce', label: 'E-commerce', status: 'planned' },
    { id: 'settings', label: 'Settings & Security', status: 'planned' },
  ];
}

async function fetchSupabaseRows(config, table, params, fetchImpl) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  config.usage.requests += 1;
  const response = await fetchImpl(url, {
    headers: createSupabaseApiHeaders(config.apiKey),
  });
  if (!response.ok) {
    throw new Error(`Supabase ${table} request failed with status ${response.status}.`);
  }
  const text = await response.text();
  config.usage.responseBytes += Buffer.byteLength(text, 'utf8');
  const rows = text ? JSON.parse(text) : [];
  config.usage.rowsLoaded += Array.isArray(rows) ? rows.length : 0;
  return rows;
}

async function fetchSupabaseCount(config, table, params, fetchImpl) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  config.usage.requests += 1;
  const response = await fetchImpl(url, {
    method: 'HEAD',
    headers: {
      ...createSupabaseApiHeaders(config.apiKey),
      Prefer: 'count=exact',
      Range: '0-0',
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${table} count failed with status ${response.status}.`);
  }
  const match = String(response.headers.get('content-range') || '').match(/\/(\d+)$/u);
  return match ? Number(match[1]) : 0;
}

async function fetchSupabasePage(config, table, params, offset, limit, fetchImpl) {
  const url = new URL(`/rest/v1/${table}`, config.url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  config.usage.requests += 1;
  const response = await fetchImpl(url, {
    headers: {
      ...createSupabaseApiHeaders(config.apiKey),
      Prefer: 'count=exact',
      Range: `${offset}-${offset + limit - 1}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Supabase ${table} page failed with status ${response.status}.`);
  }
  const text = await response.text();
  config.usage.responseBytes += Buffer.byteLength(text, 'utf8');
  const rows = text ? JSON.parse(text) : [];
  config.usage.rowsLoaded += Array.isArray(rows) ? rows.length : 0;
  const match = String(response.headers.get('content-range') || '').match(/\/(\d+)$/u);
  return {
    rows: Array.isArray(rows) ? rows : [],
    total: match ? Number(match[1]) : offset + (Array.isArray(rows) ? rows.length : 0),
  };
}

function sanitizeLead(row) {
  return {
    id: String(row?.id || ''),
    businessName: String(row?.business_name || 'Unnamed lead'),
    businessType: String(row?.business_type || ''),
    sourceUrl: sanitizePublicUrl(row?.source_url),
    niche: String(row?.niche || ''),
    location: String(row?.location || ''),
    status: String(row?.status || 'unknown'),
    createdAt: safeDate(row?.created_at),
  };
}

export async function buildLeadOperations(options) {
  const runtimeConfig = options.runtimeConfig;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const query = normalizeLeadQuery(options.query);
  const env = runtimeConfig.env || {};
  const config = {
    url: String(env.SUPABASE_URL || ''),
    apiKey: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''),
    usage: { requests: 0, rowsLoaded: 0, responseBytes: 0 },
  };
  if (!config.url || !config.apiKey) {
    return {
      generatedAt: new Date(options.now || Date.now()).toISOString(),
      mode: 'read_only',
      available: false,
      reason: 'Server-side Supabase configuration is unavailable.',
      summary: { total: 0, new: 0, filtered: 0 },
      pagination: { ...query, totalPages: 0 },
      leads: [],
      resourceUsage: { supabase: config.usage, policy: 'lazy_bounded_page' },
    };
  }

  const offset = (query.page - 1) * query.pageSize;
  const pagePromise = fetchSupabasePage(config, 'leads', {
    select: 'id,business_name,business_type,source_url,niche,location,status,created_at',
    order: 'created_at.desc',
    limit: query.pageSize,
    status: query.status === 'all' ? '' : `eq.${query.status}`,
  }, offset, query.pageSize, fetchImpl);
  const newCountPromise = fetchSupabaseCount(config, 'leads', {
    select: 'id',
    status: 'eq.new',
  }, fetchImpl);
  const totalCountPromise = query.status === 'all'
    ? null
    : fetchSupabaseCount(config, 'leads', { select: 'id' }, fetchImpl);

  const [pageResult, newCount, separateTotal] = await Promise.all([
    pagePromise,
    newCountPromise,
    totalCountPromise,
  ]);
  const total = query.status === 'all' ? pageResult.total : separateTotal;
  const totalPages = Math.max(1, Math.ceil(pageResult.total / query.pageSize));

  return {
    generatedAt: new Date(options.now || Date.now()).toISOString(),
    mode: 'read_only',
    available: true,
    reason: '',
    summary: {
      total,
      new: newCount,
      filtered: pageResult.total,
    },
    pagination: { ...query, totalPages },
    leads: pageResult.rows.map(sanitizeLead),
    resourceUsage: { supabase: config.usage, policy: 'lazy_bounded_page' },
  };
}

function summarizeChannels(rows) {
  return rows.map((row) => {
    const settings = row?.settings && typeof row.settings === 'object' ? row.settings : {};
    const slots = Array.isArray(settings.schedule_slots) ? settings.schedule_slots : [];
    return {
      id: String(row.id || ''),
      name: String(row.name || row.account_key || 'Unnamed channel'),
      platform: String(row.platform || ''),
      accountKey: String(row.account_key || ''),
      niche: String(row.niche || ''),
      status: String(row.status || 'unknown'),
      scheduleSlots: slots.map(String),
      updatedAt: safeDate(row.updated_at),
    };
  });
}

function summarizePublications(rows, now) {
  const nowMs = new Date(now).getTime();
  const upcoming = rows
    .filter((row) => ['queued', 'scheduled'].includes(row.status))
    .filter((row) => {
      const scheduledMs = new Date(row.scheduled_for || '').getTime();
      return Number.isFinite(scheduledMs) && scheduledMs >= nowMs;
    })
    .sort((left, right) => new Date(left.scheduled_for) - new Date(right.scheduled_for))
    .slice(0, 12)
    .map((row) => ({
      id: String(row.id || ''),
      videoId: String(row.video_id || ''),
      platform: String(row.platform || ''),
      accountKey: String(row.account_key || ''),
      status: String(row.status || ''),
      title: String(row.title || 'Untitled publication'),
      scheduledFor: safeDate(row.scheduled_for),
    }));

  return {
    totalLoaded: rows.length,
    truncated: rows.length >= PUBLICATION_LIMIT,
    byStatus: countBy(rows, 'status'),
    byPlatform: countBy(rows, 'platform'),
    upcoming,
  };
}

async function loadSupabaseOverview(runtimeConfig, fetchImpl, now) {
  const env = runtimeConfig.env || {};
  const config = {
    url: String(env.SUPABASE_URL || ''),
    apiKey: String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || ''),
    usage: { requests: 0, rowsLoaded: 0, responseBytes: 0 },
  };
  if (!config.url || !config.apiKey) {
    return {
      available: false,
      reason: 'Server-side Supabase configuration is unavailable.',
      channels: [],
      publications: { totalLoaded: 0, truncated: false, byStatus: {}, byPlatform: {}, upcoming: [] },
      leads: { totalLoaded: 0, truncated: false, byStatus: {} },
      usage: config.usage,
    };
  }

  const [channels, publications, failedPublications] = await Promise.all([
    fetchSupabaseRows(config, 'video_channels', {
      select: 'id,name,niche,platform,account_key,status,settings,updated_at',
      order: 'name.asc',
      limit: 500,
    }, fetchImpl),
    fetchSupabaseRows(config, 'video_publications', {
      select: 'id,video_id,platform,account_key,status,title,scheduled_for,published_at,updated_at',
      status: 'in.(queued,scheduled)',
      scheduled_for: `gte.${now}`,
      order: 'scheduled_for.asc',
      limit: PUBLICATION_LIMIT,
    }, fetchImpl),
    fetchSupabaseCount(config, 'video_publications', {
      select: 'id',
      status: 'eq.failed',
    }, fetchImpl),
  ]);

  const publicationSummary = summarizePublications(
    Array.isArray(publications) ? publications : [],
    now,
  );
  publicationSummary.byStatus.failed = failedPublications;

  return {
    available: true,
    channels: summarizeChannels(Array.isArray(channels) ? channels : []),
    publications: publicationSummary,
    leads: {
      totalLoaded: 0,
      truncated: false,
      byStatus: {},
      deferred: true,
    },
    usage: config.usage,
  };
}

export async function buildDashboardOverview(options) {
  const runtimeConfig = options.runtimeConfig;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now || new Date().toISOString();

  let events = [];
  let opsAvailable = true;
  try {
    events = loadOpsEvents(runtimeConfig);
  } catch {
    opsAvailable = false;
  }

  let pendingApprovals = [];
  let approvalsAvailable = true;
  try {
    pendingApprovals = loadPersistedPendingTasks(runtimeConfig).map(sanitizePendingTask);
  } catch {
    approvalsAvailable = false;
  }

  const healthState = safeJsonFile(runtimeConfig.runtimePaths.healthMonitorStateFile, null);
  const health = sanitizeHealth(healthState);
  const digitalAssets = loadDigitalAssetsOverview(runtimeConfig);

  let supabase;
  try {
    supabase = await loadSupabaseOverview(runtimeConfig, fetchImpl, now);
  } catch {
    supabase = {
      available: false,
      reason: 'The shared data service could not be reached.',
      channels: [],
      publications: { totalLoaded: 0, truncated: false, byStatus: {}, byPlatform: {}, upcoming: [] },
      leads: { totalLoaded: 0, truncated: false, byStatus: {} },
      usage: { requests: 0, rowsLoaded: 0, responseBytes: 0 },
    };
  }

  const sources = {
    supabase: { available: supabase.available, reason: supabase.reason || '' },
    operations: { available: opsAvailable, reason: opsAvailable ? '' : 'Operational events are unavailable.' },
    approvals: { available: approvalsAvailable, reason: approvalsAvailable ? '' : 'Approval state is unavailable.' },
    health: { available: Boolean(healthState), reason: healthState ? '' : 'No health snapshot has been recorded yet.' },
    digitalAssets: { available: digitalAssets.available, reason: digitalAssets.reason || '' },
  };

  return {
    generatedAt: new Date(now).toISOString(),
    mode: 'read_only',
    coordination: {
      sourceOfTruth: 'ORION runtime state',
      discordRole: 'Primary communication and notification layer',
      dashboardRole: 'Read-only visual management layer',
    },
    modules: buildModules(sources),
    sources,
    health,
    operations: summarizeOperations(events, now),
    pendingApprovals,
    social: {
      channels: supabase.channels,
      publications: supabase.publications,
    },
    leads: supabase.leads,
    digitalAssets,
    resourceUsage: {
      supabase: supabase.usage,
      policy: 'bounded_cached_snapshot',
    },
    recentActivity: events.slice(-20).reverse().map(sanitizeEvent),
  };
}

export class DashboardDataSource {
  constructor(options) {
    this.runtimeConfig = options.runtimeConfig;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.cacheTtlMs = Number(options.cacheTtlSeconds || 30) * 1000;
    this.now = options.now || (() => Date.now());
    this.cached = null;
    this.leadCache = new Map();
  }

  async getOverview(options = {}) {
    const nowMs = this.now();
    if (!options.force && this.cached && this.cached.expiresAt > nowMs) {
      return this.cached.value;
    }
    const value = await buildDashboardOverview({
      runtimeConfig: this.runtimeConfig,
      fetchImpl: this.fetchImpl,
      now: new Date(nowMs).toISOString(),
    });
    this.cached = { value, expiresAt: nowMs + this.cacheTtlMs };
    return value;
  }

  async getLeadOperations(query = {}, options = {}) {
    const normalized = normalizeLeadQuery(query);
    const cacheKey = `${normalized.status}:${normalized.page}:${normalized.pageSize}`;
    const nowMs = this.now();
    const cached = this.leadCache.get(cacheKey);
    if (!options.force && cached && cached.expiresAt > nowMs) {
      return cached.value;
    }
    const value = await buildLeadOperations({
      runtimeConfig: this.runtimeConfig,
      fetchImpl: this.fetchImpl,
      query: normalized,
      now: nowMs,
    });
    this.leadCache.delete(cacheKey);
    this.leadCache.set(cacheKey, { value, expiresAt: nowMs + this.cacheTtlMs });
    if (this.leadCache.size > LEAD_CACHE_ENTRY_LIMIT) {
      this.leadCache.delete(this.leadCache.keys().next().value);
    }
    return value;
  }
}
