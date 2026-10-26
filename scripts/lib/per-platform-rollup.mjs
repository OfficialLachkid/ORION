// Per-platform rollup helpers for the weekly analytics review.
// Extracted from scripts/run-weekly-analytics-review.mjs to keep that
// script under the 700-line guardrail. Pure data-shaping + Supabase
// fetchers; the main script owns the Supabase client and passes it in.

// Pokemon channel account_keys for Instagram. Kept explicit (not
// derived from publication-channels config) so a stray new account
// on another brand doesn't accidentally join the review.
export const POKE_CHANNELS_INSTAGRAM = new Set([
  'poke-quizzz-instagram',
  'poke-guess-instagram',
  'dexguess-instagram',
  'trivamon-instagram',
  'proffmon-instagram',
]);

// Platform allowlist for the cross-platform activity rollup
// (publishing cadence only; engagement is per-platform below).
// Includes `tiktok_video` so TikTok cadence still surfaces — ORION
// publishes there via Buffer under this platform code (direct
// `tiktok` OAuth isn't approved yet). Engagement capture for
// `tiktok_video` is NOT included: Buffer's `insights:read` scope is
// gated behind a paid tier the operator opted out of (2026-10-26),
// so only publishing metadata (status + external_link) is
// available, which the cadence rollup already derives from
// `video_publications` without any Buffer calls.
export const CROSS_PLATFORM_ALLOWLIST = Object.freeze(['youtube_shorts', 'tiktok_video', 'instagram_reels']);
export const CROSS_PLATFORM_LABELS = Object.freeze({
  youtube_shorts: 'YouTube Shorts',
  tiktok_video: 'TikTok (via Buffer)',
  instagram_reels: 'Instagram Reels',
});
export const CROSS_PLATFORM_ANALYTICS_STATUS = Object.freeze({
  youtube_shorts: 'full — views, likes, geo, traffic sources',
  tiktok_video: 'cadence only — Buffer free tier does not expose engagement metrics; no sweep runs',
  instagram_reels: 'full — views, reach, likes, saves, shares, avg watch time',
});

// Fetch non-YouTube pokemon publications in the window. Separate from
// the main YouTube fetcher because the YouTube deep-dive drives most
// of the review (per-channel/template/slot analysis), while
// Instagram + TikTok feed only the per-platform summary block.
export async function fetchPokemonPublicationsForPlatform(supabaseFetch, sinceIso, platform, allowlist) {
  const rows = await supabaseFetch(
    `video_publications?platform=eq.${encodeURIComponent(platform)}&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.asc&limit=2000`,
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => allowlist.has(row.account_key));
}

export async function fetchCrossPlatformActivity(supabaseFetch, sinceIso, untilIso) {
  const rows = await supabaseFetch(
    `video_publications?status=eq.published&published_at=gte.${encodeURIComponent(sinceIso)}&published_at=lt.${encodeURIComponent(untilIso)}&select=platform,account_key&limit=5000`,
  );
  const list = Array.isArray(rows) ? rows : [];
  const perPlatform = {};
  for (const platform of CROSS_PLATFORM_ALLOWLIST) {
    perPlatform[platform] = { publications: 0, channels: new Set() };
  }
  for (const row of list) {
    const bucket = perPlatform[row.platform];
    if (!bucket) continue;
    bucket.publications += 1;
    if (row.account_key) bucket.channels.add(row.account_key);
  }
  const summary = {};
  let total = 0;
  for (const platform of CROSS_PLATFORM_ALLOWLIST) {
    const b = perPlatform[platform];
    total += b.publications;
    summary[platform] = {
      label: CROSS_PLATFORM_LABELS[platform],
      publications: b.publications,
      channels: [...b.channels].sort(),
      analytics_capture: CROSS_PLATFORM_ANALYTICS_STATUS[platform],
    };
  }
  return {
    window: { since: sinceIso, until: untilIso },
    total_published_all_platforms: total,
    per_platform: summary,
  };
}

// Build a per-platform engagement summary. For each platform the
// operator cares about, roll up the publications + their analytics
// into totals / per-video / like-rate. Rows with no analytics
// snapshot count as "with_metrics=false" so we don't dilute
// averages with zeros. Returns null if nothing is passed in (keeps
// buildDataPack backward compatible with older test harnesses).
export function buildPerPlatformPerformance({ platforms } = {}) {
  if (!platforms || typeof platforms !== 'object') return null;
  const out = {};
  for (const [platform, { publications = [], analyticsByPub = new Map() } = {}] of Object.entries(platforms)) {
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let withMetrics = 0;
    const viewsList = [];
    const watchSecList = [];
    for (const pub of publications) {
      const snapshot = analyticsByPub.get(pub.id);
      const metrics = snapshot?.metrics || null;
      if (!metrics) continue;
      const views = Number.isFinite(Number(metrics.views)) ? Number(metrics.views) : null;
      if (views === null) continue;
      withMetrics += 1;
      totalViews += views;
      totalLikes += Number(metrics.likes || 0);
      totalComments += Number(metrics.comments || 0);
      viewsList.push(views);
      if (Number.isFinite(Number(metrics.avg_view_duration_sec))) watchSecList.push(Number(metrics.avg_view_duration_sec));
    }
    viewsList.sort((a, b) => a - b);
    out[platform] = {
      publications: publications.length,
      videos_with_metrics: withMetrics,
      total_views: totalViews,
      total_likes: totalLikes,
      total_comments: totalComments,
      views_per_video: withMetrics ? Math.round(totalViews / withMetrics) : 0,
      median_views: viewsList.length ? viewsList[Math.floor(viewsList.length / 2)] : 0,
      like_rate_pct: totalViews ? Number(((totalLikes / totalViews) * 100).toFixed(2)) : 0,
      avg_watch_sec_median: watchSecList.length
        ? Number(watchSecList.sort((a, b) => a - b)[Math.floor(watchSecList.length / 2)].toFixed(2))
        : null,
    };
  }
  return out;
}
