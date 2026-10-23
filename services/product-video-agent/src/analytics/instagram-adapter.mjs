// Instagram Reels analytics adapter.
//
// Phase 1 of the "add TikTok + Instagram to analytics" ask
// (2026-10-19 operator). The weekly analytics review was YouTube-only
// because `video_analytics` had no snapshot rows for TikTok or
// Instagram publications. This adapter closes the Instagram gap: it
// reads per-media insights from the Instagram Graph API and returns a
// snapshot shaped the same way as `youtube-adapter.mjs`'s output, so
// the sweep can write it to `video_analytics` without any schema
// change.
//
// What we can and can't capture from the Graph API for a Reel:
//
//   - **Count fields** on `/media/{id}` directly: `like_count`,
//     `comments_count`. These are the engagement numbers that match
//     YouTube's `likes` and `comments`.
//
//   - **Insights** on `/media/{id}/insights?metric=...`. Exact metric
//     names confirmed 2026-10-19 against the live Graph API error
//     response — using any other spelling 400s the entire call:
//       views                        → view count (YouTube `views` analogue)
//       reach                        → unique accounts reached
//       shares                       → reshare count
//       saved                        → bookmark count (NB: `saved`, not `saves`)
//       total_interactions           → aggregated engagement count
//       ig_reels_avg_watch_time      → avg watch time in ms (retention signal)
//       ig_reels_video_view_total_time → total watch time in ms
//
// Instagram Graph API doesn't give us per-video country breakdowns or
// hour-of-watch distribution — those live only in the Instagram UI's
// own insights tab and are not exposed to third-party apps. The
// returned metrics will have `viewer_countries: []` and
// `traffic_sources: []` so the weekly review's existing geo/traffic
// aggregation treats them as "no data yet" rather than crashing on
// missing fields (matches the YouTube adapter's behaviour before the
// 2026-09-21 enrichment landed).
//
// Bonus: avg watch time IS exposed here (`ig_reels_avg_watch_time`)
// while the YouTube equivalent is still an outstanding instrumentation
// gap. So Reels will carry retention data the YouTube Shorts rows
// don't — the review script can start reporting on it directly.

import {
  createInstagramGraphClient,
  InstagramGraphApiError,
} from '../instagram-publication-executor.mjs';

const DEFAULT_INSIGHTS_METRICS = Object.freeze([
  'views',
  'reach',
  'shares',
  'saved',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
]);

// Pull the insight value for one metric name out of the Graph API
// response. Shape is `{ data: [{ name, values: [{ value }], ... }, ... ] }`.
function pickInsightValue(payload, metric) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const row = entries.find((entry) => String(entry?.name || '').toLowerCase() === metric.toLowerCase());
  if (!row) return null;
  const values = Array.isArray(row.values) ? row.values : [];
  const first = values[0];
  if (!first) return null;
  const value = first.value;
  if (value === undefined || value === null) return null;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeNumeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// Build the Graph client for a given Instagram publisher target. The
// target shape mirrors what lives inside each YouTube channel's
// `metadata.publisher.targets[]` with `platform: 'instagram_reels'`
// (see publication-channels.example.json).
export function resolveInstagramTarget(channelProfile, accountKey) {
  const targets = channelProfile?.metadata?.publisher?.targets;
  if (!Array.isArray(targets)) return null;
  const normalized = String(accountKey || '').trim();
  if (!normalized) return null;
  return targets.find((t) => (
    String(t?.platform || '').toLowerCase() === 'instagram_reels'
    && String(t?.account_key || t?.accountKey || '').trim() === normalized
  )) || null;
}

