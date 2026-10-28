import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboardOverview, buildLeadOperations, DashboardDataSource } from '../src/data-source.mjs';

test('overview reuses shared sources and does not expose channel secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-dashboard-'));
  const eventsPath = join(root, 'ops-events.jsonl');
  const healthPath = join(root, 'health.json');
  const approvalsPath = join(root, 'approvals.json');
  const archiveRoot = join(root, 'digital-assets');
  const productRoot = join(archiveRoot, 'neon-pack');
  mkdirSync(join(productRoot, 'review'), { recursive: true });
  writeFileSync(eventsPath, [
    JSON.stringify({
      timestamp: '2026-10-28T10:00:00.000Z',
      type: 'task_state_changed',
      payload: { taskId: 'task-1', status: 'awaiting_approval', domain: 'social' },
    }),
    JSON.stringify({
      timestamp: '2026-10-28T10:05:00.000Z',
      type: 'task_execution_finished',
      payload: { outcome: 'completed', action: 'publish' },
    }),
  ].join('\n') + '\n');
  writeFileSync(healthPath, JSON.stringify({
    updatedAt: '2026-10-28T10:10:00.000Z',
    checks: { ollama: { severity: 'healthy', state: 'idle', summary: 'Ollama is ready.' } },
  }));
  writeFileSync(approvalsPath, JSON.stringify([{
    task_id: 'task-1',
    summary: 'Approve publication',
    full_text: 'must remain private',
    domain: 'social',
    status: 'awaiting_approval',
    submitted_at: '2026-10-28T10:00:00.000Z',
  }]));
  writeFileSync(join(productRoot, 'product.json'), JSON.stringify({
    product_id: 'product-1',
    slug: 'neon-pack',
    title: 'Neon Pack',
    version: '1.0.0',
    status: 'approved',
    category: 'pixel-art',
    assets: [{ status: 'generated' }, { status: 'generated' }],
    distribution: { marketplaces: ['itch.io'] },
    updated_at: '2026-10-28T11:00:00.000Z',
  }));
  writeFileSync(join(productRoot, 'review', 'itch-release.json'), JSON.stringify({
    status: 'verified_public',
    public_url: 'https://vbjservices.itch.io/neon-pack?secret=never-expose',
  }));

  const rows = {
    video_channels: [{
      id: 'channel-1',
      name: 'Poke Quiz',
      platform: 'youtube',
      account_key: 'poke-quizz',
      status: 'active',
      settings: { schedule_slots: ['08:00'], access_token: 'never-expose' },
      updated_at: '2026-10-28T09:00:00.000Z',
    }],
    video_publications: [{
      id: 'publication-1',
      video_id: 'video-1',
      platform: 'instagram_reel',
      account_key: 'pokequizzz',
      status: 'scheduled',
      title: 'Who is that Pokemon?',
      scheduled_for: '2026-10-29T08:00:00.000Z',
      updated_at: '2026-10-28T10:00:00.000Z',
    }],
    leads: [{ id: 'lead-1', status: 'qualified', created_at: '2026-10-28T08:00:00.000Z' }],
  };
  const fetchImpl = async (url) => {
    const table = new URL(url).pathname.split('/').at(-1);
    return new Response(JSON.stringify(rows[table] || []), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  const runtimeConfig = {
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_example',
      PENDING_APPROVAL_TASKS_PATH: approvalsPath,
      DIGITAL_ASSET_ARCHIVE_ROOT: archiveRoot,
    },
    runtimePaths: {
      metricsEventsFile: eventsPath,
      logDir: root,
      healthMonitorStateFile: healthPath,
      tmpDir: root,
    },
  };

  const overview = await buildDashboardOverview({
    runtimeConfig,
    fetchImpl,
    now: '2026-10-28T12:00:00.000Z',
  });

  assert.equal(overview.mode, 'read_only');
  assert.equal(overview.health.overall, 'healthy');
  assert.equal(overview.pendingApprovals.length, 1);
  assert.equal(overview.pendingApprovals[0].full_text, undefined);
  assert.deepEqual(overview.social.channels[0].scheduleSlots, ['08:00']);
  assert.equal(JSON.stringify(overview).includes('never-expose'), false);
  assert.equal(overview.social.publications.upcoming.length, 1);
  assert.equal(overview.leads.deferred, true);
  assert.equal(overview.resourceUsage.supabase.requests, 3);
  assert.equal(overview.resourceUsage.supabase.rowsLoaded, 2);
  assert.deepEqual(
    overview.modules.map((module) => module.id),
    [
      'overview',
      'social',
      'digital-assets',
      'leads',
      'jobs',
      'infrastructure',
      'approvals',
      'commerce',
      'settings',
    ],
  );
  assert.equal(overview.modules.find((module) => module.id === 'leads').status, 'read_only');
  assert.equal(overview.modules.filter((module) => module.status === 'planned').length, 5);
  assert.equal(overview.digitalAssets.totalProducts, 1);
  assert.equal(overview.digitalAssets.totalAssets, 2);
  assert.equal(overview.digitalAssets.products[0].publicUrl, 'https://vbjservices.itch.io/neon-pack');
  assert.equal(JSON.stringify(overview).includes('never-expose'), false);
});

