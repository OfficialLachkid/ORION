import { createServer as createHttpServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { LoginRateLimiter, createSessionManager, parseCookies, verifyPassword } from './auth.mjs';

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
]);

function applySecurityHeaders(response, config) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  if (config.publicOrigin.startsWith('https:')) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function sendJson(response, statusCode, body, config, extraHeaders = {}) {
  applySecurityHeaders(response, config);
  for (const [key, value] of Object.entries(extraHeaders)) response.setHeader(key, value);
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendText(response, statusCode, body, config) {
  applySecurityHeaders(response, config);
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(body);
}

async function readJsonBody(request, limitBytes = 8_192) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('request_too_large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error('invalid_json');
  }
}

function originAllowed(request, config) {
  const origin = String(request.headers.origin || '');
  return Boolean(origin && config.allowedOrigins.has(origin));
}

function resolveStaticPath(appRoot, pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  if (requested.split('/').some((segment) => segment.startsWith('.'))) return null;
  const filePath = resolve(appRoot, requested);
  const relation = relative(appRoot, filePath);
  if (!relation || relation.startsWith('..') || isAbsolute(relation)) return null;
  return filePath;
}

function serveFile(response, filePath, config, method = 'GET') {
  if (!filePath || !existsSync(filePath)) {
    sendText(response, 404, 'Not found', config);
    return;
  }
  applySecurityHeaders(response, config);
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
  });
  response.end(method === 'HEAD' ? undefined : readFileSync(filePath));
}

function clientKey(request) {
  return String(request.socket?.remoteAddress || 'unknown');
}

export function createDashboardServer(options) {
  const config = options.config;
  const dataSource = options.dataSource;
  const recordEvent = options.recordEvent || (() => {});
  const sessions = options.sessions || createSessionManager({
    secret: config.sessionSecret,
    ttlSeconds: config.sessionTtlSeconds,
    secureCookie: config.secureCookie,
  });
  const loginLimiter = options.loginLimiter || new LoginRateLimiter({
    maxAttempts: config.loginMaxAttempts,
    windowSeconds: config.loginWindowSeconds,
  });

  function authenticate(request) {
    const token = parseCookies(request.headers.cookie || '')[sessions.cookieName];
    return sessions.verify(token);
  }

  async function handleApi(request, response, pathname) {
    if (pathname === '/api/session' && request.method === 'GET') {
      const session = authenticate(request);
      sendJson(response, 200, session ? {
        authenticated: true,
        username: session.sub,
        csrfToken: session.csrf,
        expiresAt: new Date(session.exp * 1000).toISOString(),
      } : { authenticated: false }, config);
      return;
    }

    if (pathname === '/api/auth/login' && request.method === 'POST') {
      if (!originAllowed(request, config)) {
        sendJson(response, 403, { error: 'Request origin is not allowed.' }, config);
        return;
      }
      const key = clientKey(request);
      const rate = loginLimiter.check(key);
      if (!rate.allowed) {
        sendJson(response, 429, { error: 'Too many login attempts.' }, config, {
          'Retry-After': String(rate.retryAfterSeconds),
        });
        return;
      }

      let body;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        sendJson(response, error.message === 'request_too_large' ? 413 : 400, { error: 'Invalid request.' }, config);
        return;
      }

      const passwordValid = verifyPassword(body.password, config.adminPasswordHash);
      const usernameValid = String(body.username || '') === config.adminUsername;
      if (!usernameValid || !passwordValid) {
        loginLimiter.fail(key);
        recordEvent('dashboard_login_failed', { reason: 'invalid_credentials' });
        sendJson(response, 401, { error: 'Invalid credentials.' }, config);
        return;
      }

      loginLimiter.clear(key);
      const issued = sessions.issue(config.adminUsername);
      recordEvent('dashboard_login_succeeded', {});
      sendJson(response, 200, {
        authenticated: true,
        username: issued.payload.sub,
        csrfToken: issued.payload.csrf,
        expiresAt: new Date(issued.payload.exp * 1000).toISOString(),
      }, config, { 'Set-Cookie': sessions.cookie(issued.token) });
      return;
    }

    if (pathname === '/api/auth/logout' && request.method === 'POST') {
      const session = authenticate(request);
      if (!session) {
        sendJson(response, 401, { error: 'Authentication required.' }, config);
        return;
      }
      if (!originAllowed(request, config) || request.headers['x-csrf-token'] !== session.csrf) {
        sendJson(response, 403, { error: 'Request verification failed.' }, config);
        return;
      }
      sessions.revoke(session);
      recordEvent('dashboard_logout_succeeded', {});
      sendJson(response, 200, { authenticated: false }, config, {
        'Set-Cookie': sessions.clearCookie(),
      });
      return;
    }

    if (pathname === '/api/overview' && request.method === 'GET') {
      if (!authenticate(request)) {
        sendJson(response, 401, { error: 'Authentication required.' }, config);
        return;
      }
      const overview = await dataSource.getOverview({
        force: new URL(request.url, config.publicOrigin).searchParams.get('refresh') === '1',
      });
      sendJson(response, 200, overview, config);
      return;
    }

    sendJson(response, 404, { error: 'Not found.' }, config);
  }

  const server = createHttpServer((request, response) => {
    void (async () => {
      const pathname = new URL(request.url || '/', config.publicOrigin).pathname;
      if (pathname.startsWith('/api/')) {
        await handleApi(request, response, pathname);
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method || 'GET')) {
        sendText(response, 405, 'Method not allowed', config);
        return;
      }
      if (pathname === '/brand/orion-logo.png') {
        serveFile(response, config.brandAssetPath, config, request.method);
        return;
      }
      serveFile(response, resolveStaticPath(config.appRoot, pathname), config, request.method);
    })().catch((error) => {
      process.stderr.write(`Dashboard request failed: ${error.message}\n`);
      if (!response.headersSent) {
        sendJson(response, 500, { error: 'Dashboard request failed.' }, config);
      } else {
        response.end();
      }
    });
  });

  return server;
}

