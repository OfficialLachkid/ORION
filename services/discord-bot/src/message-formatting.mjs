import { buildCommandHelpDescriptor } from './command-catalog.mjs';

const MAX_DISCORD_MESSAGE_LENGTH = 2000;
const MAX_EMBED_TITLE_LENGTH = 256;
const MAX_EMBED_DESCRIPTION_LENGTH = 4096;
const MAX_EMBED_FIELD_VALUE_LENGTH = 1024;

export const EMBED_COLORS = {
  parsedTask: 0x5865F2,
  approval: 0xFEE75C,
  queue: 0x3498DB,
  queued: 0xFEE75C,
  // Distinct from `queued` yellow so a drafted email awaiting operator review
  // reads visually as "ready, needs your click" instead of "still processing".
  awaitingReview: 0x9B59B6,
  running: 0x3498DB,
  voice: 0x1ABC9C,
  memory: 0x1ABC9C,
  execution: 0x57F287,
  alert: 0xED4245,
  warning: 0xFEE75C,
  system: 0x5865F2,
  success: 0x57F287,
  blocked: 0xED4245,
};

function truncateText(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function truncateMessage(content) {
  return truncateText(content, MAX_DISCORD_MESSAGE_LENGTH);
}

function percent(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '';
  }

  return `${Math.round(value * 100)}%`;
}

function lines(...items) {
  return items.filter(Boolean).join('\n');
}

function quote(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  return `> ${text}`;
}

