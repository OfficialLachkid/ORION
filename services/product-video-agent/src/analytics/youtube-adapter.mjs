import { refreshYoutubeAccessToken } from '../youtube-oauth.mjs';

const YOUTUBE_VIDEOS_ENDPOINT = 'https://www.googleapis.com/youtube/v3/videos';
const YOUTUBE_ANALYTICS_REPORTS_ENDPOINT = 'https://youtubeanalytics.googleapis.com/v2/reports';
const YOUTUBE_VIDEOS_BATCH_SIZE = 50;
const ANALYTICS_SUMMARY_METRICS = Object.freeze([
  'views',
  'likes',
  'comments',
  'shares',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
]);

function toDateOrNull(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function normalizeNumericMetric(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseYoutubeCount(value, fallbackValue = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallbackValue;
}

function chunkValues(values = [], size = YOUTUBE_VIDEOS_BATCH_SIZE) {
  const chunkSize = Number.isFinite(Number(size)) && Number(size) > 0
    ? Math.floor(Number(size))
    : YOUTUBE_VIDEOS_BATCH_SIZE;
  const chunks = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function readJsonResponse(response) {
  const bodyText = await response.text();
  let payload = {};
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
  }
  return { bodyText, payload };
}

function buildAuthHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  };
}

function resolveAnalyticsWindow(publication, capturedAt) {
  const captureDate = toDateOrNull(capturedAt) || new Date();
  const publicationDate = toDateOrNull(
    publication?.published_at
      || publication?.uploaded_at
      || publication?.created_at,
  ) || captureDate;

  const startDate = publicationDate > captureDate ? captureDate : publicationDate;
  return {
    startDate: startDate.toISOString().slice(0, 10),
    endDate: captureDate.toISOString().slice(0, 10),
    fetchLagHours: Math.max(0, (captureDate.valueOf() - publicationDate.valueOf()) / (60 * 60 * 1000)),
  };
}

function mapAnalyticsRow(columnHeaders = [], rows = []) {
  const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  if (!row) {
    return {};
  }
  return Object.fromEntries(
    columnHeaders.map((header, index) => [
      String(header?.name || '').trim(),
      row[index],
    ]).filter(([key]) => key),
  );
}

export async function createYoutubeAnalyticsAccessToken({
  clientConfig,
  refreshToken,
  fetchImpl = globalThis.fetch,
}) {
  const refreshed = await refreshYoutubeAccessToken(clientConfig, refreshToken, { fetch: fetchImpl });
  return refreshed.accessToken;
}

export async function fetchYoutubeVideoStatisticsMap({
  externalIds = [],
  accessToken,
  fetchImpl = globalThis.fetch,
}) {
  const ids = [...new Set(
    (Array.isArray(externalIds) ? externalIds : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )];
  const statisticsByVideoId = new Map();
  const payloads = [];

  for (const batchIds of chunkValues(ids, YOUTUBE_VIDEOS_BATCH_SIZE)) {
    const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
    url.searchParams.set('part', 'statistics,snippet');
    url.searchParams.set('id', batchIds.join(','));
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: buildAuthHeaders(accessToken),
    });
    const { bodyText, payload } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`YouTube videos.list statistics lookup failed (${response.status}): ${bodyText || 'no body'}`);
    }

    payloads.push(payload);
    for (const item of Array.isArray(payload?.items) ? payload.items : []) {
      const videoId = String(item?.id || '').trim();
      if (!videoId) {
        continue;
      }
      statisticsByVideoId.set(videoId, item);
    }
  }

  return {
    statisticsByVideoId,
    payloads,
  };
}

