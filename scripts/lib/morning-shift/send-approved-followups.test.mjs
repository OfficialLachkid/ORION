import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteApprovalCard,
  pickApprovedFollowUpSends,
  sendApprovedFollowUps,
  sendOneFollowUp,
} from './send-approved-followups.mjs';

function makeTask(overrides = {}) {
  return {
    task_id: 'TASK-A',
    source_type: 'lead_follow_up',
    runtime_action: 'gmail_send_draft',
    source_channel: 'outreachFollowups',
    email_request: { to: 'lead@example.nl', subject: 'Re: Hi', bodyText: '...' },
    ...overrides,
  };
}

function makeConfig() {
  return {
    env: { DISCORD_BOT_TOKEN: 'botXYZ' },
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

test('pickApprovedFollowUpSends picks ONLY lead_follow_up + gmail_send_draft', () => {
  const tasks = [
    makeTask({ task_id: 'A' }),
    makeTask({ task_id: 'B', source_type: 'lead_qualification' }),           // fresh outreach — must skip
    makeTask({ task_id: 'C', runtime_action: 'gmail_create_draft' }),        // draft step — must skip
    makeTask({ task_id: 'D' }),
    { task_id: 'E', source_type: 'automation', runtime_action: 'poke_quizz_publish_preview' },
  ];
  const picked = pickApprovedFollowUpSends(tasks);
  assert.deepEqual(picked.map((t) => t.task_id), ['A', 'D']);
});

test('pickApprovedFollowUpSends returns [] when store is empty or malformed', () => {
  assert.deepEqual(pickApprovedFollowUpSends([]), []);
  assert.deepEqual(pickApprovedFollowUpSends([null, undefined, {}]), []);
});

test('pickApprovedFollowUpSends sorts by task_id ascending (oldest-first by TASK-<ts> convention)', () => {
  // task_id prefix is a UTC timestamp — lex sort === chronological sort.
  // The night-shift's draft creation order drives who sent first, so send
  // in the same order to keep failures reproducible and human-reviewable.
  const picked = pickApprovedFollowUpSends([
    makeTask({ task_id: 'TASK-202604291000-A' }),
    makeTask({ task_id: 'TASK-202604290800-B' }),
    makeTask({ task_id: 'TASK-202604290900-C' }),
  ]);
  assert.deepEqual(picked.map((t) => t.task_id), [
    'TASK-202604290800-B',
    'TASK-202604290900-C',
    'TASK-202604291000-A',
  ]);
});

test('deleteApprovalCard searches configured channels and DELETEs the card', async () => {
  const calls = [];
  const discordApi = async (path, method = 'GET') => {
    calls.push({ path, method });
    return null;
  };
  const search = async ({ threadIds, fetchChannelMessages }) => {
    assert.deepEqual(threadIds, ['C_FOLLOW', 'C_WAIT', 'C_AGENT']);
    // confirm the fetchChannelMessages wiring reaches discordApi
    await fetchChannelMessages('C_FOLLOW', 100, {});
    return { channelId: 'C_FOLLOW', messageId: 'M123' };
  };
  const result = await deleteApprovalCard({
    config: makeConfig(),
    taskId: 'TASK-A',
    discordApi,
    searchApprovalMessageInThreads: search,
  });
  assert.deepEqual(result, { deleted: true });
  assert.ok(calls.some((c) => c.method === 'DELETE' && c.path === '/channels/C_FOLLOW/messages/M123'));
});

test('deleteApprovalCard reports card_not_found when search finds nothing', async () => {
  const result = await deleteApprovalCard({
    config: makeConfig(),
    taskId: 'TASK-X',
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
  });
  assert.equal(result.deleted, false);
  assert.equal(result.reason, 'card_not_found');
});

test('deleteApprovalCard reports no_channels_configured when config missing channel ids', async () => {
  const result = await deleteApprovalCard({
    config: { env: { DISCORD_BOT_TOKEN: 't' }, channelIds: {} },
    taskId: 'TASK-X',
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => { throw new Error('must not be called'); },
  });
  assert.equal(result.deleted, false);
  assert.equal(result.reason, 'no_channels_configured');
});

test('sendOneFollowUp: success removes task from store AND deletes card', async () => {
  const removed = [];
  const result = await sendOneFollowUp(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    deleteApprovalCard: async () => ({ deleted: true }),
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cardDeleted, true);
  assert.deepEqual(removed, ['TASK-A']);
});

test('sendOneFollowUp: executeTask failure LEAVES task in store (so next morning retries)', async () => {
  // This is the critical safety property. If a send flakes (Gmail 503,
  // network blip, etc.), the task MUST stay in the store so tomorrow's
  // morning shift tries again. Removing on failure would silently drop
  // follow-ups.
  const removed = [];
  const result = await sendOneFollowUp(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'failed', error: { message: 'Gmail 503' } }),
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    deleteApprovalCard: async () => { throw new Error('must not be called on failed send'); },
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Gmail 503/u);
  assert.deepEqual(removed, []);
});

test('sendOneFollowUp: card-delete failure does NOT fail the overall send', async () => {
  const removed = [];
  const result = await sendOneFollowUp(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    deleteApprovalCard: async () => ({ deleted: false, reason: 'card_not_found' }),
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.cardDeleted, false);
  assert.equal(result.cardReason, 'card_not_found');
  assert.deepEqual(removed, ['TASK-A'], 'the SEND succeeded; store cleanup must still happen');
});

