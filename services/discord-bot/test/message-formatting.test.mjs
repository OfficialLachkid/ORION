import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthNotificationDiscordPayload,
  buildOutboundEventDiscordPayload,
  formatOutboundEventMessage,
} from '../src/message-formatting.mjs';

test('formatOutboundEventMessage renders parsed task previews in human-readable form', () => {
  const message = formatOutboundEventMessage({
    type: 'parsed_task_preview',
    body: 'Parsed TASK-123 for developer-agent: Check daemon health',
    metadata: {
      task: {
        task_id: 'TASK-123',
        target_agent: 'developer-agent',
        domain: 'infra',
        priority: 'normal',
        status: 'queued',
        summary: 'Check daemon health',
        approval_required: false,
      },
    },
  });

  assert.match(message, /\*\*Parsed Task\*\*/u);
  assert.match(message, /Task: `TASK-123`/u);
  assert.match(message, /Agent: `developer-agent`/u);
  assert.doesNotMatch(message, /```json/u);
});

test('buildOutboundEventDiscordPayload renders parsed task previews as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'parsed_task_preview',
    body: 'Parsed TASK-123 for developer-agent: Check daemon health',
    metadata: {
      task: {
        task_id: 'TASK-123',
        target_agent: 'developer-agent',
        domain: 'infra',
        priority: 'normal',
        status: 'queued',
        summary: 'Check daemon health',
        approval_required: false,
        submitted_by: 'Lachkid',
      },
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Parsed Task .*TASK-123/u);
  assert.match(payload.embeds[0].description, /Check daemon health/u);
});

test('buildOutboundEventDiscordPayload renders image-aware parsed tasks with attachment fields', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'parsed_task_preview',
    body: 'Parsed TASK-999 for orchestrator: Review attached screenshot.',
    metadata: {
      task: {
        task_id: 'TASK-999',
        target_agent: 'orchestrator',
        domain: 'general',
        priority: 'normal',
        status: 'queued',
        summary: 'Review attached screenshot.',
        approval_required: false,
        submitted_by: 'Lachkid',
        image_attachment_count: 1,
        image_attachment_filenames: ['screenshot.png'],
      },
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Images' && /1/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Image Files' && /screenshot\.png/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders task context updates as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_context_update',
    body: 'Linked 2 image attachment(s) to TASK-999.',
    metadata: {
      taskId: 'TASK-999',
      summary: 'Review attached screenshots.',
      imageAttachmentCount: 2,
      imageAttachmentFilenames: ['screenshot-1.png', 'screenshot-2.png'],
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Task Context Updated .*TASK-999/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Images' && /2/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders memory write-back candidates as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'memory_writeback_candidates',
    body: 'Prepared 3 memory write-back candidate(s) for TASK-321.',
    metadata: {
      taskId: 'TASK-321',
      summary: 'check docker and colima health',
      targetAgent: 'developer-agent',
      domain: 'infra',
      candidateCount: 3,
      candidates: [
        { namespace: 'results', type: 'normalized_task_summary', status: 'pending_review' },
        { namespace: 'approvals', type: 'approval_request', status: 'awaiting_outcome' },
        { namespace: 'infra', type: 'infra_change_candidate', status: 'pending_review' },
      ],
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Memory Update .*TASK-321/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Candidates' && /3/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Namespaces' && /results/u.test(field.value)), true);
});

test('formatOutboundEventMessage renders approval requests with guidance', () => {
  const message = formatOutboundEventMessage({
    type: 'approval_request',
    body: 'Approval needed for TASK-123: Deploy the latest fix.',
    metadata: {
      taskId: 'TASK-123',
      approvalReason: 'production_change: deploy to production',
    },
  });

  assert.match(message, /\*\*Approval Needed\*\*/u);
  assert.match(message, /Task: `TASK-123`/u);
  assert.match(message, /Action: use the buttons below/u);
});

test('buildOutboundEventDiscordPayload renders final PR merge approval details', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_request',
    body: 'Approval needed for TASK-PR-MERGE-42-1234567890AB: Merge PR #42.',
    metadata: {
      taskId: 'TASK-PR-MERGE-42-1234567890AB',
      summary: 'Merge PR #42: agent/task-42-fix-runtime -> main',
      pullRequestNumber: 42,
      pullRequestUrl: 'https://github.com/OfficialLachkid/ruflo/pull/42',
      sourceBranch: 'agent/task-42-fix-runtime',
      targetBranch: 'main',
      expectedHeadSha: '1234567890abcdef',
      ciRunUrl: 'https://github.com/OfficialLachkid/ruflo/actions/runs/123',
      approvalReason: 'Runtime Validation passed for the tested commit.',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Pull Request' && /#42/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Source Branch' && /agent\/task-42/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Action' && /merges it/u.test(field.value)), true);
});

test('formatOutboundEventMessage renders execution results without raw JSON', () => {
  const message = formatOutboundEventMessage({
    type: 'task_execution_result',
    body: 'Execution result for TASK-123: Ruflo daemon state is running.',
    metadata: {
      taskId: 'TASK-123',
      action: 'ruflo_daemon_health_check',
      state: 'running',
      activeCount: 1,
      runs: 2,
      lastExitCode: 0,
    },
  });

  assert.match(message, /\*\*Execution Result\*\*/u);
  assert.match(message, /State: `running`/u);
  assert.doesNotMatch(message, /```json/u);
});

