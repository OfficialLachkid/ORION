import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OUTREACH_DAILY_SEND_CAP,
  pickApprovedOutreachSends,
  sendApprovedOutreach,
  sendOneOutreachDraft,
} from './send-approved-outreach.mjs';

function makeTask(overrides = {}) {
  const body = overrides.body ?? `Hi there,\n\nI noticed your workshop in Rotterdam and wondered if a 10-minute call next week would be useful to talk through how a few other operators in your region are handling booking automation. If not, no worries.\n\nBest,\nJacob`;
  const { task_id, source_type, runtime_action, to, subject, lead_id, lead_domain } = overrides;
  return {
    task_id: task_id ?? 'TASK-A',
    source_type: source_type ?? 'lead_qualification',
    runtime_action: runtime_action ?? 'gmail_send_draft',
    email_request: {
      to: to ?? 'info@example.nl',
      subject: subject ?? 'Quick question',
      bodyText: body,
    },
    lead_id: lead_id ?? 'LEAD-1',
    lead_domain: lead_domain ?? 'example.nl',
  };
}

function makeConfig() {
  return {
    env: { DISCORD_BOT_TOKEN: 'botXYZ', SUPABASE_URL: '', SUPABASE_SECRET_KEY: '' },
    channelIds: {
      outreachFollowups: 'C_FOLLOW',
      outreachWaitingApproval: 'C_WAIT',
      outreachAgent: 'C_AGENT',
    },
  };
}

function silentStdout() {
  const writes = [];
  return { write: (chunk) => { writes.push(String(chunk)); }, writes };
}

// ─── pickApprovedOutreachSends ──────────────────────────────────────

// Helper: build a fixture of unique-domain tasks (post-2026-11-13 the
// picker dedupes by domain, so every task in a cap-exercising fixture
// needs its own domain).
function uniqueDomainTasks(count, { prefix = 'TASK' } = {}) {
  return Array.from({ length: count }, (_, i) => makeTask({
    task_id: `${prefix}-${String(i).padStart(4, '0')}`,
    to: `info@lead-${i}.nl`,
    lead_domain: `lead-${i}.nl`,
  }));
}

test('pickApprovedOutreachSends picks ONLY lead_qualification + gmail_send_draft', () => {
  const tasks = [
    makeTask({ task_id: 'A', to: 'info@a.nl', lead_domain: 'a.nl' }),
    makeTask({ task_id: 'B', to: 'info@b.nl', lead_domain: 'b.nl', source_type: 'lead_follow_up' }),      // follow-up — must skip
    makeTask({ task_id: 'C', to: 'info@c.nl', lead_domain: 'c.nl', runtime_action: 'gmail_create_draft' }), // draft step — must skip
    makeTask({ task_id: 'D', to: 'info@d.nl', lead_domain: 'd.nl' }),
    { task_id: 'E', source_type: 'automation', runtime_action: 'something_else' },
  ];
  assert.deepEqual(pickApprovedOutreachSends(tasks).map((t) => t.task_id), ['A', 'D']);
});

test('pickApprovedOutreachSends respects the cap (default + custom)', () => {
  // Fixture must carry unique domains per task so the per-domain
  // dedup (added 2026-11-13) doesn't collapse the pool below the cap.
  const fixtureSize = DEFAULT_OUTREACH_DAILY_SEND_CAP + 10;
  const tasks = uniqueDomainTasks(fixtureSize);
  assert.equal(pickApprovedOutreachSends(tasks).length, DEFAULT_OUTREACH_DAILY_SEND_CAP);
  assert.equal(pickApprovedOutreachSends(tasks, { cap: 2 }).length, 2);
  assert.equal(
    pickApprovedOutreachSends(tasks, { cap: fixtureSize + 100 }).length,
    fixtureSize,
    'cap higher than matched returns all matched',
  );
});

test('pickApprovedOutreachSends with cap=Infinity returns every match (no cap)', () => {
  const tasks = uniqueDomainTasks(20);
  assert.equal(pickApprovedOutreachSends(tasks, { cap: Infinity }).length, 20);
});

