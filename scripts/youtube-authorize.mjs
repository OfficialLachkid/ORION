#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { loadPublicationChannelProfiles } from '../services/product-video-agent/src/publication-channels.mjs';
import {
  buildYoutubeAuthorizeUrl,
  buildYoutubeLoopbackRedirectUri,
  exchangeYoutubeAuthorizationCode,
  extractYoutubeOAuthClientCredentials,
  fetchYoutubeMineChannel,
  YOUTUBE_DEFAULT_SCOPES,
} from '../services/product-video-agent/src/youtube-oauth.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
  printWarn,
  projectRoot,
} from './lib/ruflo-wrapper-utils.mjs';

const PRODUCT_VIDEO_ENV_PATH = resolve(projectRoot, 'config', 'product-video', '.env');

function openInBrowser(url) {
  try {
    const command = process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
    const args = process.platform === 'win32'
      ? ['/c', 'start', '', url]
      : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function upsertEnvValue(filePath, key, value) {
  const line = `${key}=${value}`;
  if (!existsSync(filePath)) {
    writeFileSync(filePath, `${line}\n`, 'utf8');
    return { updated: false, created: true };
  }

  const existing = readFileSync(filePath, 'utf8');
  const lines = existing.split(/\r?\n/u);
  let matched = false;
  const nextLines = lines.map((raw) => {
    if (raw.startsWith(`${key}=`)) {
      matched = true;
      return line;
    }
    return raw;
  });

  if (!matched) {
    nextLines.push(line);
  }

  const nextText = nextLines.join('\n').replace(/\n+$/u, '\n');
  writeFileSync(filePath, nextText.endsWith('\n') ? nextText : `${nextText}\n`, 'utf8');
  return { updated: matched, created: false };
}

function getPositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return parsed;
}

async function captureAuthorizationCode(port, expectedState, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5 * 60 * 1000;
  return new Promise((resolvePromise, rejectPromise) => {
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || '', `http://127.0.0.1:${port}`);
      if (requestUrl.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const errorParam = requestUrl.searchParams.get('error');
      const stateParam = requestUrl.searchParams.get('state');
      if (errorParam) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`OAuth error: ${errorParam}`);
        server.close();
        rejectPromise(new Error(`Google returned OAuth error: ${errorParam}`));
        return;
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing authorization code.');
        return;
      }

      if (expectedState && stateParam !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('State mismatch. Aborting.');
        server.close();
        rejectPromise(new Error(`State mismatch: expected ${expectedState}, got ${stateParam || ''}`));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>YouTube authorization received</h2><p>You can close this tab and return to the terminal.</p></body></html>');
      server.close();
      resolvePromise({ code, state: stateParam });
    });

    server.on('error', rejectPromise);
    server.listen(port, '127.0.0.1');
    setTimeout(() => {
      rejectPromise(new Error(`Timed out waiting for OAuth callback after ${Math.round(timeoutMs / 1000)}s`));
      try { server.close(); } catch { /* already closed */ }
    }, timeoutMs).unref();
  });
}