function formatEmailBody(value) {
  return String(value || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .trim();
}

function formatDurationMs(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'n/a';
  }

  const totalSeconds = Math.round(numeric / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.round(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatBytes(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }

  if (numeric >= 1024 * 1024 * 1024) {
    return `${(numeric / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  if (numeric >= 1024 * 1024) {
    return `${(numeric / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (numeric >= 1024) {
    return `${(numeric / 1024).toFixed(1)} KB`;
  }

  return `${numeric} B`;
}

function formatKilobytes(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return '';
  }

  return formatBytes(numeric * 1024);
}

function compactPath(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\\/gu, '/');
  const parts = normalized.split('/');
  return parts.length <= 2 ? normalized : parts.slice(-2).join('/');
}

function createField(name, value, inline = true) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  return {
    name: truncateText(name, 256),
    value: truncateText(text, MAX_EMBED_FIELD_VALUE_LENGTH),
    inline,
  };
}

function buildEmbedPayload({
  color,
  title,
  description = '',
  fields = [],
  footerText = '',
  content = '',
  allowedMentions = undefined,
}) {
  return {
    ...(content ? { content: truncateMessage(content) } : {}),
    ...(allowedMentions ? { allowed_mentions: allowedMentions } : {}),
    embeds: [
      {
        color,
        title: truncateText(title, MAX_EMBED_TITLE_LENGTH),
        description: truncateText(description, MAX_EMBED_DESCRIPTION_LENGTH),
        ...(fields.length > 0 ? { fields } : {}),
        ...(footerText ? { footer: { text: truncateText(footerText, 2048) } } : {}),
      },
    ],
  };
}

function queueStatusColor(status) {
  switch (String(status || '').trim().toLowerCase()) {
    case 'completed':
    case 'success':
    case 'approved':
    case 'approve':
      return EMBED_COLORS.success;
    case 'running':
    case 'starting':
      return EMBED_COLORS.running;
    case 'awaiting_approval':
      return EMBED_COLORS.awaitingReview;
    case 'queued':
    case 'pending':
    case 'paused':
      return EMBED_COLORS.queued;
    case 'rejected':
    case 'reject':
    case 'failed':
    case 'blocked':
    case 'stopped':
    case 'cancelled':
    case 'invalid':
      return EMBED_COLORS.blocked;
    default:
      return EMBED_COLORS.alert;
  }
}

function queueStatusTitle(status, taskId) {
  const normalized = String(status || '').trim().toLowerCase();
  switch (normalized) {
    case 'running':
    case 'starting':
      return taskTitle('🔄 Queue Update', taskId);
    case 'queued':
    case 'awaiting_approval':
    case 'pending':
    case 'approved':
      return taskTitle('⏳ Queue Update', taskId);
    case 'paused':
      return taskTitle('⏸️ Queue Update', taskId);
    case 'completed':
    case 'success':
      return taskTitle('✅ Queue Update', taskId);
    case 'rejected':
    case 'failed':
    case 'blocked':
    case 'stopped':
    case 'critical':
      return taskTitle('❌ Queue Update', taskId);
    default:
      return taskTitle('Queue Update', taskId);
  }
}

export function approvalStateTitle(metadata = {}) {
  if (metadata.decision === 'approve' || metadata.status === 'approved') {
    return taskTitle('✅ Approval Resolved', metadata.taskId);
  }

  if (metadata.decision === 'reject' || metadata.status === 'rejected') {
    return taskTitle('❌ Approval Resolved', metadata.taskId);
  }

  return taskTitle('⏳ Approval Needed', metadata.taskId);
}

function inferLegacyCardColor(title) {
  switch (String(title || '').trim().toLowerCase()) {
    case 'queue update':
      return EMBED_COLORS.queue;
    case 'parsed task':
      return EMBED_COLORS.parsedTask;
    case 'execution result':
      return EMBED_COLORS.execution;
    case 'alert':
    case 'unauthorized operator blocked':
      return EMBED_COLORS.alert;
    case 'system log':
      return EMBED_COLORS.system;
    case 'voice transcript':
      return EMBED_COLORS.voice;
    case 'approval needed':
      return EMBED_COLORS.approval;
    default:
      return EMBED_COLORS.system;
  }
}

function parseLegacyMarkdownCard(content) {
  const text = String(content || '').trim();
  const lines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const titleMatch = /^\*\*(.+?)\*\*$/u.exec(lines[0]);
  if (!titleMatch) {
    return null;
  }

  const title = titleMatch[1].trim();
  const fields = [];
  const descriptionLines = [];

  for (const line of lines.slice(1)) {
    const fieldMatch = /^([^:]{1,64}):\s+(.+)$/u.exec(line);
    if (fieldMatch) {
      const [, name, rawValue] = fieldMatch;
      const value = rawValue.replace(/^`|`$/gu, '').trim();
      fields.push(createField(name.trim(), value, value.length <= 40));
      continue;
    }

    descriptionLines.push(line);
  }

  return {
    title,
    description: descriptionLines.join('\n'),
    fields: fields.filter(Boolean),
  };
}

export function upgradeLegacyDiscordPayload(payloadOrContent) {
  const payload = typeof payloadOrContent === 'string'
    ? { content: payloadOrContent }
    : { ...(payloadOrContent || {}) };

  if (Array.isArray(payload.embeds) && payload.embeds.length > 0) {
    return payload;
  }

  const legacyCard = parseLegacyMarkdownCard(payload.content || '');
  if (!legacyCard) {
    return payload;
  }

  return buildEmbedPayload({
    color: inferLegacyCardColor(legacyCard.title),
    title: legacyCard.title,
    description: legacyCard.description,
    fields: legacyCard.fields,
    allowedMentions: payload.allowed_mentions,
  });
}

function buildAllowedMentions(metadata = {}) {
  const roleIds = Array.isArray(metadata.approverRoleIds) ? metadata.approverRoleIds.filter(Boolean) : [];
  const userIds = Array.isArray(metadata.approverUserIds) ? metadata.approverUserIds.filter(Boolean) : [];

  if (roleIds.length === 0 && userIds.length === 0) {
    return undefined;
  }

  return {
    parse: [],
    roles: roleIds,
    users: userIds,
  };
}

function taskTitle(prefix, taskId) {
  return taskId ? `${prefix} · ${taskId}` : prefix;
}

function queueTitleText(metadata = {}, outboundEvent = {}) {
  const summary = String(metadata.summary || '').trim();
  if (summary) {
    return truncateText(summary, MAX_EMBED_TITLE_LENGTH - 24);
  }

  const body = String(outboundEvent.body || '').trim();
  if (
    body &&
    !/^(approve|reject)\s+TASK-/iu.test(body) &&
    !/^Approval\s+(approve|reject)\s+for\s+TASK-/iu.test(body) &&
    !/^TASK-[A-Z0-9-]+\s+/u.test(body)
  ) {
    return truncateText(body, MAX_EMBED_TITLE_LENGTH - 24);
  }

  return String(metadata.taskId || '').trim();
}

function formatTaskMetadata(task = {}) {
  return lines(
    task.task_id ? `Task: \`${task.task_id}\`` : '',
    task.target_agent ? `Agent: \`${task.target_agent}\`` : '',
    task.domain ? `Domain: \`${task.domain}\`` : '',
    task.priority ? `Priority: \`${task.priority}\`` : '',
    task.status ? `Status: \`${task.status}\`` : '',
    task.image_attachment_count ? `Images: \`${task.image_attachment_count}\`` : ''
  );
}

function formatParsedTaskPreview(outboundEvent) {
  const task = outboundEvent.metadata?.task || {};
  return lines(
    `**Parsed Task**`,
    formatTaskMetadata(task),
    task.summary ? `Summary: ${task.summary}` : '',
    task.approval_required ? `Approval: required` : `Approval: not required`
  );
}

function buildParsedTaskPayload(outboundEvent) {
  const task = outboundEvent.metadata?.task || {};
  return buildEmbedPayload({
    color: EMBED_COLORS.parsedTask,
    title: taskTitle('Parsed Task', task.task_id),
    description: task.summary || outboundEvent.body || 'Parsed task received.',
    fields: [
      createField('Agent', task.target_agent ? `\`${task.target_agent}\`` : '', true),
      createField('Domain', task.domain ? `\`${task.domain}\`` : '', true),
      createField('Priority', task.priority ? `\`${task.priority}\`` : '', true),
      createField('Status', task.status ? `\`${task.status}\`` : '', true),
      createField('Approval', task.approval_required ? 'Required' : 'Not required', true),
      createField('Images', task.image_attachment_count ? `\`${task.image_attachment_count}\`` : '', true),
      createField('Source', task.source_type ? `\`${task.source_type}\`` : '', true),
      createField('Image Files', Array.isArray(task.image_attachment_filenames) ? task.image_attachment_filenames.join('\n') : '', false),
    ].filter(Boolean),
    footerText: task.submitted_by ? `Submitted by ${task.submitted_by}` : 'Ruflo parser',
  });
}

function formatApprovalRequest(outboundEvent) {
  const taskId = outboundEvent.metadata?.taskId || '';
  const summaryMatch = /^Approval needed for [^:]+:\s*(.*)$/u.exec(outboundEvent.body || '');
  const summary = summaryMatch ? summaryMatch[1] : '';
  const emailTo = outboundEvent.metadata?.emailTo || '';
  const emailSubject = outboundEvent.metadata?.emailSubject || '';
  const emailBody = outboundEvent.metadata?.emailBody || '';

  return lines(
    `**Approval Needed**`,
    taskId ? `Task: \`${taskId}\`` : '',
    summary ? `Summary: ${summary}` : '',
    emailTo ? `To: \`${emailTo}\`` : '',
    emailSubject ? `Subject: ${emailSubject}` : '',
    emailBody ? `Body:\n${emailBody}` : '',
    `Action: ${emailTo ? 'approve sends the draft; reject opens a feedback form' : 'use the buttons below or reply with `approve TASK-ID` / `reject TASK-ID because <reason>`'}`
  );
}

function buildApprovalRequestPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const isProductVideoApproval = Boolean(metadata.productVideoStage);
  const actionText = metadata.emailTo
    ? 'Approve sends the current Gmail draft. Reject opens a feedback form for revisions.'
    : isProductVideoApproval && metadata.approvalBlocked
      ? 'Approval is disabled until every listed blocker is resolved. Reject remains available.'
      : isProductVideoApproval && metadata.approvalResolved
        ? `This request is already ${metadata.approvalState}.`
        : metadata.pullRequestNumber
          ? 'Approve revalidates the live PR head and CI checks, marks the draft ready, and merges it. Reject leaves the PR open.'
          : 'Use the buttons below or reply with `approve TASK-ID` / `reject TASK-ID because <reason>`';
  const embedFields = [
    createField('Agent', metadata.targetAgent ? `\`${metadata.targetAgent}\`` : '', true),
    createField('Domain', metadata.domain ? `\`${metadata.domain}\`` : '', true),
    createField('Images', metadata.imageAttachmentCount ? `\`${metadata.imageAttachmentCount}\`` : '', true),
    createField('To', metadata.emailTo ? `\`${metadata.emailTo}\`` : '', true),
    createField('Subject', metadata.emailSubject ? metadata.emailSubject : '', false),
    createField('Draft', metadata.gmailDraftId ? `\`${metadata.gmailDraftId}\`` : '', true),
    createField('Body', formatEmailBody(metadata.emailBody || ''), false),
    createField('Stage', metadata.productVideoStage ? `\`${metadata.productVideoStage}\`` : '', true),
    createField('Product', metadata.productName || '', true),
    createField('State', metadata.approvalState ? `\`${metadata.approvalState}\`` : '', true),
    createField('Subject', metadata.subjectId ? `\`${metadata.subjectId}\`` : '', false),
    createField('Script Angle', metadata.scriptAngle ? `\`${metadata.scriptAngle}\`` : '', true),
    createField('Target Duration', metadata.scriptDurationSeconds ? `\`${metadata.scriptDurationSeconds}s\`` : '', true),
    createField('Script Preview', metadata.scriptPreview || '', false),
    createField('Publication Disclosure (not narrated)', metadata.affiliateDisclosure || '', false),
    createField('Media', metadata.assetMediaType ? `\`${metadata.assetMediaType}\`` : '', true),
    createField('Source Provider', metadata.assetSourceProvider ? `\`${metadata.assetSourceProvider}\`` : '', true),
    createField('Usage Scope', metadata.assetUsageScope ? `\`${metadata.assetUsageScope}\`` : '', true),
    createField('Rights', metadata.assetRightsStatus ? `\`${metadata.assetRightsStatus}\` / \`${metadata.assetRightsBasis}\`` : '', false),
    createField('Rights Evidence', metadata.assetRightsEvidence || '', false),
    createField('Render Template', metadata.renderTemplate ? `\`${metadata.renderTemplate}\`` : '', true),
    createField('Render Purpose', metadata.renderPurpose ? `\`${metadata.renderPurpose}\`` : '', true),
    createField('Publication Eligible', metadata.renderPurpose ? `\`${metadata.publicationEligible === true}\`` : '', true),
    createField('Platforms', Array.isArray(metadata.renderTargets) ? metadata.renderTargets.join(', ') : '', false),
    createField('Blockers', Array.isArray(metadata.blockingReasons) ? metadata.blockingReasons.join('\n') : '', false),
    createField('Render Blockers', Array.isArray(metadata.renderBlockers) ? metadata.renderBlockers.join('\n') : '', false),
    createField(
      'Pull Request',
      metadata.pullRequestUrl && metadata.pullRequestNumber
        ? `[#${metadata.pullRequestNumber}](${metadata.pullRequestUrl})`
        : '',
      true
    ),
    createField('Source Branch', metadata.sourceBranch ? `\`${metadata.sourceBranch}\`` : '', true),
    createField('Target Branch', metadata.targetBranch ? `\`${metadata.targetBranch}\`` : '', true),
    createField('Tested Commit', metadata.expectedHeadSha ? `\`${String(metadata.expectedHeadSha).slice(0, 12)}\`` : '', true),
    createField('CI Run', metadata.ciRunUrl ? `[Open validation run](${metadata.ciRunUrl})` : '', true),
    // Reason and Preview were dropped from email approvals per operator
    // request (2026-07-20) — Preview always duplicated Body regardless of
    // approval type, but Reason still carries real signal for non-email
    // approvals (PR merges, infra sync), so it only drops for emailTo.
    createField('Reason', metadata.emailTo ? '' : (metadata.approvalReason || ''), false),
    createField('Image Files', Array.isArray(metadata.imageAttachmentFilenames) ? metadata.imageAttachmentFilenames.join('\n') : '', false),
    createField('Action', actionText, false),
  ].filter(Boolean);

  return buildEmbedPayload({
    color: EMBED_COLORS.approval,
    title: approvalStateTitle(metadata),
    description: metadata.summary || outboundEvent.body || 'Approval requested.',
    fields: embedFields,
    footerText: metadata.submittedBy ? `Requested by ${metadata.submittedBy}` : 'Ruflo approval gate',
    content: metadata.approverMentions || '',
    allowedMentions: buildAllowedMentions(metadata),
  });
}

function formatQueueUpdate(outboundEvent) {
  const taskId = outboundEvent.metadata?.taskId || '';
  const status = outboundEvent.metadata?.status || '';
  const priority = outboundEvent.metadata?.priority || '';
  const action = outboundEvent.metadata?.action || '';
  const summary = outboundEvent.metadata?.summary || '';
  const targetAgent = outboundEvent.metadata?.targetAgent || '';
  const decision = outboundEvent.metadata?.decision || '';
  const reason = outboundEvent.metadata?.reason || '';

  return lines(
    `**Queue Update**`,
    taskId ? `Task: \`${taskId}\`` : '',
    summary ? `Request: ${summary}` : '',
    status ? `Status: \`${status}\`` : '',
    priority ? `Priority: \`${priority}\`` : '',
    targetAgent ? `Agent: \`${targetAgent}\`` : '',
    action ? `Action: \`${action}\`` : '',
    decision ? `Decision: \`${decision}\`` : '',
    reason ? `Reason: ${reason}` : '',
    outboundEvent.body && !outboundEvent.body.startsWith(`${taskId} is`) ? outboundEvent.body : ''
  );
}

function buildQueueUpdatePayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const titleStatus = metadata.status === 'approved' || metadata.decision === 'approve'
    ? 'completed'
    : metadata.status === 'rejected' || metadata.decision === 'reject'
      ? 'rejected'
      : metadata.status || metadata.decision;
  return buildEmbedPayload({
    color: queueStatusColor(metadata.status || metadata.decision),
    title: queueStatusTitle(titleStatus, queueTitleText(metadata, outboundEvent)),
    description: metadata.summary || outboundEvent.body || 'Queue state changed.',
    fields: [
      createField('Task', metadata.taskId ? `\`${metadata.taskId}\`` : '', true),
      createField('Request', metadata.summary || '', false),
      createField('Status', metadata.status ? `\`${metadata.status}\`` : '', true),
      createField('Priority', metadata.priority ? `\`${metadata.priority}\`` : '', true),
      createField('Agent', metadata.targetAgent ? `\`${metadata.targetAgent}\`` : '', true),
      createField('Images', metadata.imageAttachmentCount ? `\`${metadata.imageAttachmentCount}\`` : '', true),
      createField('Action', metadata.action ? `\`${metadata.action}\`` : '', true),
      createField('Decision', metadata.decision ? `\`${metadata.decision}\`` : '', true),
      createField('Reason', metadata.reason || '', false),
      createField('Image Files', Array.isArray(metadata.imageAttachmentFilenames) ? metadata.imageAttachmentFilenames.join('\n') : '', false),
    ].filter(Boolean),
    footerText: 'Ruflo task queue',
  });
}

function buildTaskContextUpdatePayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  return buildEmbedPayload({
    color: EMBED_COLORS.parsedTask,
    title: taskTitle('Task Context Updated', metadata.taskId),
    description: outboundEvent.body || 'Task context updated.',
    fields: [
      createField('Request', metadata.summary || '', false),
      createField('Images', metadata.imageAttachmentCount ? `\`${metadata.imageAttachmentCount}\`` : '', true),
      createField('Image Files', Array.isArray(metadata.imageAttachmentFilenames) ? metadata.imageAttachmentFilenames.join('\n') : '', false),
    ].filter(Boolean),
    footerText: 'Ruflo task context',
  });
}

function formatMemoryWriteBackCandidates(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const candidates = Array.isArray(metadata.candidates) ? metadata.candidates : [];

  return lines(
    `**Memory Update**`,
    metadata.taskId ? `Task: \`${metadata.taskId}\`` : '',
    metadata.summary ? `Request: ${metadata.summary}` : '',
    metadata.targetAgent ? `Agent: \`${metadata.targetAgent}\`` : '',
    metadata.domain ? `Domain: \`${metadata.domain}\`` : '',
    candidates.length > 0
      ? `Candidates: ${candidates.map((candidate) => `${candidate.namespace}/${candidate.type} (${candidate.status})`).join(' | ')}`
      : '',
    outboundEvent.body || ''
  );
}

function buildMemoryWriteBackPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const candidates = Array.isArray(metadata.candidates) ? metadata.candidates : [];
  const reviewWindows = candidates
    .map((candidate) => {
      const review = candidate.reviewByUtc ? `review ${candidate.reviewByUtc.slice(0, 10)}` : '';
      const stale = candidate.staleByUtc ? `stale ${candidate.staleByUtc.slice(0, 10)}` : '';
      const combined = [review, stale].filter(Boolean).join(' · ');
      return combined ? `- ${candidate.namespace}: ${combined}` : '';
    })
    .filter(Boolean);

  return buildEmbedPayload({
    color: EMBED_COLORS.memory,
    title: taskTitle('Memory Update', metadata.taskId),
    description: metadata.summary || outboundEvent.body || 'Memory write-back candidates prepared.',
    fields: [
      createField('Task', metadata.taskId ? `\`${metadata.taskId}\`` : '', true),
      createField('Request', metadata.summary || '', false),
      createField('Agent', metadata.targetAgent ? `\`${metadata.targetAgent}\`` : '', true),
      createField('Domain', metadata.domain ? `\`${metadata.domain}\`` : '', true),
      createField('Candidates', metadata.candidateCount !== undefined ? `\`${metadata.candidateCount}\`` : '', true),
      createField(
        'Namespaces',
        candidates.length > 0
          ? candidates.map((candidate) => `- ${candidate.namespace}: ${candidate.type} (${candidate.status})`).join('\n')
          : '',
        false
      ),
      createField('Review / Freshness', reviewWindows.join('\n'), false),
    ].filter(Boolean),
    footerText: 'Ruflo memory updates',
  });
}

function formatVoiceTranscript(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const transcript = String(outboundEvent.body || '').replace(/^Transcript from .*?:\s*/u, '');

  return lines(
    `**Voice Transcript**`,
    quote(transcript),
    metadata.confidence !== undefined ? `Confidence: ${percent(metadata.confidence)}` : '',
    metadata.language ? `Language: \`${metadata.language}\`` : '',
    metadata.segmentCount ? `Segments: \`${metadata.segmentCount}\`` : ''
  );
}

function buildVoiceTranscriptPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const transcript = String(outboundEvent.body || '').replace(/^Transcript from .*?:\s*/u, '');

  return buildEmbedPayload({
    color: EMBED_COLORS.voice,
    title: 'Voice Transcript',
    description: transcript || outboundEvent.body || 'Voice note transcribed.',
    fields: [
      createField('Confidence', metadata.confidence !== undefined ? percent(metadata.confidence) : '', true),
      createField('Language', metadata.language ? `\`${metadata.language}\`` : '', true),
      createField('Segments', metadata.segmentCount ? `\`${metadata.segmentCount}\`` : '', true),
    ].filter(Boolean),
    footerText: metadata.sourceMessageId ? `Source message ${metadata.sourceMessageId}` : 'Ruflo transcription',
  });
}

