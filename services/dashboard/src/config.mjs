import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return values;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parsePositiveInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(String(host || '').toLowerCase());
}

function validateOrigin(origin) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('ORION_DASHBOARD_PUBLIC_ORIGIN must use HTTP or HTTPS.');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('ORION_DASHBOARD_PUBLIC_ORIGIN must not include a path, query, or fragment.');
  }
  return parsed.origin;
}

export function loadDashboardConfig(options = {}) {
  const envPath = resolve(
    options.envFilePath || resolve(projectRoot, 'config', 'dashboard', '.env'),
  );
  const env = {
    ...parseEnvFile(envPath),
    ...process.env,
    ...(options.env || {}),
  };

  const host = String(env.ORION_DASHBOARD_HOST || '127.0.0.1').trim();
  if (!isLoopbackHost(host)) {
    throw new Error(
      'The first ORION dashboard release must bind to loopback. Use an authenticated HTTPS proxy such as Tailscale Serve for remote access.',
    );
  }

  const port = parsePositiveInteger(env.ORION_DASHBOARD_PORT, 4317, 65535);
  const publicOrigin = validateOrigin(
    String(env.ORION_DASHBOARD_PUBLIC_ORIGIN || `http://127.0.0.1:${port}`).trim(),
  );
  const originHost = new URL(publicOrigin).hostname;
  if (publicOrigin.startsWith('http:') && !isLoopbackHost(originHost)) {
    throw new Error('Non-loopback dashboard access requires an HTTPS public origin.');
  }

  const adminUsername = String(env.ORION_DASHBOARD_ADMIN_USERNAME || 'admin').trim();
  const adminPasswordHash = String(env.ORION_DASHBOARD_ADMIN_PASSWORD_HASH || '').trim();
  const sessionSecret = String(env.ORION_DASHBOARD_SESSION_SECRET || '').trim();
  if (!adminUsername) throw new Error('ORION_DASHBOARD_ADMIN_USERNAME is required.');
  if (!/^scrypt\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/u.test(adminPasswordHash)) {
    throw new Error('ORION_DASHBOARD_ADMIN_PASSWORD_HASH is missing or invalid.');
  }
  if (Buffer.byteLength(sessionSecret, 'utf8') < 32) {
    throw new Error('ORION_DASHBOARD_SESSION_SECRET must be at least 32 bytes.');
  }

  const secureCookie = parseBoolean(
    env.ORION_DASHBOARD_SECURE_COOKIE,
    publicOrigin.startsWith('https:'),
  );
  if (publicOrigin.startsWith('https:') && !secureCookie) {
    throw new Error('HTTPS dashboard access requires secure cookies.');
  }

  return {
    host,
    port,
    publicOrigin,
    allowedOrigins: new Set([publicOrigin]),
    adminUsername,
    adminPasswordHash,
    sessionSecret,
    secureCookie,
    sessionTtlSeconds: parsePositiveInteger(
      env.ORION_DASHBOARD_SESSION_TTL_SECONDS,
      8 * 60 * 60,
      24 * 60 * 60,
    ),
    cacheTtlSeconds: parsePositiveInteger(env.ORION_DASHBOARD_CACHE_TTL_SECONDS, 30, 300),
    loginWindowSeconds: parsePositiveInteger(env.ORION_DASHBOARD_LOGIN_WINDOW_SECONDS, 15 * 60, 3600),
    loginMaxAttempts: parsePositiveInteger(env.ORION_DASHBOARD_LOGIN_MAX_ATTEMPTS, 5, 20),
    appRoot: resolve(projectRoot, 'apps', 'orion-dashboard'),
    brandAssetPath: resolve(projectRoot, 'docs', 'assets', 'orion-logo.png'),
  };
}

