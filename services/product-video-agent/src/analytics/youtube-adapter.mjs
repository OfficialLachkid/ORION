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

export async function fetchYoutubePublicationMetrics({
  publication,
  accessToken,
  statistics = null,
  fetchImpl = globalThis.fetch,
  capturedAt = new Date().toISOString(),
}) {
  const externalId = String(publication?.external_id || '').trim();
  const resolvedStatistics = statistics || null;
  const analyticsSummary = await fetchYoutubeAnalyticsSummary({
    externalId,
    accessToken,
    publication,
    capturedAt,
    fetchImpl,
  });
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
    traffic_sources: null,
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
    },
  };
}
