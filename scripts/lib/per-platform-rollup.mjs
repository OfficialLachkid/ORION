// Per-platform rollup helpers for the weekly analytics review.
// Extracted from scripts/run-weekly-analytics-review.mjs to keep that
// script under the 700-line guardrail. Pure data-shaping + Supabase
// fetchers; the main script owns the Supabase client and passes it in.

// Pokemon channel account_keys per non-YouTube platform. Kept
// explicit (not derived from publication-channels config) so a stray
// new account on another brand doesn't accidentally join the review.
// Dexguess + proffmon aren't on TikTok (operator confirmed 2026-10-19).
export const POKE_CHANNELS_INSTAGRAM = new Set([
  'poke-quizzz-instagram',
  'poke-guess-instagram',
  'dexguess-instagram',
  'trivamon-instagram',
  'proffmon-instagram',
]);
export const POKE_CHANNELS_TIKTOK = new Set([
  'poke-quizz-tiktok',
  'poke-guess-tiktok',
  'trivamon-tiktok',
]);

// Platform allowlist for the cross-platform activity rollup. The
// bare `tiktok` platform (direct TikTok OAuth) is intentionally
// excluded — the TikTok Developer app review isn't approved yet, so
// all production TikTok traffic runs via Buffer under `tiktok_video`
// (operator confirmed 2026-10-18). If direct TikTok ever ships, add
// it here.
export const CROSS_PLATFORM_ALLOWLIST = Object.freeze(['youtube_shorts', 'tiktok_video', 'instagram_reels']);
export const CROSS_PLATFORM_LABELS = Object.freeze({
  youtube_shorts: 'YouTube Shorts',
  tiktok_video: 'TikTok (via Buffer)',
  instagram_reels: 'Instagram Reels',
});
export const CROSS_PLATFORM_ANALYTICS_STATUS = Object.freeze({
  youtube_shorts: 'full — views, likes, geo, traffic sources',
  tiktok_video: 'not yet captured — adapter pending (planned follow-up)',
  instagram_reels: 'not yet captured — adapter pending (planned follow-up)',
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
// snapshot (and TikTok rows with buffer_insights_scope_missing)
// count as "with_metrics=false" so we don't dilute averages with
// zeros. Returns null if nothing is passed in (keeps buildDataPack
// backward compatible with older test harnesses).
export function buildPerPlatformPerformance({ platforms } = {}) {
  if (!platforms || typeof platforms !== 'object') return null;
  const out = {};
  for (const [platform, { publications = [], analyticsByPub = new Map() } = {}] of Object.entries(platforms)) {
    let totalViews = 0;
    let totalLikes = 0;
    let totalComments = 0;
    let withMetrics = 0;
    let scopeMissing = 0;
    const viewsList = [];
    const watchSecList = [];
    for (const pub of publications) {
      const snapshot = analyticsByPub.get(pub.id);
      const metrics = snapshot?.metrics || null;
      if (!metrics) continue;
      // TikTok sparse rows have null views when Buffer insights:read
      // isn't granted. Don't count them as "with metrics".
      if (metrics.buffer_insights_scope_missing) { scopeMissing += 1; continue; }
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
      videos_sparse_scope_missing: scopeMissing,
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
