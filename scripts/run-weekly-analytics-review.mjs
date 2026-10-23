#!/usr/bin/env node
// Weekly analytics review: builds a compact data pack from the last 7 days
// of pokemon video analytics, feeds it to Claude for an "analyst" pass,
// and posts the resulting summary to a dedicated Discord thread. The
// operator reads the summary in Discord and applies any recommended
// changes manually — this script does NOT open PRs or edit configs, per
// the 2026-09-21 operator ask.
//
// Scheduled via scripts/install-weekly-analytics-review-schedule.mjs
// (Sundays 08:00 CEST).

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { sendDiscordChannelMessage } from './lib/discord-post.mjs';

const STATE_PATH = resolve(projectRoot, 'data', 'analytics', 'weekly-review-state.json');
const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const THREAD_AUTO_ARCHIVE_MINUTES = 10080; // 7 days
const POKE_CHANNELS = new Set([
  'poke-quizz-youtube',
  'poke-guess-youtube',
  'dexguess-youtube',
  'trivamon-youtube',
  'proffmon-youtube',
]);

// Pokemon channel account_keys per non-YouTube platform. Kept
// explicit (not derived from publication-channels config) so a stray
// new account on another brand doesn't accidentally join the review.
// Dexguess + proffmon aren't on TikTok (operator confirmed 2026-10-19).
const POKE_CHANNELS_INSTAGRAM = new Set([
  'poke-quizzz-instagram',
  'poke-guess-instagram',
  'dexguess-instagram',
  'trivamon-instagram',
  'proffmon-instagram',
]);
const POKE_CHANNELS_TIKTOK = new Set([
  'poke-quizz-tiktok',
  'poke-guess-tiktok',
  'trivamon-tiktok',
]);

// Cap on what we feed Claude. Well under the token budget of a single
// claude -p call, but enough to give it real signal per template and per
// channel.
const TOP_VIDEOS_TO_INCLUDE = 15;
const BOTTOM_VIDEOS_TO_INCLUDE = 5;

// ─── Supabase helpers ──────────────────────────────────────────────

