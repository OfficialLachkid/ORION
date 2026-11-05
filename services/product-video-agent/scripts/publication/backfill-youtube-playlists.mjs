#!/usr/bin/env node

import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  executeYoutubePlaylistBackfill,
  normalizePlaylistBackfillLimit,
} from '../../src/youtube-playlists/backfill.mjs';
import { refreshYoutubeAccessToken } from '../../src/youtube-oauth.mjs';
import { loadYoutubeClientCredentials } from '../../src/youtube-publication-executor.mjs';
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
  const store = dependencies.store || new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    egressLedgerDir: runtimeConfig.runtimePaths?.supabaseEgressLedgerDir,
    telemetryService: 'youtube-playlist-backfill',
  });
  const rows = await store.fetchYoutubePlaylistBackfillCandidates({
    accountKey: channelProfile.account_key,
    limit,
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

  return executeYoutubePlaylistBackfill({
    store,
    rows,
    channelProfile,
    clientConfig,
    refreshToken,
    limit,
    apply: Boolean(options.apply),
    asOf: options.asOf || new Date().toISOString(),
  }, {
    ...(refreshOnce ? { refreshYoutubeAccessTokenImpl: refreshOnce } : {}),
    ...(dependencies.syncYoutubePlaylistStateImpl
      ? { syncYoutubePlaylistStateImpl: dependencies.syncYoutubePlaylistStateImpl }
      : {}),
  });
}

if (process.argv[1] && process.argv[1].endsWith('backfill-youtube-playlists.mjs')) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: npm run product-video:backfill-youtube-playlists -- --channel <account-key> [options]',
      '',
      'Options:',
      '  --channel <selector>  Required exact channel id or account key.',
      '  --limit <n>           Newest public videos to inspect. Default: 10; hard maximum: 25.',
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