function buildExecutionFields(metadata = {}) {
  const checkedAgents = Array.isArray(metadata.checkedAgents) ? metadata.checkedAgents : [];
  const topFolders = Array.isArray(metadata.topFolders) ? metadata.topFolders : [];
  const unhealthyChecks = Array.isArray(metadata.unhealthyChecks) ? metadata.unhealthyChecks : [];
  const files = Array.isArray(metadata.files) ? metadata.files : [];
  const nextSteps = Array.isArray(metadata.nextSteps) ? metadata.nextSteps : [];

  return [
    createField('Action', metadata.action ? `\`${metadata.action}\`` : '', true),
    createField('State', metadata.state ? `\`${metadata.state}\`` : '', true),
    createField('Severity', metadata.severity ? `\`${metadata.severity}\`` : '', true),
    createField('Active Count', metadata.activeCount !== undefined ? `\`${metadata.activeCount}\`` : '', true),
    createField('Process Count', metadata.processCount !== undefined ? `\`${metadata.processCount}\`` : '', true),
    createField('Runs', metadata.runs !== undefined ? `\`${metadata.runs}\`` : '', true),
    createField('Last Exit Code', metadata.lastExitCode !== undefined ? `\`${metadata.lastExitCode}\`` : '', true),
    createField('Tailscale IP', metadata.tailscaleIp ? `\`${metadata.tailscaleIp}\`` : '', true),
    createField('Tailscale DNS', metadata.dnsName ? `\`${metadata.dnsName}\`` : '', true),
    createField('Docker Context', metadata.dockerContext ? `\`${metadata.dockerContext}\`` : '', true),
    createField('Docker Version', metadata.dockerServerVersion ? `\`${metadata.dockerServerVersion}\`` : '', true),
    createField('Colima State', metadata.colimaState ? `\`${metadata.colimaState}\`` : '', true),
    createField('Active Models', metadata.activeModelCount !== undefined ? `\`${metadata.activeModelCount}\`` : '', true),
    createField('Mount Point', metadata.mountPoint ? `\`${metadata.mountPoint}\`` : '', true),
    createField('Available', metadata.availableKb !== undefined ? formatKilobytes(metadata.availableKb) : '', true),
    createField('Total', metadata.totalKb !== undefined ? formatKilobytes(metadata.totalKb) : '', true),
    createField('GitHub Host', metadata.githubHost ? `\`${metadata.githubHost}\`` : '', true),
    createField('GitHub Account', metadata.githubAccount ? `\`${metadata.githubAccount}\`` : '', true),
    createField('Git Protocol', metadata.gitProtocol ? `\`${metadata.gitProtocol}\`` : '', true),
    createField(
      'Issue',
      metadata.issueUrl
        ? `[${metadata.issueNumber ? `#${metadata.issueNumber}` : 'Open issue'}](${metadata.issueUrl})`
        : '',
      true
    ),
    createField(
      metadata.merged || metadata.mergeQueued ? 'Pull Request' : 'Draft PR',
      metadata.pullRequestUrl
        ? `[${metadata.pullRequestNumber ? `#${metadata.pullRequestNumber}` : 'Open PR'}](${metadata.pullRequestUrl})`
        : '',
      true
    ),
    createField('Base Branch', metadata.baseBranch ? `\`${metadata.baseBranch}\`` : '', true),
    createField('Commit', metadata.commitSha ? `\`${String(metadata.commitSha).slice(0, 7)}\`` : '', true),
    createField('Merge Method', metadata.mergeMethod ? `\`${metadata.mergeMethod}\`` : '', true),
    createField('Email To', metadata.emailTo ? `\`${metadata.emailTo}\`` : '', true),
    createField('Email Subject', metadata.emailSubject ? metadata.emailSubject : '', false),
    createField('Email Body', formatEmailBody(metadata.emailBody || ''), false),
    createField('Draft ID', metadata.gmailDraftId ? `\`${metadata.gmailDraftId}\`` : '', true),
    createField('Gmail Message', metadata.gmailMessageId ? `\`${metadata.gmailMessageId}\`` : '', true),
    createField('Gmail Thread', metadata.gmailThreadId ? `\`${metadata.gmailThreadId}\`` : '', true),
    createField('Claude Version', metadata.claudeVersion ? `\`${metadata.claudeVersion}\`` : '', true),
    createField('Claude Logged In', metadata.claudeLoggedIn !== undefined ? (metadata.claudeLoggedIn ? 'Yes' : 'No') : '', true),
    createField('Claude Auth', metadata.claudeAuthMethod ? `\`${metadata.claudeAuthMethod}\`` : '', true),
    createField('Claude API', metadata.claudeApiProvider ? `\`${metadata.claudeApiProvider}\`` : '', true),
    createField('Claude Working Dir', metadata.claudeWorkingDirectory ? `\`${compactPath(metadata.claudeWorkingDirectory)}\`` : '', false),
    createField('Claude Artifacts', metadata.claudeTaskArtifactsPath ? `\`${compactPath(metadata.claudeTaskArtifactsPath)}\`` : '', false),
    createField('Claude Artifacts Writable', metadata.claudeTaskArtifactWritable !== undefined ? (metadata.claudeTaskArtifactWritable ? 'Yes' : 'No') : '', true),
    createField('Log Path', metadata.logPath ? `\`${compactPath(metadata.logPath)}\`` : '', true),
    createField('Checkpoint Root', metadata.checkpointRoot ? `\`${compactPath(metadata.checkpointRoot)}\`` : '', true),
    createField('Claude Session', metadata.claudeSessionId ? `\`${metadata.claudeSessionId}\`` : '', true),
    createField('Payload Path', metadata.taskPayloadPath ? `\`${compactPath(metadata.taskPayloadPath)}\`` : '', false),
    createField('Prompt Path', metadata.promptPath ? `\`${compactPath(metadata.promptPath)}\`` : '', false),
    createField('Result Path', metadata.resultPath ? `\`${compactPath(metadata.resultPath)}\`` : '', false),
    createField('Bridge Export', metadata.bridgeExportPath ? `\`${compactPath(metadata.bridgeExportPath)}\`` : '', false),
    createField('Supabase Cache', metadata.supabaseCachePath ? `\`${compactPath(metadata.supabaseCachePath)}\`` : '', false),
    createField('Session Count', metadata.sessionCount !== undefined ? `\`${metadata.sessionCount}\`` : '', true),
    createField('Latest Session', metadata.latestSessionId ? `\`${metadata.latestSessionId}\`` : '', true),
    createField('Latest Checkpoint Age', metadata.latestAgeMs ? formatDurationMs(metadata.latestAgeMs) : '', true),
    createField('Log Files', metadata.fileCount !== undefined ? `\`${metadata.fileCount}\`` : '', true),
    createField('Total Log Size', metadata.totalBytes !== undefined ? formatBytes(metadata.totalBytes) : '', true),
    createField('Stale Logs', metadata.staleCount !== undefined ? `\`${metadata.staleCount}\`` : '', true),
    createField('Largest Log', metadata.largestFileName ? `${metadata.largestFileName} (${formatBytes(metadata.largestFileBytes)})` : '', false),
    createField('Bridge Notes', metadata.manifestEntries !== undefined ? `\`${metadata.manifestEntries}\`` : '', true),
    createField('Latest Bridge Age', metadata.latestBridgeAgeMs ? formatDurationMs(metadata.latestBridgeAgeMs) : '', true),
    createField('Branch', metadata.branch ? `\`${metadata.branch}\`` : '', true),
    createField('Upstream', metadata.upstream ? `\`${metadata.upstream}\`` : '', true),
    createField('Ahead', metadata.aheadCount !== undefined ? `\`${metadata.aheadCount}\`` : '', true),
    createField('Behind', metadata.behindCount !== undefined ? `\`${metadata.behindCount}\`` : '', true),
    createField('Pull Applied', metadata.didPull !== undefined ? (metadata.didPull ? 'Yes' : 'No') : '', true),
    createField('Discord Bot Restarted', metadata.restartedDiscordBot !== undefined ? (metadata.restartedDiscordBot ? 'Yes' : 'No') : '', true),
    createField('Worker Restarted', metadata.restartedRufloWorkerService !== undefined ? (metadata.restartedRufloWorkerService ? 'Yes' : 'No') : '', true),
    createField('Healthy Checks', metadata.healthyCount !== undefined ? `\`${metadata.healthyCount}\`` : '', true),
    createField('Unhealthy Checks', metadata.unhealthyCount !== undefined ? `\`${metadata.unhealthyCount}\`` : '', true),
    createField(
      'Launch Agents',
      checkedAgents.length > 0
        ? checkedAgents.map((entry) => `- ${entry.label}: ${entry.state}`).join('\n')
        : '',
      false
    ),
    createField(
      'Health Warnings',
      unhealthyChecks.length > 0
        ? unhealthyChecks.map((entry) => `- ${entry.label || entry.action || 'unknown'}: ${entry.severity || 'unknown'}${entry.state ? ` (${entry.state})` : ''}`).join('\n')
        : '',
      false
    ),
    createField(
      'Top Folders',
      topFolders.length > 0
        ? topFolders.map((entry) => `- ${compactPath(entry.path)}: ${formatKilobytes(entry.sizeKb)}`).join('\n')
        : '',
      false
    ),
    createField('Files', files.length > 0 ? files.map((entry) => `- ${entry}`).join('\n') : '', false),
    createField('Next Step', nextSteps.length > 0 ? nextSteps.map((entry) => `- ${entry}`).join('\n') : '', false),
  ].filter(Boolean);
}