function supabaseFetch(config, path) {
  const url = new URL(`/rest/v1/${path}`, config.env.SUPABASE_URL);
  const apiKey = config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_PUBLISHABLE_KEY;
  if (!config.env.SUPABASE_URL || !apiKey) {
    throw new Error('Weekly analytics review requires SUPABASE_URL and a Supabase API key.');
  }
  return fetch(url, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Supabase ${path} failed (${response.status}): ${await response.text()}`);
    }
    return response.json();
  });
}

async function fetchPokemonPublications(config, sinceIso) {
  const rows = await supabaseFetch(
    config,
    `video_publications?platform=eq.youtube_shorts&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,hashtags,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.asc&limit=2000`,
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => POKE_CHANNELS.has(row.account_key));
}

// Fetch non-YouTube pokemon publications in the window. Separate from
// fetchPokemonPublications because the main YouTube deep-dive drives
// most of the review (per-channel/template/slot analysis), while
// Instagram + TikTok feed only the per-platform summary block.
async function fetchPokemonPublicationsForPlatform(config, sinceIso, platform, allowlist) {
  const rows = await supabaseFetch(
    config,
    `video_publications?platform=eq.${encodeURIComponent(platform)}&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.asc&limit=2000`,
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => allowlist.has(row.account_key));
}

// Platform allowlist for the cross-platform activity rollup. The
// bare `tiktok` platform (direct TikTok OAuth) is intentionally
// excluded — the TikTok Developer app review isn't approved yet, so
// all production TikTok traffic runs via Buffer under `tiktok_video`
// (operator confirmed 2026-10-18). If direct TikTok ever ships, add
// it here.
const CROSS_PLATFORM_ALLOWLIST = Object.freeze(['youtube_shorts', 'tiktok_video', 'instagram_reels']);
const CROSS_PLATFORM_LABELS = Object.freeze({
  youtube_shorts: 'YouTube Shorts',
  tiktok_video: 'TikTok (via Buffer)',
  instagram_reels: 'Instagram Reels',
});
const CROSS_PLATFORM_ANALYTICS_STATUS = Object.freeze({
  youtube_shorts: 'full — views, likes, geo, traffic sources',
  tiktok_video: 'not yet captured — adapter pending (planned follow-up)',
  instagram_reels: 'not yet captured — adapter pending (planned follow-up)',
});

async function fetchCrossPlatformActivity(config, sinceIso, untilIso) {
  const rows = await supabaseFetch(
    config,
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

async function fetchLatestAnalyticsByPub(config, publicationIds = []) {
  if (publicationIds.length === 0) return new Map();
  const chunkSize = 100;
  const analyticsByPub = new Map();
  for (let i = 0; i < publicationIds.length; i += chunkSize) {
    const batch = publicationIds.slice(i, i + chunkSize);
    const idsFilter = batch.map((id) => `"${id}"`).join(',');
    const rows = await supabaseFetch(
      config,
      `video_analytics?publication_id=in.(${idsFilter})&order=captured_at.desc&limit=10000&select=publication_id,captured_at,metrics`,
    );
    for (const row of Array.isArray(rows) ? rows : []) {
      // rows come back captured_at DESC, so first entry per pub is the freshest
      if (!analyticsByPub.has(row.publication_id)) {
        analyticsByPub.set(row.publication_id, row);
      }
    }
  }
  return analyticsByPub;
}

// ─── Data pack shape ───────────────────────────────────────────────

function templateSlugFromMetadata(metadata) {
  const tplId = String(metadata?.template_id || '').trim();
  if (!tplId) return 'unknown';
  return tplId.replace(/^pokemon\./u, '').replace(/\.v\d+$/u, '');
}

function summarizeChannel(publications, analyticsByPub) {
  let totalViews = 0;
  let totalLikes = 0;
  let totalComments = 0;
  let countWithAnalytics = 0;
  const viewsList = [];
  for (const pub of publications) {
    const row = analyticsByPub.get(pub.id);
    const metrics = row?.metrics || null;
    if (!metrics) continue;
    const views = Number(metrics.views || 0);
    const likes = Number(metrics.likes || 0);
    const comments = Number(metrics.comments || 0);
    totalViews += views;
    totalLikes += likes;
    totalComments += comments;
    viewsList.push(views);
    countWithAnalytics += 1;
  }
  viewsList.sort((a, b) => a - b);
  const median = viewsList.length ? viewsList[Math.floor(viewsList.length / 2)] : 0;
  const viewsPerVideo = countWithAnalytics ? Math.round(totalViews / countWithAnalytics) : 0;
  const likesPerVideo = countWithAnalytics ? Number((totalLikes / countWithAnalytics).toFixed(2)) : 0;
  const likeRatePct = totalViews ? Number(((totalLikes / totalViews) * 100).toFixed(2)) : 0;
  return {
    videos_published: publications.length,
    videos_with_analytics: countWithAnalytics,
    total_views: totalViews,
    total_likes: totalLikes,
    total_comments: totalComments,
    views_per_video: viewsPerVideo,
    median_views: median,
    likes_per_video: likesPerVideo,
    like_rate_pct: likeRatePct,
  };
}

// Hashtag capture is best-effort: the top-level `hashtags` column on
// video_publications is the source of truth (populated at publish time),
// but historical rows may only carry them under
// metadata.manifest_publication.hashtags, and future analytics writers
// might attach them to the metrics row itself. Prefer the freshest
// non-empty source in that order.
function pickHashtags(metrics, pub) {
  const candidates = [
    Array.isArray(metrics?.hashtags) ? metrics.hashtags : null,
    Array.isArray(pub?.hashtags) ? pub.hashtags : null,
    Array.isArray(pub?.metadata?.manifest_publication?.hashtags)
      ? pub.metadata.manifest_publication.hashtags
      : null,
  ];
  for (const list of candidates) {
    if (list && list.length > 0) return list;
  }
  return [];
}

// Build a per-platform engagement summary. For each platform the
// operator cares about, roll up the publications + their analytics
// into totals / per-video / like-rate. Rows with no analytics
// snapshot (and TikTok rows with buffer_insights_scope_missing)
// count as "with_metrics=false" so we don't dilute averages with
// zeros. Returns null if nothing is passed in (keeps buildDataPack
// backward compatible with older test harnesses).
function buildPerPlatformPerformance({ platforms } = {}) {
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

function buildDataPack({ publications, analyticsByPub, sinceIso, untilIso, crossPlatformActivity = null, perPlatformPerformance = null }) {
  const byChannel = new Map();
  const byTemplate = new Map();
  const scoredVideos = [];

  for (const pub of publications) {
    const ch = pub.account_key;
    const tpl = templateSlugFromMetadata(pub.metadata);
    if (!byChannel.has(ch)) byChannel.set(ch, []);
    byChannel.get(ch).push(pub);
    if (!byTemplate.has(tpl)) byTemplate.set(tpl, []);
    byTemplate.get(tpl).push(pub);

    const row = analyticsByPub.get(pub.id);
    const metrics = row?.metrics || {};
    scoredVideos.push({
      channel: ch,
      template: tpl,
      title: String(pub.title || '').replace(/\s+/gu, ' ').trim(),
      published_at: pub.published_at,
      external_id: pub.external_id || metrics.external_id || '',
      views: Number(metrics.views || 0),
      likes: Number(metrics.likes || 0),
      comments: Number(metrics.comments || 0),
      hashtags: pickHashtags(metrics, pub),
      viewer_countries: Array.isArray(metrics.viewer_countries) ? metrics.viewer_countries : [],
      traffic_sources: Array.isArray(metrics.traffic_sources) ? metrics.traffic_sources : [],
    });
  }

  const channelSummaries = {};
  for (const [ch, pubs] of byChannel.entries()) {
    channelSummaries[ch] = summarizeChannel(pubs, analyticsByPub);
  }

  const templateSummaries = {};
  for (const [tpl, pubs] of byTemplate.entries()) {
    templateSummaries[tpl] = summarizeChannel(pubs, analyticsByPub);
  }

  scoredVideos.sort((a, b) => b.views - a.views);
  const topVideos = scoredVideos.slice(0, TOP_VIDEOS_TO_INCLUDE);
  const bottomVideos = scoredVideos.slice(-BOTTOM_VIDEOS_TO_INCLUDE).reverse();

  // Publish-hour rollup (UTC-based per YouTube's published_at). We're
  // currently posting at 08/12/14 CEST across all channels — this rollup
  // exposes whether one of those slots actually pulls more views than the
  // others so the analyst can reason about per-channel schedule changes.
  const publishHourBuckets = buildPublishHourBuckets(scoredVideos);
  const publishHourByChannel = {};
  const scoredByChannel = groupBy(scoredVideos, (v) => v.channel);
  for (const [ch, vids] of Object.entries(scoredByChannel)) {
    publishHourByChannel[ch] = buildPublishHourBuckets(vids);
  }

  // Geography + traffic-source rollups — sum per-video top-N lists into
  // network-wide and per-channel view splits so the analyst can reason
  // about where viewers come from without walking every video row.
  const networkGeoTotals = aggregateDimensionBreakdown(scoredVideos.map((v) => v.viewer_countries));
  const networkTrafficTotals = aggregateDimensionBreakdown(scoredVideos.map((v) => v.traffic_sources));
  const geoByChannel = {};
  const trafficByChannel = {};
  for (const [ch, vids] of Object.entries(scoredByChannel)) {
    geoByChannel[ch] = aggregateDimensionBreakdown(vids.map((v) => v.viewer_countries));
    trafficByChannel[ch] = aggregateDimensionBreakdown(vids.map((v) => v.traffic_sources));
  }
  const geoCoverage = scoredVideos.filter((v) => v.viewer_countries.length > 0).length;
  const trafficCoverage = scoredVideos.filter((v) => v.traffic_sources.length > 0).length;

  // Only surface gaps we STILL can't answer (retention + hourly). Geo +
  // traffic dropped from the list on 2026-09-21 when the youtube-adapter
  // started pulling dimensions=country + insightTrafficSourceType — but
  // if this run's coverage is 0 (no analytics sweep has hit any video
  // yet with the new adapter), keep them in the gap list with an
  // explanation so the analyst doesn't try to answer from empty data.
  const instrumentationGaps = [
    'hourly view distribution (when viewers actually watch vs when we posted) — needs `dimensions=day + startTime + endTime` slicing',
    'retention curve + average view % — currently NULL; needs the retention audit query',
  ];
  if (geoCoverage === 0) {
    instrumentationGaps.push('viewer geography — collected via the enriched adapter but this week no rows have populated data yet; expect full coverage next review');
  }
  if (trafficCoverage === 0) {
    instrumentationGaps.push('traffic sources — collected via the enriched adapter but this week no rows have populated data yet; expect full coverage next review');
  }

  return {
    window: { since: sinceIso, until: untilIso, days: 7 },
    totals: {
      publications: publications.length,
      videos_with_analytics: scoredVideos.length,
      total_views: scoredVideos.reduce((sum, v) => sum + v.views, 0),
      total_likes: scoredVideos.reduce((sum, v) => sum + v.likes, 0),
    },
    per_channel: channelSummaries,
    per_template: templateSummaries,
    publish_hour_rollup: {
      note: 'hours are UTC. current schedule fires 08/12/14 CEST which is 06/10/12 UTC (or 07/11/13 UTC on standard time).',
      network_wide: publishHourBuckets,
      per_channel: publishHourByChannel,
    },
    viewer_geography: {
      videos_with_data: geoCoverage,
      videos_total: scoredVideos.length,
      network_wide_top_countries: networkGeoTotals,
      per_channel_top_countries: geoByChannel,
    },
    traffic_sources_split: {
      videos_with_data: trafficCoverage,
      videos_total: scoredVideos.length,
      network_wide: networkTrafficTotals,
      per_channel: trafficByChannel,
    },
    instrumentation_gaps: instrumentationGaps,
    cross_platform_activity: crossPlatformActivity || null,
    per_platform_performance: perPlatformPerformance || null,
    top_videos: topVideos,
    bottom_videos: bottomVideos,
  };
}

// Sum {key, views} lists across multiple videos into a single sorted
// distribution — used for both geography (country codes) and traffic
// sources (insightTrafficSourceType values).
function aggregateDimensionBreakdown(perVideoLists = []) {
  const totals = new Map();
  for (const list of perVideoLists) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || !entry.key) continue;
      totals.set(entry.key, (totals.get(entry.key) || 0) + Number(entry.views || 0));
    }
  }
  return [...totals.entries()]
    .map(([key, views]) => ({ key, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 15);
}

function groupBy(items, keyFn) {
  const out = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!out[key]) out[key] = [];
    out[key].push(item);
  }
  return out;
}

// Rollup of average / median views per UTC publish hour. Enough signal to
// tell whether the current 08/12/14 CEST slots split into a winner + a
// loser, or whether they're all roughly equivalent — without needing a
// separate YouTube-Analytics geo/hour query.
function buildPublishHourBuckets(videos) {
  const byHour = {};
  for (const v of videos) {
    if (!v.published_at) continue;
    const hour = new Date(v.published_at).getUTCHours();
    if (!byHour[hour]) byHour[hour] = [];
    byHour[hour].push(v.views || 0);
  }
  const rollup = {};
  for (const [hour, viewsList] of Object.entries(byHour)) {
    const sorted = [...viewsList].sort((a, b) => a - b);
    const total = viewsList.reduce((s, n) => s + n, 0);
    rollup[hour] = {
      videos: viewsList.length,
      total_views: total,
      median_views: sorted[Math.floor(sorted.length / 2)] || 0,
      avg_views: viewsList.length ? Math.round(total / viewsList.length) : 0,
    };
  }
  return rollup;
}

// ─── Claude call ────────────────────────────────────────────────────

function buildAnalystPrompt(dataPack, priorSummary = '') {
  const lines = [
    'You are an analyst for a Pokemon quiz Shorts network on YouTube. Read the JSON data pack below (last 7 days of published Shorts across 5 channels) and produce a concise operator-facing weekly review.',
    '',
    'FORMATTING: every concrete number you cite (view count, like count, v/vid, like-rate %, median, delta, hour, etc.) MUST be wrapped in bold with double-asterisks so it stands out at a glance in Discord. Example: "poke-quizz-youtube pulled **2070 v/vid** on **90 videos** (like-rate **1.33%**)." This is non-negotiable — plain numbers get lost in the wall of text.',
    '',
    'Structure your response as:',
    '0. **Cross-platform posting activity + per-platform performance** — read `cross_platform_activity` AND `per_platform_performance`. In the FIRST paragraph: total posts across platforms this week, split by platform (YouTube Shorts, TikTok via Buffer, Instagram Reels) with channel counts. Bold every count. In the SECOND paragraph: a per-platform performance comparison from `per_platform_performance` — total views, v/vid, median, like-rate for each platform where `videos_with_metrics > 0`. Call out which platform is pulling the most engagement per video, and if a platform is sparse-only (`videos_sparse_scope_missing > 0 and videos_with_metrics == 0`) say so and name the fix (e.g. for TikTok: "Buffer insights:read scope not yet granted — once granted, next sweep rolls in metrics"). Instagram Reels DOES carry an avg-watch-time signal (`avg_watch_sec_median`) that YouTube Shorts does not — call it out when present. You MAY now make cautious cross-platform observations ("pixelated-reveal pulls 2x the views per video on Instagram vs YouTube this week — worth a template-mix tilt test"), but still prefix any strong recommendation with the sample sizes so the operator can judge confidence. If both blocks are null/missing, skip this section silently.',
    '1. **This week in numbers (YouTube Shorts deep-dive)** — 2-3 sentences on YouTube totals + which channel/template stood out. Bold every number. This is the deepest-signal platform (full analytics capture); the other sections cover cross-platform at a lighter grain.',
    '2. **What is working** — 2-4 bullets identifying the templates or channels moving up, with the specific v/vid or like-rate numbers as evidence.',
    '3. **What is not working** — 2-4 bullets on underperformers or drops relative to peers. Do NOT recommend killing a channel or template with fewer than 20 videos in the window (undersampled).',
    '4. **Scheduling signal** — the network runs these per-channel CEST slots: poke-quizz 08:00/11:00/12:00 (3/day), trivamon 08:00/12:00/18:00/22:00 (4/day), proffmon 08:00/12:00/14:00 (3/day), poke-guess 08:00/12:00/18:00 (3/day), dexguess 08:00/12:00/18:00 (3/day). Three concurrent experiments this week: (i) poke-quizz is testing winner-adjacency — moving its 14:00 slot to 11:00 CEST, a tight 1h gap to the proven 12:00 CEST winner, to answer "is 12:00 a magic hour or a noon-audience-window effect"; (ii) trivamon, poke-guess, and dexguess run an 18:00 CEST slot against proffmon on 14:00 as the control; (iii) trivamon is additionally testing a 4/day cadence bump with a new 22:00 CEST slot (= 20 UTC = 16:00 EDT, US workday afternoon) — the strongest, most US-skewed channel is the one place where "more at-bats" is most likely to print, if the per-video floor holds. Read the `publish_hour_rollup` block. Answer: (a) does one UTC hour slot pull materially more views than the others network-wide, (b) does the picture differ per channel, (c) for the three experiments above, is each one working — specifically (i) does poke-quizz at 11 UTC perform near its 10 UTC winner, (ii) does 18:00 hold up on trivamon the way it did on poke-guess last week, (iii) does trivamon\'s 4th slot (20 UTC) deliver incremental views without dropping the per-video floor more than ~25%. Cross-reference with `viewer_geography` — if most viewers are in one timezone the "best hour" may differ from a naive views-per-UTC read. If the per-slot sample is small (< 5 videos) say so rather than over-fit. Treat all per-channel slot differences as intentional, not drift. Flag any remaining `instrumentation_gaps`.',
    '4b. **Audience mix (geo + traffic)** — read `viewer_geography` and `traffic_sources_split`. Report the top-3 countries network-wide (with view %s) and any channel that skews meaningfully differently from the network mix. Then report the traffic-source split (browse / suggested / search / external) — is one source disproportionately carrying a channel or template? If `videos_with_data` is 0 for either block, say "no data yet, expected next review" and skip the section rather than fabricate.',
    '5. **Concrete adjustments to consider** — a bulleted list of specific things the operator could try. Each bullet must include: WHAT to change (template weight, title pattern, hashtag mix, thumbnail idea, posting cadence), WHERE to change it (which channel or template), and WHY (which datapoint in the pack supports it). Bold every number cited as evidence.',
    '6. **Metadata patterns** — 1-3 bullets describing patterns in the top-video titles/hashtags that do NOT appear in the bottom-video titles/hashtags.',
    '7. **Needs manual investigation** — anything you cannot decide from data alone (e.g., "trivamon lagging by 15% on medians — worth eyeballing thumbnails / upload timing manually"). Include any instrumentation gaps that block a real answer.',
    '',
    'Tone: analytical, terse, no marketing language, no filler. It is fine to say "no clear signal this week" for any section if the data does not support a conclusion. Do NOT recommend permanent deprecations from a single week of data.',
    '',
    'Do NOT open PRs or edit configs. The operator reads your summary in Discord and applies changes manually. Your job is to help them SEE the signal, not to act on it.',
    '',
  ];
  if (priorSummary) {
    lines.push('=== Previous week\'s summary (for continuity — reference briefly if any of your prior suggestions produced visible movement) ===');
    lines.push(priorSummary);
    lines.push('');
  }
  lines.push('=== This week\'s data pack (JSON) ===');
  lines.push('```json');
  lines.push(JSON.stringify(dataPack, null, 2));
  lines.push('```');
  return lines.join('\n');
}

function runClaudeAnalysis(prompt, config) {
  return new Promise((resolvePromise, rejectPromise) => {
    const command = config?.env?.CLAUDE_COMMAND || 'claude';
    const model = config?.env?.CLAUDE_MODEL || 'sonnet';
    const child = spawn(command, ['-p', prompt, '--model', model], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: projectRoot,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', (error) => rejectPromise(error));
    child.once('close', (code) => {
      if (code !== 0) {
        rejectPromise(new Error(`claude -p exited ${code}. stderr: ${stderr.trim().slice(0, 500) || '(empty)'}`));
        return;
      }
      resolvePromise(stdout.trim());
    });
  });
}

// ─── Discord thread management ─────────────────────────────────────

async function createDiscordThreadFromMessage({ config, channelId, messageId, name }) {
  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  if (!token) throw new Error('Discord thread creation requires DISCORD_BOT_TOKEN.');
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}/threads`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, auto_archive_duration: THREAD_AUTO_ARCHIVE_MINUTES }),
  });
  if (!response.ok) {
    throw new Error(`Discord thread creation failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function postToThread({ config, threadId, content }) {
  const token = config?.env?.DISCORD_BOT_TOKEN || '';
  if (!token) throw new Error('Discord thread post requires DISCORD_BOT_TOKEN.');
  // Discord message limit is 2000 chars; chunk if the report is longer.
  const chunks = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= 1950) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf('\n', 1950);
    if (cut < 500) cut = 1950; // no newline near the cap — hard-split
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  for (const chunk of chunks) {
    const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${threadId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: chunk }),
    });
    if (!response.ok) {
      throw new Error(`Discord thread post failed (${response.status}): ${await response.text()}`);
    }
  }
}

