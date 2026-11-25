import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildManualMarketplaceTask,
  evaluateMarketplaceAutomation,
} from '../src/automation-policy.mjs';
import { loadClippingEngineConfig } from '../src/config.mjs';
import {
  assessRuntimeResourceLock,
  assessOllamaModelHealth,
  buildJobFailureTransition,
  classifyJobForRecovery,
  createJobIdempotencyKey,
  createJobInputRevision,
  findJobHealthFindings,
} from '../src/job-lifecycle.mjs';

const AS_OF = new Date('2026-11-24T12:00:00.000Z');

test('example config proves profiles are dynamic and disabled by default', async () => {
  const config = await loadClippingEngineConfig();
  assert.equal(config.enabled, false);
  assert.deepEqual(
    config.search_profiles.map((profile) => profile.key),
    ['gaming-gta-vi-pilot', 'podcast-proof-profile'],
  );
  assert.equal(config.search_profiles.every((profile) => profile.enabled === false), true);
  assert.equal(config.budgets.max_in_flight_inference_jobs, 1);
});

test('Discord approval cannot override marketplace terms', () => {
  const marketplace = {
    key: 'blocked-marketplace',
    discovery: { mode: 'prohibited', authorization: 'prohibited_by_terms' },
  };
  const result = evaluateMarketplaceAutomation({
    marketplace,
    action: 'discovery',
    approval: { approved: true, approved_at: AS_OF.toISOString(), revision: 'rev-1' },
    expectedRevision: 'rev-1',
    asOf: AS_OF,
  });
  assert.deepEqual(result, { allowed: false, reason: 'prohibited_by_terms' });
});

