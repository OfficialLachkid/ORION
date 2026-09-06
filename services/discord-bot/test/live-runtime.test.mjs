import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildApprovalDecisionModal,
  buildApprovalRejectModal,
  buildApprovalButtons,
  buildResolvedApprovalButtons,
  buildResolvedApprovalContent,
  buildResolvedApprovalEmbeds,
  getApprovalModalRequest,
  normalizeInteractionAsApprovalMessage,
  parseApprovalButtonCustomId,
  shouldOpenRejectApprovalModal,
} from '../src/approval-buttons.mjs';
import {
  attachImageContextToTasks,
  buildImageContextKey,
  collectApprovalDeleteTargets,
  findTrackedApprovalMessagesForTask,
  isLeadOutreachSendComplete,
  mergeImageAttachments,
  prepareCommandTasksForExecution,
  rehydratePokeQuizzReviewTask,
  resolveInteractionApprovalOrigin,
  shouldScheduleDeferredDiscordBotRestart,
} from '../src/live-runtime.mjs';

test('parseApprovalButtonCustomId understands approve, reject, and delete actions', () => {
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

  assert.deepEqual(
    parseApprovalButtonCustomId('delete:TASK-202606291339-2AA8A8F209'),
    {
      decision: 'delete',
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

test('buildApprovalButtons accepts explicit label overrides for custom approval flows', () => {
  const components = buildApprovalButtons('TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456', {
    approveLabel: 'Publish',
    rejectLabel: 'Give Feedback',
    deleteLabel: 'Delete',
  });

  assert.equal(components[0].components[0].label, 'Publish');
  assert.equal(components[0].components[0].style, 3);
  assert.equal(components[0].components[1].label, 'Give Feedback');
  assert.equal(components[0].components[1].style, 2);
  assert.equal(components[0].components[2].label, 'Delete');
  assert.equal(components[0].components[2].style, 4);
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

test('buildApprovalRejectModal uses preview-feedback copy for Poke Quizz review tasks', () => {
  const modal = buildApprovalRejectModal('TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456');

  assert.equal(modal.title, 'Give Preview Feedback');
  assert.match(modal.components[0].components[0].label, /next preview/u);
});

test('buildApprovalDecisionModal creates a delete confirmation form for Poke Quizz review tasks', () => {
  const modal = buildApprovalDecisionModal('delete', 'TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456');

  assert.equal(modal.title, 'Delete Preview');
  assert.equal(modal.custom_id, 'delete-modal:TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456');
  assert.equal(modal.components[0].components[0].custom_id, 'delete_confirmation');
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

test('buildResolvedApprovalEmbeds marks Poke Quizz approvals as queued for publish', () => {
  const originalEmbeds = [
    {
      title: 'Approval Needed',
      color: 0x9B59B6,
      fields: [
        { name: 'State', value: '`preview_uploaded`', inline: true },
      ],
    },
  ];

  const approved = buildResolvedApprovalEmbeds(
    originalEmbeds,
    'approve',
    'TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456',
  );

  assert.equal(approved[0].title, 'Publish Queued · TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456');
  assert.equal(approved[0].color, 0x3498DB);
  assert.equal(approved[0].fields[0].value, '`queued_for_publish`');
});

test('buildResolvedApprovalEmbeds marks Poke Quizz deletes as queued removal', () => {
  const originalEmbeds = [
    {
      title: 'Approval Needed',
      color: 0x9B59B6,
      fields: [
        { name: 'State', value: '`preview_uploaded`', inline: true },
      ],
    },
  ];

  const deleted = buildResolvedApprovalEmbeds(
    originalEmbeds,
    'delete',
    'TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456',
  );

  assert.equal(deleted[0].title, 'Delete Queued · TASK-ORION-PQ-PUBLISH-20260731204500-ABCDEF123456');
  assert.equal(deleted[0].color, 0xED4245);
  assert.equal(deleted[0].fields[0].value, '`delete_requested`');
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
    validationError: '',
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

test('normalizeInteractionAsApprovalMessage converts a delete button click into delete text', () => {
  const message = normalizeInteractionAsApprovalMessage({
    type: 3,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'delete:TASK-202606291339-2AA8A8F209',
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

  assert.equal(message?.content, 'delete TASK-202606291339-2AA8A8F209');
});

test('shouldOpenRejectApprovalModal flags reject button interactions', () => {
  assert.equal(shouldOpenRejectApprovalModal({
    type: 3,
    data: {
      custom_id: 'reject:TASK-202606291339-2AA8A8F209',
    },
  }), true);
});

test('getApprovalModalRequest flags delete button interactions for confirmation', () => {
  assert.deepEqual(getApprovalModalRequest({
    type: 3,
    data: {
      custom_id: 'delete:TASK-202606291339-2AA8A8F209',
    },
  }), {
    decision: 'delete',
    taskId: 'TASK-202606291339-2AA8A8F209',
  });
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

test('normalizeInteractionAsApprovalMessage requires DELETE confirmation for delete modals', () => {
  const message = normalizeInteractionAsApprovalMessage({
    type: 5,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'delete-modal:TASK-202606291339-2AA8A8F209',
      components: [
        {
          components: [
            {
              custom_id: 'delete_confirmation',
              value: 'yes',
            },
          ],
        },
      ],
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

  assert.equal(message?.validationError, 'Type DELETE exactly to confirm preview deletion.');
});

test('normalizeInteractionAsApprovalMessage converts a confirmed delete modal submit into delete text', () => {
  const message = normalizeInteractionAsApprovalMessage({
    type: 5,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: {
      custom_id: 'delete-modal:TASK-202606291339-2AA8A8F209',
      components: [
        {
          components: [
            {
              custom_id: 'delete_confirmation',
              value: 'DELETE',
            },
          ],
        },
      ],
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

  assert.equal(message?.content, 'delete TASK-202606291339-2AA8A8F209');
  assert.equal(message?.validationError, '');
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

test('prepareCommandTasksForExecution queues executable slash-command tasks', () => {
  const queuedTasks = [];
  const result = {
    route: 'command',
    normalizedTask: {
      task_id: 'TASK-ORION-PQ-GENERATE-TEST',
      full_text: 'generate video template: find-the-shiny channel: trivamon-youtube',
      domain: 'content',
      priority: 'normal',
      approval_required: false,
      target_agent: 'product-video-agent',
      submitted_by: 'Valen',
      source_type: 'discord_text_command',
      status: 'queued',
    },
  };

  const prepared = prepareCommandTasksForExecution(result, {
    author: {
      id: 'operator-1',
    },
  }, {
    activeExecutionTaskId: '',
    executionQueueLength: 0,
    queueExecutableTask: (task) => {
      queuedTasks.push(task.task_id);
      return {
        taskId: task.task_id,
        state: 'starting',
        action: 'poke_quizz_generate_review',
        queuePosition: 0,
        blockedByTaskId: '',
      };
    },
  });

  assert.deepEqual(queuedTasks, ['TASK-ORION-PQ-GENERATE-TEST']);
  assert.equal(prepared.tasks.length, 1);
  assert.equal(prepared.runtimeOutboundEvents.length, 0);
  assert.equal(result.commandRuntimeSummary.taskCount, 1);
  assert.equal(result.commandRuntimeSummary.startingCount, 1);
  assert.equal(result.commandRuntimeSummary.queuedCount, 0);
});

test('rehydratePokeQuizzReviewTask finds TrivaMon reviews without assuming the Poke Quizz account', async () => {
  const publication = {
    id: 'publication-trivamon-review-1',
    video_id: 'video-trivamon-review-1',
    created_at: '2026-08-10T09:39:37.000Z',
    metadata: {
      review_task_id: 'TASK-ORION-PQ-PUBLISH-20260810093937-6EF1E8780A08',
      review_thread_id: '1536146358749233222',
      review_requested_at: '2026-08-10T09:39:37.000Z',
      type_pair: ['rock', 'fairy'],
      seed: 'shiny-review-3',
      render_path: 'data/runtime/product-video-agent/poke-quizz/reviews/trivamon-rock-fairy.mp4',
    },
  };
  const video = {
    id: 'video-trivamon-review-1',
    render: {
      type_pair: ['rock', 'fairy'],
      output_path: 'data/runtime/product-video-agent/poke-quizz/reviews/trivamon-rock-fairy.mp4',
    },
  };

  const task = await rehydratePokeQuizzReviewTask(
    {
      taskId: 'TASK-ORION-PQ-PUBLISH-20260810093937-6EF1E8780A08',
      messageId: '1536308033032945767',
    },
    {
      env: {
        SUPABASE_URL: 'https://example.supabase.co',
        SUPABASE_SECRET_KEY: 'secret',
      },
      channelIds: {},
    },
    {
      loadPublicationChannelProfiles: async () => ([
        {
          id: 'video-channel-poke-quizz-youtube',
          name: 'Poke Quizz',
          platform: 'youtube_shorts',
          account_key: 'poke-quizz-youtube',
          metadata: {
            review_thread_id: '1532709429902839810',
          },
        },
        {
          id: 'video-channel-trivamon-youtube',
          name: 'TrivaMon',
          platform: 'youtube_shorts',
          account_key: 'trivamon-youtube',
          metadata: {
            review_thread_id: '1536146358749233222',
          },
        },
      ]),
      publicationStore: {
        async fetchPublicationsByChannel({ accountKey }) {
          return accountKey === 'trivamon-youtube' ? [publication] : [];
        },
        async fetchVideoById(id) {
          assert.equal(id, 'video-trivamon-review-1');
          return video;
        },
      },
      resolvePokeQuizzReviewTaskPaths: async () => ({
        planPath: 'data/runtime/product-video-agent/poke-quizz/reviews/trivamon-rock-fairy.plan.json',
        catalogJsonPath: 'data/runtime/product-video-agent/pokedex/gen1-gen9-localized.json',
        templatePath: 'services/product-video-agent/config/templates/pokemon/find-the-shiny.v1.json',
        configPath: 'services/product-video-agent/config.example.json',
      }),
    },
  );

  assert.equal(task?.poke_quizz_publication_review?.publicationId, 'publication-trivamon-review-1');
  assert.equal(task?.poke_quizz_publication_review?.channelSelector, 'trivamon-youtube');
  assert.equal(task?.poke_quizz_publication_review?.reviewThreadId, '1536146358749233222');
});

test('isLeadOutreachSendComplete only fires for completed lead-outreach gmail sends', () => {
  // Positive: gmail_send_draft that completed AND carries a lead_id.
  assert.equal(
    isLeadOutreachSendComplete(
      { outcome: 'completed', executionPlan: { action: 'gmail_send_draft' } },
      { task_id: 'TASK-1', lead_id: 'lead-abc' },
    ),
    true,
  );
  // Ops-tool gmail send (no lead_id): must NOT clean up any approval msg.
  assert.equal(
    isLeadOutreachSendComplete(
      { outcome: 'completed', executionPlan: { action: 'gmail_send_draft' } },
      { task_id: 'TASK-1' },
    ),
    false,
  );
  // Send failed: keep the message for triage.
  assert.equal(
    isLeadOutreachSendComplete(
      { outcome: 'failed', executionPlan: { action: 'gmail_send_draft' } },
      { task_id: 'TASK-1', lead_id: 'lead-abc' },
    ),
    false,
  );
  // Wrong action (create vs send): must NOT delete.
  assert.equal(
    isLeadOutreachSendComplete(
      { outcome: 'completed', executionPlan: { action: 'gmail_create_draft' } },
      { task_id: 'TASK-1', lead_id: 'lead-abc' },
    ),
    false,
  );
});

test('findTrackedApprovalMessagesForTask matches the approval stream, not queue/result/parsed', () => {
  // Regression guard for 2026-08-29 delete-on-send fix: the trackedTaskMessages
  // key format is <channelId>:<stream>:<taskId>. We must match ONLY the
  // approval stream so we don't accidentally delete task-queue update
  // messages or the sent-outreach confirmation that just landed.
  const tracked = new Map([
    ['CHAN-WAITING:approval:TASK-1', { channelId: 'CHAN-WAITING', messageId: 'MSG-APPROVAL' }],
    ['CHAN-QUEUE:queue:TASK-1', { channelId: 'CHAN-QUEUE', messageId: 'MSG-QUEUE' }],
    ['CHAN-RESULT:result:TASK-1', { channelId: 'CHAN-RESULT', messageId: 'MSG-RESULT' }],
    ['CHAN-WAITING:approval:TASK-OTHER', { channelId: 'CHAN-WAITING', messageId: 'MSG-OTHER' }],
  ]);

  const matches = findTrackedApprovalMessagesForTask(tracked, 'TASK-1');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].channelId, 'CHAN-WAITING');
  assert.equal(matches[0].messageId, 'MSG-APPROVAL');
});

test('findTrackedApprovalMessagesForTask skips entries missing channelId or messageId', () => {
  const tracked = new Map([
    ['CHAN-A:approval:TASK-1', { channelId: 'CHAN-A', messageId: 'MSG-1' }],
    ['CHAN-B:approval:TASK-1', { channelId: '', messageId: 'MSG-2' }],
    ['CHAN-C:approval:TASK-1', { channelId: 'CHAN-C' }],
  ]);

  const matches = findTrackedApprovalMessagesForTask(tracked, 'TASK-1');

  assert.equal(matches.length, 1);
  assert.equal(matches[0].messageId, 'MSG-1');
});

test('findTrackedApprovalMessagesForTask returns empty array for empty/missing taskId', () => {
  const tracked = new Map([['CHAN-A:approval:TASK-1', { channelId: 'CHAN-A', messageId: 'MSG-1' }]]);
  assert.deepEqual(findTrackedApprovalMessagesForTask(tracked, ''), []);
  assert.deepEqual(findTrackedApprovalMessagesForTask(tracked, null), []);
});

test('resolveInteractionApprovalOrigin keeps approval message origin available after deferred updates', () => {
  const trackedMap = new Map([
    ['CHAN-APPROVAL:approval:TASK-1', { channelId: 'CHAN-APPROVAL', messageId: 'MSG-TRACKED' }],
  ]);

  const resolved = resolveInteractionApprovalOrigin({
    channel_id: 'CHAN-APPROVAL',
    message: {
      id: 'MSG-FALLBACK',
    },
  }, trackedMap, 'TASK-1');

  assert.deepEqual(resolved, {
    interactionChannelId: 'CHAN-APPROVAL',
    approvalMessageId: 'MSG-TRACKED',
    approvalOrigin: {
      channelId: 'CHAN-APPROVAL',
      messageId: 'MSG-TRACKED',
    },
  });
});

test('collectApprovalDeleteTargets uses task.approval_origin from the interaction payload', () => {
  // Regression guard for 2026-09-01: approval messages posted by batch
  // scripts (run-follow-ups, run-lead-qualification) don't flow through
  // the bot's fanOutOutboundEvents, so trackedTaskMessages has nothing
  // for them. The interaction handler DOES have the messageId from the
  // Discord button-click payload and stashes it as task.approval_origin.
  // Without this fallback the delete-on-send fix silently no-op'd for
  // the most common case (all outreach approvals come from batch scripts).
  const task = {
    task_id: 'TASK-1',
    lead_id: 'lead-abc',
    approval_origin: {
      channelId: '1541759565274808410',
      messageId: '1611234567890',
    },
  };
  const trackedMap = new Map();

  const targets = collectApprovalDeleteTargets({ task, trackedMap });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].channelId, '1541759565274808410');
  assert.equal(targets[0].messageId, '1611234567890');
  assert.equal(targets[0].source, 'approval_origin');
});

test('collectApprovalDeleteTargets also picks up tracked-map entries for bot-posted approvals', () => {
  // Non-batch-script approvals (e.g. from Discord bot processing an
  // incoming task) still flow through trackedTaskMessages the way they
  // always did — the fallback path must keep working alongside the
  // new approval_origin path.
  const task = { task_id: 'TASK-1', lead_id: 'lead-abc' };
  const trackedMap = new Map([
    ['CHAN-BOT:approval:TASK-1', { channelId: 'CHAN-BOT', messageId: 'MSG-BOT' }],
  ]);

  const targets = collectApprovalDeleteTargets({ task, trackedMap });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, 'tracked_messages');
  assert.equal(targets[0].messageId, 'MSG-BOT');
});

test('collectApprovalDeleteTargets deduplicates when tracked and origin point to the same message', () => {
  // Belt-and-braces: if a message ended up in BOTH sources (unlikely
  // but possible with future refactoring), don't double-DELETE it.
  const task = {
    task_id: 'TASK-1',
    lead_id: 'lead-abc',
    approval_origin: { channelId: 'CHAN-A', messageId: 'MSG-A' },
  };
  const trackedMap = new Map([
    ['CHAN-A:approval:TASK-1', { channelId: 'CHAN-A', messageId: 'MSG-A' }],
  ]);

  const targets = collectApprovalDeleteTargets({ task, trackedMap });

  assert.equal(targets.length, 1);
  assert.equal(targets[0].source, 'approval_origin');
});

test('collectApprovalDeleteTargets returns empty when neither source has a target', () => {
  assert.deepEqual(collectApprovalDeleteTargets({ task: { task_id: 'TASK-1' }, trackedMap: new Map() }), []);
  assert.deepEqual(collectApprovalDeleteTargets({}), []);
});
