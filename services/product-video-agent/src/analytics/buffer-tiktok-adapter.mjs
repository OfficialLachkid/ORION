// TikTok (via Buffer) analytics adapter.
//
// Phase 2 of the "add TikTok + Instagram to analytics" ask
// (2026-10-19 operator). ORION posts to TikTok via Buffer (direct
// TikTok OAuth app isn't approved yet), so Buffer is our source of
// truth for TikTok engagement. Buffer exposes `post.metrics` on its
// GraphQL API — a LIST of named metric values that varies per
// service (TikTok vs IG vs LinkedIn).
//
// **IMPORTANT SCOPE REQUIREMENT** (confirmed via live introspection
// 2026-10-19): the `metrics` + `metricsUpdatedAt` fields require the
// `insights:read` scope on the Buffer API token. The current ORION
// token has only `posts:read, posts:write, account:read`. Until the
// scope is added in Buffer's dashboard, calls return
// INSUFFICIENT_SCOPE and this adapter writes a sparse snapshot
// (status + external_link only, no engagement). The sweep
// `run-tiktok-analytics-sweep.mjs` detects + logs the condition on
// first failure so the operator knows to grant the scope.
//
// Once the scope is granted, no code change is required — the next
// sweep run captures real metrics automatically.
//
// Buffer's `post.metrics` for TikTok currently returns a flexible
// LIST of metric name/value pairs. The common TikTok engagement
// surface Buffer exposes includes some subset of:
//   - impressions / views
//   - likes
//   - comments
//   - shares
//   - reach (sometimes)
//   - play_time (sometimes)
//
// We normalise whatever we get into the shared YouTube-adapter shape
// so the weekly review reads TikTok rows with the same keys as every
// other platform.

const DEFAULT_METRICS_FRAGMENT = `
  id
  status
  externalLink
  sentAt
  createdAt
  channelService
  metricsUpdatedAt
  metrics { __typename }
`;

// Buffer returns `metrics` as a polymorphic LIST — in practice the
// members have a `name` and a `value` field (plus __typename). We
// normalise by scanning for well-known names and taking the first
// value. Returns null when the metric isn't present in the response.
export function pickBufferMetric(metricsList, candidateNames) {
  const list = Array.isArray(metricsList) ? metricsList : [];
  const normalizedCandidates = candidateNames.map((n) => String(n).toLowerCase());
  for (const entry of list) {
    const name = String(entry?.name || entry?.key || '').toLowerCase();
    if (!name || !normalizedCandidates.includes(name)) continue;
    const raw = entry?.value ?? entry?.number ?? entry?.count ?? entry?.total;
    if (raw === null || raw === undefined || raw === '') continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// Detect the "scope missing" condition. Buffer returns a 200 with
// an `errors` array containing `INSUFFICIENT_SCOPE` extensions. The
// shared BufferApiClient throws on `payload.errors`, so this helper
// matches on the thrown error's message string.
export function isBufferInsightsScopeMissing(error) {
  const msg = String(error?.message || '');
  return /insufficient scope/iu.test(msg) && /insights:read/iu.test(msg);
}

export async function fetchTikTokPublicationMetrics({
  publication,
  bufferClient,
  capturedAt = new Date().toISOString(),
}) {
  const externalId = String(publication?.external_id || '').trim();
  if (!externalId) {
    throw new Error('Buffer-TikTok analytics fetch requires publication.external_id (Buffer post id).');
  }
  if (!bufferClient || typeof bufferClient.request !== 'function') {
    throw new Error('Buffer-TikTok analytics fetch requires a bufferClient with request().');
  }

  // The engagement query. `metrics` + `metricsUpdatedAt` are the only
  // fields that require insights:read; everything else works on the
  // posts:read scope we already have. If the whole call 400s on
  // scope, we fall back to the minimal query so the row still writes.
  const enrichedQuery = `
    query TikTokMetrics($input: PostInput!) {
      post(input: $input) {
        ${DEFAULT_METRICS_FRAGMENT}
      }
    }
  `;
  const minimalQuery = `
    query TikTokMetricsMinimal($input: PostInput!) {
      post(input: $input) {
        id status externalLink sentAt createdAt channelService
      }
    }
  `;

  let post = null;
  let scopeMissing = false;
  let fetchError = '';
  try {
    const data = await bufferClient.request(enrichedQuery, { input: { id: externalId } });
    post = data?.post || null;
  } catch (error) {
    if (isBufferInsightsScopeMissing(error)) {
      scopeMissing = true;
      fetchError = 'insights:read scope not granted on Buffer API token';
      // Degraded: still write the row with publication-level fields
      try {
        const data = await bufferClient.request(minimalQuery, { input: { id: externalId } });
        post = data?.post || null;
      } catch (fallbackError) {
        fetchError = `${fetchError}; fallback failed: ${fallbackError.message || fallbackError}`;
      }
    } else {
      throw error;
    }
  }

  if (!post) {
    throw new Error(`Buffer post ${externalId} returned no data`);
  }

  const metricsList = Array.isArray(post.metrics) ? post.metrics : [];
  const views = pickBufferMetric(metricsList, ['views', 'impressions', 'plays', 'video_views']);
  const likes = pickBufferMetric(metricsList, ['likes', 'like_count']);
  const comments = pickBufferMetric(metricsList, ['comments', 'comment_count']);
  const shares = pickBufferMetric(metricsList, ['shares', 'share_count']);
  const reach = pickBufferMetric(metricsList, ['reach', 'unique_viewers']);
  const playTimeMs = pickBufferMetric(metricsList, ['play_time', 'total_play_time', 'ig_reels_video_view_total_time']);

  const metrics = {
    platform: 'tiktok_video',
    external_id: externalId,
    public_url: String(post.externalLink || '').trim() || null,
    views,
    unique_viewers: reach,
    avg_view_duration_sec: null,
    avg_view_percentage: null,
    watch_time_minutes: playTimeMs != null ? Number((playTimeMs / 60000).toFixed(2)) : null,
    impressions: null,
    ctr_percentage: null,
    likes,
    comments,
    shares,
    saves: null,
    total_interactions: null,
    subs_gained: null,
    subs_lost: null,
    retention_curve: null,
    // Buffer / TikTok don't expose per-video country or traffic-source
    // breakdowns via the public API. Empty arrays preserve shape.
    viewer_countries: [],
    traffic_sources: [],
    fetch_lag_hours: null,
    captured_at: capturedAt,
    published_at: publication?.published_at || post.sentAt || publication?.created_at || null,
    video_title: String(publication?.title || '').trim(),
    buffer_metrics_updated_at: post.metricsUpdatedAt || null,
    buffer_insights_scope_missing: scopeMissing || null,
    buffer_fetch_error: fetchError || null,
  };

  return {
    metrics,
    raw_payload: {
      buffer_post: post,
      scope_missing: scopeMissing,
      fetch_error: fetchError,
    },
  };
}

// Convenience for the sweep: match a Buffer-TikTok target from the
// publication's account_key. Same shape as the Instagram helper.
export function findBufferTikTokTargetAcrossProfiles(channelProfiles, accountKey) {
  const normalized = String(accountKey || '').trim();
  if (!normalized) return null;
  for (const profile of Array.isArray(channelProfiles) ? channelProfiles : []) {
    const targets = profile?.metadata?.publisher?.targets;
    if (!Array.isArray(targets)) continue;
    const match = targets.find((t) => (
      String(t?.platform || '').toLowerCase() === 'tiktok_video'
      && String(t?.account_key || t?.accountKey || '').trim() === normalized
    ));
    if (match) return match;
  }
  return null;
}
