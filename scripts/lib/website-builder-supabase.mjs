import { loadRuntimeConfig } from '../../services/lib/runtime-config.mjs';
import {
  createHeaders,
  fetchJson,
  getRuntimeApiKey,
} from './supabase-bridge-api.mjs';

export const DEFAULT_WEBSITE_DESIGNS_TABLE = 'website_designs';
export const DEFAULT_WEBSITES_TABLE = 'websites';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeDraft(value) {
  return value && typeof value === 'object' ? value : {};
}

export function getWebsiteBuilderPersistenceConfig() {
  const runtimeConfig = loadRuntimeConfig();
  const env = runtimeConfig.env || {};

  return {
    supabaseUrl: env.SUPABASE_URL || '',
    apiKey: getRuntimeApiKey(env),
    websiteDesignsTable: env.WEBSITE_BUILDER_DESIGNS_TABLE || DEFAULT_WEBSITE_DESIGNS_TABLE,
    websitesTable: env.WEBSITE_BUILDER_WEBSITES_TABLE || DEFAULT_WEBSITES_TABLE,
  };
}

export function isWebsiteBuilderPersistenceConfigured(config = getWebsiteBuilderPersistenceConfig()) {
  return Boolean(config.supabaseUrl && config.apiKey);
}

function getTableName(kind, config) {
  return kind === 'website' ? config.websitesTable : config.websiteDesignsTable;
}

function getSelectClause(kind) {
  const sharedColumns = 'id,title,summary,template_id,draft,created_at,updated_at';
  if (kind === 'website') {
    return `${sharedColumns},company_name,source_design_id`;
  }

  return sharedColumns;
}

export function mapLibraryEntryToSupabaseRow(kind, entry) {
  const nextKind = kind === 'website' ? 'website' : 'design';

  return {
    id: normalizeText(entry?.id),
    title: normalizeText(entry?.title),
    summary: normalizeText(entry?.summary),
    template_id: normalizeText(entry?.templateId || entry?.draft?.templateId),
    company_name: nextKind === 'website' ? normalizeText(entry?.companyName) : undefined,
    source_design_id: nextKind === 'website' ? normalizeText(entry?.sourceDesignId) || null : undefined,
    draft: normalizeDraft(entry?.draft),
    created_at: normalizeText(entry?.createdAt) || undefined,
    updated_at: normalizeText(entry?.updatedAt) || undefined,
  };
}

export function mapSupabaseRowToLibraryEntry(kind, row) {
  const nextKind = kind === 'website' ? 'website' : 'design';

  return {
    id: normalizeText(row?.id),
    kind: nextKind,
    templateId: normalizeText(row?.template_id || row?.draft?.templateId),
    title: normalizeText(row?.title),
    companyName: nextKind === 'website' ? normalizeText(row?.company_name) : '',
    summary: normalizeText(row?.summary),
    sourceDesignId: nextKind === 'website' ? normalizeText(row?.source_design_id) : '',
    createdAt: normalizeText(row?.created_at),
    updatedAt: normalizeText(row?.updated_at),
    draft: normalizeDraft(row?.draft),
  };
}

export async function fetchWebsiteBuilderEntries(kind, config = getWebsiteBuilderPersistenceConfig()) {
  const nextKind = kind === 'website' ? 'website' : 'design';
  const tableName = getTableName(nextKind, config);
  const url = new URL(`/rest/v1/${tableName}`, config.supabaseUrl);
  url.searchParams.set('select', getSelectClause(nextKind));
  url.searchParams.set('order', 'updated_at.desc');

  const rows = await fetchJson(url.toString(), {
    headers: createHeaders(config.apiKey),
  });

  return Array.isArray(rows)
    ? rows.map((row) => mapSupabaseRowToLibraryEntry(nextKind, row))
    : [];
}

export async function fetchWebsiteBuilderLibrary(config = getWebsiteBuilderPersistenceConfig()) {
  const [designs, websites] = await Promise.all([
    fetchWebsiteBuilderEntries('design', config),
    fetchWebsiteBuilderEntries('website', config),
  ]);

  return { designs, websites };
}

export async function upsertWebsiteBuilderEntries(kind, entries, config = getWebsiteBuilderPersistenceConfig()) {
  const nextKind = kind === 'website' ? 'website' : 'design';
  const nextEntries = Array.isArray(entries)
    ? entries.filter((entry) => normalizeText(entry?.id))
    : [];

  if (nextEntries.length < 1) {
    return fetchWebsiteBuilderLibrary(config);
  }

  const tableName = getTableName(nextKind, config);
  const url = new URL(`/rest/v1/${tableName}`, config.supabaseUrl);
  url.searchParams.set('on_conflict', 'id');

  await fetchJson(url.toString(), {
    method: 'POST',
    headers: createHeaders(config.apiKey, {
      Prefer: 'resolution=merge-duplicates,return=minimal',
    }),
    body: JSON.stringify(nextEntries.map((entry) => mapLibraryEntryToSupabaseRow(nextKind, entry))),
  });

  return fetchWebsiteBuilderLibrary(config);
}
