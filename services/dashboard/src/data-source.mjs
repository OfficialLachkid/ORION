import { existsSync, readFileSync } from 'node:fs';
import { loadOpsEvents, summarizeOpsEvents } from '../../discord-bot/src/daily-summary.mjs';
import { loadPersistedPendingTasks } from '../../discord-bot/src/pending-task-store.mjs';
import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';

const SOURCE_LIMIT = 5_000;

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
    { id: 'leads', label: 'Lead Operations', status: sources.supabase.available ? 'read_only' : 'unavailable' },
    { id: 'jobs', label: 'Jobs & Scheduling', status: 'planned' },
    { id: 'infrastructure', label: 'Agents & Infrastructure', status: 'planned' },
    { id: 'approvals', label: 'Approvals & Activity', status: 'read_only' },
    { id: 'digital-assets', label: 'Digital Assets', status: 'planned' },
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
  const response = await fetchImpl(url, {
    headers: createSupabaseApiHeaders(config.apiKey),
  });
  if (!response.ok) {
    throw new Error(`Supabase ${table} request failed with status ${response.status}.`);
  }
  return response.json();
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
    truncated: rows.length >= SOURCE_LIMIT,
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
  };
  if (!config.url || !config.apiKey) {
    return {
      available: false,
      reason: 'Server-side Supabase configuration is unavailable.',
      channels: [],
      publications: { totalLoaded: 0, truncated: false, byStatus: {}, byPlatform: {}, upcoming: [] },
      leads: { totalLoaded: 0, truncated: false, byStatus: {} },
    };
  }

  const [channels, publications, leads] = await Promise.all([
    fetchSupabaseRows(config, 'video_channels', {
      select: 'id,name,niche,platform,account_key,status,settings,updated_at',
      order: 'name.asc',
      limit: 500,
    }, fetchImpl),
    fetchSupabaseRows(config, 'video_publications', {
      select: 'id,video_id,platform,account_key,status,title,scheduled_for,published_at,updated_at',
      order: 'updated_at.desc',
      limit: SOURCE_LIMIT,
    }, fetchImpl),
    fetchSupabaseRows(config, 'leads', {
      select: 'id,status,created_at,qualified_at',
      order: 'created_at.desc',
      limit: SOURCE_LIMIT,
    }, fetchImpl),
  ]);

  return {
    available: true,
    channels: summarizeChannels(Array.isArray(channels) ? channels : []),
    publications: summarizePublications(Array.isArray(publications) ? publications : [], now),
    leads: {
      totalLoaded: Array.isArray(leads) ? leads.length : 0,
      truncated: Array.isArray(leads) && leads.length >= SOURCE_LIMIT,
      byStatus: countBy(Array.isArray(leads) ? leads : [], 'status'),
    },
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
    };
  }

  const sources = {
    supabase: { available: supabase.available, reason: supabase.reason || '' },
    operations: { available: opsAvailable, reason: opsAvailable ? '' : 'Operational events are unavailable.' },
    approvals: { available: approvalsAvailable, reason: approvalsAvailable ? '' : 'Approval state is unavailable.' },
    health: { available: Boolean(healthState), reason: healthState ? '' : 'No health snapshot has been recorded yet.' },
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
}

