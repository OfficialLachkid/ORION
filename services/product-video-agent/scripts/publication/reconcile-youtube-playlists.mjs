#!/usr/bin/env node

import { loadRuntimeConfig } from '../../../lib/runtime-config.mjs';
import {
  findPublicationChannelProfile,
  loadPublicationChannelProfiles,
} from '../../src/publication-channels.mjs';
import { SupabasePublicationStore } from '../../src/publication-store.mjs';
import {
  planYoutubePlaylistRegistryReconciliation,
  reconcileYoutubePlaylistRegistry,
} from '../../src/youtube-playlists/reconcile.mjs';
import { refreshYoutubeAccessToken } from '../../src/youtube-oauth.mjs';
import { loadYoutubeClientCredentials } from '../../src/youtube-publication-executor.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printUsage,
  projectRoot,
} from '../../../../scripts/lib/ruflo-wrapper-utils.mjs';

export async function runYoutubePlaylistReconciliation(options = {}, dependencies = {}) {
  const runtimeConfig = (dependencies.loadRuntimeConfigImpl || loadRuntimeConfig)();
  const profiles = await (dependencies.loadPublicationChannelProfilesImpl
    || loadPublicationChannelProfiles)(options.channelsPath, { projectRoot });
  const channelProfile = (dependencies.findPublicationChannelProfileImpl
    || findPublicationChannelProfile)(profiles, options.channel);
  if (channelProfile.status !== 'active' || channelProfile.platform !== 'youtube_shorts') {
    throw new Error(`Channel ${channelProfile.account_key} is not an active YouTube Shorts channel.`);
  }

  const store = dependencies.store || new SupabasePublicationStore({
    supabaseUrl: runtimeConfig.env.SUPABASE_URL,
    apiKey: runtimeConfig.env.SUPABASE_SECRET_KEY || runtimeConfig.env.SUPABASE_PUBLISHABLE_KEY,
    egressLedgerDir: runtimeConfig.runtimePaths?.supabaseEgressLedgerDir,
    telemetryService: 'youtube-playlist-reconciliation',
  });
  const entries = await store.fetchYoutubePlaylistRegistryEntries(channelProfile.account_key, 100);
  const plan = planYoutubePlaylistRegistryReconciliation({
    entries,
    accountKey: channelProfile.account_key,
  });
  let accessToken = '';
  if (options.apply && plan.remote_updates > 0) {
    const refreshToken = runtimeConfig.env[channelProfile.youtube.oauth_refresh_token_env] || '';
    if (!refreshToken) {
      throw new Error(`Missing refresh token env value: ${channelProfile.youtube.oauth_refresh_token_env}`);
    }
    const clientConfig = await (dependencies.loadYoutubeClientCredentialsImpl
      || loadYoutubeClientCredentials)(channelProfile.youtube.oauth_client_secret_path, projectRoot);
    const token = await (dependencies.refreshYoutubeAccessTokenImpl
      || refreshYoutubeAccessToken)(clientConfig, refreshToken, {
        channelKey: channelProfile.account_key,
        action: 'playlist_reconciliation',
      });
    accessToken = token.accessToken;
  }

  return reconcileYoutubePlaylistRegistry({
    store,
    entries,
    accountKey: channelProfile.account_key,
    accessToken,
    apply: Boolean(options.apply),
  }, {
    ...(dependencies.updateYoutubePlaylistImpl
      ? { updateYoutubePlaylistImpl: dependencies.updateYoutubePlaylistImpl }
      : {}),
  });
}

if (process.argv[1] && process.argv[1].endsWith('reconcile-youtube-playlists.mjs')) {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: npm run product-video:reconcile-youtube-playlists -- --channel <account-key> [--apply]',
      '',
      'Dry-run is the default. --apply updates existing playlist metadata sequentially.',
    ]);
    process.exit(0);
  }
  const channel = getStringOption(options, 'channel', '');
  if (!channel) throw new Error('--channel is required; reconciliation never defaults across channels.');
  const result = await runYoutubePlaylistReconciliation({
    channel,
    apply: getBooleanOption(options, 'apply', false),
    channelsPath: getStringOption(
      options,
      'channels',
      'services/product-video-agent/publication-channels.example.json',
    ),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
