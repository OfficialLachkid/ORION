#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { upsertEnvValues } from '../services/lib/env-file.mjs';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { loadPublicationChannelProfiles } from '../services/product-video-agent/src/publication-channels.mjs';
import { listConfiguredPlatformPublicationTargets } from '../services/product-video-agent/src/social-publication-targets.mjs';
import {
  buildTikTokAuthorizeUrl,
  buildTikTokCredentialEnvValues,
  createTikTokPkcePair,
  exchangeTikTokAuthorizationCode,
  fetchTikTokCreatorInfo,
  fetchTikTokUserInfo,
  revokeTikTokAccessToken,
  TIKTOK_DEFAULT_SCOPES,
  validateTikTokDesktopRedirectUri,
} from '../services/product-video-agent/src/tiktok-oauth.mjs';
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
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function resolveChannelsPath(explicitPath) {
  if (explicitPath) return explicitPath;
  const privatePath = 'services/product-video-agent/publication-channels.json';
  return existsSync(resolve(projectRoot, privatePath))
    ? privatePath
    : 'services/product-video-agent/publication-channels.example.json';
}

function findTikTokTarget(profiles, accountKey) {
  const matches = profiles.flatMap((profile) => (
    listConfiguredPlatformPublicationTargets(profile)
      .filter((target) => target.platform === 'tiktok_video' && target.accountKey === accountKey)
      .map((target) => ({ profile, target }))
  ));
  if (matches.length === 0) {
    throw new Error(`No TikTok publication target matched account_key "${accountKey}".`);
  }
  if (matches.length > 1) {
    throw new Error(`Multiple TikTok publication targets matched account_key "${accountKey}".`);
  }
  return matches[0];
}

