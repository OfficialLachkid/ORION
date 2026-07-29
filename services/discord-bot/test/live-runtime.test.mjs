import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalRejectModal,
  buildApprovalButtons,
  buildResolvedApprovalButtons,
  buildResolvedApprovalContent,
  buildResolvedApprovalEmbeds,
  normalizeInteractionAsApprovalMessage,
  parseApprovalButtonCustomId,
  shouldOpenRejectApprovalModal,
} from '../src/approval-buttons.mjs';
import {
  attachImageContextToTasks,
  buildImageContextKey,
  mergeImageAttachments,
  shouldScheduleDeferredDiscordBotRestart,
} from '../src/live-runtime.mjs';

test('parseApprovalButtonCustomId understands approve and reject actions', () => {
  assert.deepEqual(
    parseApprovalButtonCustomId('approve:TASK-202606291339-2AA8A8F209'),
    {
      decision: 'approve',
      taskId: 'TASK-202606291339-2AA8A8F209',
    }
  );

  assert.deepEqual(
    parseApprovalButtonCustomId('reject:TASK-202606291339-2AA8A8F209'),
    {
      decision: 'reject',
      taskId: 'TASK-202606291339-2AA8A8F209',
    }
  );

  assert.equal(parseApprovalButtonCustomId('noop:TASK-123'), null);
});

test('buildApprovalButtons creates green approve and red reject buttons', () => {
  const components = buildApprovalButtons('TASK-202606291339-2AA8A8F209');
  assert.equal(components.length, 1);
  assert.equal(components[0].components[0].label, 'Approve');
  assert.equal(components[0].components[0].style, 3);
  assert.equal(components[0].components[1].label, 'Reject');
  assert.equal(components[0].components[1].style, 4);
});

test('buildApprovalButtons uses email-specific labels without changing custom_id values', () => {
  const components = buildApprovalButtons('TASK-202606291339-2AA8A8F209', { isEmailAction: true });
  assert.equal(components[0].components[0].label, 'Send Email');
  assert.equal(components[0].components[0].custom_id, 'approve:TASK-202606291339-2AA8A8F209');
  assert.equal(components[0].components[1].label, 'Give Feedback');
  assert.equal(components[0].components[1].custom_id, 'reject:TASK-202606291339-2AA8A8F209');
});

test('buildApprovalRejectModal creates a required feedback form', () => {
  const modal = buildApprovalRejectModal('TASK-202606291339-2AA8A8F209');

  assert.equal(modal.custom_id, 'reject-modal:TASK-202606291339-2AA8A8F209');
  assert.equal(modal.components[0].components[0].custom_id, 'rejection_reason');
  assert.equal(modal.components[0].components[0].required, true);
});

test('buildApprovalRejectModal uses PR-specific copy for merge approvals', () => {
  const modal = buildApprovalRejectModal('TASK-PR-MERGE-42-1234567890AB');

  assert.equal(modal.title, 'Reject PR Merge');
  assert.match(modal.components[0].components[0].label, /PR remain open/u);
});

test('buildResolvedApprovalButtons removes the approval buttons after resolution', () => {
  const components = buildResolvedApprovalButtons('TASK-202606291339-2AA8A8F209', 'approve');
  assert.deepEqual(components, []);
});

test('buildResolvedApprovalContent appends a visible resolution line', () => {
  assert.equal(
    buildResolvedApprovalContent('Approval needed for TASK-202606291339-2AA8A8F209: Deploy to production', 'approve', 'Valen'),
    'Approval needed for TASK-202606291339-2AA8A8F209: Deploy to production\n\n**Decision: APPROVE by Valen.**'
  );
});

test('buildResolvedApprovalEmbeds recolors and retitles the first embed on resolution', () => {
  const originalEmbeds = [
    { title: '⏳ Approval Needed · TASK-1', color: 0xFEE75C, description: 'Send drafted email.' },
  ];

  const approved = buildResolvedApprovalEmbeds(originalEmbeds, 'approve', 'TASK-1');
  assert.equal(approved[0].title, '✅ Approval Resolved · TASK-1');
  assert.equal(approved[0].color, 0x57F287);
  assert.equal(approved[0].description, 'Send drafted email.');

  const rejected = buildResolvedApprovalEmbeds(originalEmbeds, 'reject', 'TASK-1');
  assert.equal(rejected[0].title, '❌ Approval Resolved · TASK-1');
  assert.equal(rejected[0].color, 0xED4245);
});