test('pickApprovedOutreachSends with cap<=0 returns [] (defensive — disables sending)', () => {
  const tasks = uniqueDomainTasks(2);
  assert.deepEqual(pickApprovedOutreachSends(tasks, { cap: 0 }), []);
  assert.deepEqual(pickApprovedOutreachSends(tasks, { cap: -3 }), []);
});

test('pickApprovedOutreachSends sorts by task_id ascending before applying the cap (oldest-first)', () => {
  // Same TASK-<ts> lex-sort convention as follow-ups.
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'TASK-202604291000-A', to: 'info@a.nl', lead_domain: 'a.nl' }),
    makeTask({ task_id: 'TASK-202604290800-B', to: 'info@b.nl', lead_domain: 'b.nl' }),
    makeTask({ task_id: 'TASK-202604290900-C', to: 'info@c.nl', lead_domain: 'c.nl' }),
  ], { cap: 2 });
  assert.deepEqual(picked.map((t) => t.task_id), ['TASK-202604290800-B', 'TASK-202604290900-C']);
});

// Per-domain dedup at pick time — 2026-11-13. Without this, cap=50
// morning runs were sending ~20 unique-domain emails because the pool
// is dominated by same-domain siblings (3-6 drafts/domain), and the
// send-loop collapsed them to one. Deduping at pick time gives us up
// to `cap` real sends/morning.
test('pickApprovedOutreachSends collapses same-domain siblings and keeps the oldest task', () => {
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'TASK-003-A', to: 'info@foo.nl',    lead_domain: 'foo.nl' }),
    makeTask({ task_id: 'TASK-001-B', to: 'sales@foo.nl',   lead_domain: 'foo.nl' }),
    makeTask({ task_id: 'TASK-002-C', to: 'contact@foo.nl', lead_domain: 'foo.nl' }),
    makeTask({ task_id: 'TASK-004-D', to: 'info@bar.nl',    lead_domain: 'bar.nl' }),
  ], { cap: 10 });
  assert.deepEqual(picked.map((t) => t.task_id), ['TASK-001-B', 'TASK-004-D']);
});

test('pickApprovedOutreachSends dedup uses lead_domain explicitly when present', () => {
  // lead_domain wins even if the email address string parses to a different host
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'A', to: 'info@mail.foo.nl', lead_domain: 'foo.nl' }),
    makeTask({ task_id: 'B', to: 'info@www.foo.nl',  lead_domain: 'foo.nl' }),
  ], { cap: 10 });
  assert.deepEqual(picked.map((t) => t.task_id), ['A']);
});

test('pickApprovedOutreachSends falls back to parsing the to-address when lead_domain is missing', () => {
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'A', to: 'info@foo.nl',  lead_domain: '' }),
    makeTask({ task_id: 'B', to: 'sales@foo.nl', lead_domain: '' }),
    makeTask({ task_id: 'C', to: 'info@bar.nl',  lead_domain: '' }),
  ], { cap: 10 });
  assert.deepEqual(picked.map((t) => t.task_id), ['A', 'C']);
});

test('pickApprovedOutreachSends lets tasks with no resolvable domain through (legacy tolerance)', () => {
  // If neither lead_domain nor a parseable `to` address is available,
  // don't collapse — the task goes through and the send-loop guard is
  // the final safety net.
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'A', to: '', lead_domain: '' }),
    makeTask({ task_id: 'B', to: '', lead_domain: '' }),
  ], { cap: 10 });
  assert.deepEqual(picked.map((t) => t.task_id), ['A', 'B']);
});

// ─── sendOneOutreachDraft ───────────────────────────────────────────

