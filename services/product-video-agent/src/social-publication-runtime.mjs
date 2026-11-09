import { SupabasePublicationStore } from './publication-store.mjs';

export function normalizeSocialText(value) {
  return String(value || '').trim();
}

export function normalizeSocialBoolean(value) {
  return ['1', 'true', 'yes', 'on'].includes(normalizeSocialText(value).toLowerCase());
}

export function normalizeSocialWorkflowState(publication = {}) {
  return normalizeSocialText(
    publication.metadata?.workflow_state || publication.status,
  ).toLowerCase();
}

export function isSocialPublicationDueAt(value, asOf) {
  const timestamp = normalizeSocialText(value);
  return !timestamp || new Date(timestamp).getTime() <= new Date(asOf).getTime();
}

export function limitSocialItems(items, limit) {
  const count = Number(limit);
  return Number.isFinite(count) && count > 0 ? items.slice(0, Math.floor(count)) : items;
}

export function nextSocialStatusPollAt(asOf, delayMinutes = 4) {
  const date = new Date(asOf);
  return Number.isNaN(date.getTime())
    ? ''
    : new Date(date.getTime() + delayMinutes * 60 * 1000).toISOString();
}

export function createSocialPublicationStore(config, telemetryService = '') {
  return new SupabasePublicationStore({
    supabaseUrl: config?.env?.SUPABASE_URL || '',
    apiKey: config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '',
    egressLedgerDir: config?.runtimePaths?.supabaseEgressLedgerDir,
    telemetryService: telemetryService || undefined,
  });
}

export function buildSocialMetadataPatch(publication, patch = {}) {
  return { ...(publication.metadata || {}), ...patch };
}
