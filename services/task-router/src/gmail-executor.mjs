import { createGmailDraft, sendGmailDraft } from '../../gmail/src/send.mjs';

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function summarizeSendApproval(task, draft = {}) {
  const to = normalizeWhitespace(draft.to || task?.email_request?.to);
  const subject = normalizeWhitespace(draft.subject || task?.email_request?.subject);
  // Lead-outreach tasks (run-lead-qualification.mjs) set these so the
  // approval message names the actual business, clickable through to their
  // site — plain recipient email is easy to lose track of at outreach
  // volume. Falls back cleanly for any non-lead gmail_create_draft caller.
  const businessName = normalizeWhitespace(task?.lead_business_name);
  const businessLabel = businessName
    ? (task?.lead_source_url ? `[${businessName}](${task.lead_source_url})` : businessName)
    : '';

  if (!to && !subject) {
    return businessLabel ? `Approve to send the drafted email to ${businessLabel}.` : 'Approve to send the drafted email.';
  }

  // Subject is intentionally NOT repeated here — the approval embed already
  // shows it in its own "Subject" field, so including it in the summary
  // (which becomes the embed description) made it appear twice (operator
  // request, 2026-07-23). The summary names only the recipient/business.
  const recipientLabel = businessLabel ? `${businessLabel} (${to || 'recipient'})` : (to || 'recipient');
  return `Send drafted email to ${recipientLabel}`;
}

function buildPendingSendTask(task, draftResult) {
  return {
    ...task,
    status: 'awaiting_approval',
    approval_required: true,
    approval_reason: 'gmail_send_draft: drafted email is waiting for explicit send approval',
    runtime_action: 'gmail_send_draft',
    automation_type: 'gmail_send_draft',
    gmail_draft: {
      draftId: draftResult.draftId,
      messageId: draftResult.messageId,
      threadId: draftResult.threadId,
      to: draftResult.to,
      subject: draftResult.subject,
      bodyText: draftResult.bodyText,
      bodyPreview: draftResult.bodyPreview,
    },
    summary: summarizeSendApproval(task, draftResult),
  };
}

export function describeExplicitExecutionAction(task) {
  const action = String(task?.runtime_action || '').trim();
  if (action === 'gmail_create_draft') {
    return {
      action,
      description: 'Create a Gmail draft and hold it for explicit send approval.',
    };
  }

  if (action === 'gmail_send_draft') {
    return {
      action,
      description: 'Send an approved Gmail draft.',
    };
  }

  return null;
}

async function executeGmailCreateDraft(task, config, options = {}) {
  const request = task?.email_request;
  if (!request?.to || !request?.subject || !request?.bodyText) {
    throw new Error('Gmail draft task is missing to, subject, or bodyText fields.');
  }

  const draft = await createGmailDraft(config.env, request, options);
  const pendingApprovalTask = buildPendingSendTask(task, draft);

  return {
    rawStdout: '',
    report: {
      state: 'awaiting_approval',
      awaitingApproval: true,
      awaitingApprovalAction: 'gmail_send_draft',
      severity: 'warning',
      summary: `Gmail draft created for ${draft.to}. Approve to send or reject with revision feedback.`,
      emailTo: draft.to,
      emailSubject: draft.subject,
      emailBody: draft.bodyText,
      emailPreview: draft.bodyPreview,
      gmailDraftId: draft.draftId,
      gmailMessageId: draft.messageId,
      gmailThreadId: draft.threadId,
      pendingApprovalTask,
    },
  };
}

// Gmail deletes a draft the moment it's sent — whether sent via our API or
// manually in the Gmail UI. So if the operator tweaks-and-sends the draft
// themselves in Gmail and later someone also clicks "Send Email" in Discord,
// the draftId is already gone: Gmail returns 404/notFound and NO duplicate
// email goes out. We detect that case and report it as an idempotent
// "already sent" success instead of an ugly failure — closing the operator's
// concern that a forgotten already-sent draft could be sent twice. It can't:
// the second attempt has nothing to send.
function isDraftAlreadyGoneError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('(404)')
    || message.includes('notfound')
    || message.includes('not found')
    || message.includes('requested entity was not found');
}

async function executeGmailSendDraftAction(task, config, options = {}) {
  const draftId = normalizeWhitespace(task?.gmail_draft?.draftId);
  if (!draftId) {
    throw new Error('Approved Gmail send task is missing the draft ID.');
  }

  const to = task?.gmail_draft?.to || task?.email_request?.to || 'recipient';

  let result;
  try {
    result = await sendGmailDraft(config.env, draftId, options);
  } catch (error) {
    if (isDraftAlreadyGoneError(error)) {
      return {
        rawStdout: '',
        report: {
          state: 'already_sent',
          severity: 'success',
          summary: `Draft to ${to} was already sent (likely manually in Gmail) — no duplicate was sent.`,
          emailTo: task?.gmail_draft?.to || task?.email_request?.to || '',
          emailSubject: task?.gmail_draft?.subject || task?.email_request?.subject || '',
          emailBody: task?.gmail_draft?.bodyText || task?.email_request?.bodyText || '',
          emailPreview: task?.gmail_draft?.bodyPreview || '',
          gmailDraftId: draftId,
          alreadySent: true,
        },
      };
    }
    throw error;
  }

  return {
    rawStdout: '',
    report: {
      state: 'sent',
      severity: 'success',
      summary: `Sent drafted email to ${to}.`,
      emailTo: task?.gmail_draft?.to || task?.email_request?.to || '',
      emailSubject: task?.gmail_draft?.subject || task?.email_request?.subject || '',
      emailBody: task?.gmail_draft?.bodyText || task?.email_request?.bodyText || '',
      emailPreview: task?.gmail_draft?.bodyPreview || '',
      gmailDraftId: draftId,
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
    },
  };
}

export async function executeGmailAction(action, task, config, options = {}) {
  if (action === 'gmail_create_draft') {
    return executeGmailCreateDraft(task, config, options);
  }

  if (action === 'gmail_send_draft') {
    return executeGmailSendDraftAction(task, config, options);
  }

  throw new Error(`Unsupported Gmail action '${action}'.`);
}
