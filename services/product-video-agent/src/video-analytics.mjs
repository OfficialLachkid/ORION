const EARLY_PUBLICATION_WINDOW_HOURS = 48;
const MID_PUBLICATION_WINDOW_HOURS = 14 * 24;
const DEFAULT_LEADERBOARD_SIZE = 5;
const DEFAULT_INSIGHT_GROUP_LIMIT = 3;
const DEFAULT_HOOK_PREVIEW_LENGTH = 64;

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

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

function titleCaseWord(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function humanizeSlug(value) {
  return String(value || '')
    .trim()
    .replace(/\.[a-z0-9]+$/iu, '')
    .replace(/[_-]+/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => titleCaseWord(part))
    .join(' ');
}

function truncateText(value, maxLength = DEFAULT_HOOK_PREVIEW_LENGTH) {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
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

function normalizeTypePair(typePair = []) {
  return toArray(typePair)
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
}

function createTypePairKey(typePair = []) {
  const normalized = normalizeTypePair(typePair);
  return normalized.length > 0 ? normalized.join('|') : '';
}

function formatTypePair(typePair = []) {
  const normalized = normalizeTypePair(typePair)
    .map((value) => titleCaseWord(value));
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

function normalizeTemplateId(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveTemplateId(publication = {}, videoRow = null) {
  return normalizeTemplateId(
    publication?.metadata?.template_id
      || publication?.template_key
      || videoRow?.render?.template_id
      || videoRow?.template_key
      || ''
  );
}

function resolveTemplateLabelFromId(templateId) {
  const normalizedTemplateId = normalizeTemplateId(templateId);
  if (!normalizedTemplateId) {
    return 'Unknown';
  }
  if (normalizedTemplateId.includes('find-the-shiny')) {
    return 'Find the Shiny';
  }
  if (normalizedTemplateId.includes('know-your-shiny')) {
    return 'Know Your Shiny';
  }
  if (normalizedTemplateId.includes('memory')) {
    return 'Memory';
  }
  if (normalizedTemplateId.includes('type-quiz') || normalizedTemplateId.includes('type-speed-quiz')) {
    return 'Type Quiz';
  }
  if (normalizedTemplateId.includes('dual-type-reveal') || normalizedTemplateId.includes('type-challenge')) {
    return 'Dual Type Reveal';
  }

  const tail = normalizedTemplateId.split('.').filter(Boolean).at(-1) || normalizedTemplateId;
  return humanizeSlug(tail.replace(/v\d+$/iu, ''));
}

function resolvePublicationTypePair(publication = {}, videoRow = null) {
  return normalizeTypePair(
    publication?.metadata?.type_pair
      || videoRow?.render?.type_pair
      || videoRow?.source_data?.type_pair
      || []
  );
}

function normalizePath(value) {
  return String(value || '').trim().replace(/\\/gu, '/');
}

function resolveBackgroundPath(publication = {}, videoRow = null) {
  return normalizePath(
    publication?.metadata?.background_path
      || videoRow?.source_data?.background_path
      || publication?.metadata?.render_path
      || ''
  );
}

function resolveBackgroundStyleLabel(backgroundPath = '') {
  const normalizedPath = normalizePath(backgroundPath).toLowerCase();
  if (!normalizedPath) {
    return 'Unknown';
  }
  const segments = normalizedPath.split('/').filter(Boolean);
  const styleSegment = [...segments].reverse().find((segment) => segment.includes('background'));
  if (styleSegment) {
    return humanizeSlug(styleSegment);
  }
  if (segments.length >= 2) {
    return humanizeSlug(segments.at(-2));
  }
  return humanizeSlug(segments.at(-1) || 'unknown');
}

function resolveBackgroundAssetLabel(backgroundPath = '') {
  const normalizedPath = normalizePath(backgroundPath);
  if (!normalizedPath) {
    return 'Unknown';
  }
  const fileName = normalizedPath.split('/').filter(Boolean).at(-1) || '';
  return humanizeSlug(fileName);
}

function resolveHookText(publication = {}, videoRow = null) {
  return normalizeWhitespace(
    videoRow?.selected_script?.hook
      || publication?.metadata?.hook
      || ''
  );
}

function resolveSelectedSubjectCount(publication = {}, videoRow = null) {
  return Number(
    publication?.metadata?.selected_subject_count
      || videoRow?.score?.selected_subject_count
      || 0
  ) || 0;
}

function buildPerformanceSummary(entry = {}) {
  return {
    publication_id: entry.publication_id,
    external_id: entry.external_id,
    title: entry.title,
    views: entry.views,
    avg_view_duration_sec: entry.avg_view_duration_sec,
    avg_view_percentage: entry.avg_view_percentage,
    type_pair: entry.type_pair,
    template_id: entry.template_id,
    template_label: entry.template_label,
    background_style: entry.background_style,
    background_asset: entry.background_asset,
    hook: entry.hook,
    published_at: entry.published_at,
    render_path: entry.render_path,
  };
}

function compareViewsDescending(left, right) {
  return (right.views || 0) - (left.views || 0);
}

function compareViewsAscending(left, right) {
  return (left.views || 0) - (right.views || 0);
}

function comparePublishedDescending(left, right) {
  const leftDate = toDateOrNull(left.published_at);
  const rightDate = toDateOrNull(right.published_at);
  return (rightDate?.valueOf() || 0) - (leftDate?.valueOf() || 0);
}

function takeEntries(entries = [], comparator, limit = DEFAULT_LEADERBOARD_SIZE) {
  return entries
    .slice()
    .sort(comparator)
    .slice(0, Math.max(0, Number(limit) || 0));
}

function buildPerformanceGroups(
  entries = [],
  {
    keyResolver,
    labelResolver,
    limit = DEFAULT_INSIGHT_GROUP_LIMIT,
  } = {},
) {
  const buckets = new Map();
  for (const entry of entries) {
    const key = normalizeWhitespace(keyResolver?.(entry) || '');
    if (!key || key.toLowerCase() === 'unknown') {
      continue;
    }

    const label = normalizeWhitespace(labelResolver?.(entry) || key);
    const bucket = buckets.get(key) || {
      key,
      label,
      entries: [],
      views: [],
      avgViewDurationSec: [],
      avgViewPercentage: [],
    };
    bucket.entries.push(entry);
    bucket.views.push(entry.views);
    bucket.avgViewDurationSec.push(entry.avg_view_duration_sec);
    bucket.avgViewPercentage.push(entry.avg_view_percentage);
    buckets.set(key, bucket);
  }

  const groups = [...buckets.values()].map((bucket) => {
    const rankedByViews = bucket.entries
      .filter((entry) => entry.views !== null)
      .slice()
      .sort(compareViewsDescending);
    return {
      key: bucket.key,
      label: bucket.label,
      video_count: bucket.entries.length,
      total_views: sumNumbers(bucket.views),
      average_views: bucket.entries.length > 0 ? sumNumbers(bucket.views) / bucket.entries.length : null,
      median_views: calculateMedian(bucket.views),
      median_avg_view_duration_sec: calculateMedian(bucket.avgViewDurationSec),
      median_avg_view_percentage: calculateMedian(bucket.avgViewPercentage),
      best_video: rankedByViews[0] ? buildPerformanceSummary(rankedByViews[0]) : null,
      worst_video: rankedByViews.at(-1) ? buildPerformanceSummary(rankedByViews.at(-1)) : null,
    };
  });

  const rankedGroups = groups.slice().sort((left, right) => (
    (right.average_views || 0) - (left.average_views || 0)
      || (right.total_views || 0) - (left.total_views || 0)
      || (right.median_avg_view_percentage || 0) - (left.median_avg_view_percentage || 0)
      || right.video_count - left.video_count
      || String(left.label).localeCompare(String(right.label))
  ));
  const weakestGroups = groups.slice().sort((left, right) => (
    (left.average_views || 0) - (right.average_views || 0)
      || (left.total_views || 0) - (right.total_views || 0)
      || (left.median_avg_view_percentage || 0) - (right.median_avg_view_percentage || 0)
      || left.video_count - right.video_count
      || String(left.label).localeCompare(String(right.label))
  ));

  return {
    group_count: groups.length,
    strongest: rankedGroups.slice(0, Math.max(0, Number(limit) || 0)),
    weakest: weakestGroups.slice(0, Math.max(0, Number(limit) || 0)),
  };
}

function buildContentInsights(entries = []) {
  const entriesWithViews = entries.filter((entry) => entry.views !== null);
  return {
    sample_size: entriesWithViews.length,
    templates: buildPerformanceGroups(entriesWithViews, {
      keyResolver: (entry) => entry.template_id || entry.template_label,
      labelResolver: (entry) => entry.template_label || entry.template_id || 'Unknown',
    }),
    type_pairs: buildPerformanceGroups(entriesWithViews, {
      keyResolver: (entry) => entry.type_pair_key,
      labelResolver: (entry) => entry.type_pair,
    }),
    hooks: buildPerformanceGroups(entriesWithViews, {
      keyResolver: (entry) => entry.hook || '',
      labelResolver: (entry) => truncateText(entry.hook || '', DEFAULT_HOOK_PREVIEW_LENGTH),
      limit: 2,
    }),
    background_styles: buildPerformanceGroups(entriesWithViews, {
      keyResolver: (entry) => entry.background_style,
      labelResolver: (entry) => entry.background_style,
    }),
  };
}

function buildPublicationEntry(publication = {}, snapshot = null, videoRow = null) {
  const metrics = snapshot?.metrics || {};
  const templateId = resolveTemplateId(publication, videoRow);
  const typePair = resolvePublicationTypePair(publication, videoRow);
  const backgroundPath = resolveBackgroundPath(publication, videoRow);
  const hook = resolveHookText(publication, videoRow);

  return {
    publication_id: String(publication?.id || '').trim(),
    video_id: String(publication?.video_id || '').trim(),
    external_id: String(publication?.external_id || '').trim(),
    title: normalizeWhitespace(publication?.title || ''),
    template_id: templateId,
    template_label: resolveTemplateLabelFromId(templateId),
    type_pair_key: createTypePairKey(typePair),
    type_pair: formatTypePair(typePair),
    background_path: backgroundPath,
    background_style: resolveBackgroundStyleLabel(backgroundPath),
    background_asset: resolveBackgroundAssetLabel(backgroundPath),
    hook,
    hook_preview: truncateText(hook, DEFAULT_HOOK_PREVIEW_LENGTH),
    selected_subject_count: resolveSelectedSubjectCount(publication, videoRow),
    published_at: publication?.published_at || publication?.uploaded_at || publication?.created_at || null,
    render_path: normalizePath(publication?.metadata?.render_path || videoRow?.render?.output_path || ''),
    views: pickMetric(metrics, ['views']),
    avg_view_duration_sec: pickMetric(metrics, ['avg_view_duration_sec', 'average_view_duration_seconds']),
    avg_view_percentage: pickMetric(metrics, ['avg_view_percentage', 'average_view_percentage']),
    likes: pickMetric(metrics, ['likes']),
    comments: pickMetric(metrics, ['comments']),
    shares: pickMetric(metrics, ['shares']),
    subs_gained: pickMetric(metrics, ['subs_gained', 'subscribers_gained']),
    subs_lost: pickMetric(metrics, ['subs_lost', 'subscribers_lost']),
    captured_at: snapshot?.captured_at || null,
  };
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
        || publication?.created_at
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
  videoRowsById = new Map(),
  asOf = new Date().toISOString(),
  windowDays = 7,
  insufficientDataThreshold = 3,
  leaderboardSize = DEFAULT_LEADERBOARD_SIZE,
} = {}) {
  const endDate = toDateOrNull(asOf) || new Date();
  const windowStart = startOfWindow(endDate, windowDays);
  const publishedPublications = toArray(publications).filter((publication) => (
    String(publication?.status || '').trim().toLowerCase() === 'published'
  ));
  const windowPublications = publishedPublications.filter((publication) => (
    isWithinWindow(publication?.published_at || publication?.uploaded_at || publication?.created_at, windowStart, endDate)
  ));

  const allTimeEntries = publishedPublications.map((publication) => buildPublicationEntry(
    publication,
    latestSnapshotsByPublicationId.get(String(publication?.id || '').trim()) || null,
    videoRowsById.get(String(publication?.video_id || '').trim()) || null,
  ));
  const entries = windowPublications.map((publication) => buildPublicationEntry(
    publication,
    latestSnapshotsByPublicationId.get(String(publication?.id || '').trim()) || null,
    videoRowsById.get(String(publication?.video_id || '').trim()) || null,
  ));

  const entriesWithViews = entries.filter((entry) => entry.views !== null);
  const bestPerformer = takeEntries(entriesWithViews, compareViewsDescending, 1)[0] || null;
  const worstPerformer = takeEntries(entriesWithViews, compareViewsAscending, 1)[0] || null;
  const recentWinners = takeEntries(entriesWithViews, compareViewsDescending, leaderboardSize);
  const recentLosers = takeEntries(entriesWithViews, compareViewsAscending, leaderboardSize);
  const recentUploads = takeEntries(entries, comparePublishedDescending, leaderboardSize);

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
    videos_with_snapshots_count: entries.filter((entry) => entry.captured_at).length,
    all_time_publications_count: publishedPublications.length,
    all_time_videos_with_snapshots_count: allTimeEntries.filter((entry) => entry.captured_at).length,
    crossed_10k_views_count: entries.filter((entry) => (entry.views || 0) >= 10_000).length,
    median_views: calculateMedian(entries.map((entry) => entry.views)),
    median_avg_view_duration_sec: calculateMedian(entries.map((entry) => entry.avg_view_duration_sec)),
    median_avg_view_percentage: calculateMedian(entries.map((entry) => entry.avg_view_percentage)),
    total_views: sumNumbers(entries.map((entry) => entry.views)),
    all_time_views: sumNumbers(allTimeEntries.map((entry) => entry.views)),
    total_likes: sumNumbers(entries.map((entry) => entry.likes)),
    total_comments: sumNumbers(entries.map((entry) => entry.comments)),
    total_shares: sumNumbers(entries.map((entry) => entry.shares)),
    total_subscribers_gained: sumNumbers(entries.map((entry) => entry.subs_gained)),
    total_subscribers_lost: sumNumbers(entries.map((entry) => entry.subs_lost)),
    insufficient_data: windowPublications.length < insufficientDataThreshold,
    best_performer: bestPerformer ? buildPerformanceSummary(bestPerformer) : null,
    worst_performer: worstPerformer ? buildPerformanceSummary(worstPerformer) : null,
    recent_winners: recentWinners.map((entry) => buildPerformanceSummary(entry)),
    recent_losers: recentLosers.map((entry) => buildPerformanceSummary(entry)),
    recent_uploads: recentUploads.map((entry) => buildPerformanceSummary(entry)),
    content_insights: buildContentInsights(entries),
    publications: entries,
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
