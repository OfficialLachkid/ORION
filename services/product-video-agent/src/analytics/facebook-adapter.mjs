import {
  createFacebookGraphClient,
  FacebookGraphApiError,
} from '../facebook-publication-executor.mjs';

const FACEBOOK_REEL_INSIGHT_METRICS = Object.freeze([
  'fb_reels_total_plays',
  'blue_reels_play_count',
  'fb_reels_replay_count',
  'post_impressions_unique',
  'post_video_avg_time_watched',
  'post_video_view_time',
  'post_video_followers',
  'post_video_likes_by_reaction_type',
  'post_video_social_actions',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function insightValue(payload, metric) {
  const entry = (Array.isArray(payload?.data) ? payload.data : [])
    .find((row) => normalizeText(row?.name).toLowerCase() === metric.toLowerCase());
  const value = Array.isArray(entry?.values) ? entry.values[0]?.value : entry?.value;
  return value === undefined ? null : value;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumNumericObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return numeric(value);
  return Object.values(value).reduce((total, item) => total + (numeric(item) || 0), 0);
}

function pickActionCount(value, names) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  for (const name of names) {
    const parsed = numeric(value[name]);
    if (parsed !== null) return parsed;
  }
  return null;
}

async function fetchInsightsResilient(client, externalId, metrics) {
  try {
    return await client.request(`${externalId}/video_insights`, {
      query: { metric: metrics.join(','), period: 'lifetime' },
    });
  } catch (error) {
    if (!(error instanceof FacebookGraphApiError)) throw error;
    if (metrics.length === 1) {
      return { data: [], __metric_errors: { [metrics[0]]: error.message } };
    }
    const splitAt = Math.ceil(metrics.length / 2);
    const [left, right] = await Promise.all([
      fetchInsightsResilient(client, externalId, metrics.slice(0, splitAt)),
      fetchInsightsResilient(client, externalId, metrics.slice(splitAt)),
    ]);
    return {
      data: [...(left.data || []), ...(right.data || [])],
      __metric_errors: { ...(left.__metric_errors || {}), ...(right.__metric_errors || {}) },
    };
  }
}

export function resolveFacebookTarget(channelProfile, accountKey) {
  const targets = channelProfile?.metadata?.publisher?.targets;
  const normalized = normalizeText(accountKey);
  if (!Array.isArray(targets) || !normalized) return null;
  return targets.find((target) => (
    normalizeText(target?.platform).toLowerCase() === 'facebook_reels'
      && normalizeText(target?.account_key || target?.accountKey) === normalized
  )) || null;
}

export async function fetchFacebookPublicationMetrics({
  publication,
  target,
  runtimeEnv,
  fetchImpl = globalThis.fetch,
  capturedAt = new Date().toISOString(),
  graphClient = null,
  insightsMetrics = FACEBOOK_REEL_INSIGHT_METRICS,
}) {
  const externalId = normalizeText(publication?.external_id);
  if (!externalId) throw new Error('Facebook analytics fetch requires publication.external_id (Reel video id).');
  if (!target) throw new Error('Facebook analytics fetch requires a resolved publisher target.');

  const client = graphClient || createFacebookGraphClient(runtimeEnv || {}, target, { fetchImpl });
  const [reel, insights] = await Promise.all([
    client.fetchReel(externalId),
    fetchInsightsResilient(client, externalId, insightsMetrics),
  ]);

  const totalPlays = numeric(insightValue(insights, 'fb_reels_total_plays'));
  const bluePlays = numeric(insightValue(insights, 'blue_reels_play_count'));
  const avgWatchMs = numeric(insightValue(insights, 'post_video_avg_time_watched'));
  const totalWatchMs = numeric(insightValue(insights, 'post_video_view_time'));
  const reactions = insightValue(insights, 'post_video_likes_by_reaction_type');
  const socialActions = insightValue(insights, 'post_video_social_actions');

  return {
    metrics: {
      platform: 'facebook_reels',
      external_id: externalId,
      public_url: normalizeText(reel?.permalink || publication?.public_url) || null,
      views: totalPlays ?? bluePlays,
      unique_viewers: numeric(insightValue(insights, 'post_impressions_unique')),
      avg_view_duration_sec: avgWatchMs === null ? null : Number((avgWatchMs / 1000).toFixed(2)),
      avg_view_percentage: null,
      watch_time_minutes: totalWatchMs === null ? null : Number((totalWatchMs / 60000).toFixed(2)),
      impressions: null,
      ctr_percentage: null,
      likes: sumNumericObject(reactions),
      comments: pickActionCount(socialActions, ['comment', 'comments']),
      shares: pickActionCount(socialActions, ['share', 'shares']),
      saves: null,
      total_interactions: sumNumericObject(socialActions),
      subs_gained: numeric(insightValue(insights, 'post_video_followers')),
      subs_lost: null,
      retention_curve: null,
      viewer_countries: [],
      traffic_sources: [],
      fetch_lag_hours: null,
      captured_at: capturedAt,
      published_at: publication?.published_at || publication?.uploaded_at || publication?.created_at || null,
      video_title: normalizeText(publication?.title),
    },
    raw_payload: {
      facebook_reel: reel?.payload || reel,
      facebook_video_insights: insights,
    },
  };
}

export function findFacebookTargetAcrossProfiles(channelProfiles, accountKey) {
  for (const profile of Array.isArray(channelProfiles) ? channelProfiles : []) {
    const target = resolveFacebookTarget(profile, accountKey);
    if (target) return target;
  }
  return null;
}

export const FACEBOOK_REEL_ANALYTICS_METRICS = FACEBOOK_REEL_INSIGHT_METRICS;