// Shared query builder for the dimensioned analytics reports (geo /
// traffic source). The summary path already sets the same window +
// filters — we only differ in `dimensions`, `metrics`, `sort`, and an
// optional `maxResults`. Kept small so the two callers stay one-liners.
async function fetchYoutubeAnalyticsDimensioned({
  externalId,
  accessToken,
  publication,
  capturedAt,
  fetchImpl,
  dimensions,
  metrics,
  sort = '',
  maxResults = 0,
}) {
  const videoId = String(externalId || '').trim();
  if (!videoId) return { metricsByName: {}, rows: [], columnHeaders: [], rawPayload: null };

  const window = resolveAnalyticsWindow(publication, capturedAt);
  const url = new URL(YOUTUBE_ANALYTICS_REPORTS_ENDPOINT);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', window.startDate);
  url.searchParams.set('endDate', window.endDate);
  url.searchParams.set('metrics', metrics.join(','));
  url.searchParams.set('dimensions', dimensions.join(','));
  url.searchParams.set('filters', `video==${videoId}`);
  if (sort) url.searchParams.set('sort', sort);
  if (maxResults > 0) url.searchParams.set('maxResults', String(maxResults));

  const response = await fetchImpl(url, { method: 'GET', headers: buildAuthHeaders(accessToken) });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    // Dimensioned queries are best-effort enrichment. A single failure
    // (permission-missing, empty window, transient 500) must NOT torpedo
    // the whole publication metrics fetch — callers get a null-shaped
    // result and continue. The summary metric fetch is still the source
    // of truth for the required numbers (views/likes/comments).
    return { metricsByName: {}, rows: [], columnHeaders: [], rawPayload: null, error: `${response.status}: ${bodyText || 'no body'}` };
  }
  return {
    metricsByName: mapAnalyticsRow(payload?.columnHeaders || [], payload?.rows || []),
    rows: Array.isArray(payload?.rows) ? payload.rows : [],
    columnHeaders: Array.isArray(payload?.columnHeaders) ? payload.columnHeaders : [],
    rawPayload: payload,
  };
}

export async function fetchYoutubeAnalyticsSummary({
  externalId,
  accessToken,
  publication,
  capturedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
}) {
  const videoId = String(externalId || '').trim();
  if (!videoId) {
    return {
      metricsByName: {},
      rawPayload: null,
      fetchLagHours: null,
    };
  }

  const window = resolveAnalyticsWindow(publication, capturedAt);
  const url = new URL(YOUTUBE_ANALYTICS_REPORTS_ENDPOINT);
  url.searchParams.set('ids', 'channel==MINE');
  url.searchParams.set('startDate', window.startDate);
  url.searchParams.set('endDate', window.endDate);
  url.searchParams.set('metrics', ANALYTICS_SUMMARY_METRICS.join(','));
  url.searchParams.set('filters', `video==${videoId}`);

  const response = await fetchImpl(url, {
    method: 'GET',
    headers: buildAuthHeaders(accessToken),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`YouTube Analytics reports.query failed (${response.status}): ${bodyText || 'no body'}`);
  }

  return {
    metricsByName: mapAnalyticsRow(payload?.columnHeaders || [], payload?.rows || []),
    rawPayload: payload,
    fetchLagHours: window.fetchLagHours,
  };
}

// Convert a dimensioned analytics response into a lightweight sorted
// list of {key, views} entries so the persisted metric stays compact
// (Supabase JSONB is fine either way, but the weekly review data pack
// stays readable when it doesn't have to dig through columnHeaders).
function summarizeDimensionRows({ rows = [], columnHeaders = [], dimensionName, viewsColumn = 'views', topN = 25 }) {
  if (!Array.isArray(rows) || rows.length === 0) return [];
  const dimensionIdx = columnHeaders.findIndex((h) => (h?.name || '') === dimensionName);
  const viewsIdx = columnHeaders.findIndex((h) => (h?.name || '') === viewsColumn);
  if (dimensionIdx < 0 || viewsIdx < 0) return [];
  return rows
    .map((row) => ({
      key: String(row[dimensionIdx] || '').trim(),
      views: parseYoutubeCount(row[viewsIdx], 0),
    }))
    .filter((entry) => entry.key)
    .sort((a, b) => b.views - a.views)
    .slice(0, topN);
}

