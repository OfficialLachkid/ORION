import { normalizeScheduleSlots } from './publication-channels.mjs';

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
  if (publication.status === 'failed') return 'failed';
  if (publication.status === 'blocked') return 'blocked';
  if (publication.preview_url) return 'preview_uploaded';
  return 'preview_upload_pending';
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
      publication.platform === channelProfile.platform
      && publication.account_key === channelProfile.account_key
      && workflowState(publication) === 'preview_upload_pending'
      && publication.status !== 'blocked'
      && publication.status !== 'failed'
      && publication.status !== 'published'
    )),
  );
}

export function selectScheduleCandidates(publications, channelProfile) {
  return sortByOldestFirst(
    publications.filter((publication) => (
      publication.platform === channelProfile.platform
      && publication.account_key === channelProfile.account_key
      && ['preview_approved', 'queued', 'scheduled'].includes(workflowState(publication))
      && publication.status !== 'blocked'
      && publication.status !== 'failed'
      && publication.status !== 'published'
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

export function assignScheduleSlots(publications, channelProfile, asOf = new Date()) {
  const scheduled = [];
  let cursor = asDate(asOf);
  for (const publication of publications) {
    const scheduledFor = nextSlotAfter(
      cursor,
      channelProfile.schedule_slots,
      channelProfile.timezone || 'UTC',
    );
    scheduled.push({
      ...publication,
      scheduled_for: toIsoString(scheduledFor),
      metadata: {
        ...(publication.metadata || {}),
        workflow_state: 'scheduled',
      },
    });
    cursor = new Date(scheduledFor.getTime() + 60_000);
  }
  return scheduled;
}

export function selectRelatedPublicationCandidate(publications, targetPublication) {
  const targetTypePair = JSON.stringify(targetPublication?.metadata?.type_pair || []);
  const candidates = publications.filter((publication) => {
    if (!publication || publication.id === targetPublication?.id) return false;
    if (publication.account_key !== targetPublication?.account_key) return false;
    if (publication.platform !== targetPublication?.platform) return false;
    if (!publication.public_url && !publication.preview_url) return false;
    if (workflowState(publication) !== 'published') return false;
    return JSON.stringify(publication.metadata?.type_pair || []) === targetTypePair;
  });

  const sameTypePair = sortByOldestFirst(candidates).reverse()[0];
  if (sameTypePair) return sameTypePair;

  return sortByOldestFirst(
    publications.filter((publication) => (
      publication
      && publication.id !== targetPublication?.id
      && publication.account_key === targetPublication?.account_key
      && publication.platform === targetPublication?.platform
      && workflowState(publication) === 'published'
      && (publication.public_url || publication.preview_url)
    )),
  ).reverse()[0] || null;
}

export function buildPublicationQueuePlan({ publications, channelProfiles, asOf = new Date() }) {
  const planChannels = channelProfiles.map((channelProfile) => {
    const previewUploads = selectPreviewUploadCandidates(publications, channelProfile);
    const scheduleCandidates = selectScheduleCandidates(publications, channelProfile);
    const scheduledQueue = assignScheduleSlots(scheduleCandidates, channelProfile, asOf);
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
      })),
    };
  });

  return {
    generated_at: toIsoString(asOf),
    channels: planChannels,
  };
}
