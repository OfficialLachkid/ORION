import test from 'node:test';
import assert from 'node:assert/strict';
import { routeLeadOutreachEvents } from '../lib/lead-outreach-routing.mjs';

const approvalEvent = {
  type: 'approval_request',
  channelKey: 'approvals',
  metadata: { taskId: 'TASK-ORION-DRAFT-1' },
};

const agentResultsEvent = {
  type: 'task_execution_result',
  channelKey: 'agentResults',
  metadata: { taskId: 'TASK-ORION-DRAFT-1' },
};

const systemLogsEvent = {
  type: 'task_execution_completed',
  channelKey: 'systemLogs',
  metadata: { taskId: 'TASK-ORION-DRAFT-1' },
};

test('routes approval_request to outreachWaitingApproval thread when configured', () => {
  // Regression guard for the 2026-08-25 change: pending outreach drafts must
  // land in #waiting-approval so the parent #outreach-agent channel stays
  // clean and the operator can eyeball what's pending.
  const routed = routeLeadOutreachEvents(
    { outreachWaitingApproval: '1541759565274808410', outreachAgent: 'CHAN-OUTREACH' },
    [approvalEvent],
  );

  assert.equal(routed.length, 1);
  assert.equal(routed[0].channelKey, 'outreachWaitingApproval');
});

test('falls back to outreachAgent when the waiting-approval thread is not configured', () => {
  // Backward compat guard — existing installs without the new env var must
  // keep working as before (drafts posted directly in #outreach-agent).
  const routed = routeLeadOutreachEvents(
    { outreachAgent: 'CHAN-OUTREACH' },
    [approvalEvent],
  );

  assert.equal(routed.length, 1);
  assert.equal(routed[0].channelKey, 'outreachAgent');
});

test('drops agentResults events entirely (they never belonged in the outreach flow)', () => {
  const routed = routeLeadOutreachEvents(
    { outreachWaitingApproval: '1541759565274808410', outreachAgent: 'CHAN-OUTREACH' },
    [agentResultsEvent, approvalEvent],
  );

  assert.equal(routed.length, 1);
  assert.equal(routed[0].type, 'approval_request');
});

test('leaves non-approval events untouched (system logs, taskQueue updates, etc.)', () => {
  const routed = routeLeadOutreachEvents(
    { outreachWaitingApproval: '1541759565274808410', outreachAgent: 'CHAN-OUTREACH' },
    [systemLogsEvent, approvalEvent],
  );

  assert.equal(routed.length, 2);
  assert.equal(routed.find((e) => e.channelKey === 'systemLogs')?.type, 'task_execution_completed');
  assert.equal(routed.find((e) => e.channelKey === 'outreachWaitingApproval')?.type, 'approval_request');
});

test('leaves approvals unrouted when neither outreach channel nor thread is configured', () => {
  // Edge case — fresh install without any outreach env. Events flow through
  // with their original channelKey ('approvals'); the wider approvals
  // channel picks them up if configured.
  const routed = routeLeadOutreachEvents({}, [approvalEvent]);

  assert.equal(routed.length, 1);
  assert.equal(routed[0].channelKey, 'approvals');
});