function executionResultColor(metadata = {}) {
  const state = String(metadata.state || '').trim().toLowerCase();
  const severity = String(metadata.severity || '').trim().toLowerCase();

  if (
    severity === 'blocked' ||
    severity === 'critical' ||
    state === 'failed' ||
    state === 'not running' ||
    state === 'stopped' ||
    state.startsWith('blocked')
  ) {
    return EMBED_COLORS.alert;
  }

  if (severity === 'warning') {
    return EMBED_COLORS.warning;
  }

  return EMBED_COLORS.execution;
}

function compactExecutionResultBody(outboundEvent) {
  const taskId = outboundEvent?.metadata?.taskId || '';
  const body = String(outboundEvent?.body || '').trim();
  if (!body) {
    return '';
  }

  if (taskId) {
    const escapedTaskId = taskId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    return body.replace(new RegExp(`^Execution result for ${escapedTaskId}:\\s*`, 'u'), '');
  }

  return body.replace(/^Execution result:\s*/u, '');
}

function formatExecutionResult(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const compactBody = compactExecutionResultBody(outboundEvent);

  return lines(
    `**Execution Result**`,
    metadata.taskId ? `Task: \`${metadata.taskId}\`` : '',
    metadata.action ? `Action: \`${metadata.action}\`` : '',
    metadata.state ? `State: \`${metadata.state}\`` : '',
    metadata.activeCount !== undefined ? `Active Count: \`${metadata.activeCount}\`` : '',
    metadata.processCount !== undefined ? `Process Count: \`${metadata.processCount}\`` : '',
    metadata.runs !== undefined ? `Runs: \`${metadata.runs}\`` : '',
    metadata.lastExitCode !== undefined ? `Last Exit Code: \`${metadata.lastExitCode}\`` : '',
    metadata.tailscaleIp ? `Tailscale IP: \`${metadata.tailscaleIp}\`` : '',
    metadata.dnsName ? `Tailscale DNS: \`${metadata.dnsName}\`` : '',
    metadata.dockerContext ? `Docker Context: \`${metadata.dockerContext}\`` : '',
    metadata.dockerServerVersion ? `Docker Version: \`${metadata.dockerServerVersion}\`` : '',
    metadata.colimaState ? `Colima State: \`${metadata.colimaState}\`` : '',
    metadata.activeModelCount !== undefined ? `Active Models: \`${metadata.activeModelCount}\`` : '',
    metadata.mountPoint ? `Mount Point: \`${metadata.mountPoint}\`` : '',
    metadata.availableKb !== undefined ? `Available KB: \`${metadata.availableKb}\`` : '',
    metadata.totalKb !== undefined ? `Total KB: \`${metadata.totalKb}\`` : '',
    metadata.githubHost ? `GitHub Host: \`${metadata.githubHost}\`` : '',
    metadata.githubAccount ? `GitHub Account: \`${metadata.githubAccount}\`` : '',
    metadata.gitProtocol ? `Git Protocol: \`${metadata.gitProtocol}\`` : '',
    metadata.logPath ? `Log Path: \`${metadata.logPath}\`` : '',
    compactBody || outboundEvent.body || ''
  );
}

function buildExecutionResultPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const compactBody = compactExecutionResultBody(outboundEvent);
  return buildEmbedPayload({
    color: executionResultColor(metadata),
    title: taskTitle('Execution Result', metadata.taskId),
    description: compactBody || outboundEvent.body || 'Execution result received.',
    fields: buildExecutionFields(metadata),
    footerText: 'Ruflo executor',
  });
}

function formatRejectedOperator(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const humanName = [metadata.displayName, metadata.username].filter(Boolean).join(' / ');

  return lines(
    `**Unauthorized Operator Blocked**`,
    metadata.mention ? `User: ${metadata.mention}` : '',
    humanName ? `Identity: ${humanName}` : '',
    metadata.authorId ? `User ID: \`${metadata.authorId}\`` : '',
    outboundEvent.body || ''
  );
}

function buildRejectedOperatorPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const humanName = [metadata.displayName, metadata.username].filter(Boolean).join(' / ');

  return buildEmbedPayload({
    color: EMBED_COLORS.alert,
    title: 'Unauthorized Operator Blocked',
    description: outboundEvent.body || 'Rejected an unauthorized operator message.',
    fields: [
      createField('User', metadata.mention || '', false),
      createField('Identity', humanName || '', false),
      createField('User ID', metadata.authorId ? `\`${metadata.authorId}\`` : '', false),
    ].filter(Boolean),
    footerText: 'Ruflo access control',
  });
}

function formatSystemLog(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  return lines(
    `**System Log**`,
    outboundEvent.body || '',
    metadata.taskId ? `Task: \`${metadata.taskId}\`` : '',
    metadata.action ? `Action: \`${metadata.action}\`` : '',
    metadata.state ? `State: \`${metadata.state}\`` : '',
    metadata.decision ? `Decision: \`${metadata.decision}\`` : '',
    metadata.reason ? `Reason: ${metadata.reason}` : ''
  );
}

function buildSystemLogPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  return buildEmbedPayload({
    color: EMBED_COLORS.system,
    title: metadata.taskId ? `System Log · ${metadata.taskId}` : 'System Log',
    description: outboundEvent.body || 'Runtime system event.',
    fields: [
      createField('Task', metadata.taskId ? `\`${metadata.taskId}\`` : '', true),
      createField('Action', metadata.action ? `\`${metadata.action}\`` : '', true),
      createField('State', metadata.state ? `\`${metadata.state}\`` : '', true),
      createField('Decision', metadata.decision ? `\`${metadata.decision}\`` : '', true),
      createField('Reason', metadata.reason || '', false),
    ].filter(Boolean),
    footerText: 'Ruflo runtime',
  });
}

function formatAlert(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const label = String(metadata.severity || '').trim().toLowerCase() === 'warning' ? 'Warning' : 'Alert';
  return lines(
    `**${label}**`,
    outboundEvent.body || '',
    Array.isArray(metadata.warnings) && metadata.warnings.length > 0
      ? `Warnings: ${metadata.warnings.join(' | ')}`
      : ''
  );
}

function buildAlertPayload(outboundEvent) {
  const metadata = outboundEvent.metadata || {};
  const isWarning = String(metadata.severity || '').trim().toLowerCase() === 'warning';
  return buildEmbedPayload({
    color: isWarning ? EMBED_COLORS.warning : EMBED_COLORS.alert,
    title: isWarning ? '⚠️ Warning' : '⚠️ Alert',
    description: outboundEvent.body || 'Runtime alert.',
    fields: [
      createField(
        'Warnings',
        Array.isArray(metadata.warnings) && metadata.warnings.length > 0 ? metadata.warnings.join('\n') : '',
        false
      ),
      createField('Task', metadata.taskId ? `\`${metadata.taskId}\`` : '', true),
      createField('Action', metadata.action ? `\`${metadata.action}\`` : '', true),
      createField('Agent', metadata.targetAgent ? `\`${metadata.targetAgent}\`` : '', true),
      createField('Reason', metadata.reason || '', false),
      createField('Recovery Command', metadata.recoveryCommand ? `\`${metadata.recoveryCommand}\`` : '', false),
    ].filter(Boolean),
    footerText: 'Ruflo alerts',
  });
}

export function buildHealthNotificationDiscordPayload(notification) {
  const isRecovery = notification.kind === 'recovery';
  return buildEmbedPayload({
    color: isRecovery ? EMBED_COLORS.success : notification.severity === 'warning' ? EMBED_COLORS.warning : EMBED_COLORS.alert,
    title: `${isRecovery ? '✅' : '⚠️'} ${isRecovery ? 'Runtime Health Recovered' : 'Runtime Health Alert'} · ${notification.label}`,
    description: notification.summary || `${notification.label} state changed.`,
    fields: [
      createField('Severity', notification.severity ? `\`${notification.severity}\`` : '', true),
      createField('State', notification.state ? `\`${notification.state}\`` : '', true),
      createField('Details', Array.isArray(notification.details) && notification.details.length > 0 ? notification.details.join('\n') : '', false),
      createField('Recovery Command', notification.recoveryCommand ? `\`${notification.recoveryCommand}\`` : '', false),
    ].filter(Boolean),
    footerText: 'Ruflo health monitor',
  });
}