function captureAuthorizationCode(redirectUri, expectedState, options = {}) {
  const parsedRedirect = new URL(validateTikTokDesktopRedirectUri(redirectUri));
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5 * 60 * 1000;
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timeout;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      callback(value);
    };
    const server = http.createServer((req, res) => {
      const requestUrl = new URL(req.url || '', parsedRedirect.origin);
      if (requestUrl.pathname !== parsedRedirect.pathname) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      const errorParam = requestUrl.searchParams.get('error');
      const errorDescription = requestUrl.searchParams.get('error_description');
      const stateParam = requestUrl.searchParams.get('state');
      const code = requestUrl.searchParams.get('code');
      if (errorParam) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('TikTok authorization was not completed. Return to the terminal for details.');
        settle(rejectPromise, new Error(`TikTok returned OAuth error: ${errorDescription || errorParam}`));
        return;
      }
      if (stateParam !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('State mismatch. Authorization aborted.');
        settle(rejectPromise, new Error('TikTok OAuth state mismatch.'));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing authorization code.');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<html><body><h2>ORION TikTok authorization received</h2><p>You can close this tab and return to the terminal.</p></body></html>');
      settle(resolvePromise, { code, scopes: requestUrl.searchParams.get('scopes') || '' });
    });
    server.on('error', (error) => settle(rejectPromise, error));
    server.listen(Number(parsedRedirect.port), parsedRedirect.hostname);
    timeout = setTimeout(() => {
      settle(rejectPromise, new Error(`Timed out waiting for TikTok OAuth callback after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);
    timeout.unref();
  });
}

async function revokeAfterFailedVerification(clientConfig, accessToken) {
  try {
    await revokeTikTokAccessToken(clientConfig, accessToken);
    printWarn('Revoked the unverified TikTok authorization.');
  } catch (error) {
    printWarn(`Could not revoke the unverified TikTok authorization: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/tiktok-authorize.mjs --account <account-key> [options]',
      '',
      'Connects one configured TikTok target through Desktop Login Kit with PKCE,',
      'verifies the creator identity, and stores rotating tokens in the ignored',
      'config/product-video/.env file.',
      '',
      'Options:',
      '  --account <key>            Required TikTok target account_key.',
      '  --expect-username <name>    Fail and revoke if a different TikTok creator authorizes.',
      '  --channels <path>           Override the publication channel registry.',
      '  --no-open                   Print the authorize URL instead of opening a browser.',
    ]);
    return;
  }

  const accountKey = getStringOption(options, 'account', '');
  if (!accountKey) throw new Error('The --account option is required.');

  const channelsPath = resolveChannelsPath(getStringOption(options, 'channels', ''));
  const profiles = await loadPublicationChannelProfiles(channelsPath, { projectRoot });
  const { profile, target } = findTikTokTarget(profiles, accountKey);
  const runtimeConfig = loadRuntimeConfig();
  const clientConfig = {
    clientKey: runtimeConfig.env.TIKTOK_CLIENT_KEY,
    clientSecret: runtimeConfig.env.TIKTOK_CLIENT_SECRET,
  };
  if (!clientConfig.clientKey || !clientConfig.clientSecret) {
    throw new Error('TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must both be set in config/product-video/.env.');
  }
  const redirectUri = validateTikTokDesktopRedirectUri(runtimeConfig.env.TIKTOK_OAUTH_REDIRECT_URI);
  const state = randomBytes(32).toString('base64url');
  const pkce = createTikTokPkcePair();
  const authorizeUrl = buildTikTokAuthorizeUrl(clientConfig, {
    redirectUri,
    scopes: TIKTOK_DEFAULT_SCOPES,
    state,
    codeChallenge: pkce.challenge,
  });

  printInfo(`Source channel: ${profile.id} (${profile.name})`);
  printInfo(`TikTok target: ${target.accountKey}`);
  printInfo(`Redirect URI: ${redirectUri}`);
  printInfo(`Requested scopes: ${TIKTOK_DEFAULT_SCOPES.join(',')}`);

  const callbackPromise = captureAuthorizationCode(redirectUri, state);
  if (!getBooleanOption(options, 'no-open', false) && openInBrowser(authorizeUrl)) {
    printInfo('Opened the TikTok consent screen in the default browser.');
  } else {
    printWarn('Open this URL in the browser that can reach the callback URI:');
    process.stdout.write(`${authorizeUrl}\n`);
  }

  printInfo(`Waiting for the callback on ${redirectUri} ...`);
  const { code } = await callbackPromise;
  printInfo('Authorization code received. Exchanging it for tokens.');
  const tokens = await exchangeTikTokAuthorizationCode(clientConfig, code, {
    codeVerifier: pkce.verifier,
    redirectUri,
  });

  const grantedScopes = new Set(tokens.scope.split(',').map((scope) => scope.trim()).filter(Boolean));
  const missingScopes = TIKTOK_DEFAULT_SCOPES.filter((scope) => !grantedScopes.has(scope));
  if (missingScopes.length > 0) {
    await revokeAfterFailedVerification(clientConfig, tokens.accessToken);
    throw new Error(`TikTok did not grant required scope(s): ${missingScopes.join(', ')}`);
  }

  let creatorInfo;
  let userInfo;
  try {
    [creatorInfo, userInfo] = await Promise.all([
      fetchTikTokCreatorInfo(tokens.accessToken),
      fetchTikTokUserInfo(tokens.accessToken),
    ]);
  } catch (error) {
    await revokeAfterFailedVerification(clientConfig, tokens.accessToken);
    throw error;
  }

  const expectedUsername = getStringOption(options, 'expect-username', '').replace(/^@/u, '').toLowerCase();
  const actualUsername = String(creatorInfo.creator_username || '').replace(/^@/u, '').toLowerCase();
  if (expectedUsername && actualUsername !== expectedUsername) {
    await revokeAfterFailedVerification(clientConfig, tokens.accessToken);
    throw new Error(`Authorized @${actualUsername}, but expected @${expectedUsername}. No tokens were stored.`);
  }

  const envValues = buildTikTokCredentialEnvValues(target, tokens);
  upsertEnvValues(PRODUCT_VIDEO_ENV_PATH, envValues);
  printInfo(`Authorized TikTok creator: @${creatorInfo.creator_username} (${creatorInfo.creator_nickname || userInfo.display_name || 'unnamed'})`);
  printInfo(`Verified scopes: ${tokens.scope}`);
  printInfo(`Tokens saved to ${PRODUCT_VIDEO_ENV_PATH} with owner-only permissions.`);
  printInfo('The publication target remains disabled; this command does not upload or publish content.');
}

main().catch((error) => {
  printError(error.message || String(error));
  process.exitCode = 1;
});
