#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import { loadPublicationChannelProfiles } from '../../src/publication-channels.mjs';
import { loadYoutubeClientCredentials } from '../../src/youtube-publication-executor.mjs';
import {
  buildChannelVideoAnalyticsDigest,
  buildVideoAnalyticsOverviewDigest,
  buildVideoAnalyticsThreadName,
  indexLatestAnalyticsSnapshotsByPublicationId,
  resolveVideoAnalyticsCapturePlan,
} from '../../src/video-analytics.mjs';
import {
  createYoutubeAnalyticsAccessToken,
  fetchYoutubePublicationMetrics,
  fetchYoutubeVideoStatisticsMap,
} from '../../src/analytics/youtube-adapter.mjs';
import { sendDiscordChannelMessage } from '../../../../scripts/lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DEFAULT_STATE_PATH = 'data/runtime/product-video-agent/video-analytics-discord-state.json';
const DEFAULT_CHANNELS_PATH = 'services/product-video-agent/publication-channels.example.json';
const DEFAULT_DIGEST_WINDOW_DAYS = 7;
const DEFAULT_DIGEST_WEEKDAY = 1;
const DEFAULT_DIGEST_HOUR = 9;
const THREAD_AUTO_ARCHIVE_DURATION_MINUTES = 10080;

function getNumberOption(options, key, fallbackValue) {
  const rawValue = getStringOption(options, key, '');
  if (!rawValue) {
    return fallbackValue;
  }
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function toDateOrNull(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function formatNumber(value, options = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'n/a';
  }
  return new Intl.NumberFormat('en-US', options).format(number);
}

function formatMetric(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 'n/a';
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(number);
}

function normalizeChannelProfiles(profiles, channelSelector = '') {
  const activeProfiles = profiles.filter((profile) => profile.status === 'active' && profile.platform === 'youtube_shorts');
  const normalizedSelector = String(channelSelector || '').trim();
  if (!normalizedSelector) {
    return activeProfiles;
  }
  return activeProfiles.filter((profile) => (
    profile.id === normalizedSelector || profile.account_key === normalizedSelector
  ));
}

function buildOverviewEmbed(overview, channelDigests = []) {
  const fields = channelDigests.slice(0, 25).map((digest) => ({
    name: `${digest.channel_name} (${digest.account_key})`,
    value: [
      `New videos: ${digest.new_videos_count}`,
      `Views (7D): ${formatNumber(digest.total_views)}`,
      `Views (all time): ${formatNumber(digest.all_time_views)}`,
      `Median views: ${formatNumber(digest.median_views)}`,
      `Median AVD: ${formatMetric(digest.median_avg_view_duration_sec)}s`,
      `Median AVP: ${formatMetric(digest.median_avg_view_percentage)}%`,
      digest.insufficient_data ? 'Signal: insufficient data' : 'Signal: usable',
    ].join(' | '),
    inline: false,
  }));

  return {
    embeds: [
      {
        title: `Weekly YouTube Analytics Digest (${overview.window_days}d)`,
        description: [
          `Channels: **${overview.channel_count}**`,
          `New videos: **${formatNumber(overview.total_new_videos_count)}**`,
          `Videos with snapshots: **${formatNumber(overview.total_videos_with_snapshots_count)}**`,
          `Crossed 10k views: **${formatNumber(overview.total_crossed_10k_views_count)}**`,
          `Combined views (7D): **${formatNumber(overview.total_views)}**`,
          `Total views (all time): **${formatNumber(overview.total_all_time_views)}**`,
        ].join('\n'),
        color: 0x1f7a3a,
        fields,
        footer: { text: 'ORION analytics overview' },
        timestamp: overview.as_of,
      },
    ],
  };
}

function buildChannelDigestEmbed(digest) {
  const bestLabel = digest.best_performer
    ? `${digest.best_performer.title || digest.best_performer.type_pair} (${formatNumber(digest.best_performer.views)} views)`
    : 'n/a';
  const worstLabel = digest.worst_performer
    ? `${digest.worst_performer.title || digest.worst_performer.type_pair} (${formatNumber(digest.worst_performer.views)} views)`
    : 'n/a';

  return {
    embeds: [
      {
        title: `${digest.channel_name} - YouTube Analytics`,
        description: digest.new_videos_count > 0
          ? [
              `Window: last **${digest.window_days}** days`,
              `New videos: **${formatNumber(digest.new_videos_count)}**`,
              `Videos with snapshots: **${formatNumber(digest.videos_with_snapshots_count)}**`,
              `Crossed 10k views: **${formatNumber(digest.crossed_10k_views_count)}**`,
            ].join('\n')
          : `No published videos landed in the last ${digest.window_days} days.`,
        color: digest.insufficient_data ? 0xd4a017 : 0x1f7a3a,
        fields: [
          {
            name: 'Medians',
            value: [
              `Views: ${formatNumber(digest.median_views)}`,
              `AVD: ${formatMetric(digest.median_avg_view_duration_sec)}s`,
              `AVP: ${formatMetric(digest.median_avg_view_percentage)}%`,
            ].join(' | '),
            inline: false,
          },
          {
            name: 'Totals',
            value: [
              `Views (7D): ${formatNumber(digest.total_views)}`,
              `Views (all time): ${formatNumber(digest.all_time_views)}`,
              `Likes: ${formatNumber(digest.total_likes)}`,
              `Comments: ${formatNumber(digest.total_comments)}`,
              `Shares: ${formatNumber(digest.total_shares)}`,
            ].join(' | '),
            inline: false,
          },
          {
            name: 'Subscribers',
            value: `Gained: ${formatNumber(digest.total_subscribers_gained)} | Lost: ${formatNumber(digest.total_subscribers_lost)}`,
            inline: false,
          },
          {
            name: 'Best Performer',
            value: bestLabel,
            inline: false,
          },
          {
            name: 'Weakest Performer',
            value: worstLabel,
            inline: false,
          },
          {
            name: 'Signal Quality',
            value: digest.insufficient_data
              ? 'Insufficient data. Keep observing before changing strategy.'
              : 'Enough weekly volume to compare performance without auto-adjusting strategy yet.',
            inline: false,
          },
        ],
        footer: { text: `${digest.account_key} | ${digest.platform}` },
        timestamp: digest.window_end,
      },
    ],
  };
}

function buildThreadAnchorMessage(channelProfile) {
  return {
    content: `Analytics thread for **${channelProfile.name}** (${channelProfile.account_key}).`,
  };
}

function getIsoWeekKey(value) {
  const date = toDateOrNull(value) || new Date();
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const weekNumber = Math.ceil((((utcDate - yearStart) / 86400000) + 1) / 7);
  return `${utcDate.getUTCFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
}

function shouldPostWeeklyDigest({
  asOf,
  state,
  forceDigest = false,
  digestWeekday = DEFAULT_DIGEST_WEEKDAY,
  digestHour = DEFAULT_DIGEST_HOUR,
}) {
  if (forceDigest) {
    return true;
  }

  const now = toDateOrNull(asOf) || new Date();
  if (now.getDay() !== digestWeekday || now.getHours() < digestHour) {
    return false;
  }

  return getIsoWeekKey(now) !== getIsoWeekKey(state?.last_weekly_digest_at);
}

async function loadState(statePath) {
  try {
    return JSON.parse(await readFile(statePath, 'utf8'));
  } catch {
    return {
      last_weekly_digest_at: '',
      analytics_threads: {},
    };
  }
}

async function saveState(statePath, state) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function createDiscordThreadFromMessage({
  runtimeConfig,
  analyticsChannelId,
  messageId,
  name,
  fetchImpl = globalThis.fetch,
}) {
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN || '';
  if (!token) {
    throw new Error('Discord thread creation requires DISCORD_BOT_TOKEN.');
  }

  const response = await fetchImpl(`${DISCORD_API_BASE_URL}/channels/${analyticsChannelId}/messages/${messageId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name,
      auto_archive_duration: THREAD_AUTO_ARCHIVE_DURATION_MINUTES,
    }),
  });
  if (!response.ok) {
    throw new Error(`Discord thread creation failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function ensureAnalyticsThread({
  runtimeConfig,
  analyticsChannelId,
  channelProfile,
  state,
  sendDiscordMessage,
  fetchImpl = globalThis.fetch,
}) {
  state.analytics_threads = state.analytics_threads || {};
  const existing = state.analytics_threads?.[channelProfile.id];
  if (existing?.thread_id) {
    return existing.thread_id;
  }

  const anchor = await sendDiscordMessage(
    runtimeConfig,
    analyticsChannelId,
    buildThreadAnchorMessage(channelProfile),
    { fetch: fetchImpl },
  );
  if (!anchor.posted || !anchor.messageId) {
    throw new Error(`Could not create analytics anchor message for ${channelProfile.account_key}.`);
  }

  const thread = await createDiscordThreadFromMessage({
    runtimeConfig,
    analyticsChannelId,
    messageId: anchor.messageId,
    name: buildVideoAnalyticsThreadName(channelProfile),
    fetchImpl,
  });

  state.analytics_threads[channelProfile.id] = {
    thread_id: String(thread?.id || '').trim(),
    anchor_message_id: anchor.messageId,
    channel_name: channelProfile.name,
    account_key: channelProfile.account_key,
    created_at: new Date().toISOString(),
  };
  return state.analytics_threads[channelProfile.id].thread_id;
}

async function postWeeklyDigest({
  runtimeConfig,
  analyticsChannelId,
  channelDigests,
  asOf,
  windowDays,
  state,
  postChannelThreads = false,
  sendDiscordMessage,
  fetchImpl = globalThis.fetch,
}) {
  const overview = buildVideoAnalyticsOverviewDigest({
    channelDigests,
    asOf,
    windowDays,
  });

  await sendDiscordMessage(
    runtimeConfig,
    analyticsChannelId,
    buildOverviewEmbed(overview, channelDigests),
    { fetch: fetchImpl },
  );

  if (!postChannelThreads) {
    state.last_weekly_digest_at = asOf;
    return;
  }

  for (const digest of channelDigests) {
    const threadId = await ensureAnalyticsThread({
      runtimeConfig,
      analyticsChannelId,
      channelProfile: {
        id: digest.channel_id,
        name: digest.channel_name,
        account_key: digest.account_key,
      },
      state,
      sendDiscordMessage,
      fetchImpl,
    });
    await sendDiscordMessage(
      runtimeConfig,
      threadId,
      buildChannelDigestEmbed(digest),
      { fetch: fetchImpl },
    );
  }

  state.last_weekly_digest_at = asOf;
}

export async function runVideoAnalyticsSweep(options = {}, dependencies = {}) {
  const runtimeConfig = dependencies.runtimeConfig || loadRuntimeConfig();
  const loadProfiles = dependencies.loadPublicationChannelProfiles || loadPublicationChannelProfiles;
  const loadClientCredentials = dependencies.loadYoutubeClientCredentials || loadYoutubeClientCredentials;
  const createAccessToken = dependencies.createYoutubeAnalyticsAccessToken || createYoutubeAnalyticsAccessToken;
  const fetchStatisticsMap = dependencies.fetchYoutubeVideoStatisticsMap || fetchYoutubeVideoStatisticsMap;
  const fetchPublicationMetrics = dependencies.fetchYoutubePublicationMetrics || fetchYoutubePublicationMetrics;
  const sendDiscordMessage = dependencies.sendDiscordChannelMessage || sendDiscordChannelMessage;
  const channelsPath = getStringOption(options, 'channels', DEFAULT_CHANNELS_PATH);
  const channelSelector = getStringOption(options, 'channel', '');
  const asOf = getStringOption(options, 'as-of', new Date().toISOString());
  const statePath = resolve(projectRoot, getStringOption(options, 'state-path', DEFAULT_STATE_PATH));
  const analyticsChannelId = getStringOption(options, 'analytics-channel-id', '')
    || String(runtimeConfig?.channelIds?.orionAnalytics || '').trim();
  const windowDays = getNumberOption(options, 'digest-window-days', DEFAULT_DIGEST_WINDOW_DAYS);
  const postDiscord = getBooleanOption(options, 'post-discord', false);
  const postChannelThreads = getBooleanOption(options, 'post-channel-threads', false);
  const forceDigest = getBooleanOption(options, 'force-digest', false);
  const digestWeekday = getNumberOption(options, 'digest-weekday', DEFAULT_DIGEST_WEEKDAY);
  const digestHour = getNumberOption(options, 'digest-hour', DEFAULT_DIGEST_HOUR);
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const profiles = normalizeChannelProfiles(
    await loadProfiles(channelsPath, { projectRoot }),
    channelSelector,
  );

  const store = dependencies.store || new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    fetchImpl,
  });

  const state = await loadState(statePath);
  state.analytics_threads = state.analytics_threads || {};
  const sweepResults = [];
  const publicationsByChannelId = new Map();
  const latestSnapshotsByPublicationId = new Map();

  for (const channelProfile of profiles) {
    const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
    if (!refreshToken || !channelProfile.youtube.oauth_client_secret_path) {
      printWarn(`Skipping analytics for ${channelProfile.account_key}: YouTube OAuth is not configured.`);
      sweepResults.push({
        channel_id: channelProfile.id,
        account_key: channelProfile.account_key,
        action: 'skipped',
        reason: 'youtube_oauth_not_configured',
      });
      publicationsByChannelId.set(channelProfile.id, []);
      continue;
    }

    const publications = await store.fetchPublishedPublicationsByChannel({
      platform: channelProfile.platform,
      accountKey: channelProfile.account_key,
    });
    publicationsByChannelId.set(channelProfile.id, publications || []);

    const latestSnapshots = await Promise.all((publications || []).map((publication) => (
      store.fetchLatestAnalyticsSnapshot(publication.id)
    )));
    const latestByPublicationId = indexLatestAnalyticsSnapshotsByPublicationId(latestSnapshots);
    for (const [publicationId, snapshot] of latestByPublicationId.entries()) {
      latestSnapshotsByPublicationId.set(publicationId, snapshot);
    }

    const capturePlan = resolveVideoAnalyticsCapturePlan({
      publications,
      latestSnapshotsByPublicationId: latestByPublicationId,
      capturedAt: asOf,
    });
    const duePublications = capturePlan.filter((entry) => entry.due && String(entry.publication?.external_id || '').trim());

    if (duePublications.length === 0) {
      sweepResults.push({
        channel_id: channelProfile.id,
        account_key: channelProfile.account_key,
        action: 'no_due_publications',
        publication_count: publications.length,
      });
      continue;
    }

    const clientConfig = await loadClientCredentials(
      channelProfile.youtube.oauth_client_secret_path,
      projectRoot,
    );
    const accessToken = await createAccessToken({
      clientConfig,
      refreshToken,
      fetchImpl,
    });
    const { statisticsByVideoId } = await fetchStatisticsMap({
      externalIds: duePublications.map((entry) => entry.publication.external_id),
      accessToken,
      fetchImpl,
    });

    for (const entry of duePublications) {
      try {
        const analyticsSnapshot = await fetchPublicationMetrics({
          publication: entry.publication,
          accessToken,
          statistics: statisticsByVideoId.get(String(entry.publication?.external_id || '').trim()) || null,
          fetchImpl,
          capturedAt: asOf,
        });
        const savedSnapshot = await store.upsertVideoAnalyticsSnapshot({
          publication_id: entry.publication.id,
          captured_at: asOf,
          metrics: analyticsSnapshot.metrics,
          raw_payload: analyticsSnapshot.raw_payload,
        });
        latestSnapshotsByPublicationId.set(entry.publication.id, savedSnapshot || {
          publication_id: entry.publication.id,
          captured_at: asOf,
          metrics: analyticsSnapshot.metrics,
          raw_payload: analyticsSnapshot.raw_payload,
        });
        sweepResults.push({
          channel_id: channelProfile.id,
          account_key: channelProfile.account_key,
          publication_id: entry.publication.id,
          external_id: entry.publication.external_id,
          action: 'captured',
          cadence_hours: entry.cadence_hours,
        });
      } catch (error) {
        sweepResults.push({
          channel_id: channelProfile.id,
          account_key: channelProfile.account_key,
          publication_id: entry.publication.id,
          external_id: entry.publication.external_id,
          action: 'failed',
          error: error.message,
        });
      }
    }
  }

  let digestPosted = false;
  const hasDiscordToken = Boolean(runtimeConfig?.env?.DISCORD_BOT_TOKEN);
  const digestDue = postDiscord && analyticsChannelId && hasDiscordToken && shouldPostWeeklyDigest({
    asOf,
    state,
    forceDigest,
    digestWeekday,
    digestHour,
  });
  if (digestDue) {
    const channelDigests = profiles.map((channelProfile) => buildChannelVideoAnalyticsDigest({
      channelProfile,
      publications: publicationsByChannelId.get(channelProfile.id) || [],
      latestSnapshotsByPublicationId,
      asOf,
      windowDays,
    }));
    await postWeeklyDigest({
      runtimeConfig,
      analyticsChannelId,
      channelDigests,
      asOf,
      windowDays,
      state,
      postChannelThreads,
      sendDiscordMessage,
      fetchImpl,
    });
    await saveState(statePath, state);
    digestPosted = true;
  } else if (postDiscord && !analyticsChannelId) {
    printWarn('Weekly analytics digest was requested, but no analytics Discord channel is configured.');
  } else if (postDiscord && analyticsChannelId && !hasDiscordToken) {
    printWarn('Weekly analytics digest was requested, but DISCORD_BOT_TOKEN is not configured.');
  }

  return {
    as_of: asOf,
    channel_count: profiles.length,
    analytics_channel_id: analyticsChannelId || null,
    digest_posted: digestPosted,
    state_path: statePath,
    results: sweepResults,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node services/product-video-agent/scripts/run-video-analytics-sweep.mjs [options]',
      '',
      'Options:',
      `  --channels <path>            Channel registry JSON. Default: ${DEFAULT_CHANNELS_PATH}`,
      '  --channel <id>               Optional channel id or account_key filter.',
      '  --as-of <ISO>                Deterministic capture timestamp. Default: now.',
      '  --post-discord               Post the weekly digest when due.',
      '  --post-channel-threads       Also post per-channel detail messages into dedicated threads.',
      '  --force-digest               Post the weekly digest immediately, ignoring the due check.',
      `  --digest-window-days <n>     Window size for the weekly digest. Default: ${DEFAULT_DIGEST_WINDOW_DAYS}`,
      `  --digest-weekday <0-6>       Local weekday for the digest. Default: ${DEFAULT_DIGEST_WEEKDAY} (Monday=1)`,
      `  --digest-hour <0-23>         Local hour gate for digest posting. Default: ${DEFAULT_DIGEST_HOUR}`,
      '  --analytics-channel-id <id>  Override the Discord analytics channel id.',
      `  --state-path <path>          Digest thread/state file. Default: ${DEFAULT_STATE_PATH}`,
    ]);
    process.exit(0);
  }

  runVideoAnalyticsSweep(options).then((result) => {
    printInfo(`Analytics sweep processed ${result.results.length} publication result(s).`);
    if (result.digest_posted) {
      printInfo(`Posted the weekly analytics digest to ${result.analytics_channel_id}.`);
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
