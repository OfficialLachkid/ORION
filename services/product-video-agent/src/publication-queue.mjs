import { normalizeScheduleSlots } from './publication-channels.mjs';
import { selectRelatedPublicationCandidate as selectGenericRelatedPublicationCandidate } from './related-video/selector.mjs';

export const DEFAULT_MINIMUM_SCHEDULE_LEAD_MINUTES = 20;
export const DEFAULT_SCHEDULE_PUBLISH_GRACE_MINUTES = 30;

function asDate(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  return parsed;
}

function toIsoString(value) {
  return asDate(value).toISOString();
}

function workflowState(publication = {}) {
  if (publication.metadata?.workflow_state) {
    return String(publication.metadata.workflow_state).trim();
  }
  if (publication.status === 'published') return 'published';
  if (publication.status === 'withdrawn') return 'withdrawn';
  if (publication.status === 'deleted') return 'deleted';
  if (publication.status === 'failed') return 'failed';
  if (publication.status === 'blocked') return 'blocked';
  if (publication.preview_url) return 'preview_uploaded';
  return 'preview_upload_pending';
}

function matchesChannel(publication, channelProfile) {
  return publication.platform === channelProfile.platform
    && publication.account_key === channelProfile.account_key;
}

function isActivePublication(publication) {
  return publication.status !== 'deleted'
    && publication.status !== 'blocked'
    && publication.status !== 'failed'
    && publication.status !== 'withdrawn'
    && publication.status !== 'published';
}

function hasScheduledSlot(publication) {
  const scheduledFor = String(publication?.scheduled_for || '').trim();
  return Boolean(scheduledFor);
}

export function hasCommittedScheduledSlot(
  publication,
  asOf = new Date(),
  graceMinutes = DEFAULT_SCHEDULE_PUBLISH_GRACE_MINUTES,
) {
  const scheduledFor = String(publication?.scheduled_for || '').trim();
  if (!scheduledFor) {
    return false;
  }
  const scheduledAtMs = asDate(scheduledFor).getTime();
  const asOfMs = asDate(asOf).getTime();
  if (scheduledAtMs >= asOfMs) {
    return true;
  }

  const normalizedGraceMinutes = Number(graceMinutes);
  const graceMs = Number.isFinite(normalizedGraceMinutes) && normalizedGraceMinutes > 0
    ? normalizedGraceMinutes * 60_000
    : 0;
  return scheduledAtMs + graceMs > asOfMs;
}

function getTimeZoneParts(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(byType.year),
    month: Number(byType.month),
    day: Number(byType.day),
    hour: Number(byType.hour),
    minute: Number(byType.minute),
    second: Number(byType.second),
  };
}

function getTimeZoneOffsetMs(date, timeZone) {
  const parts = getTimeZoneParts(date, timeZone);
  const zoneLocalAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  return zoneLocalAsUtc - date.getTime();
}

function zonedDateTimeToUtc({ year, month, day, hour, minute }, timeZone) {
  const utcGuessMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstGuess = new Date(utcGuessMs);
  const firstOffset = getTimeZoneOffsetMs(firstGuess, timeZone);
  const corrected = new Date(utcGuessMs - firstOffset);
  const correctedOffset = getTimeZoneOffsetMs(corrected, timeZone);
  if (correctedOffset === firstOffset) {
    return corrected;
  }
  return new Date(utcGuessMs - correctedOffset);
}

function sortByOldestFirst(items) {
  return [...items].sort((left, right) => {
    const leftTime = asDate(left.created_at || left.updated_at || left.scheduled_for || left.uploaded_at || left.published_at || '1970-01-01T00:00:00.000Z').getTime();
    const rightTime = asDate(right.created_at || right.updated_at || right.scheduled_for || right.uploaded_at || right.published_at || '1970-01-01T00:00:00.000Z').getTime();
    return leftTime - rightTime;
  });
}

export function selectPreviewUploadCandidates(publications, channelProfile) {
  return sortByOldestFirst(
    publications.filter((publication) => (
      matchesChannel(publication, channelProfile)
      && workflowState(publication) === 'preview_upload_pending'
      && isActivePublication(publication)
    )),
  );
}

export function listCommittedScheduledPublications(publications, channelProfile, asOf = new Date()) {
  return sortScheduledByTime(
    publications.filter((publication) => (
      matchesChannel(publication, channelProfile)
      && workflowState(publication) === 'scheduled'
      && isActivePublication(publication)
      && hasCommittedScheduledSlot(publication, asOf)
    )),
  );
}

export function listTrackedScheduledPublications(publications, channelProfile) {
  return sortScheduledByTime(
    publications.filter((publication) => (
      matchesChannel(publication, channelProfile)
      && workflowState(publication) === 'scheduled'
      && isActivePublication(publication)
      && hasScheduledSlot(publication)
    )),
  );
}

export function listTrackedPublishedPublications(publications, channelProfile) {
  return sortByOldestFirst(
    publications.filter((publication) => (
      matchesChannel(publication, channelProfile)
      && ['published', 'withdrawn'].includes(workflowState(publication))
      && Boolean(String(publication?.external_id || '').trim())
    )),
  );
}