export async function fetchInstagramPublicationMetrics({
  publication,
  target,
  runtimeEnv,
  fetchImpl = globalThis.fetch,
  capturedAt = new Date().toISOString(),
  graphClient = null,
  insightsMetrics = DEFAULT_INSIGHTS_METRICS,
}) {
  const externalId = String(publication?.external_id || '').trim();
  if (!externalId) {
    throw new Error('Instagram analytics fetch requires publication.external_id (media id).');
  }
  if (!target) {
    throw new Error('Instagram analytics fetch requires a resolved publisher target.');
  }

  const client = graphClient || createInstagramGraphClient(runtimeEnv || {}, target, { fetchImpl });

  // Two parallel requests: media-level count fields + insights. The
  // Graph API returns `like_count` / `comments_count` on the media
  // object itself (NOT in insights), so we need both to populate the
  // YouTube-shaped `views / likes / comments` triple.
  const [mediaPayload, insightsPayload] = await Promise.all([
    client.request(externalId, {
      query: { fields: 'id,media_type,permalink,timestamp,like_count,comments_count' },
    }),
    client.request(`${externalId}/insights`, {
      query: { metric: insightsMetrics.join(',') },
    }).catch((error) => {
      // A per-metric 400 from Instagram can tank the whole insights
      // response (e.g. `plays` isn't available on IMAGE-type media).
      // Preserve the error on the raw payload for debugging but keep
      // the snapshot write going with just the media-level counts.
      if (error instanceof InstagramGraphApiError) return { data: [], __error: error.message };
      throw error;
    }),
  ]);

  const views = pickInsightValue(insightsPayload, 'views');
  const reach = pickInsightValue(insightsPayload, 'reach');
  const shares = pickInsightValue(insightsPayload, 'shares');
  const saved = pickInsightValue(insightsPayload, 'saved');
  const totalInteractions = pickInsightValue(insightsPayload, 'total_interactions');
  // Instagram returns watch-time insights in milliseconds. Normalise
  // to the same units the YouTube adapter uses so the weekly review
  // can read `avg_view_duration_sec` and `watch_time_minutes` without
  // per-platform branching.
  const avgWatchTimeMs = pickInsightValue(insightsPayload, 'ig_reels_avg_watch_time');
  const totalWatchTimeMs = pickInsightValue(insightsPayload, 'ig_reels_video_view_total_time');
  const avgViewDurationSec = avgWatchTimeMs != null ? Number((avgWatchTimeMs / 1000).toFixed(2)) : null;
  const watchTimeMinutes = totalWatchTimeMs != null ? Number((totalWatchTimeMs / 60000).toFixed(2)) : null;
  const likes = normalizeNumeric(mediaPayload?.like_count);
  const comments = normalizeNumeric(mediaPayload?.comments_count);
  const permalink = String(mediaPayload?.permalink || '').trim();

  const metrics = {
    platform: 'instagram_reels',
    external_id: externalId,
    public_url: permalink || null,
    views,
    unique_viewers: reach,
    avg_view_duration_sec: avgViewDurationSec,
    avg_view_percentage: null,
    watch_time_minutes: watchTimeMinutes,
    impressions: null,
    ctr_percentage: null,
    likes,
    comments,
    shares,
    saves: saved,
    total_interactions: totalInteractions,
    subs_gained: null,
    subs_lost: null,
    retention_curve: null,
    // Instagram Graph doesn't expose per-video country or traffic-source
    // breakdowns to third-party apps. Empty arrays here keep the review
    // script's geo + traffic aggregation treating these rows as "no
    // data yet" rather than crashing on missing fields — matches the
    // YouTube adapter's behaviour before the 2026-09-21 enrichment.
    viewer_countries: [],
    traffic_sources: [],
    fetch_lag_hours: null,
    captured_at: capturedAt,
    published_at: publication?.published_at || publication?.uploaded_at || publication?.created_at || null,
    video_title: String(publication?.title || '').trim(),
  };

  return {
    metrics,
    raw_payload: {
      instagram_media: mediaPayload,
      instagram_insights: insightsPayload,
    },
  };
}

// Convenience for the sweep script: given a channel-profiles list and
// the account_key on an Instagram publication row, find the target
// definition (which carries the access_token_env + user_id).
export function findInstagramTargetAcrossProfiles(channelProfiles, accountKey) {
  const normalized = String(accountKey || '').trim();
  if (!normalized) return null;
  for (const profile of Array.isArray(channelProfiles) ? channelProfiles : []) {
    const target = resolveInstagramTarget(profile, normalized);
    if (target) return target;
  }
  return null;
}
