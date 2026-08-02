import { approvalStateTitle, EMBED_COLORS } from './message-formatting.mjs';

const DISCORD_COMPONENT_TYPE_ACTION_ROW = 1;
const DISCORD_COMPONENT_TYPE_BUTTON = 2;
const DISCORD_COMPONENT_TYPE_TEXT_INPUT = 4;
const DISCORD_BUTTON_STYLE_SECONDARY = 2;
const DISCORD_BUTTON_STYLE_SUCCESS = 3;
const DISCORD_BUTTON_STYLE_DANGER = 4;
const DISCORD_TEXT_INPUT_STYLE_PARAGRAPH = 2;
const DISCORD_INTERACTION_TYPE_MESSAGE_COMPONENT = 3;
const DISCORD_INTERACTION_TYPE_MODAL_SUBMIT = 5;
const APPROVAL_REJECT_MODAL_PREFIX = 'reject-modal:';
const POKE_QUIZZ_PUBLISH_TASK_PREFIX = 'TASK-ORION-PQ-PUBLISH-';

export function parseApprovalButtonCustomId(customId) {
  const match = /^(approve|reject|delete):(TASK-[A-Z0-9-]+)$/u.exec(String(customId || ''));
  if (!match) {
    return null;
  }

  return {
    decision: match[1],
    taskId: match[2],
  };
}

// Labels are display-only — custom_id keeps the generic approve/reject
// values everywhere (parseApprovalButtonCustomId, decision.decision
// comparisons, etc. never change), so email-specific wording here has zero
// effect on button functionality, only what the operator sees before
// clicking. Email approvals say what actually happens on click ("Send") and
// what the alternative actually does (opens a feedback form) — "Approve"/
// "Reject" stay the wording for non-email approvals (infra sync, etc.),
// where they're still the more accurate description.
export function buildApprovalButtons(taskId, options = {}) {
  if (!taskId) {
    return [];
  }

  const isEmailAction = options.isEmailAction === true;
  const approveLabel = String(options.approveLabel || '').trim() || (isEmailAction ? 'Send Email' : 'Approve');
  const rejectLabel = String(options.rejectLabel || '').trim() || (isEmailAction ? 'Give Feedback' : 'Reject');
  const deleteLabel = String(options.deleteLabel || '').trim();
  const components = [
    {
      type: DISCORD_COMPONENT_TYPE_BUTTON,
      style: DISCORD_BUTTON_STYLE_SUCCESS,
      label: approveLabel,
      custom_id: `approve:${taskId}`,
      disabled: options.approveDisabled === true,
    },
    {
      type: DISCORD_COMPONENT_TYPE_BUTTON,
      style: deleteLabel ? DISCORD_BUTTON_STYLE_SECONDARY : DISCORD_BUTTON_STYLE_DANGER,
      label: rejectLabel,
      custom_id: `reject:${taskId}`,
      disabled: options.rejectDisabled === true,
    },
  ];
  if (deleteLabel) {
    components.push({
      type: DISCORD_COMPONENT_TYPE_BUTTON,
      style: DISCORD_BUTTON_STYLE_DANGER,
      label: deleteLabel,
      custom_id: `delete:${taskId}`,
      disabled: options.deleteDisabled === true,
    });
  }

  return [
    {
      type: DISCORD_COMPONENT_TYPE_ACTION_ROW,
      components,
    },
  ];
}

export function shouldOpenRejectApprovalModal(interaction) {
  const action = parseApprovalButtonCustomId(interaction?.data?.custom_id);
  return interaction?.type === DISCORD_INTERACTION_TYPE_MESSAGE_COMPONENT && action?.decision === 'reject';
}

export function buildApprovalRejectModal(taskId) {
  if (!taskId) {
    return null;
  }

  const isPullRequestMerge = taskId.startsWith('TASK-PR-MERGE-');
  const isProductVideo = taskId.startsWith('TASK-ORION-');
  const isPokeQuizzPublicationReview = taskId.startsWith('TASK-ORION-PQ-PUBLISH-');

  return {
    custom_id: `${APPROVAL_REJECT_MODAL_PREFIX}${taskId}`,
    title: isPokeQuizzPublicationReview
      ? 'Give Preview Feedback'
      : isPullRequestMerge
      ? 'Reject PR Merge'
      : isProductVideo
        ? 'Reject Approval Request'
        : 'Reject Email Draft',
    components: [
      {
        type: DISCORD_COMPONENT_TYPE_ACTION_ROW,
        components: [
          {
            type: DISCORD_COMPONENT_TYPE_TEXT_INPUT,
            custom_id: 'rejection_reason',
            style: DISCORD_TEXT_INPUT_STYLE_PARAGRAPH,
            label: isPokeQuizzPublicationReview
              ? 'What should change in the next preview?'
              : isPullRequestMerge
              ? 'Why should this PR remain open?'
              : isProductVideo
                ? 'Why is this approval being rejected?'
                : 'What should be improved before this is sent?',
            placeholder: isPokeQuizzPublicationReview
              ? 'Describe the revision to render next.'
              : isPullRequestMerge
              ? 'State what must change before merging.'
              : 'State the required revision feedback.',
            min_length: 5,
            max_length: 1000,
            required: true,
          },
        ],
      },
    ],
  };
}

