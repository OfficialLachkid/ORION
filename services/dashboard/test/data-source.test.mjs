import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDashboardOverview } from '../src/data-source.mjs';

test('overview reuses shared sources and does not expose channel secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'orion-dashboard-'));
  const eventsPath = join(root, 'ops-events.jsonl');
  const healthPath = join(root, 'health.json');
  const approvalsPath = join(root, 'approvals.json');
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
  assert.equal(overview.leads.byStatus.qualified, 1);
});