test('authorized browser automation requires current permission and exact approval revision', () => {
  const marketplace = {
    key: 'partner-marketplace',
    submission: {
      mode: 'authorized_browser',
      authorization: 'written_permission',
      permission_evidence: {
        source_url: 'https://example.com/partner-letter',
        verified_at: '2026-11-20T00:00:00.000Z',
        expires_at: '2027-01-01T00:00:00.000Z',
      },
    },
  };
  const mismatch = evaluateMarketplaceAutomation({
    marketplace,
    action: 'submission',
    approval: { approved: true, approved_at: AS_OF.toISOString(), revision: 'old' },
    expectedRevision: 'current',
    asOf: AS_OF,
  });
  assert.equal(mismatch.reason, 'approval_revision_mismatch');

  const allowed = evaluateMarketplaceAutomation({
    marketplace,
    action: 'submission',
    approval: { approved: true, approved_at: AS_OF.toISOString(), revision: 'current' },
    expectedRevision: 'current',
    asOf: AS_OF,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.mode, 'authorized_browser');
});

test('invalid Discord approval timestamps fail closed', () => {
  const marketplace = {
    key: 'partner-marketplace',
    submission: {
      mode: 'authorized_api',
      authorization: 'published_api',
      permission_evidence: {
        source_url: 'https://example.com/api',
        verified_at: '2026-11-20T00:00:00.000Z',
      },
    },
  };
  const result = evaluateMarketplaceAutomation({
    marketplace,
    action: 'submission',
    approval: { approved: true, approved_at: 'not-a-date', revision: 'rev-1' },
    expectedRevision: 'rev-1',
    asOf: AS_OF,
  });
  assert.equal(result.reason, 'approval_timestamp_invalid');
});

test('manual capability creates a ready-to-act task rather than pretending it automated', () => {
  const task = buildManualMarketplaceTask({
    marketplace: { key: 'content-rewards' },
    action: 'submission',
    campaignId: 'campaign-1',
    canonicalUrl: 'https://youtube.com/shorts/example',
  });
  assert.equal(task.status, 'manual_action_required');
  assert.equal(task.marketplace_key, 'content-rewards');
});

test('job input revision and idempotency key are stable across object key order', () => {
  const first = createJobInputRevision({ campaign: '1', rules: { b: 2, a: 1 } });
  const second = createJobInputRevision({ rules: { a: 1, b: 2 }, campaign: '1' });
  assert.equal(first, second);
  assert.equal(createJobIdempotencyKey({
    namespace: 'clipping', jobType: 'qualify', subjectId: '1', inputRevision: first,
  }), createJobIdempotencyKey({
    namespace: 'clipping', jobType: 'qualify', subjectId: '1', inputRevision: second,
  }));
});

test('expired lease and overdue heartbeat cannot fail silently', () => {
  const expired = classifyJobForRecovery({
    status: 'running',
    claimed_at: '2026-11-24T10:00:00.000Z',
    heartbeat_at: '2026-11-24T11:59:00.000Z',
    lease_expires_at: '2026-11-24T11:59:59.000Z',
  }, { now: AS_OF });
  assert.deepEqual(expired, { state: 'stalled', reason: 'lease_expired' });

  const heartbeat = classifyJobForRecovery({
    status: 'running',
    claimed_at: '2026-11-24T11:00:00.000Z',
    heartbeat_at: '2026-11-24T11:40:00.000Z',
    lease_expires_at: '2026-11-24T12:30:00.000Z',
  }, { now: AS_OF, heartbeatTimeoutMs: 5 * 60_000 });
  assert.deepEqual(heartbeat, { state: 'stalled', reason: 'heartbeat_overdue' });
});

test('bounded failures retry then move to human review', () => {
  const retry = buildJobFailureTransition(
    { attempt_count: 2, max_attempts: 3 },
    new Error('temporary failure'),
    { now: AS_OF, baseDelayMs: 60_000 },
  );
  assert.equal(retry.status, 'retry');
  assert.equal(retry.next_retry_at, '2026-11-24T12:02:00.000Z');

  const terminal = buildJobFailureTransition(
    { attempt_count: 3, max_attempts: 3 },
    new Error('still failing'),
    { now: AS_OF },
  );
  assert.equal(terminal.status, 'review');
  assert.equal(terminal.next_retry_at, null);
});

test('watchdog identifies stuck resource waits and stale queue entries', () => {
  const findings = findJobHealthFindings([
    {
      id: 'queued-1', status: 'queued', created_at: '2026-11-24T10:00:00.000Z',
    },
    {
      id: 'wait-1', status: 'waiting_for_resources',
      next_retry_at: '2026-11-24T11:40:00.000Z', created_at: '2026-11-24T10:00:00.000Z',
    },
  ], { now: AS_OF, queueWarningMs: 30 * 60_000, overdueWarningMs: 5 * 60_000 });
  assert.deepEqual(findings.map((finding) => finding.code), [
    'queue_wait_overdue',
    'scheduled_retry_not_claimed',
  ]);
});

test('loaded Ollama model is not treated as healthy without a smoke test', () => {
  const falseReady = assessOllamaModelHealth({
    endpointReachable: true,
    requiredModel: 'llama3.1:8b',
    installedModels: ['llama3.1:8b'],
    loadedModels: ['llama3.1:8b'],
    smokeTestRequired: true,
    smokeTestStatus: 'failed',
  });
  assert.deepEqual(falseReady, { ready: false, reason: 'smoke_test_failed', loaded: true });

  const coldReady = assessOllamaModelHealth({
    endpointReachable: true,
    requiredModel: 'llama3.1:8b',
    installedModels: ['llama3.1:8b'],
    loadedModels: [],
    smokeTestRequired: true,
    smokeTestStatus: 'passed',
  });
  assert.deepEqual(coldReady, { ready: true, reason: 'ready', loaded: false });
});

test('dead and unreadable resource locks are observable health findings', () => {
  assert.deepEqual(assessRuntimeResourceLock({ held: false, reason: 'stale' }), {
    healthy: false,
    severity: 'warning',
    reason: 'resource_lock_stale',
  });
  assert.deepEqual(assessRuntimeResourceLock({ held: true, reason: 'unreadable' }), {
    healthy: false,
    severity: 'critical',
    reason: 'resource_lock_unreadable',
  });
});

test('shared job migration contains atomic claims, heartbeats and stale recovery', async () => {
  const sql = await readFile(
    'supabase/migrations/20261124_create_orion_jobs_and_clipping_campaigns.sql',
    'utf8',
  );
  assert.match(sql, /for update skip locked/iu);
  assert.match(sql, /unique \(namespace, idempotency_key\)/iu);
  assert.match(sql, /attempt_count = job\.attempt_count \+ 1/iu);
  assert.match(sql, /next_retry_at <= timezone\('utc', now\(\)\)/iu);
  assert.match(sql, /claim_token = gen_random_uuid\(\)/u);
  assert.match(sql, /create or replace function public\.heartbeat_orion_job/iu);
  assert.match(sql, /create or replace function public\.recover_stale_orion_jobs/iu);
  assert.match(sql, /create or replace function public\.complete_orion_job/iu);
  assert.match(sql, /and claim_token = p_claim_token/iu);
  assert.match(sql, /and lease_expires_at > timezone\('utc', now\(\)\)/iu);
});
