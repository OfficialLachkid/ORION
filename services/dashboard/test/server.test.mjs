import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createPasswordHash } from '../src/auth.mjs';
import { createDashboardServer } from '../src/server.mjs';

test('server protects private data with one admin session and CSRF logout', async (context) => {
  const publicOrigin = 'http://127.0.0.1:4317';
  const config = {
    publicOrigin,
    allowedOrigins: new Set([publicOrigin]),
    adminUsername: 'admin',
    adminPasswordHash: createPasswordHash('a strong dashboard password', { salt: Buffer.alloc(16, 3) }),
    sessionSecret: 's'.repeat(48),
    secureCookie: false,
    sessionTtlSeconds: 3_600,
    loginMaxAttempts: 3,
    loginWindowSeconds: 60,
    appRoot: resolve('apps', 'orion-dashboard'),
    brandAssetPath: resolve('docs', 'assets', 'orion-logo.png'),
  };
  const server = createDashboardServer({
    config,
    dataSource: {
      getOverview: async () => ({ mode: 'read_only' }),
      getLeadOperations: async (query) => ({ mode: 'read_only', query }),
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;

  const anonymous = await fetch(`${base}/api/overview`);
  assert.equal(anonymous.status, 401);
  const anonymousLeads = await fetch(`${base}/api/leads`);
  assert.equal(anonymousLeads.status, 401);

  const wrongOrigin = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ username: 'admin', password: 'a strong dashboard password' }),
  });
  assert.equal(wrongOrigin.status, 403);

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: publicOrigin },
    body: JSON.stringify({ username: 'admin', password: 'a strong dashboard password' }),
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.ok(loginBody.csrfToken);
  assert.match(login.headers.get('content-security-policy'), /default-src 'self'/u);

  const overview = await fetch(`${base}/api/overview`, { headers: { Cookie: cookie } });
  assert.equal(overview.status, 200);
  assert.deepEqual(await overview.json(), { mode: 'read_only' });

  const leads = await fetch(`${base}/api/leads?page=2&pageSize=25&status=new`, {
    headers: { Cookie: cookie },
  });
  assert.equal(leads.status, 200);
  assert.deepEqual(await leads.json(), {
    mode: 'read_only',
    query: { page: 2, pageSize: 25, status: 'new' },
  });

  const invalidLeadQuery = await fetch(`${base}/api/leads?status=not-a-real-status`, {
    headers: { Cookie: cookie },
  });
  assert.equal(invalidLeadQuery.status, 400);

  const badLogout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: publicOrigin },
  });
  assert.equal(badLogout.status, 403);

  const logout = await fetch(`${base}/api/auth/logout`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: publicOrigin,
      'X-CSRF-Token': loginBody.csrfToken,
    },
  });
  assert.equal(logout.status, 200);

  const afterLogout = await fetch(`${base}/api/overview`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401);
});