export function buildAcknowledgementDiscordPayload(result, acknowledgementText, config = {}) {
  if (result?.route === 'help' && result.helpTopic === 'commands') {
    const help = buildCommandHelpDescriptor(config);
    return buildNoticeDiscordPayload({
      title: help.title,
      description: help.description,
      fields: help.fields.map((field) => createField(field.name, field.value, field.inline)).filter(Boolean),
      footerText: help.footerText,
    });
  }

  if (result?.route === 'command' && (result.normalizedTask || (Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0))) {
    const tasks = Array.isArray(result.normalizedTasks) && result.normalizedTasks.length > 0
      ? result.normalizedTasks
      : [result.normalizedTask];
    const task = tasks[0];
    const runtimeSummary = result.commandRuntimeSummary || {};

    if (tasks.length > 1) {
      return buildEmbedPayload({
        color: EMBED_COLORS.success,
        title: `Commands Accepted · ${tasks.length} tasks`,
        description: acknowledgementText || `Accepted ${tasks.length} tasks.`,
        fields: [
          createField('Tasks', `\`${tasks.length}\``, true),
          createField('Starting now', runtimeSummary.startingCount !== undefined ? `\`${runtimeSummary.startingCount}\`` : '', true),
          createField('Queued', runtimeSummary.queuedCount !== undefined ? `\`${runtimeSummary.queuedCount}\`` : '', true),
          createField('Awaiting approval', runtimeSummary.awaitingApprovalCount !== undefined ? `\`${runtimeSummary.awaitingApprovalCount}\`` : '', true),
          createField('No executor', runtimeSummary.noExecutorCount !== undefined ? `\`${runtimeSummary.noExecutorCount}\`` : '', true),
          createField(
            'Task IDs',
            tasks.map((item) => `- \`${item.task_id}\` · ${item.summary}`).join('\n'),
            false
          ),
        ].filter(Boolean),
        footerText: task?.submitted_by ? `Submitted by ${task.submitted_by}` : 'Ruflo intake',
      });
    }

    return buildEmbedPayload({
      color: EMBED_COLORS.success,
      title: taskTitle('Command Accepted', task.task_id),
      description: acknowledgementText || `Accepted ${task.task_id}.`,
      fields: [
        createField('Agent', task.target_agent ? `\`${task.target_agent}\`` : '', true),
        createField('Domain', task.domain ? `\`${task.domain}\`` : '', true),
        createField('Priority', task.priority ? `\`${task.priority}\`` : '', true),
        createField('Approval', task.approval_required ? 'Required' : 'Not required', true),
        createField('Images', task.image_attachment_count ? `\`${task.image_attachment_count}\`` : '', true),
        createField('Execution', runtimeSummary.awaitingApprovalCount ? 'Waiting approval' : runtimeSummary.queuedCount ? 'Queued behind active work' : runtimeSummary.startingCount ? 'Starting now' : runtimeSummary.noExecutorCount ? 'No executor yet' : '', true),
        createField('Queue ahead', runtimeSummary.queueBacklogBefore ? `\`${runtimeSummary.queueBacklogBefore}\`` : '', true),
        createField('Image Files', Array.isArray(task.image_attachment_filenames) ? task.image_attachment_filenames.join('\n') : '', false),
      ].filter(Boolean),
      footerText: task.submitted_by ? `Submitted by ${task.submitted_by}` : 'Ruflo intake',
    });
  }

  if (result?.route === 'approval' && result.decision?.taskId) {
    return buildEmbedPayload({
      color: result.decision.decision === 'approve' ? EMBED_COLORS.success : EMBED_COLORS.blocked,
      title: taskTitle('Approval Recorded', result.decision.taskId),
      description: acknowledgementText || `Registered ${result.decision.decision} for ${result.decision.taskId}.`,
      fields: [
        createField('Decision', result.decision.decision ? `\`${result.decision.decision}\`` : '', true),
        createField('Reason', result.decision.reason || '', false),
      ].filter(Boolean),
      footerText: 'Ruflo approval gate',
    });
  }

  if (result?.route === 'voice') {
    return buildEmbedPayload({
      color: EMBED_COLORS.voice,
      title: 'Voice Note Accepted',
      description: acknowledgementText || 'Voice note accepted. Transcription handoff prepared.',
      footerText: 'Ruflo transcription intake',
    });
  }

  return buildNoticeDiscordPayload({
    title: 'Notice',
    description: acknowledgementText || 'Runtime acknowledgement.',
  });
}

export function buildNoticeDiscordPayload({
  title,
  description,
  color = EMBED_COLORS.system,
  fields = [],
  footerText = 'Ruflo runtime',
  content = '',
  allowedMentions = undefined,
}) {
  return buildEmbedPayload({
    color,
    title,
    description,
    fields: fields.filter(Boolean),
    footerText,
    content,
    allowedMentions,
  });
}

export function formatOutboundEventMessage(outboundEvent) {
  let formatted = '';

  switch (outboundEvent.type) {
    case 'parsed_task_preview':
      formatted = formatParsedTaskPreview(outboundEvent);
      break;
    case 'task_context_update':
      formatted = outboundEvent.body || 'Task context updated.';
      break;
    case 'memory_writeback_candidates':
      formatted = formatMemoryWriteBackCandidates(outboundEvent);
      break;
    case 'approval_request':
      formatted = formatApprovalRequest(outboundEvent);
      break;
    case 'task_queue_update':
      formatted = formatQueueUpdate(outboundEvent);
      break;
    case 'approval_outcome':
      formatted = outboundEvent.channelKey === 'systemLogs'
        ? formatSystemLog(outboundEvent)
        : formatQueueUpdate(outboundEvent);
      break;
    case 'voice_transcript':
      formatted = formatVoiceTranscript(outboundEvent);
      break;
    case 'task_execution_result':
      formatted = formatExecutionResult(outboundEvent);
      break;
    case 'rejected_message':
      formatted = formatRejectedOperator(outboundEvent);
      break;
    case 'voice_transcription_failed':
    case 'task_dispatch_blocked':
    case 'task_execution_blocked':
    case 'task_execution_paused':
    case 'task_execution_failed':
    case 'invalid_approval_message':
    case 'image_command_text_missing':
    case 'voice_attachment_missing':
    case 'unexpected_channel':
      formatted = formatAlert(outboundEvent);
      break;
    case 'accepted_command':
    case 'accepted_transcribed_command':
    case 'task_execution_started':
    case 'task_execution_completed':
    case 'voice_command_received':
      formatted = formatSystemLog(outboundEvent);
      break;
    default:
      formatted = outboundEvent.body || outboundEvent.type || 'Event received.';
      break;
  }

  return truncateMessage(formatted);
}

export function buildOutboundEventDiscordPayload(outboundEvent) {
  switch (outboundEvent.type) {
    case 'parsed_task_preview':
      return buildParsedTaskPayload(outboundEvent);
    case 'task_context_update':
      return buildTaskContextUpdatePayload(outboundEvent);
    case 'memory_writeback_candidates':
      return buildMemoryWriteBackPayload(outboundEvent);
    case 'approval_request':
      return buildApprovalRequestPayload(outboundEvent);
    case 'task_queue_update':
      return buildQueueUpdatePayload(outboundEvent);
    case 'approval_outcome':
      return outboundEvent.channelKey === 'systemLogs'
        ? buildSystemLogPayload(outboundEvent)
        : buildQueueUpdatePayload(outboundEvent);
    case 'voice_transcript':
      return buildVoiceTranscriptPayload(outboundEvent);
    case 'task_execution_result':
      return buildExecutionResultPayload(outboundEvent);
    case 'rejected_message':
      return buildRejectedOperatorPayload(outboundEvent);
    case 'voice_transcription_failed':
    case 'task_dispatch_blocked':
    case 'task_execution_blocked':
    case 'task_execution_paused':
    case 'task_execution_failed':
    case 'invalid_approval_message':
    case 'image_command_text_missing':
    case 'voice_attachment_missing':
    case 'unexpected_channel':
      return buildAlertPayload(outboundEvent);
    case 'accepted_command':
    case 'accepted_transcribed_command':
    case 'task_execution_started':
    case 'task_execution_completed':
    case 'voice_command_received':
      return buildSystemLogPayload(outboundEvent);
    default:
      return {
        content: formatOutboundEventMessage(outboundEvent),
      };
  }
}
