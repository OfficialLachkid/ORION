import { createGmailDraft, getGmailDraft, sendGmailDraft, updateGmailDraft } from '../../gmail/src/send.mjs';
import { ensureOptOutFooter, hasOptOutFooter } from '../../gmail/src/opt-out-footer.mjs';

// Stamps leads.last_contacted_at = now so the morning-shift's
// cross-run per-domain cap (outreach-presend-checks.mjs) can see
// prior sends. Best-effort — the email is already out by the time
// this runs, so a Supabase hiccup must NOT fail the task. A failure
// just means tomorrow's sends might duplicate; worst case stays
// bounded by the in-batch dedup + cap.
async function stampLeadLastContactedAt(task, config, options) {
  const leadId = String(task?.lead_id || '').trim();
  if (!leadId) return; // non-outreach gmail send, nothing to stamp
  const supabaseUrl = config?.env?.SUPABASE_URL || '';
  const apiKey = config?.env?.SUPABASE_SECRET_KEY || config?.env?.SUPABASE_PUBLISHABLE_KEY || '';
  if (!supabaseUrl || !apiKey) {
    process.stderr.write(
      `[gmail-executor] stamp last_contacted_at skipped for lead ${leadId}: Supabase config missing\n`,
    );
    return;
  }
  const leadsTable = config?.env?.LEADGEN_LEADS_TABLE || 'leads';
  const fetchImpl = options?.fetch || options?.fetchImpl || fetch;
  const url = new URL(
    `/rest/v1/${leadsTable}?id=eq.${encodeURIComponent(leadId)}`,
    supabaseUrl,
  );
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'PATCH',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ last_contacted_at: new Date().toISOString() }),
    });
    if (!response.ok) {
      const bodyText = typeof response.text === 'function' ? await response.text().catch(() => '') : '';
      process.stderr.write(
        `[gmail-executor] stamp last_contacted_at failed for lead ${leadId}: HTTP ${response.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `[gmail-executor] stamp last_contacted_at threw for lead ${leadId}: ${error?.message || error}\n`,
    );
  }
}

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

  // Opt-out footer guard (mandatory pre-send step, 2026-09-28): read the
  // current Gmail draft body and, if it's missing an opt-out phrase,
  // patch the draft with an appended PS line before firing drafts.send.
  // Covers the ~400 drafts that were composed BEFORE the qualifier
  // prompt started emitting the PS line, plus any operator hand-edit
  // that accidentally stripped it.
  //
  // Fails CLOSED (2026-10-27 operator decision): if the read or update
  // fails for any reason other than a 404 (draft already gone — the
  // send-side already-sent detection owns that path), we refuse to
  // send. Previously this was a best-effort try/catch that printed a
  // warning and sent anyway, which caused 5 cold emails to go out
  // without the opt-out footer on 2026-10-27 after a round-trip
  // "Invalid To header" bug in buildRfc822Message. Compliance >
  // throughput: if the guard can't confirm the footer is in place,
  // the operator sees the error and the task retries the next
  // morning.
  const current = await getGmailDraft(config.env, draftId, options).catch((readError) => {
    // Draft genuinely gone → let the send call surface the standard
    // already-sent / 404 path. Any other read failure fails the task.
    if (isDraftAlreadyGoneError(readError)) return null;
    throw new Error(
      `Opt-out footer guard: Gmail draft read failed for ${draftId}: ${readError?.message || readError}`,
    );
  });
  if (current && !hasOptOutFooter(current.bodyText)) {
    const patched = ensureOptOutFooter(current.bodyText);
    await updateGmailDraft(config.env, draftId, {
      to: current.to,
      subject: current.subject,
      bodyText: patched,
      fromEmail: current.fromEmail,
      fromName: current.fromName,
      replyTo: current.replyTo,
      inReplyTo: current.inReplyTo,
      references: current.references,
      threadId: current.threadId,
    }, options).catch((updateError) => {
      throw new Error(
        `Opt-out footer guard: Gmail draft update failed for ${draftId}: ${updateError?.message || updateError}`,
      );
    });
  }

  let result;
  try {
    result = await sendGmailDraft(config.env, draftId, options);
  } catch (error) {
    if (isDraftAlreadyGoneError(error)) {
      // The draft was already sent (likely the operator fired it from the
      // Gmail UI). Still stamp last_contacted_at — the outreach happened,
      // and the per-domain cap check needs to see it tomorrow.
      await stampLeadLastContactedAt(task, config, options);
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

  await stampLeadLastContactedAt(task, config, options);

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