async function loadState() {
  if (!existsSync(STATE_PATH)) return { thread_id: '', last_summary: '', last_run_at: '' };
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    return { thread_id: '', last_summary: '', last_run_at: '' };
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

// ─── Main ───────────────────────────────────────────────────────────

export async function runWeeklyAnalyticsReview({ config = loadRuntimeConfig(), now = new Date() } = {}) {
  const untilIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const analyticsChannelId = config?.channelIds?.orionAnalytics || '';
  if (!analyticsChannelId) {
    throw new Error('Weekly analytics review requires DISCORD_ORION_ANALYTICS_CHANNEL_ID.');
  }

  process.stdout.write(`[weekly-analytics-review] window ${sinceIso} → ${untilIso}\n`);

  const publications = await fetchPokemonPublications(config, sinceIso);
  process.stdout.write(`[weekly-analytics-review] ${publications.length} pokemon publications in window\n`);
  if (publications.length === 0) {
    process.stdout.write('[weekly-analytics-review] no publications; nothing to summarize.\n');
    return { skipped: true, reason: 'no_publications' };
  }

  const analyticsByPub = await fetchLatestAnalyticsByPub(config, publications.map((p) => p.id));
  process.stdout.write(`[weekly-analytics-review] analytics coverage ${analyticsByPub.size}/${publications.length}\n`);

  // Cross-platform activity rollup (TikTok via Buffer + Instagram Reels
  // alongside YouTube Shorts). Best-effort — a Supabase blip here must
  // not block the main YouTube review.
  let crossPlatformActivity = null;
  try {
    crossPlatformActivity = await fetchCrossPlatformActivity(config, sinceIso, untilIso);
    process.stdout.write(`[weekly-analytics-review] cross-platform activity: ${crossPlatformActivity.total_published_all_platforms} posts across ${CROSS_PLATFORM_ALLOWLIST.length} platforms\n`);
  } catch (error) {
    process.stderr.write(`[weekly-analytics-review] cross-platform activity fetch failed (non-fatal): ${error.message}\n`);
  }

  // Per-platform performance summary. Fetches Instagram + TikTok pubs
  // and their analytics snapshots, then rolls up into per-platform
  // engagement totals/averages. Also best-effort — if either fails we
  // still ship the YouTube review.
  let perPlatformPerformance = null;
  try {
    const [instagramPubs, tiktokPubs] = await Promise.all([
      fetchPokemonPublicationsForPlatform(config, sinceIso, 'instagram_reels', POKE_CHANNELS_INSTAGRAM).catch(() => []),
      fetchPokemonPublicationsForPlatform(config, sinceIso, 'tiktok_video', POKE_CHANNELS_TIKTOK).catch(() => []),
    ]);
    const [instagramAnalytics, tiktokAnalytics] = await Promise.all([
      fetchLatestAnalyticsByPub(config, instagramPubs.map((p) => p.id)).catch(() => new Map()),
      fetchLatestAnalyticsByPub(config, tiktokPubs.map((p) => p.id)).catch(() => new Map()),
    ]);
    perPlatformPerformance = buildPerPlatformPerformance({
      platforms: {
        youtube_shorts: { publications, analyticsByPub },
        instagram_reels: { publications: instagramPubs, analyticsByPub: instagramAnalytics },
        tiktok_video: { publications: tiktokPubs, analyticsByPub: tiktokAnalytics },
      },
    });
    const summaryLine = Object.entries(perPlatformPerformance || {})
      .map(([p, s]) => `${p}:${s.publications}pub/${s.videos_with_metrics}metrics`)
      .join(' ');
    process.stdout.write(`[weekly-analytics-review] per-platform performance: ${summaryLine}\n`);
  } catch (error) {
    process.stderr.write(`[weekly-analytics-review] per-platform performance fetch failed (non-fatal): ${error.message}\n`);
  }

  const dataPack = buildDataPack({
    publications, analyticsByPub, sinceIso, untilIso,
    crossPlatformActivity, perPlatformPerformance,
  });

  const state = await loadState();
  const prompt = buildAnalystPrompt(dataPack, state.last_summary || '');
  process.stdout.write(`[weekly-analytics-review] prompt ${prompt.length} chars → claude -p\n`);
  const summary = await runClaudeAnalysis(prompt, config);
  process.stdout.write(`[weekly-analytics-review] summary ${summary.length} chars\n`);

  // Ensure the review thread exists, otherwise create it.
  let threadId = state.thread_id;
  if (!threadId) {
    const anchor = await sendDiscordChannelMessage(config, analyticsChannelId, {
      content: '**ORION Weekly Analytics Review** — automated weekly digest of pokemon Shorts performance across the 5 channels. New summary posts here every Monday.',
    });
    if (!anchor.posted || !anchor.messageId) {
      throw new Error('Could not create weekly analytics anchor message.');
    }
    const thread = await createDiscordThreadFromMessage({
      config,
      channelId: analyticsChannelId,
      messageId: anchor.messageId,
      name: 'ORION Weekly Analytics Review',
    });
    threadId = String(thread?.id || '').trim();
    process.stdout.write(`[weekly-analytics-review] created thread ${threadId}\n`);
  }

  const header = `📊 **Weekly analytics review — ${sinceIso.slice(0, 10)} → ${untilIso.slice(0, 10)}**\nWindow: 7 days • ${publications.length} shorts published • ${analyticsByPub.size} with analytics\n\n`;
  await postToThread({ config, threadId, content: header + summary });
  process.stdout.write('[weekly-analytics-review] posted to thread.\n');

  await saveState({
    thread_id: threadId,
    last_summary: summary,
    last_run_at: untilIso,
    last_data_pack_totals: dataPack.totals,
  });

  return {
    skipped: false,
    thread_id: threadId,
    summary_chars: summary.length,
    window: { since: sinceIso, until: untilIso },
    totals: dataPack.totals,
  };
}

// Exports for tests
export const __testables = {
  buildDataPack,
  buildAnalystPrompt,
  summarizeChannel,
  templateSlugFromMetadata,
  buildPerPlatformPerformance,
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runWeeklyAnalyticsReview()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`[weekly-analytics-review] failed: ${error?.stack || error?.message || error}\n`);
      process.exitCode = 1;
    });
}