test('buildOutboundEventDiscordPayload renders execution results as embed cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_execution_result',
    body: 'Execution result for TASK-123: Ruflo daemon state is running.',
    metadata: {
      taskId: 'TASK-123',
      action: 'ruflo_daemon_health_check',
      state: 'running',
      activeCount: 1,
      runs: 2,
      lastExitCode: 0,
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Execution Result .*TASK-123/u);
  assert.equal(payload.embeds[0].description, 'Ruflo daemon state is running.');
  assert.doesNotMatch(payload.embeds[0].description, /Execution result for TASK-123/u);
});

test('buildOutboundEventDiscordPayload renders Gmail execution results with draft metadata', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_execution_result',
    body: 'Execution result for TASK-MAIL: Gmail draft created for vbjtechservices@gmail.com.',
    metadata: {
      taskId: 'TASK-MAIL',
      action: 'gmail_create_draft',
      state: 'awaiting_approval',
      severity: 'warning',
      emailTo: 'vbjtechservices@gmail.com',
      emailSubject: 'Smoke test',
      emailBody: 'Hello from O.R.I.O.N.\n\nKind regards,\nVBJ Services',
      emailPreview: 'Hello from O.R.I.O.N.',
      gmailDraftId: 'r-123',
      gmailMessageId: 'm-456',
      gmailThreadId: 't-789',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Draft ID' && /r-123/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Email To' && /vbjtechservices@gmail\.com/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Email Body' && /Kind regards/u.test(field.value)), true);
  // 'Email Preview' was removed as a redundant duplicate of 'Email Body' — the
  // preview text was always a truncated prefix of the same content.
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Email Preview'), false);
});

test('formatOutboundEventMessage renders GitHub auth metadata cleanly', () => {
  const message = formatOutboundEventMessage({
    type: 'task_execution_result',
    body: 'Execution result for TASK-456: GitHub auth is authenticated for vbjservices.',
    metadata: {
      taskId: 'TASK-456',
      action: 'github_auth_health_check',
      state: 'authenticated',
      githubHost: 'github.com',
      githubAccount: 'vbjservices',
      gitProtocol: 'https',
    },
  });

  assert.match(message, /GitHub Host: `github\.com`/u);
  assert.match(message, /GitHub Account: `vbjservices`/u);
  assert.match(message, /Git Protocol: `https`/u);
});

test('buildOutboundEventDiscordPayload renders Claude runtime metadata cleanly', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_execution_result',
    body: 'Execution result for TASK-CLAUDE: Claude runtime is auth_required on 2.1.206 (Claude Code).',
    metadata: {
      taskId: 'TASK-CLAUDE',
      action: 'claude_runtime_health_check',
      state: 'auth_required',
      claudeVersion: '2.1.206 (Claude Code)',
      claudeLoggedIn: false,
      claudeAuthMethod: 'none',
      claudeApiProvider: 'firstParty',
      claudeTaskArtifactWritable: true,
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Claude Version' && /2\.1\.206/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Claude Logged In' && /No/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders approval requests as a pinged embed payload', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_request',
    body: 'Approval needed for TASK-789: Deploy latest runtime patch.',
    metadata: {
      taskId: 'TASK-789',
      summary: 'Deploy latest runtime patch.',
      targetAgent: 'developer-agent',
      domain: 'infra',
      priority: 'high',
      submittedBy: 'Lachkid',
      approvalReason: 'production_change: deploy to production',
      approverMentions: '<@374565340644114433>',
      approverUserIds: ['374565340644114433'],
      approverRoleIds: [],
    },
  });

  assert.equal(payload.content, '<@374565340644114433>');
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Approval Needed/u);
  assert.match(payload.embeds[0].description, /Deploy latest runtime patch/u);
  assert.equal(payload.allowed_mentions.users[0], '374565340644114433');
});

test('buildOutboundEventDiscordPayload renders Gmail approval requests with draft context', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_request',
    body: 'Approval needed for TASK-MAIL: Send drafted email to vbjtechservices@gmail.com: Smoke test',
    metadata: {
      taskId: 'TASK-MAIL',
      summary: 'Send drafted email to vbjtechservices@gmail.com: Smoke test',
      targetAgent: 'orchestrator',
      domain: 'sales',
      priority: 'normal',
      approvalReason: 'gmail_send_draft: drafted email is waiting for explicit send approval',
      emailTo: 'vbjtechservices@gmail.com',
      emailSubject: 'Smoke test',
      emailBody: 'Hello from O.R.I.O.N.\n\nKind regards,\nVBJ Services',
      emailPreview: 'Hello from O.R.I.O.N.',
      gmailDraftId: 'r-123',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'To' && /vbjtechservices@gmail\.com/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Subject' && /Smoke test/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Body' && /Kind regards/u.test(field.value)), true);
  // 'Preview' was removed as a redundant duplicate of 'Body' in the approval embed.
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Preview'), false);
});