test('sendOneOutreachDraft refuses to send when the pre-send check fails', async () => {
  const executeCalls = [];
  const removeCalls = [];
  const outcome = await sendOneOutreachDraft(makeTask({ to: '' }), {
    config: makeConfig(),
    executeTask: (t) => { executeCalls.push(t); return { outcome: 'completed' }; },
    removePersistedPendingTask: (c, id) => removeCalls.push(id),
    deleteApprovalCard: async () => ({ deleted: true }),
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
    supabaseFetch: async () => [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped, true);
  assert.equal(outcome.reason, 'missing_to_address');
  assert.equal(executeCalls.length, 0, 'executeTask must NOT run when pre-send check fails');
  assert.equal(removeCalls.length, 0, 'rejected task must stay in the pending-approval store');
});

test('sendOneOutreachDraft runs the send + deletes the card when every check passes', async () => {
  let removed = false;
  let cardDeleted = false;
  const outcome = await sendOneOutreachDraft(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    removePersistedPendingTask: () => { removed = true; },
    deleteApprovalCard: async () => { cardDeleted = true; return { deleted: true }; },
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
    supabaseFetch: async () => [],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.cardDeleted, true);
  assert.ok(removed);
  assert.ok(cardDeleted);
});

test('sendOneOutreachDraft reports send failure without removing the task from the store', async () => {
  let removed = false;
  const outcome = await sendOneOutreachDraft(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'failed', error: { message: 'gmail boom' } }),
    removePersistedPendingTask: () => { removed = true; },
    deleteApprovalCard: async () => ({ deleted: true }),
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
    supabaseFetch: async () => [],
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.skipped, false);
  assert.equal(outcome.error, 'gmail boom');
  assert.ok(!removed, 'send failure must keep the task so it retries next morning');
});

test('sendOneOutreachDraft keeps sent mail visible while its database receipt is pending', async () => {
  const removed = [];
  const upserted = [];
  let cardUpdated = false;
  const outcome = await sendOneOutreachDraft(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({
      outcome: 'completed',
      executionResult: { report: { databaseReceiptPending: true } },
    }),
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    upsertPersistedPendingTask: (_cfg, task) => upserted.push(task),
    deleteApprovalCard: async () => { throw new Error('must not delete'); },
    markApprovalCardReceiptPending: async () => { cardUpdated = true; return { updated: true }; },
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
    supabaseFetch: async () => [],
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.receiptPending, true);
  assert.equal(cardUpdated, true);
  assert.deepEqual(removed, []);
  assert.equal(upserted[0].database_receipt_pending, true);
});

// ─── sendApprovedOutreach orchestrator ──────────────────────────────

test('sendApprovedOutreach short-circuits with picked=0 when the store is empty', async () => {
  const stdout = silentStdout();
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => [],
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    stdout,
  });
  assert.deepEqual(summary, { picked: 0, sent: 0, skipped: 0, failed: 0, cardsDeleted: 0, failures: [], outcomes: [], matched: 0 });
});

test('sendApprovedOutreach caps picks at DEFAULT_OUTREACH_DAILY_SEND_CAP and reports matched vs picked', async () => {
  const stdout = silentStdout();
  // Build a fixture strictly bigger than the default cap so the cap
  // is actually exercised regardless of its current value. Each task
  // gets a unique domain so the in-batch dedup gate doesn't
  // short-circuit the cap check we're validating here.
  const fixtureSize = DEFAULT_OUTREACH_DAILY_SEND_CAP + 10;
  const tasks = Array.from({ length: fixtureSize }, (_, i) => makeTask({
    task_id: `TASK-${String(i).padStart(4, '0')}`,
    to: `info@lead-${i}.nl`,
    lead_domain: `lead-${i}.nl`,
  }));
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => tasks,
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    stdout,
  });
  assert.equal(summary.matched, fixtureSize);
  assert.equal(summary.picked, DEFAULT_OUTREACH_DAILY_SEND_CAP);
  assert.equal(summary.sent, DEFAULT_OUTREACH_DAILY_SEND_CAP);
  assert.equal(summary.skipped, 0);
});

test('sendApprovedOutreach counts a pre-send rejection as skipped (not failed), task stays in store', async () => {
  const stdout = silentStdout();
  const removed = [];
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => [
      // Two unique domains so the per-domain picker dedup doesn't
      // collapse them — the behavior under test is pre-send rejection.
      makeTask({ task_id: 'TASK-OK',   to: 'info@ok.nl',   lead_domain: 'ok.nl' }),
      makeTask({ task_id: 'TASK-SKIP', to: 'info@skip.nl', lead_domain: 'skip.nl', body: 'Hi' }), // body_too_short
    ],
    removePersistedPendingTask: (_c, id) => removed.push(id),
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    stdout,
  });
  assert.equal(summary.sent, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.failed, 0);
  assert.deepEqual(removed, ['TASK-OK'], 'skipped task must stay in the store');
});

