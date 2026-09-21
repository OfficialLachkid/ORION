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
    `video_publications?platform=eq.youtube_shorts&status=eq.published&external_id=not.is.null&select=id,account_key,external_id,title,published_at,metadata&published_at=gte.${encodeURIComponent(sinceIso)}&order=published_at.asc&limit=2000`,
  );
  return (Array.isArray(rows) ? rows : []).filter((row) => POKE_CHANNELS.has(row.account_key));
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

function buildDataPack({ publications, analyticsByPub, sinceIso, untilIso }) {
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
      hashtags: Array.isArray(metrics.hashtags) ? metrics.hashtags : (pub.metadata?.manifest_publication?.hashtags || []),
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
    instrumentation_gaps: [
      'viewer geography (country/region) — currently NULL in all analytics rows; needs `dimensions=country` on the YouTube Analytics query to populate',
      'hourly view distribution (when viewers actually watch, vs when we posted) — needs `dimensions=day + startTime + endTime` slicing',
      'traffic sources (browse / suggested / search / external) — currently NULL; needs `dimensions=insightTrafficSourceType`',
      'retention curve + average view % — currently NULL; needs the retention audit query',
    ],
    top_videos: topVideos,
    bottom_videos: bottomVideos,
  };
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
    '1. **This week in numbers** — 2-3 sentences on totals + which channel/template stood out. Bold every number.',
    '2. **What is working** — 2-4 bullets identifying the templates or channels moving up, with the specific v/vid or like-rate numbers as evidence.',
    '3. **What is not working** — 2-4 bullets on underperformers or drops relative to peers. Do NOT recommend killing a channel or template with fewer than 20 videos in the window (undersampled).',
    '4. **Scheduling signal** — the network currently posts 3× / day at 08:00, 12:00, 14:00 CEST across ALL channels. Read the `publish_hour_rollup` block. Answer: (a) does one UTC hour slot pull materially more views than the others network-wide, (b) does the picture differ per channel (some channels prefer earlier/later slots), and (c) is there a recommended per-channel schedule change based on the data. If the sample per slot is too small (< 5 videos in a slot) say so explicitly rather than over-fit. Also note what geo / hourly-view / traffic-source data is MISSING (see `instrumentation_gaps`) so the operator knows what would sharpen next week\'s answer.',
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

  const dataPack = buildDataPack({ publications, analyticsByPub, sinceIso, untilIso });

  const state = await loadState();
  const prompt = buildAnalystPrompt(dataPack, state.last_summary || '');
  process.stdout.write(`[weekly-analytics-review] prompt ${prompt.length} chars → claude -p\n`);
  const summary = await runClaudeAnalysis(prompt, config);
  process.stdout.write(`[weekly-analytics-review] summary ${summary.length} chars\n`);

  // Ensure the review thread exists, otherwise create it.
  let threadId = state.thread_id;
  if (!threadId) {
    const anchor = await sendDiscordChannelMessage(config, analyticsChannelId, {
      content: '**ORION Weekly Analytics Review** — automated weekly digest of pokemon Shorts performance across the 5 channels. New summary posts here every Sunday.',
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
