import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import { buildClaudeTaskPayload, isValidClaudeSessionId } from '../src/payload-store.mjs';
import { executeClaudeTask, parseClaudeStructuredResponse } from '../src/runner.mjs';

test('buildClaudeTaskPayload keeps approval, attachment, and context refs', () => {
  const config = loadRuntimeConfig();
  const payload = buildClaudeTaskPayload({
    task_id: 'TASK-CLAUDE-1',
    summary: 'Review attached screenshots and explain the bug.',
    full_text: 'Review attached screenshots and explain the bug in the Discord flow.',
    domain: 'general',
    priority: 'normal',
    target_agent: 'orchestrator',
    source_type: 'discord_text_command',
    source_channel: 'commands',
    submitted_at: '2026-07-09T10:00:00.000Z',
    submitted_by: 'VBJ Services',
    approval_required: true,
    approval_reason: 'manual review',
    approval_state: 'approved',
    approved_by: 'Lachkid',
    approved_by_id: '123',
    image_attachments: [
      {
        id: 'img-1',
        filename: 'screen-1.png',
        url: 'https://cdn.discordapp.com/one',
        contentType: 'image/png',
        size: 123,
      },
    ],
  }, config);

  assert.equal(payload.task.approval.state, 'approved');
  assert.equal(payload.task.approval.approvedBy, 'Lachkid');
  assert.equal(payload.task.attachments.length, 1);
  assert.equal(isValidClaudeSessionId(payload.sessionId), true);
  assert.match(payload.contextRefs.bridgeExportPath, /data[\\/]+vault-bridge[\\/]+current/u);
  assert.match(payload.contextRefs.supabaseMemoryCachePath, /data[\\/]+supabase-memory[\\/]+current/u);
});

test('buildClaudeTaskPayload keeps an explicit valid Claude session ID', () => {
  const config = loadRuntimeConfig();
  const payload = buildClaudeTaskPayload({
    task_id: 'TASK-CLAUDE-2',
    summary: 'Reuse a valid session id.',
    full_text: 'Reuse a valid session id.',
  }, config, {
    sessionId: '5f490876-8d0e-4ff7-9c40-ef6a3e79cdb4',
  });

  assert.equal(payload.sessionId, '5f490876-8d0e-4ff7-9c40-ef6a3e79cdb4');
});

test('buildClaudeTaskPayload exposes an isolated developer worktree as the repository root', () => {
  const config = loadRuntimeConfig();
  const isolatedWorktree = join(tmpdir(), 'ruflo-developer-worktree');
  const payload = buildClaudeTaskPayload({
    task_id: 'TASK-CLAUDE-WORKTREE',
    summary: 'Work in the isolated branch.',
    full_text: 'Work in the isolated branch.',
  }, {
    ...config,
    claude: {
      ...config.claude,
      workingDirectory: isolatedWorktree,
    },
  });

  assert.equal(payload.contextRefs.repoRoot, isolatedWorktree);
});

test('parseClaudeStructuredResponse extracts status, summary, files, and next step', () => {
  const parsed = parseClaudeStructuredResponse([
    'STATUS: completed',
    'SUMMARY: Reviewed the queue flow and identified the ordering bug.',
    'DETAILS:',
    '- Checked the task queue update order.',
    'FILES:',
    '- services/discord-bot/src/live-runtime.mjs',
    '- services/task-router/src/executor.mjs',
    'NEXT_STEP:',
    '- Restart the bot on the Mac.',
  ].join('\n'));

  assert.equal(parsed.status, 'completed');
  assert.match(parsed.summary, /ordering bug/u);
  assert.deepEqual(parsed.files, [
    'services/discord-bot/src/live-runtime.mjs',
    'services/task-router/src/executor.mjs',
  ]);
  assert.deepEqual(parsed.nextSteps, ['Restart the bot on the Mac.']);
});

test('executeClaudeTask classifies auth-blocked Claude runs clearly', async () => {
  const config = loadRuntimeConfig();
  const tempRoot = mkdtempSync(join(tmpdir(), 'ruflo-claude-runner-'));
  const result = await executeClaudeTask({
    task_id: 'TASK-AUTH-BLOCKED',
    summary: 'Probe auth state.',
    full_text: 'Probe auth state.',
    domain: 'general',
    priority: 'normal',
    target_agent: 'orchestrator',
    source_type: 'discord_text_command',
    source_channel: 'commands',
    submitted_at: '2026-07-10T10:00:00.000Z',
    submitted_by: 'Codex',
    approval_required: false,
    approval_state: 'not_required',
    image_attachments: [],
  }, {
    ...config,
    env: {
      ...config.env,
      CLAUDE_CHECKPOINTS_PATH: join(tempRoot, 'checkpoints'),
    },
    runtimePaths: {
      ...config.runtimePaths,
      tmpDir: join(tempRoot, 'tmp'),
    },
    claude: {
      ...config.claude,
      workingDirectory: tempRoot,
    },
  }, {
    commandRunner: async () => ({
      code: 1,
      stdout: '',
      stderr: 'Not logged in · Please run /login\n',
    }),
  });

  assert.equal(result.report.state, 'blocked');
  assert.match(result.report.summary, /not logged in/u);
  assert.equal(result.report.recoveryCommand, 'claude auth login --claudeai');
  assert.equal(result.report.nextSteps.some((entry) => /claude auth login/u.test(entry)), true);
});
