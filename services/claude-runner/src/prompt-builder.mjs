function bulletList(items = []) {
  if (!Array.isArray(items) || items.length === 0) {
    return '- none';
  }

  return items.map((item) => `- ${item}`).join('\n');
}

export function buildClaudeTaskPrompt(payload) {
  const attachments = Array.isArray(payload?.task?.attachments) ? payload.task.attachments : [];
  const attachmentLines = attachments.map((attachment) => {
    const parts = [attachment.filename || 'unnamed attachment'];
    if (attachment.contentType) {
      parts.push(attachment.contentType);
    }
    if (attachment.url) {
      parts.push(attachment.url);
    }
    return parts.join(' | ');
  });

  const approvedBy = payload?.task?.approval?.approvedBy
    ? `${payload.task.approval.approvedBy}${payload.task.approval.approvedById ? ` (${payload.task.approval.approvedById})` : ''}`
    : 'not applicable';

  return [
    'You are the O.R.I.O.N. Claude worker running on the Mac mini.',
    'Operate inside the Ruflo repository and complete exactly one approved task.',
    'Use the structured bridge and Supabase cache first. Do not load the full vault unless the task explicitly requires it.',
    'If the task is blocked, risky, or missing context, stop cleanly and explain the minimum next step.',
    '',
    'Task Payload',
    `- Task ID: ${payload.taskId}`,
    `- Session ID: ${payload.sessionId}`,
    `- Target Agent: ${payload.task.targetAgent || 'orchestrator'}`,
    `- Domain: ${payload.task.domain || 'general'}`,
    `- Priority: ${payload.task.priority || 'normal'}`,
    `- Source Channel: ${payload.task.sourceChannel || 'commands'}`,
    `- Submitted By: ${payload.task.submittedBy || 'unknown'}`,
    `- Approval State: ${payload.task.approval.state || 'unknown'}`,
    `- Approved By: ${approvedBy}`,
    '',
    'Operator Request',
    payload.task.request || payload.task.summary || '',
    '',
    'Local Context Surfaces',
    `- Repo Root: ${payload.contextRefs.repoRoot}`,
    `- Bridge Export: ${payload.contextRefs.bridgeExportPath}`,
    `- Supabase Cache: ${payload.contextRefs.supabaseMemoryCachePath}`,
    `- Session Checkpoints: ${payload.contextRefs.sessionCheckpointPath}`,
    '',
    'Attachment Refs',
    bulletList(attachmentLines),
    '',
    'Execution Rules',
    '- Prefer direct repo, terminal, and browser-automation work over long prose.',
    '- Keep edits scoped to the request.',
    '- Mention every changed file in the FILES section.',
    '- Before you risk hitting a provider limit or losing context, stop early with STATUS: paused and leave a checkpoint-quality summary plus the immediate next step.',
    '- If you need human input or hit a limit, use STATUS: blocked or STATUS: paused.',
    '- If you create follow-up work, put only the immediate next step in NEXT_STEP.',
    '',
    'Return exactly this plain-text structure:',
    'STATUS: completed | blocked | paused',
    'SUMMARY: one concise sentence',
    'DETAILS:',
    '- first key outcome',
    'FILES:',
    '- path/to/file',
    'NEXT_STEP:',
    '- next immediate step',
  ].join('\n');
}
