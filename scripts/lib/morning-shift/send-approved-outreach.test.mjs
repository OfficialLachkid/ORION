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

test('pickApprovedOutreachSends picks ONLY lead_qualification + gmail_send_draft', () => {
  const tasks = [
    makeTask({ task_id: 'A' }),
    makeTask({ task_id: 'B', source_type: 'lead_follow_up' }),                 // follow-up — must skip
    makeTask({ task_id: 'C', runtime_action: 'gmail_create_draft' }),          // draft step — must skip
    makeTask({ task_id: 'D' }),
    { task_id: 'E', source_type: 'automation', runtime_action: 'something_else' },
  ];
  assert.deepEqual(pickApprovedOutreachSends(tasks).map((t) => t.task_id), ['A', 'D']);
});

test('pickApprovedOutreachSends respects the cap (default = 5, custom accepted)', () => {
  const tasks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => makeTask({ task_id: `TASK-${String(n).padStart(3, '0')}` }));
  assert.equal(pickApprovedOutreachSends(tasks).length, DEFAULT_OUTREACH_DAILY_SEND_CAP);
  assert.equal(pickApprovedOutreachSends(tasks, { cap: 2 }).length, 2);
  assert.equal(pickApprovedOutreachSends(tasks, { cap: 100 }).length, 10, 'cap higher than matched returns all matched');
});

test('pickApprovedOutreachSends with cap=Infinity returns every match (no cap)', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => makeTask({ task_id: `TASK-${String(i).padStart(3, '0')}` }));
  assert.equal(pickApprovedOutreachSends(tasks, { cap: Infinity }).length, 20);
});

test('pickApprovedOutreachSends with cap<=0 returns [] (defensive — disables sending)', () => {
  const tasks = [makeTask({ task_id: 'A' }), makeTask({ task_id: 'B' })];
  assert.deepEqual(pickApprovedOutreachSends(tasks, { cap: 0 }), []);
  assert.deepEqual(pickApprovedOutreachSends(tasks, { cap: -3 }), []);
});

test('pickApprovedOutreachSends sorts by task_id ascending before applying the cap (oldest-first)', () => {
  // Same TASK-<ts> lex-sort convention as follow-ups.
  const picked = pickApprovedOutreachSends([
    makeTask({ task_id: 'TASK-202604291000-A' }),
    makeTask({ task_id: 'TASK-202604290800-B' }),
    makeTask({ task_id: 'TASK-202604290900-C' }),
  ], { cap: 2 });
  assert.deepEqual(picked.map((t) => t.task_id), ['TASK-202604290800-B', 'TASK-202604290900-C']);
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
  // Each task gets a unique domain so the in-batch dedup gate doesn't
  // short-circuit the cap check we're validating here.
  const tasks = Array.from({ length: 12 }, (_, i) => makeTask({
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
    stdout,
  });
  assert.equal(summary.matched, 12);
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
      makeTask({ task_id: 'TASK-OK' }),
      makeTask({ task_id: 'TASK-SKIP', body: 'Hi' }), // body_too_short
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

test('sendApprovedOutreach dedupes in-batch domains — only the first send per domain goes through, rest marked skipped', async () => {
  // Regression guard for the 2026-10-27 live run: 4 cold emails went to
  // info@nextloodgieters.com in one batch because the Supabase cap only
  // looked at last_contacted_at, which is null on queued drafts. Now
  // every sibling in the same picks list to the same domain gets
  // short-circuited.
  const stdout = silentStdout();
  const removed = [];
  const sentTo = [];
  const summary = await sendApprovedOutreach({
    config: makeConfig(),
    executeTask: async (t) => { sentTo.push(t.email_request?.to); return { outcome: 'completed' }; },
    loadPersistedPendingTasks: () => [
      makeTask({ task_id: 'TASK-001', to: 'info@dup.nl', lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-002', to: 'info@dup.nl', lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-003', to: 'info@dup.nl', lead_domain: 'dup.nl' }),
      makeTask({ task_id: 'TASK-004', to: 'info@other.nl', lead_domain: 'other.nl' }),
    ],
    removePersistedPendingTask: (_c, id) => removed.push(id),
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    deleteApprovalCard: async () => ({ deleted: true }),
    supabaseFetch: async () => [],
    sleep: async () => {},
    cap: 10, // high cap so dedup, not cap, is what short-circuits
    stdout,
  });
  assert.equal(summary.picked, 4);
  assert.equal(summary.sent, 2, 'exactly two sends: dup.nl once + other.nl once');
  assert.equal(summary.skipped, 2, 'the two sibling dup.nl tasks must be skipped as in-batch duplicates');
  assert.equal(summary.failed, 0);
  assert.deepEqual(sentTo, ['info@dup.nl', 'info@other.nl']);
  assert.deepEqual(removed, ['TASK-001', 'TASK-004'], 'only the actually-sent tasks leave the pending store');
  const skipLines = stdout.writes.filter((w) => w.includes('in_batch_domain_duplicate'));
  assert.equal(skipLines.length, 2, 'the two dedup rejections must be logged');
});

test('sendApprovedOutreach derives domain from the "to" address when lead_domain is missing (dedup still works)', async () => {
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
  assert.equal(summary.sent, 1);
  assert.equal(summary.skipped, 1);
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