export function selectScheduleCandidates(publications, channelProfile, asOf = new Date()) {
  return sortByOldestFirst(
    publications.filter((publication) => (
      matchesChannel(publication, channelProfile)
      && ['preview_approved', 'queued', 'scheduled'].includes(workflowState(publication))
      && isActivePublication(publication)
      && (
        workflowState(publication) !== 'scheduled'
        || !hasCommittedScheduledSlot(publication, asOf)
      )
    )),
  );
}

function nextSlotAfter(referenceDate, slots, timeZone = 'UTC') {
  const sortedSlots = normalizeScheduleSlots(slots);
  const zonedReference = getTimeZoneParts(referenceDate, timeZone);

  for (let dayOffset = 0; dayOffset < 32; dayOffset += 1) {
    const daySeed = zonedDateTimeToUtc({
      year: zonedReference.year,
      month: zonedReference.month,
      day: zonedReference.day + dayOffset,
      hour: 0,
      minute: 0,
    }, timeZone);
    const zonedDay = getTimeZoneParts(daySeed, timeZone);
    for (const slot of sortedSlots) {
      const candidate = zonedDateTimeToUtc({
        year: zonedDay.year,
        month: zonedDay.month,
        day: zonedDay.day,
        hour: slot.hour,
        minute: slot.minute,
      }, timeZone);
      if (candidate.getTime() > referenceDate.getTime()) {
        return candidate;
      }
    }
  }

  throw new Error('Could not resolve a publication slot within 32 days.');
}

function nextAvailableSlotAfter(referenceDate, slots, occupiedSlotKeys, timeZone = 'UTC') {
  let cursor = asDate(referenceDate);
  for (let attempt = 0; attempt < 128; attempt += 1) {
    const candidate = nextSlotAfter(cursor, slots, timeZone);
    const candidateKey = toIsoString(candidate);
    if (!occupiedSlotKeys.has(candidateKey)) {
      return candidate;
    }
    cursor = new Date(candidate.getTime() + 60_000);
  }
  throw new Error('Could not resolve an unoccupied publication slot within 128 attempts.');
}

function sortScheduledByTime(items) {
  return [...items].sort((left, right) => asDate(left.scheduled_for).getTime() - asDate(right.scheduled_for).getTime());
}

function applyMinimumScheduleLead(referenceDate, minimumLeadMinutes = DEFAULT_MINIMUM_SCHEDULE_LEAD_MINUTES) {
  const leadMinutes = Number(minimumLeadMinutes);
  const leadMs = Number.isFinite(leadMinutes) && leadMinutes > 0
    ? leadMinutes * 60_000
    : 0;
  return new Date(asDate(referenceDate).getTime() + leadMs);
}

export function assignScheduleSlots(
  publications,
  channelProfile,
  asOf = new Date(),
  occupiedPublications = [],
  options = {},
) {
  const occupiedSlotKeys = new Set(
    occupiedPublications
      .map((publication) => String(publication?.scheduled_for || '').trim())
      .filter(Boolean)
      .map((value) => toIsoString(value)),
  );
  const scheduled = [];
  let cursor = applyMinimumScheduleLead(
    asOf,
    options.minimumLeadMinutes ?? DEFAULT_MINIMUM_SCHEDULE_LEAD_MINUTES,
  );
  for (const publication of publications) {
    const scheduledFor = nextAvailableSlotAfter(
      cursor,
      channelProfile.schedule_slots,
      occupiedSlotKeys,
      channelProfile.timezone || 'UTC',
    );
    const scheduledForIso = toIsoString(scheduledFor);
    scheduled.push({
      ...publication,
      scheduled_for: scheduledForIso,
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
      },
      schedule_update_required: true,
    });
    occupiedSlotKeys.add(scheduledForIso);
    cursor = new Date(scheduledFor.getTime() + 60_000);
  }
  return scheduled;
}

export function selectRelatedPublicationCandidate(publications, targetPublication) {
  return selectGenericRelatedPublicationCandidate(publications, targetPublication);
}

export function buildPublicationQueuePlan({ publications, channelProfiles, asOf = new Date() }) {
  const planChannels = channelProfiles.map((channelProfile) => {
    const previewUploads = selectPreviewUploadCandidates(publications, channelProfile);
    const committedScheduled = listCommittedScheduledPublications(publications, channelProfile, asOf)
      .map((publication) => ({
        ...publication,
        schedule_update_required: false,
      }));
    const scheduleCandidates = selectScheduleCandidates(publications, channelProfile, asOf);
    const scheduledQueue = sortScheduledByTime([
      ...committedScheduled,
      ...assignScheduleSlots(scheduleCandidates, channelProfile, asOf, committedScheduled),
    ]);
    return {
      channel: {
        id: channelProfile.id,
        name: channelProfile.name,
        account_key: channelProfile.account_key,
        platform: channelProfile.platform,
        schedule_slots: channelProfile.schedule_slots,
      },
      preview_upload_queue: previewUploads.map((publication) => ({
        publication_id: publication.id,
        title: publication.title,
        workflow_state: workflowState(publication),
        status: publication.status,
      })),
      scheduled_publish_queue: scheduledQueue.map((publication) => ({
        publication_id: publication.id,
        title: publication.title,
        workflow_state: workflowState(publication),
        scheduled_for: publication.scheduled_for,
        schedule_update_required: publication.schedule_update_required === true,
      })),
    };
  });

  return {
    generated_at: toIsoString(asOf),
    channels: planChannels,
  };
}