export function buildResolvedApprovalButtons(taskId, decision) {
  if (!taskId || !decision) {
    return [];
  }

  return [];
}

// The button-click update previously sent only { content, components } —
// Discord's message-update interaction callback leaves anything omitted
// untouched, so the original yellow embed color (and "⏳ Approval Needed"
// title) stuck around forever regardless of approve/reject. Clone the
// existing embed(s) with the resolved color AND title instead of building
// new ones, so fields/links the original message carried survive — only
// the first embed's title is swapped (that's the one carrying the
// "Approval Needed" state; any additional embeds keep their own titles).
export function buildResolvedApprovalEmbeds(originalEmbeds, decision, taskId) {
  const embeds = Array.isArray(originalEmbeds) ? originalEmbeds : [];
  if (embeds.length === 0) {
    return undefined;
  }

  const isPokeQuizzPublishApproval = decision === 'approve' && String(taskId || '').startsWith(POKE_QUIZZ_PUBLISH_TASK_PREFIX);
  const isPokeQuizzDeleteApproval = decision === 'delete' && String(taskId || '').startsWith(POKE_QUIZZ_PUBLISH_TASK_PREFIX);
  const color = isPokeQuizzPublishApproval
    ? EMBED_COLORS.queue
    : isPokeQuizzDeleteApproval
      ? EMBED_COLORS.blocked
    : decision === 'approve'
      ? EMBED_COLORS.success
      : EMBED_COLORS.blocked;
  const resolvedTitle = isPokeQuizzPublishApproval
    ? `Publish Queued · ${taskId}`
    : isPokeQuizzDeleteApproval
      ? `Delete Queued · ${taskId}`
    : approvalStateTitle({ decision, taskId });
  return embeds.map((embed, index) => ({
    ...embed,
    color,
    ...(Array.isArray(embed?.fields) && embed.fields.length > 0
      ? {
        fields: embed.fields.map((field) => (
          field?.name === 'State' && isPokeQuizzPublishApproval
            ? { ...field, value: '`queued_for_publish`' }
            : field?.name === 'State' && isPokeQuizzDeleteApproval
              ? { ...field, value: '`delete_requested`' }
            : field
        )),
      }
      : {}),
    ...(index === 0 ? { title: resolvedTitle } : {}),
  }));
}

export function buildResolvedApprovalContent(originalContent, decision, actorDisplayName) {
  const base = String(originalContent || '').trim();
  const actor = String(actorDisplayName || 'operator').trim();
  const resolutionText = `Decision: ${String(decision || '').toUpperCase()} by ${actor}.`;
  const resolution = `**${resolutionText}**`;

  if (!base) {
    return resolution;
  }

  if (base.includes(resolution)) {
    return base;
  }

  if (base.includes(resolutionText)) {
    return base.replace(resolutionText, resolution);
  }

  return `${base}\n\n${resolution}`;
}

export function normalizeInteractionAsApprovalMessage(interaction) {
  const action = interaction?.type === DISCORD_INTERACTION_TYPE_MODAL_SUBMIT
    ? parseRejectApprovalModalInteraction(interaction)
    : parseApprovalButtonCustomId(interaction?.data?.custom_id);
  if (!action) {
    return null;
  }

  const content = action.decision === 'approve'
    ? `approve ${action.taskId}`
    : action.decision === 'delete'
      ? `delete ${action.taskId}`
    : `reject ${action.taskId} because ${action.reason || 'rejected via approval button'}`;

  return {
    guildId: interaction.guild_id || '',
    channelId: interaction.channel_id || '',
    messageId: interaction.message?.id || '',
    content,
    attachments: [],
    author: {
      id: interaction.member?.user?.id || interaction.user?.id || '',
      username: interaction.member?.user?.username || interaction.user?.username || '',
      displayName: interaction.member?.nick || interaction.member?.user?.global_name || interaction.user?.global_name || interaction.member?.user?.username || interaction.user?.username || '',
      roleIds: Array.isArray(interaction.member?.roles) ? interaction.member.roles : [],
      isOperator: false,
    },
  };
}

function parseRejectApprovalModalInteraction(interaction) {
  const customId = String(interaction?.data?.custom_id || '');
  const match = new RegExp(`^${APPROVAL_REJECT_MODAL_PREFIX}(TASK-[A-Z0-9-]+)$`, 'u').exec(customId);
  if (!match) {
    return null;
  }

  const reason = extractRejectApprovalReason(interaction?.data?.components);
  if (!reason) {
    return {
      decision: 'reject',
      taskId: match[1],
      reason: '',
    };
  }

  return {
    decision: 'reject',
    taskId: match[1],
    reason,
  };
}

function extractRejectApprovalReason(components = []) {
  for (const row of Array.isArray(components) ? components : []) {
    for (const component of Array.isArray(row?.components) ? row.components : []) {
      if (component?.custom_id === 'rejection_reason') {
        return String(component.value || '').replace(/\s+/gu, ' ').trim();
      }
    }
  }

  return '';
}