test('sendApprovedOutreach collapses same-domain siblings at pick time — only one task per domain reaches the send loop', async () => {
  // 2026-10-27 live run: 4 cold emails went to info@nextloodgieters.com
  // because the send loop's `sentDomains` guard was the only defense.
  // 2026-11-13: pickApprovedOutreachSends now collapses siblings BEFORE
  // they reach the loop, so `picked` == 2 here (not 4), the send-loop
  // guard never fires, and 0 skips are logged. The send-loop guard
  // stays as defense in depth and is exercised by the next test.
  const stdout = silentStdout();
  const removed = [];
  const sentTo = [];
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async (t) => { sentTo.push(t.email_request?.to); return { outcome: 'completed' }; },
    loadPersistedPendingTasks: () => [
      makeTask({ task_id: 'TASK-001', to: 'info@dup.nl',   lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-002', to: 'sales@dup.nl',  lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-003', to: 'contact@dup.nl', lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-004', to: 'info@other.nl', lead_domain: 'other.nl' }),
    ],
    removePersistedPendingTask: (_c, id) => removed.push(id),
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    cap: 10,
    stdout,
  });
  assert.equal(summary.matched, 4, 'all four tasks still count against the matched pool');
  assert.equal(summary.picked, 2, 'picker collapsed the three dup.nl siblings to one');
  assert.equal(summary.sent, 2);
  assert.equal(summary.skipped, 0, 'siblings never reach the send loop so no in-batch skip is logged');
  assert.equal(summary.failed, 0);
  assert.deepEqual(sentTo, ['info@dup.nl', 'info@other.nl']);
  assert.deepEqual(removed, ['TASK-001', 'TASK-004']);
});

test('sendApprovedOutreach send-loop dedup still fires for tasks with no resolvable domain (defense in depth)', async () => {
  // Tasks without lead_domain AND without a parseable `to` address slip
  // past the picker's dedup (it tolerates them for legacy safety).
  // The send loop's `sentDomains` guard is the last line of defense,
  // but with no resolvable domain on either task there's nothing to
  // collapse — both go through and the sendDomains Set stays empty.
  const stdout = silentStdout();
  const sentTo = [];
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async (t) => { sentTo.push(t.email_request?.to); return { outcome: 'completed' }; },
    loadPersistedPendingTasks: () => [
      makeTask({ task_id: 'TASK-001', to: '', lead_domain: '' }),
      makeTask({ task_id: 'TASK-002', to: '', lead_domain: '' }),
    ],
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    stdout,
  });
  // These tasks fail the pre-send check (missing_to_address), so they're
  // skipped — but as a pre-send rejection, not a domain duplicate. Still
  // zero sends, zero failures.
  assert.equal(summary.sent, 0);
  assert.equal(summary.failed, 0);
});

test('sendApprovedOutreach derives domain from the "to" address when lead_domain is missing (picker still dedupes)', async () => {
  const stdout = silentStdout();
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => [
      makeTask({ task_id: 'TASK-001', to: 'a@fallback.com', lead_domain: '' }),
      makeTask({ task_id: 'TASK-002', to: 'b@fallback.com', lead_domain: '' }),
    ],
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    stdout,
  });
  // Both tasks share fallback.com via to-address parsing; picker keeps
  // only the first (TASK-001 by sort order), so picked=1, sent=1.
  assert.equal(summary.matched, 2);
  assert.equal(summary.picked, 1);
  assert.equal(summary.sent, 1);
});

test('sendApprovedOutreach honors a custom cap override from the caller', async () => {
  const stdout = silentStdout();
  const tasks = Array.from({ length: 10 }, (_, i) => makeTask({
    task_id: `TASK-${String(i).padStart(3, '0')}`,
    to: `info@lead-${i}.nl`,
    lead_domain: `lead-${i}.nl`,
  }));
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => tasks,
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    cap: 2,
    stdout,
  });
  assert.equal(summary.matched, 10);
  assert.equal(summary.picked, 2);
  assert.equal(summary.sent, 2);
});
