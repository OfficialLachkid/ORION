#!/usr/bin/env node

import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  buildPlaylistBackfillCursor,
  decodePlaylistBackfillCursor,
  encodePlaylistBackfillCursor,
  executeYoutubePlaylistBackfill,
  normalizePlaylistBackfillLimit,
} from '../../src/youtube-playlists/backfill.mjs';
import {
  readYoutubePlaylistBackfillCheckpoint,
  resolveYoutubePlaylistBackfillCheckpointPath,
  writeYoutubePlaylistBackfillCheckpoint,
} from '../../src/youtube-playlists/backfill-checkpoint.mjs';
import { refreshYoutubeAccessToken } from '../../src/youtube-oauth.mjs';
import { loadYoutubeClientCredentials } from '../../src/youtube-publication-executor.mjs';
import { resolveYoutubePlaylistConfig } from '../../src/youtube-playlists/sync.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

export async function runYoutubePlaylistBackfill(options = {}, dependencies = {}) {
  const runtimeConfig = (dependencies.loadRuntimeConfigImpl || loadRuntimeConfig)();
  const profiles = await (dependencies.loadPublicationChannelProfilesImpl
    || loadPublicationChannelProfiles)(options.channelsPath, { projectRoot });
  const channelProfile = (dependencies.findPublicationChannelProfileImpl
    || findPublicationChannelProfile)(profiles, options.channel);
  if (channelProfile.status !== 'active' || channelProfile.platform !== 'youtube_shorts') {
    throw new Error(`Channel ${channelProfile.account_key} is not an active YouTube Shorts channel.`);
  }

  const limit = normalizePlaylistBackfillLimit(options.limit);
  const allPages = Boolean(options.all);
  const maxPages = Math.max(1, Math.min(Number(options.maxPages) || 10, 100));
  const store = dependencies.store || new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    egressLedgerDir: runtimeConfig.runtimePaths?.supabaseEgressLedgerDir,
    telemetryService: 'youtube-playlist-backfill',
  });
  let clientConfig = null;
  let refreshToken = '';
  let refreshOnce = null;
  if (options.apply) {
    refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
    if (!refreshToken) {
      throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
    }
    clientConfig = await (dependencies.loadYoutubeClientCredentialsImpl
      || loadYoutubeClientCredentials)(channelProfile.youtube.oauth_client_secret_path, projectRoot);
    const refreshImpl = dependencies.refreshYoutubeAccessTokenImpl || refreshYoutubeAccessToken;
    let tokenPromise = null;
    refreshOnce = (...args) => {
      tokenPromise ||= refreshImpl(...args);
      return tokenPromise;
    };
  }

  const apply = Boolean(options.apply);
  const asOf = options.asOf || new Date().toISOString();
  const configurationVersion = resolveYoutubePlaylistConfig(channelProfile).configurationVersion;
  const checkpointPath = options.checkpointPath
    || resolveYoutubePlaylistBackfillCheckpointPath(runtimeConfig, channelProfile.account_key);
  const storedCheckpoint = allPages && apply && !options.resetCheckpoint
    ? readYoutubePlaylistBackfillCheckpoint(checkpointPath)
    : null;
  const resumableCheckpoint = storedCheckpoint
    && storedCheckpoint.account_key === channelProfile.account_key
    && storedCheckpoint.configuration_version === configurationVersion
    && storedCheckpoint.completed !== true
    ? storedCheckpoint
    : null;
  let cursor = options.cursor
    ? decodePlaylistBackfillCursor(options.cursor)
    : decodePlaylistBackfillCursor(resumableCheckpoint?.next_cursor || '');
  if (allPages && apply && storedCheckpoint?.completed === true && !options.resetCheckpoint && !options.cursor) {
    return {
      account_key: channelProfile.account_key,
      configuration_version: configurationVersion,
      dry_run: false,
      completed: true,
      resumed_from_checkpoint: true,
      pages_processed: 0,
      rows_examined: 0,
      pending_videos: 0,
      already_verified_videos: 0,
      skipped: [],
      results: [],
      checkpoint_path: checkpointPath,
      next_cursor: '',
    };
  }

  const pageSummaries = [];
  const aggregate = {
    rows_examined: 0,
    eligible_videos: 0,
    pending_videos: 0,
    already_verified_videos: 0,
    skipped: [],
    results: [],
  };
  const priorTotals = {
    rows_examined: Number(resumableCheckpoint?.totals?.rows_examined || 0),
    pending_videos: Number(resumableCheckpoint?.totals?.pending_videos || 0),
    already_verified_videos: Number(
      resumableCheckpoint?.totals?.already_verified_videos || 0,
    ),
    skipped: Number(resumableCheckpoint?.totals?.skipped || 0),
  };
  let completed = false;
  let nextCursor = cursor ? encodePlaylistBackfillCursor(cursor) : '';

  for (let page = 1; page <= (allPages ? maxPages : 1); page += 1) {
    const fetchedRows = await store.fetchYoutubePlaylistBackfillCandidates({
      accountKey: channelProfile.account_key,
      limit: limit + 1,
      cursor,
    });
    const hasMore = fetchedRows.length > limit;
    const rows = fetchedRows.slice(0, limit);
    const pageResult = await executeYoutubePlaylistBackfill({
      store,
      rows,
      channelProfile,
      clientConfig,
      refreshToken,
      limit,
      apply,
      asOf,
    }, {
      ...(refreshOnce ? { refreshYoutubeAccessTokenImpl: refreshOnce } : {}),
      ...(dependencies.syncYoutubePlaylistStateImpl
        ? { syncYoutubePlaylistStateImpl: dependencies.syncYoutubePlaylistStateImpl }
        : {}),
    });
    const nextCursorValue = rows.length > 0 && hasMore
      ? buildPlaylistBackfillCursor(rows.at(-1))
      : null;
    nextCursor = encodePlaylistBackfillCursor(nextCursorValue);
    cursor = nextCursorValue;
    completed = !hasMore;

    aggregate.rows_examined += pageResult.rows_examined;
    aggregate.eligible_videos += pageResult.eligible_videos;
    aggregate.pending_videos += pageResult.pending_videos;
    aggregate.already_verified_videos += pageResult.already_verified_videos;
    aggregate.skipped.push(...pageResult.skipped);
    aggregate.results.push(...(pageResult.results || []));
    pageSummaries.push({
      page,
      rows_examined: pageResult.rows_examined,
      eligible_videos: pageResult.eligible_videos,
      pending_videos: pageResult.pending_videos,
      already_verified_videos: pageResult.already_verified_videos,
      skipped_count: pageResult.skipped.length,
      completed,
      next_cursor: nextCursor,
    });

    if (allPages && apply) {
      writeYoutubePlaylistBackfillCheckpoint(checkpointPath, {
        account_key: channelProfile.account_key,
        configuration_version: pageResult.configuration_version,
        completed,
        next_cursor: nextCursor,
        pages_processed: Number(resumableCheckpoint?.pages_processed || 0) + page,
        totals: {
          rows_examined: priorTotals.rows_examined + aggregate.rows_examined,
          pending_videos: priorTotals.pending_videos + aggregate.pending_videos,
          already_verified_videos:
            priorTotals.already_verified_videos + aggregate.already_verified_videos,
          skipped: priorTotals.skipped + aggregate.skipped.length,
        },
        updated_at: new Date().toISOString(),
      });
    }
    if (!allPages || completed) {
      if (!allPages) {
        return {
          ...pageResult,
          completed,
          next_cursor: nextCursor,
        };
      }
      break;
    }
  }

  return {
    account_key: channelProfile.account_key,
    configuration_version: configurationVersion,
    dry_run: !apply,
    completed,
    resumed_from_checkpoint: Boolean(resumableCheckpoint),
    pages_processed: pageSummaries.length,
    max_pages: maxPages,
    ...aggregate,
    page_summaries: pageSummaries,
    checkpoint_path: apply ? checkpointPath : '',
    next_cursor: nextCursor,
  };
}