test('dashboard snapshots share a bounded Supabase cache across widgets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-dashboard-cache-'));
  let nowMs = new Date('2026-10-28T12:00:00.000Z').getTime();
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return new Response('[]', {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Range': '*/0' },
    });
  };
  const source = new DashboardDataSource({
    runtimeConfig: {
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'sb_secret_example',
      },
      runtimePaths: {
        metricsEventsFile: join(root, 'missing-events.jsonl'),
        logDir: root,
        healthMonitorStateFile: join(root, 'missing-health.json'),
        tmpDir: root,
      },
    },
    fetchImpl,
    cacheTtlSeconds: 120,
    now: () => nowMs,
  });

  const first = await source.getOverview();
  const cached = await source.getOverview();
  assert.equal(requests, 3);
  assert.equal(cached, first);

  nowMs += 121_000;
  await source.getOverview();
  assert.equal(requests, 6);
});

test('lead operations lazily returns a sanitized bounded page and cached Discord-equivalent totals', async () => {
  let nowMs = new Date('2026-10-28T12:00:00.000Z').getTime();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({
      method: options.method || 'GET',
      url: parsed,
      range: options.headers?.Range,
    });
    if ((options.method || 'GET') === 'HEAD') {
      const isNew = parsed.searchParams.get('status') === 'eq.new';
      return new Response(null, {
        status: 200,
        headers: { 'Content-Range': isNew ? '*/17' : '*/42' },
      });
    }
    return new Response(JSON.stringify([
      {
        id: 'lead-1',
        business_name: 'Example Studio',
        business_type: 'Design agency',
        source_url: 'https://example.test/about?tracking=secret#contact',
        niche: 'web design',
        location: 'Rotterdam',
        status: 'new',
        created_at: '2026-10-28T08:00:00.000Z',
        contact_email: 'not-returned@example.test',
        qualification: { reasoning: 'must not leave the server' },
      },
    ]), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Content-Range': '0-0/42' },
    });
  };
  const runtimeConfig = {
    env: {
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SECRET_KEY: 'sb_secret_example',
    },
  };

  const direct = await buildLeadOperations({ runtimeConfig, fetchImpl, now: nowMs });
  assert.equal(direct.summary.total, 42);
  assert.equal(direct.summary.new, 17);
  assert.equal(direct.leads.length, 1);
  assert.equal(direct.leads[0].sourceUrl, 'https://example.test/about');
  assert.equal(JSON.stringify(direct).includes('not-returned@example.test'), false);
  assert.equal(JSON.stringify(direct).includes('must not leave the server'), false);
  assert.equal(direct.resourceUsage.supabase.requests, 2);
  assert.equal(direct.resourceUsage.supabase.rowsLoaded, 1);
  assert.equal(calls[0].range, '0-24');
  assert.equal(calls[0].url.searchParams.get('select'), 'id,business_name,business_type,source_url,niche,location,status,created_at');

  calls.length = 0;
  const source = new DashboardDataSource({
    runtimeConfig,
    fetchImpl,
    cacheTtlSeconds: 120,
    now: () => nowMs,
  });
  const first = await source.getLeadOperations({ page: 1, status: 'all' });
  const cached = await source.getLeadOperations({ page: 1, status: 'all' });
  assert.equal(cached, first);
  assert.equal(calls.length, 2);

  nowMs += 121_000;
  await source.getLeadOperations({ page: 1, status: 'all' });
  assert.equal(calls.length, 4);
});