function loadYoutubeChannelProfile(profiles, selector) {
  const normalizedSelector = String(selector || '').trim();
  const matches = profiles.filter((profile) => (
    profile.id === normalizedSelector || profile.account_key === normalizedSelector
  ));

  if (matches.length === 0) {
    throw new Error(`No publication channel matched "${normalizedSelector}". Use the row id or account_key from publication-channels.`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple publication channels matched "${normalizedSelector}". Use the exact row id.`);
  }

  return matches[0];
}

function loadYoutubeClientCredentials(secretPath) {
  const absolutePath = resolve(projectRoot, secretPath);
  const payload = JSON.parse(readFileSync(absolutePath, 'utf8'));
  return {
    absolutePath,
    ...extractYoutubeOAuthClientCredentials(payload),
  };
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/youtube-authorize.mjs --channel <channel-id-or-account-key> [options]',
      '',
      'Bootstraps a YouTube refresh token for one publication channel and',
      'verifies the authenticated YouTube identity with channels.list?mine=true.',
      '',
      'Options:',
      '  --channel <id>         Required publication channel id or account_key.',
      '  --channels <path>      Channel registry JSON. Default: services/product-video-agent/publication-channels.example.json',
      '  --loopback-port <n>    Override the OAuth loopback port. Default: YOUTUBE_OAUTH_LOOPBACK_PORT or 53683',
      '  --no-open              Print the authorize URL instead of opening a browser tab.',
    ]);
    return;
  }

  const channelSelector = getStringOption(options, 'channel', '');
  if (!channelSelector) {
    throw new Error('The --channel option is required.');
  }

  const channelsPath = getStringOption(
    options,
    'channels',
    'services/product-video-agent/publication-channels.example.json',
  );
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const profile = loadYoutubeChannelProfile(profiles, channelSelector);
  if (profile.platform !== 'youtube_shorts') {
    throw new Error(`Channel ${profile.id} is not a youtube_shorts profile.`);
  }
  if (!profile.youtube.oauth_client_secret_path) {
    throw new Error(`Channel ${profile.id} is missing youtube.oauth_client_secret_path.`);
  }
  if (!profile.youtube.oauth_refresh_token_env) {
    throw new Error(`Channel ${profile.id} is missing youtube.oauth_refresh_token_env.`);
  }

  const runtimeConfig = loadRuntimeConfig();
  const loopbackPort = getPositiveInteger(
    getStringOption(options, 'loopback-port', ''),
    getPositiveInteger(runtimeConfig.env.YOUTUBE_OAUTH_LOOPBACK_PORT, 53683),
  );
  const credentials = loadYoutubeClientCredentials(profile.youtube.oauth_client_secret_path);
  const redirectUri = buildYoutubeLoopbackRedirectUri(loopbackPort);
  const state = `orion-youtube-${profile.account_key}-${Date.now()}`;
  const authorizeUrl = buildYoutubeAuthorizeUrl(credentials, {
    redirectUri,
    scopes: YOUTUBE_DEFAULT_SCOPES,
    state,
  });

  printInfo(`Channel profile: ${profile.id} (${profile.name})`);
  printInfo(`Client secret: ${credentials.absolutePath}`);
  printInfo(`Refresh token env key: ${profile.youtube.oauth_refresh_token_env}`);
  printInfo(`Redirect URI: ${redirectUri}`);
  if (credentials.clientType === 'web') {
    printWarn('This OAuth client JSON is a web application. The exact redirect URI above must be allowed in Google Cloud.');
  } else {
    printInfo('Desktop-app OAuth client detected. This is the preferred setup for the local bootstrap flow.');
  }

  const shouldOpen = !getBooleanOption(options, 'no-open', false);
  if (shouldOpen && openInBrowser(authorizeUrl)) {
    printInfo('Opened the Google consent screen in your default browser.');
  } else {
    printWarn('Open this URL manually in your browser:');
    process.stdout.write(`${authorizeUrl}\n`);
  }

  printInfo(`Waiting for the callback on ${redirectUri} ...`);
  const { code } = await captureAuthorizationCode(loopbackPort, state);
  printInfo('Authorization code received. Exchanging for tokens.');

  const tokens = await exchangeYoutubeAuthorizationCode(credentials, code, { redirectUri });
  upsertEnvValue(PRODUCT_VIDEO_ENV_PATH, profile.youtube.oauth_refresh_token_env, tokens.refreshToken);
  printInfo(`Refresh token saved to ${PRODUCT_VIDEO_ENV_PATH}.`);

  const verifiedChannel = await fetchYoutubeMineChannel(tokens.accessToken);
  printInfo(`Authorized YouTube channel: ${verifiedChannel.title || '(untitled)'} (${verifiedChannel.channelId})`);

  if (profile.youtube.channel_id && profile.youtube.channel_id !== verifiedChannel.channelId) {
    throw new Error(
      `Configured channel_id ${profile.youtube.channel_id} does not match the authorized YouTube identity ${verifiedChannel.channelId}.`,
    );
  }

  if (!profile.youtube.channel_id) {
    printWarn(`Set youtube.channel_id for ${profile.id} to ${verifiedChannel.channelId} before enabling uploads.`);
  } else {
    printInfo(`Verified configured channel_id ${profile.youtube.channel_id}.`);
  }

  printInfo('Next step: run the publication flow only after the configured channel_id and refresh token are both in place.');
}

main().catch((error) => {
  printError(error.message || String(error));
  process.exitCode = 1;
});
