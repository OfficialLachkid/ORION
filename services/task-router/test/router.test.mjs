import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { normalizeTaskMessage, normalizeTaskMessages, parseApprovalResponse } from '../src/router.mjs';

test('normalizeTaskMessage marks production and merge requests as approval-gated', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-06-25T10:00:00.000Z',
    content: 'Deploy the latest router fix to production and merge the PR afterwards.',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.domain, 'infra');
  assert.equal(result.task.priority, 'normal');
  assert.equal(result.task.approval_required, true);
  assert.match(result.task.approval_reason, /production_change/u);
  assert.equal(result.writeBackCandidates.some((candidate) => candidate.namespace === 'approvals'), true);
});

test('parseApprovalResponse accepts approve and reject patterns', () => {
  assert.deepEqual(
    parseApprovalResponse({ content: 'approve TASK-202606251000-ABC123' }),
    {
      valid: true,
      decision: 'approve',
      taskId: 'TASK-202606251000-ABC123',
      reason: '',
    }
  );

  assert.deepEqual(
    parseApprovalResponse({ content: 'reject TASK-202606251000-ABC123 because production window is closed' }),
    {
      valid: true,
      decision: 'reject',
      taskId: 'TASK-202606251000-ABC123',
      reason: 'production window is closed',
    }
  );
});

test('parseApprovalResponse requires feedback for reject decisions', () => {
  assert.deepEqual(
    parseApprovalResponse({ content: 'reject TASK-202606251000-ABC123' }),
    {
      valid: false,
      decision: 'invalid',
      taskId: 'TASK-202606251000-ABC123',
      reason: 'Reject decisions must include feedback: `reject TASK-123 because <reason>`.',
    }
  );
});

test('normalizeTaskMessages splits multi-line operator messages into multiple tasks', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessages({
    channelKey: 'commands',
    submittedAt: '2026-06-25T10:00:00.000Z',
    content: 'check disk space\ncheck ollama health\ncheck tailscale health',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.length, 3);
  assert.match(result[0].task.full_text, /check disk space/u);
  assert.match(result[1].task.full_text, /check ollama health/u);
  assert.match(result[2].task.full_text, /check tailscale health/u);
});

test('normalizeTaskMessage marks safe Mac sync requests as approval-gated', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-07-07T16:30:00.000Z',
    content: 'Sync the Mac runtime with the latest changes from origin/main.',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.approval_required, true);
  assert.match(result.task.approval_reason, /production_change/u);
});

test('normalizeTaskMessage recognizes Gmail draft commands as explicit runtime actions', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-07-12T18:00:00.000Z',
    content: 'draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello from O.R.I.O.N.',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.runtime_action, 'gmail_create_draft');
  assert.equal(result.task.approval_required, false);
  assert.equal(result.task.target_agent, 'orchestrator');
  assert.equal(result.task.email_request.to, 'vbjtechservices@gmail.com');
  assert.equal(result.task.email_request.subject, 'Smoke test');
  assert.equal(result.task.email_request.bodyText, 'Hello from O.R.I.O.N.');
});

test('normalizeTaskMessage preserves multiline Gmail draft bodies', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-07-12T18:05:00.000Z',
    content: 'draft email to vbjtechservices@gmail.com subject: Smoke test body: Hello from O.R.I.O.N.\n\nThis is line two.\nKind regards,\nVBJ Services',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.runtime_action, 'gmail_create_draft');
  assert.equal(
    result.task.email_request.bodyText,
    'Hello from O.R.I.O.N.\n\nThis is line two.\nKind regards,\nVBJ Services'
  );
});

test('normalizeTaskMessage creates an approval-gated developer-agent workflow', () => {
  const config = loadRuntimeConfig();
  const result = normalizeTaskMessage({
    channelKey: 'commands',
    submittedAt: '2026-07-19T18:00:00.000Z',
    content: 'create issue for developer: Fix the CI branch labels and add regression tests.',
    author: { id: 'operator-1', displayName: 'VBJ Services' },
  }, config);

  assert.equal(result.task.runtime_action, 'developer_agent_workflow');
  assert.equal(result.task.automation_type, 'developer_agent_workflow');
  assert.equal(result.task.target_agent, 'developer-agent');
  assert.equal(result.task.domain, 'developer');
  assert.equal(result.task.approval_required, true);
  assert.equal(result.task.status, 'awaiting_approval');
  assert.match(result.task.approval_reason, /isolated worktree/u);
  assert.equal(
    result.task.developer_request.objective,
    'Fix the CI branch labels and add regression tests.'
  );
});