if (process.argv[1] && process.argv[1].endsWith('backfill-youtube-playlists.mjs')) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: npm run product-video:backfill-youtube-playlists -- --channel <account-key> [options]',
      '',
      'Options:',
      '  --channel <selector>  Required exact channel id or account key.',
      '  --limit <n>           Public videos per page. Default: 10; hard maximum: 25.',
      '  --all                 Continue through bounded pages instead of processing one page.',
      '  --max-pages <n>       Maximum pages for this run. Default: 10; hard maximum: 100.',
      '  --cursor <token>      Resume from an explicit opaque cursor token.',
      '  --reset-checkpoint    Ignore a completed/in-progress local checkpoint and start newest-first.',
      '  --apply               Persist classifications and call YouTube. Omit for dry-run.',
      '  --channels <path>      Publication channel config path.',
      '  --as-of <ISO>         Deterministic receipt timestamp. Default: now.',
    ]);
    process.exit(0);
  }

  const channel = getStringOption(options, 'channel', '');
  if (!channel) throw new Error('--channel is required; backfill never defaults across channels.');
  const result = await runYoutubePlaylistBackfill({
    channel,
    limit: getStringOption(options, 'limit', '10'),
    all: getBooleanOption(options, 'all', false),
    maxPages: getStringOption(options, 'max-pages', '10'),
    cursor: getStringOption(options, 'cursor', ''),
    resetCheckpoint: getBooleanOption(options, 'reset-checkpoint', false),
    apply: getBooleanOption(options, 'apply', false),
    channelsPath: getStringOption(
      options,
      'channels',
      'services/product-video-agent/publication-channels.example.json',
    ),
    asOf: getStringOption(options, 'as-of', new Date().toISOString()),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