test('sendOneFollowUp: card-delete THROW is caught (non-fatal) because email is already out', async () => {
  const removed = [];
  const result = await sendOneFollowUp(makeTask(), {
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    deleteApprovalCard: async () => { throw new Error('discord down'); },
    discordApi: async () => null,
    searchApprovalMessageInThreads: async () => null,
  });
  assert.equal(result.ok, true, 'send is already out; a Discord outage must not surface as a send failure');
  assert.equal(result.cardDeleted, false);
  assert.deepEqual(removed, ['TASK-A']);
});

test('sendApprovedFollowUps: full happy path — picks follow-ups, sends them, cleans state', async () => {
  const store = [
    makeTask({ task_id: 'TASK-1' }),
    makeTask({ task_id: 'TASK-2' }),
    makeTask({ task_id: 'TASK-SKIP', source_type: 'lead_qualification' }),
  ];
  const removed = [];
  const sent = [];
  const stdout = silentStdout();
  const summary = await sendApprovedFollowUps({
    config: makeConfig(),
    executeTask: async (task) => { sent.push(task.task_id); return { outcome: 'completed' }; },
    loadPersistedPendingTasks: () => store,
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    searchApprovalMessageInThreads: async () => ({ channelId: 'C_FOLLOW', messageId: `M-${sent.at(-1)}` }),
    discordApi: async () => null,
    sleep: async () => {}, // skip wait in tests
    stdout,
  });
  assert.equal(summary.picked, 2);
  assert.equal(summary.sent, 2);
  assert.equal(summary.failed, 0);
  assert.equal(summary.cardsDeleted, 2);
  assert.deepEqual(sent.sort(), ['TASK-1', 'TASK-2']);
  assert.deepEqual(removed.sort(), ['TASK-1', 'TASK-2']);
});

test('sendApprovedFollowUps: no-op when the store has no approved follow-ups', async () => {
  const stdout = silentStdout();
  const summary = await sendApprovedFollowUps({
    config: makeConfig(),
    executeTask: async () => { throw new Error('must not be called'); },
    loadPersistedPendingTasks: () => [makeTask({ source_type: 'lead_qualification' })],
    removePersistedPendingTask: () => { throw new Error('must not be called'); },
    searchApprovalMessageInThreads: async () => { throw new Error('must not be called'); },
    discordApi: async () => null,
    sleep: async () => {},
    stdout,
  });
  assert.deepEqual(summary, { picked: 0, sent: 0, failed: 0, cardsDeleted: 0, failures: [], outcomes: [] });
});

test('sendApprovedFollowUps: a single failure does not stop the batch; failures array carries context', async () => {
  const store = [
    makeTask({ task_id: 'TASK-OK-1' }),
    makeTask({ task_id: 'TASK-FAIL' }),
    makeTask({ task_id: 'TASK-OK-2' }),
  ];
  const removed = [];
  const stdout = silentStdout();
  const summary = await sendApprovedFollowUps({
    config: makeConfig(),
    executeTask: async (task) => (task.task_id === 'TASK-FAIL'
      ? { outcome: 'failed', error: { message: 'Gmail rate limited' } }
      : { outcome: 'completed' }),
    loadPersistedPendingTasks: () => store,
    removePersistedPendingTask: (_cfg, id) => removed.push(id),
    searchApprovalMessageInThreads: async () => ({ channelId: 'C_FOLLOW', messageId: 'M' }),
    discordApi: async () => null,
    sleep: async () => {},
    stdout,
  });
  assert.equal(summary.sent, 2);
  assert.equal(summary.failed, 1);
  assert.deepEqual(removed.sort(), ['TASK-OK-1', 'TASK-OK-2'], 'failed task must stay in store for retry');
  assert.equal(summary.failures[0].taskId, 'TASK-FAIL');
  assert.match(summary.failures[0].error, /rate limited/u);
});

test('sendApprovedFollowUps: throws without executeTask (fail-fast on missing dep)', async () => {
  await assert.rejects(() => sendApprovedFollowUps({
    config: makeConfig(),
    loadPersistedPendingTasks: () => [],
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    stdout: silentStdout(),
  }), /executeTask dependency is required/u);
});

test('sendApprovedFollowUps: sleeps BETWEEN sends but not after the last (rate-limit discipline)', async () => {
  // 2 tasks → exactly 1 sleep. Guard against both the "no sleep → Gmail
  // 429" regression and the "sleep after the last task → wasted 800ms"
  // regression.
  const sleepCalls = [];
  const store = [makeTask({ task_id: 'A' }), makeTask({ task_id: 'B' })];
  const stdout = silentStdout();
  await sendApprovedFollowUps({
    config: makeConfig(),
    executeTask: async () => ({ outcome: 'completed' }),
    loadPersistedPendingTasks: () => store,
    removePersistedPendingTask: () => {},
    searchApprovalMessageInThreads: async () => null,
    discordApi: async () => null,
    sleep: async (ms) => { sleepCalls.push(ms); },
    sleepMs: 800,
    stdout,
  });
  assert.deepEqual(sleepCalls, [800]);
});