test('buildHealthNotificationDiscordPayload renders alert cards with recovery guidance', () => {
  const payload = buildHealthNotificationDiscordPayload({
    kind: 'alert',
    label: 'Tailscale',
    severity: 'warning',
    state: 'Degraded',
    summary: 'Tailscale backend is degraded.',
    details: ['IP missing'],
    recoveryCommand: 'open -a Tailscale',
  });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].title, /Runtime Health Alert .*Tailscale/u);
  assert.match(payload.embeds[0].description, /degraded/u);
});

test('buildOutboundEventDiscordPayload renders paused execution alerts as warning cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_execution_paused',
    body: 'Execution paused for TASK-PAUSED: Claude hit a usage limit before finishing the task.',
    metadata: {
      taskId: 'TASK-PAUSED',
      action: 'claude_runtime_delegate',
      severity: 'warning',
      reason: 'Claude hit a usage limit before finishing the task.',
      recoveryCommand: 'claude -p --resume \"abc\" \"Continue the pending O.R.I.O.N. task.\"',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0xFEE75C);
  assert.match(payload.embeds[0].title, /Warning/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Recovery Command' && /--resume/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders paused queue cards in warning color', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_queue_update',
    body: 'TASK-PAUSED paused claude_runtime_delegate.',
    metadata: {
      taskId: 'TASK-PAUSED',
      status: 'paused',
      priority: 'normal',
      summary: 'continue the browser task later',
      targetAgent: 'orchestrator',
      action: 'claude_runtime_delegate',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0xFEE75C);
  assert.match(payload.embeds[0].title, /continue the browser task later/u);
});

test('buildOutboundEventDiscordPayload renders queued cards with request summary and yellow color', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_queue_update',
    body: 'TASK-123 is queued with priority normal.',
    metadata: {
      taskId: 'TASK-123',
      status: 'queued',
      priority: 'normal',
      summary: 'check disk space',
      targetAgent: 'developer-agent',
      action: 'disk_space_health_check',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0xFEE75C);
  assert.match(payload.embeds[0].title, /check disk space/u);
  assert.match(payload.embeds[0].description, /check disk space/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Task' && /TASK-123/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Request' && /check disk space/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders queue cards with image context', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_queue_update',
    body: 'TASK-777 is queued with priority normal.',
    metadata: {
      taskId: 'TASK-777',
      status: 'queued',
      priority: 'normal',
      summary: 'review attached screenshot',
      targetAgent: 'orchestrator',
      imageAttachmentCount: 2,
      imageAttachmentFilenames: ['screenshot-1.png', 'screenshot-2.png'],
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Images' && /2/u.test(field.value)), true);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Image Files' && /screenshot-1\.png/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders completed queue cards in green', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'task_queue_update',
    body: 'TASK-123 completed disk_space_health_check.',
    metadata: {
      taskId: 'TASK-123',
      status: 'completed',
      summary: 'check disk space',
      action: 'disk_space_health_check',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0x57F287);
});

test('buildOutboundEventDiscordPayload renders rejected queue cards in red', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_outcome',
    body: 'reject TASK-123',
    metadata: {
      taskId: 'TASK-123',
      status: 'rejected',
      decision: 'reject',
      summary: 'Deploy latest bot changes to production.',
      reason: 'Not approved yet.',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0xED4245);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Reason' && /Not approved yet/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders approved queue cards in green and leads with the request', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_outcome',
    channelKey: 'taskQueue',
    body: 'Approved TASK-123.',
    metadata: {
      taskId: 'TASK-123',
      status: 'approved',
      decision: 'approve',
      summary: 'Mac is behind origin/main by 1 commit. Approve to run the safe sync workflow.',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0x57F287);
  assert.match(payload.embeds[0].title, /Mac is behind origin\/main by 1 commit/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Task' && /TASK-123/u.test(field.value)), true);
});

test('buildOutboundEventDiscordPayload renders approval outcomes in system logs as system cards', () => {
  const payload = buildOutboundEventDiscordPayload({
    type: 'approval_outcome',
    channelKey: 'systemLogs',
    body: 'Approved TASK-123.',
    metadata: {
      taskId: 'TASK-123',
      status: 'approved',
      decision: 'approve',
      reason: '',
    },
  });

  assert.equal(payload.embeds.length, 1);
  assert.equal(payload.embeds[0].color, 0x5865F2);
  assert.match(payload.embeds[0].title, /System Log .*TASK-123/u);
  assert.equal(payload.embeds[0].fields.some((field) => field.name === 'Decision' && /approve/u.test(field.value)), true);
});
