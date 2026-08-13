const EARLY_PUBLICATION_WINDOW_HOURS = 48;
const MID_PUBLICATION_WINDOW_HOURS = 14 * 24;

function toDateOrNull(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function toFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function calculateMedian(values = []) {
  const sorted = values
    .map((value) => toFiniteNumber(value))
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (sorted.length === 0) {
    return null;
  }
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function sumNumbers(values = []) {
  return values.reduce((total, value) => total + (toFiniteNumber(value) || 0), 0);
}

function pickMetric(metrics = {}, keys = []) {
  for (const key of keys) {
    const value = toFiniteNumber(metrics?.[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function formatTypePair(typePair = []) {
  const normalized = toArray(typePair)
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized.join(' / ') : 'Unknown';
}

function startOfWindow(asOf, windowDays) {
  const endDate = toDateOrNull(asOf) || new Date();
  return new Date(endDate.valueOf() - (Number(windowDays) * 24 * 60 * 60 * 1000));
}

function isWithinWindow(dateValue, windowStart, windowEnd) {
  const date = toDateOrNull(dateValue);
  if (!date) {
    return false;
  }
  return date >= windowStart && date <= windowEnd;
}

export function resolveVideoAnalyticsCadenceHours(publicationAgeHours) {
  const ageHours = Number(publicationAgeHours);
  if (!Number.isFinite(ageHours) || ageHours < 0) {
    return 4;
  }
  if (ageHours <= EARLY_PUBLICATION_WINDOW_HOURS) {
    return 4;
  }
  if (ageHours <= MID_PUBLICATION_WINDOW_HOURS) {
    return 24;
  }
  return 24 * 7;
}

export function indexLatestAnalyticsSnapshotsByPublicationId(snapshots = []) {
  const latestByPublicationId = new Map();
  for (const snapshot of toArray(snapshots)) {
    const publicationId = String(snapshot?.publication_id || '').trim();
    const capturedAt = toDateOrNull(snapshot?.captured_at);
    if (!publicationId || !capturedAt) {
      continue;
    }

    const existing = latestByPublicationId.get(publicationId);
    const existingCapturedAt = toDateOrNull(existing?.captured_at);
    if (!existingCapturedAt || capturedAt > existingCapturedAt) {
      latestByPublicationId.set(publicationId, snapshot);
    }
  }
  return latestByPublicationId;
}

export function resolveVideoAnalyticsCapturePlan({
  publications = [],
  latestSnapshotsByPublicationId = new Map(),
  capturedAt = new Date().toISOString(),
} = {}) {
  const captureDate = toDateOrNull(capturedAt) || new Date();
  return toArray(publications).map((publication) => {
    const publicationId = String(publication?.id || '').trim();
    const publishedAt = toDateOrNull(
      publication?.published_at
        || publication?.uploaded_at
        || publication?.created_at,
    );
    const latestSnapshot = latestSnapshotsByPublicationId.get(publicationId) || null;
    const latestCapturedAt = toDateOrNull(latestSnapshot?.captured_at);
    const publicationAgeHours = publishedAt
      ? Math.max(0, (captureDate.valueOf() - publishedAt.valueOf()) / (60 * 60 * 1000))
      : 0;
    const cadenceHours = resolveVideoAnalyticsCadenceHours(publicationAgeHours);
    const hoursSinceLastSnapshot = latestCapturedAt
      ? Math.max(0, (captureDate.valueOf() - latestCapturedAt.valueOf()) / (60 * 60 * 1000))
      : null;
    const due = !latestCapturedAt || hoursSinceLastSnapshot >= cadenceHours;

    return {
      publication,
      publication_id: publicationId,
      latest_snapshot: latestSnapshot,
      cadence_hours: cadenceHours,
      publication_age_hours: publicationAgeHours,
      hours_since_last_snapshot: hoursSinceLastSnapshot,
      due,
    };
  });
}

export function buildChannelVideoAnalyticsDigest({
  channelProfile,
  publications = [],
  latestSnapshotsByPublicationId = new Map(),
  asOf = new Date().toISOString(),
  windowDays = 7,
  insufficientDataThreshold = 3,
} = {}) {
  const endDate = toDateOrNull(asOf) || new Date();
  const windowStart = startOfWindow(endDate, windowDays);
  const publishedPublications = toArray(publications).filter((publication) => (
    String(publication?.status || '').trim().toLowerCase() === 'published'
  ));
  const windowPublications = publishedPublications.filter((publication) => (
    String(publication?.status || '').trim().toLowerCase() === 'published'
      && isWithinWindow(publication?.published_at || publication?.uploaded_at || publication?.created_at, windowStart, endDate)
  ));
  const allTimeEntries = publishedPublications.map((publication) => {
    const snapshot = latestSnapshotsByPublicationId.get(String(publication?.id || '').trim()) || null;
    const metrics = snapshot?.metrics || {};
    return {
      publication,
      snapshot,
      metrics,
      views: pickMetric(metrics, ['views']),
    };
  });

  const entries = windowPublications.map((publication) => {
    const snapshot = latestSnapshotsByPublicationId.get(String(publication?.id || '').trim()) || null;
    const metrics = snapshot?.metrics || {};
    return {
      publication,
      snapshot,
      metrics,
      views: pickMetric(metrics, ['views']),
      avgViewDurationSec: pickMetric(metrics, ['avg_view_duration_sec', 'average_view_duration_seconds']),
      avgViewPercentage: pickMetric(metrics, ['avg_view_percentage', 'average_view_percentage']),
      likes: pickMetric(metrics, ['likes']),
      comments: pickMetric(metrics, ['comments']),
      shares: pickMetric(metrics, ['shares']),
      subscribersGained: pickMetric(metrics, ['subs_gained', 'subscribers_gained']),
      subscribersLost: pickMetric(metrics, ['subs_lost', 'subscribers_lost']),
    };
  });

  const entriesWithViews = entries.filter((entry) => entry.views !== null);
  const bestPerformer = entriesWithViews
    .slice()
    .sort((left, right) => (right.views || 0) - (left.views || 0))[0] || null;
  const worstPerformer = entriesWithViews
    .slice()
    .sort((left, right) => (left.views || 0) - (right.views || 0))[0] || null;

  const digest = {
    channel_id: String(channelProfile?.id || '').trim(),
    account_key: String(channelProfile?.account_key || '').trim(),
    channel_name: String(channelProfile?.name || '').trim() || 'Unknown channel',
    platform: String(channelProfile?.platform || '').trim() || 'youtube_shorts',
    timezone: String(channelProfile?.timezone || '').trim() || 'UTC',
    window_days: Number(windowDays),
    window_start: windowStart.toISOString(),
    window_end: endDate.toISOString(),
    new_videos_count: windowPublications.length,
    videos_with_snapshots_count: entries.filter((entry) => entry.snapshot).length,
    all_time_publications_count: publishedPublications.length,
    all_time_videos_with_snapshots_count: allTimeEntries.filter((entry) => entry.snapshot).length,
    crossed_10k_views_count: entries.filter((entry) => (entry.views || 0) >= 10_000).length,
    median_views: calculateMedian(entries.map((entry) => entry.views)),
    median_avg_view_duration_sec: calculateMedian(entries.map((entry) => entry.avgViewDurationSec)),
    median_avg_view_percentage: calculateMedian(entries.map((entry) => entry.avgViewPercentage)),
    total_views: sumNumbers(entries.map((entry) => entry.views)),
    all_time_views: sumNumbers(allTimeEntries.map((entry) => entry.views)),
    total_likes: sumNumbers(entries.map((entry) => entry.likes)),
    total_comments: sumNumbers(entries.map((entry) => entry.comments)),
    total_shares: sumNumbers(entries.map((entry) => entry.shares)),
    total_subscribers_gained: sumNumbers(entries.map((entry) => entry.subscribersGained)),
    total_subscribers_lost: sumNumbers(entries.map((entry) => entry.subscribersLost)),
    insufficient_data: windowPublications.length < insufficientDataThreshold,
    best_performer: bestPerformer
      ? {
          publication_id: bestPerformer.publication.id,
          title: String(bestPerformer.publication?.title || '').trim(),
          views: bestPerformer.views,
          type_pair: formatTypePair(bestPerformer.publication?.metadata?.type_pair),
          render_path: String(bestPerformer.publication?.metadata?.render_path || '').trim(),
        }
      : null,
    worst_performer: worstPerformer
      ? {
          publication_id: worstPerformer.publication.id,
          title: String(worstPerformer.publication?.title || '').trim(),
          views: worstPerformer.views,
          type_pair: formatTypePair(worstPerformer.publication?.metadata?.type_pair),
          render_path: String(worstPerformer.publication?.metadata?.render_path || '').trim(),
        }
      : null,
    publications: entries.map((entry) => ({
      publication_id: entry.publication.id,
      external_id: String(entry.publication?.external_id || '').trim(),
      title: String(entry.publication?.title || '').trim(),
      type_pair: formatTypePair(entry.publication?.metadata?.type_pair),
      published_at: entry.publication?.published_at || entry.publication?.uploaded_at || entry.publication?.created_at || null,
      render_path: String(entry.publication?.metadata?.render_path || '').trim(),
      views: entry.views,
      avg_view_duration_sec: entry.avgViewDurationSec,
      avg_view_percentage: entry.avgViewPercentage,
      likes: entry.likes,
      comments: entry.comments,
      shares: entry.shares,
      subs_gained: entry.subscribersGained,
      subs_lost: entry.subscribersLost,
      captured_at: entry.snapshot?.captured_at || null,
    })),
  };

  digest.thread_key = slugify(`${digest.channel_name}-${digest.account_key}`) || slugify(digest.channel_id);
  return digest;
}

export function buildVideoAnalyticsOverviewDigest({
  channelDigests = [],
  asOf = new Date().toISOString(),
  windowDays = 7,
} = {}) {
  const digests = toArray(channelDigests);
  return {
    as_of: toDateOrNull(asOf)?.toISOString() || new Date().toISOString(),
    window_days: Number(windowDays),
    channel_count: digests.length,
    total_new_videos_count: sumNumbers(digests.map((digest) => digest.new_videos_count)),
    total_videos_with_snapshots_count: sumNumbers(digests.map((digest) => digest.videos_with_snapshots_count)),
    total_all_time_videos_with_snapshots_count: sumNumbers(digests.map((digest) => digest.all_time_videos_with_snapshots_count)),
    total_crossed_10k_views_count: sumNumbers(digests.map((digest) => digest.crossed_10k_views_count)),
    total_views: sumNumbers(digests.map((digest) => digest.total_views)),
    total_all_time_views: sumNumbers(digests.map((digest) => digest.all_time_views)),
    channels: digests.map((digest) => ({
      channel_name: digest.channel_name,
      account_key: digest.account_key,
      new_videos_count: digest.new_videos_count,
      total_views: digest.total_views,
      all_time_views: digest.all_time_views,
      median_views: digest.median_views,
      median_avg_view_duration_sec: digest.median_avg_view_duration_sec,
      median_avg_view_percentage: digest.median_avg_view_percentage,
      insufficient_data: digest.insufficient_data,
    })),
  };
}

export function buildVideoAnalyticsThreadName(channelProfile = {}) {
  const parts = [
    String(channelProfile?.name || '').trim(),
    'Analytics',
  ].filter(Boolean);
  const candidate = parts.join(' - ') || 'Analytics';
  return candidate.length <= 100 ? candidate : `${candidate.slice(0, 97)}...`;
}