export async function fetchYoutubePublicationMetrics({
  publication,
  accessToken,
  statistics = null,
  fetchImpl = globalThis.fetch,
  capturedAt = new Date().toISOString(),
}) {
  const externalId = String(publication?.external_id || '').trim();
  const resolvedStatistics = statistics || null;
  // Fire summary + geo + traffic in parallel. Summary is required (the
  // views/likes/comments totals depend on it); geo + traffic are best-
  // effort enrichment and null-shape on failure — the shared helper
  // swallows non-200s and returns empty rows so a broken enrichment
  // never blocks the summary write.
  const [analyticsSummary, geoBreakdown, trafficBreakdown] = await Promise.all([
    fetchYoutubeAnalyticsSummary({
      externalId,
      accessToken,
      publication,
      capturedAt,
      fetchImpl,
    }),
    fetchYoutubeAnalyticsDimensioned({
      externalId, accessToken, publication, capturedAt, fetchImpl,
      dimensions: ['country'],
      metrics: ['views'],
      sort: '-views',
      maxResults: 25,
    }),
    fetchYoutubeAnalyticsDimensioned({
      externalId, accessToken, publication, capturedAt, fetchImpl,
      dimensions: ['insightTrafficSourceType'],
      metrics: ['views'],
      sort: '-views',
    }),
  ]);
  const statisticsPayload = resolvedStatistics?.statistics || {};

  const metrics = {
    platform: 'youtube',
    external_id: externalId,
    public_url: externalId ? `https://youtube.com/shorts/${externalId}` : null,
    views: parseYoutubeCount(
      statisticsPayload.viewCount,
      parseYoutubeCount(analyticsSummary.metricsByName.views, 0),
    ),
    unique_viewers: normalizeNumericMetric(analyticsSummary.metricsByName.uniqueViewers),
    avg_view_duration_sec: normalizeNumericMetric(analyticsSummary.metricsByName.averageViewDuration),
    avg_view_percentage: normalizeNumericMetric(analyticsSummary.metricsByName.averageViewPercentage),
    watch_time_minutes: normalizeNumericMetric(analyticsSummary.metricsByName.estimatedMinutesWatched),
    impressions: normalizeNumericMetric(analyticsSummary.metricsByName.impressions),
    ctr_percentage: normalizeNumericMetric(analyticsSummary.metricsByName.impressionCtr),
    likes: parseYoutubeCount(
      statisticsPayload.likeCount,
      parseYoutubeCount(analyticsSummary.metricsByName.likes, 0),
    ),
    comments: parseYoutubeCount(
      statisticsPayload.commentCount,
      parseYoutubeCount(analyticsSummary.metricsByName.comments, 0),
    ),
    shares: normalizeNumericMetric(analyticsSummary.metricsByName.shares),
    saves: null,
    subs_gained: normalizeNumericMetric(analyticsSummary.metricsByName.subscribersGained),
    subs_lost: normalizeNumericMetric(analyticsSummary.metricsByName.subscribersLost),
    retention_curve: null,
    // Populated 2026-09-21 (was hardcoded null). Compact top-N shape so
    // the weekly analytics review can render country / traffic-source
    // distribution without walking raw columnHeaders on every row.
    viewer_countries: summarizeDimensionRows({
      rows: geoBreakdown.rows,
      columnHeaders: geoBreakdown.columnHeaders,
      dimensionName: 'country',
    }),
    traffic_sources: summarizeDimensionRows({
      rows: trafficBreakdown.rows,
      columnHeaders: trafficBreakdown.columnHeaders,
      dimensionName: 'insightTrafficSourceType',
    }),
    fetch_lag_hours: analyticsSummary.fetchLagHours,
    captured_at: capturedAt,
    published_at: publication?.published_at || publication?.uploaded_at || publication?.created_at || null,
    video_title: String(
      resolvedStatistics?.snippet?.title
        || publication?.title
        || '',
    ).trim(),
  };

  return {
    metrics,
    raw_payload: {
      youtube_videos_item: resolvedStatistics,
      youtube_analytics_report: analyticsSummary.rawPayload,
      youtube_analytics_geo: geoBreakdown.rawPayload,
      youtube_analytics_traffic: trafficBreakdown.rawPayload,
    },
  };
}
