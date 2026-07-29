#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { resolveGmailConfig } from '../services/gmail/src/config.mjs';
import {
  buildAuthorizeUrl,
  buildLoopbackRedirectUri,
  exchangeAuthorizationCode,
  GMAIL_COMPOSE_SCOPE,
  GMAIL_METADATA_SCOPE,
} from '../services/gmail/src/oauth.mjs';
import {
  getBooleanOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';

const GMAIL_ENV_PATH = resolve(projectRoot, 'config', 'gmail', '.env');

function openInBrowser(url) {
  try {
    const child = spawn('open', [url], { stdio: 'ignore', detached: true });
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

async function captureAuthorizationCode(port, expectedState, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 5 * 60 * 1000;
  return new Promise((resolvePromise, rejectPromise) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const errorParam = url.searchParams.get('error');
      const stateParam = url.searchParams.get('state');
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
      res.end('<html><body><h2>Authorization received</h2><p>You can close this tab and return to the terminal.</p></body></html>');
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

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/gmail-authorize.mjs [--no-open]',
      '',
      'Opens the Google OAuth consent page in your default browser and captures',
      'the authorization code on http://127.0.0.1:<GMAIL_OAUTH_LOOPBACK_PORT>/callback.',
      'On success the refresh token is written into config/gmail/.env.',
      '',
      'Options:',
      '  --no-open   Print the authorize URL instead of opening a browser tab.',
    ]);
    return;
  }

  const runtimeConfig = loadRuntimeConfig();
  const gmailConfig = resolveGmailConfig(runtimeConfig);
  if (!gmailConfig.clientId || !gmailConfig.clientSecret) {
    throw new Error('GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in config/gmail/.env before running this script.');
  }

  const state = `orion-${Date.now()}`;
  const redirectUri = buildLoopbackRedirectUri(gmailConfig.loopbackPort);
  // compose (create + send drafts) + metadata (read thread structure/headers
  // for reply detection). Space-separated = request both in one consent.
  const authorizeUrl = buildAuthorizeUrl(gmailConfig, {
    state,
    scope: `${GMAIL_COMPOSE_SCOPE} ${GMAIL_METADATA_SCOPE}`,
  });

  printInfo(`Redirect URI: ${redirectUri}`);
  printInfo(`This URI MUST be registered on the OAuth 2.0 Client in Google Cloud Console.`);

  const shouldOpen = !getBooleanOption(options, 'no-open', false);
  if (shouldOpen && openInBrowser(authorizeUrl)) {
    printInfo('Opened the Google consent screen in your default browser.');
  } else {
    printWarn('Open this URL manually in your browser:');
    process.stdout.write(`${authorizeUrl}\n`);
  }

  printInfo(`Waiting for the callback on ${redirectUri} ...`);
  const { code } = await captureAuthorizationCode(gmailConfig.loopbackPort, state);
  printInfo('Authorization code received. Exchanging for tokens.');

  const tokens = await exchangeAuthorizationCode(gmailConfig, code, { redirectUri });
  upsertEnvValue(GMAIL_ENV_PATH, 'GMAIL_REFRESH_TOKEN', tokens.refreshToken);

  printInfo(`Refresh token saved to ${GMAIL_ENV_PATH}.`);
  printInfo(`Access token expires in ${tokens.expiresIn}s and will be refreshed on demand.`);
  printInfo('Sender is now authorized. Try: npm run gmail:send-test -- --to you@example.com --subject test --body hi');
}

main().catch((error) => {
  printError(error.message || String(error));
  process.exitCode = 1;
});
