import { SupabasePublicationStore } from './publication-store.mjs';

export const DEFAULT_SOCIAL_PUBLICATION_MAX_LATENESS_HOURS = 24;

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

export function resolveSocialPublicationMaxLatenessHours(env = {}) {
  const configured = Number(env.SOCIAL_PUBLICATION_MAX_LATENESS_HOURS);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_SOCIAL_PUBLICATION_MAX_LATENESS_HOURS;
}

export function isSocialPublicationPastDeliveryWindow(
  scheduledFor,
  asOf,
  maxLatenessHours = DEFAULT_SOCIAL_PUBLICATION_MAX_LATENESS_HOURS,
) {
  const scheduledAt = normalizeSocialText(scheduledFor);
  const scheduledAtMs = new Date(scheduledAt).getTime();
  const asOfMs = new Date(normalizeSocialText(asOf)).getTime();
  const latenessHours = Number(maxLatenessHours);
  if (
    !scheduledAt
    || !Number.isFinite(scheduledAtMs)
    || !Number.isFinite(asOfMs)
    || !Number.isFinite(latenessHours)
    || latenessHours < 0
  ) {
    return false;
  }
  return asOfMs - scheduledAtMs > latenessHours * 60 * 60 * 1000;
}

export function resolveSocialUploadAction(
  publication,
  asOf,
  maxLatenessHours = DEFAULT_SOCIAL_PUBLICATION_MAX_LATENESS_HOURS,
) {
  if (isSocialPublicationPastDeliveryWindow(
    publication?.scheduled_for,
    asOf,
    maxLatenessHours,
  )) {
    return 'expire';
  }
  return isSocialPublicationDueAt(publication?.scheduled_for, asOf) ? 'upload' : '';
}

export function buildSocialMissedWindowPatch(
  publication,
  asOf,
  maxLatenessHours = DEFAULT_SOCIAL_PUBLICATION_MAX_LATENESS_HOURS,
) {
  return {
    status: 'withdrawn',
    scheduled_for: null,
    metadata: buildSocialMetadataPatch(publication, {
      workflow_state: 'withdrawn',
      delivery_expired_at: asOf,
      delivery_expiry_reason: 'missed_delivery_window',
      delivery_expired_scheduled_for: normalizeSocialText(publication?.scheduled_for),
      delivery_max_lateness_hours: maxLatenessHours,
    }),
  };
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