test('buildResolvedApprovalEmbeds returns undefined when there are no embeds to clone', () => {
  assert.equal(buildResolvedApprovalEmbeds([], 'approve', 'TASK-1'), undefined);
  assert.equal(buildResolvedApprovalEmbeds(undefined, 'approve', 'TASK-1'), undefined);
});

test('shouldScheduleDeferredDiscordBotRestart only triggers for deferred Mac sync completions', () => {
  assert.equal(shouldScheduleDeferredDiscordBotRestart({
    outcome: 'completed',
    executionPlan: {
      action: 'mac_runtime_safe_sync',
    },
    executionResult: {
      report: {
        restartDiscordBotDeferred: true,
      },
    },
  }), true);

  assert.equal(shouldScheduleDeferredDiscordBotRestart({
    outcome: 'completed',
    executionPlan: {
      action: 'disk_space_health_check',
    },
    executionResult: {
      report: {
        restartDiscordBotDeferred: true,
      },
    },
  }), false);
});

test('normalizeInteractionAsApprovalMessage converts an approve button click into approval text', () => {
  const message = normalizeInteractionAsApprovalMessage({
    type: 3,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'approve:TASK-202606291339-2AA8A8F209',
    },
    message: {
      id: 'message-1',
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.deepEqual(message, {
    guildId: 'guild-1',
    channelId: 'channel-1',
    messageId: 'message-1',
    content: 'approve TASK-202606291339-2AA8A8F209',
    attachments: [],
    author: {
      id: 'user-1',
      username: 'vbjservices',
      displayName: 'Valen',
      roleIds: ['role-1'],
      isOperator: false,
    },
  });
});

test('shouldOpenRejectApprovalModal flags reject button interactions', () => {
  assert.equal(shouldOpenRejectApprovalModal({
    type: 3,
    data: {
      custom_id: 'reject:TASK-202606291339-2AA8A8F209',
    },
  }), true);
});

test('normalizeInteractionAsApprovalMessage converts a reject modal submit into approval text with feedback', () => {
  const message = normalizeInteractionAsApprovalMessage({
    type: 5,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'reject-modal:TASK-202606291339-2AA8A8F209',
      components: [
        {
          components: [
            {
              custom_id: 'rejection_reason',
              value: 'Needs a clearer CTA and shorter opening sentence.',
            },
          ],
        },
      ],
    },
    message: {
      id: 'message-1',
    },
    member: {
      nick: 'Valen',
      roles: ['role-1'],
      user: {
        id: 'user-1',
        username: 'vbjservices',
        global_name: 'VBJ Services',
      },
    },
  });

  assert.equal(
    message?.content,
    'reject TASK-202606291339-2AA8A8F209 because Needs a clearer CTA and shorter opening sentence.'
  );
});

test('mergeImageAttachments de-duplicates image attachments by id', () => {
  const merged = mergeImageAttachments(
    [{ id: 'img-1', filename: 'a.png' }],
    [{ id: 'img-1', filename: 'a.png' }, { id: 'img-2', filename: 'b.png' }]
  );

  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 'img-1');
  assert.equal(merged[1].id, 'img-2');
});

test('attachImageContextToTasks updates task image metadata', () => {
  const tasks = [{
    task_id: 'TASK-1',
    image_attachment_count: 0,
    image_attachments: [],
    image_attachment_filenames: [],
  }];

  attachImageContextToTasks(tasks, [
    { id: 'img-1', filename: 'screen-1.png', contentType: 'image/png' },
    { id: 'img-2', filename: 'screen-2.png', contentType: 'image/png' },
  ]);

  assert.equal(tasks[0].image_attachment_count, 2);
  assert.deepEqual(tasks[0].image_attachment_filenames, ['screen-1.png', 'screen-2.png']);
});

test('buildImageContextKey scopes image context by author and channel', () => {
  assert.equal(
    buildImageContextKey({
      channelId: 'channel-1',
      author: { id: 'user-1' },
    }),
    'user-1:channel-1'
  );
});
