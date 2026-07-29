// Keeps the Discord approval message in sync with the current Gmail draft.
// Runs in the night shift. Two concerns, one HTTP fetch per draft:
//   1. If the draft is gone → it was sent (or deleted) manually in Gmail.
//      Gmail deletes drafts the instant they're sent, so a persisted pending
//      send-task whose draftId no longer exists means the email already went
//      out by hand. Mark the lead `sent`, flip the Discord card to a resolved
//      "sent" state (buttons removed), drop the pending task.
//   2. If the draft still exists but its subject/body no longer match our
//      stored snapshot → the operator edited the draft in Gmail. Mirror the
//      new content into the pending-task store AND rewrite the Discord
//      approval embed's Subject/Body fields, so the card reflects what would
//      actually be sent if the operator clicks Send Email. (Approve sends the
//      current Gmail draft by ID — Gmail sends the edited version regardless
//      — so the risk here is a stale-looking preview, not a wrong send.)
import { getGmailDraft } from '../../services/gmail/src/send.mjs';
import { loadPersistedPendingTasks, removePersistedPendingTask, upsertPersistedPendingTask } from '../../services/discord-bot/src/pending-task-store.mjs';
import { updateLead } from './leadgen-supabase.mjs';

const DISCORD_API = 'https://discord.com/api/v10';

async function findApprovalMessage(config, taskId) {
  // Outreach drafts live in #outreach-agent; generic /email-draft ones in
  // #approvals. Check both, newest first.
  const channelIds = [config.channelIds.outreachAgent, config.channelIds.approvals].filter(Boolean);
  for (const channelId of channelIds) {
    try {
      const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=50`, {
        headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}` },
      });
      const msgs = await res.json();
      const match = Array.isArray(msgs)
        ? msgs.find((m) => m.embeds?.[0]?.title?.includes(taskId) && m.embeds[0].title.includes('Approval Needed'))
        : null;
      if (match) {
        return { channelId, message: match };
      }
    } catch {
      // keep trying the next channel
    }
  }
  return null;
}

async function markDiscordMessageSent(config, taskId) {
  const found = await findApprovalMessage(config, taskId);
  if (!found) {
    return false;
  }
  const original = found.message.embeds[0];
  const updatedEmbed = {
    ...original,
    title: `📨 Sent (manually) · ${taskId}`,
    color: 0x57F287,
  };
  try {
    await fetch(`${DISCORD_API}/channels/${found.channelId}/messages/${found.message.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${found.message.content || ''}\n\n**This draft was sent manually in Gmail — resolved automatically.**`.trim(),
        embeds: [updatedEmbed],
        components: [], // remove the Send/Give-Feedback buttons
      }),
    });
    return true;
  } catch {
    return false;
  }
}

function normalizeForCompare(value) {
  return String(value || '').replace(/\r\n/gu, '\n').replace(/\r/gu, '\n').trim();
}

// Rewrites only the Subject and Body fields on an existing approval embed —
// preserves color, title, description, and every other field/link. Keeps the
// approval buttons intact (still waiting for the operator's click).
function rewriteApprovalEmbedFields(originalEmbed, subject, bodyText) {
  const fields = Array.isArray(originalEmbed.fields) ? originalEmbed.fields.slice() : [];
  const setField = (name, value) => {
    const idx = fields.findIndex((f) => f?.name === name);
    if (idx === -1) {
      return;
    }
    fields[idx] = { ...fields[idx], value };
  };
  if (subject) {
    setField('Subject', subject);
  }
  if (bodyText) {
    // Discord embed field values cap at 1024 chars — the original builder
    // truncated identically, so mirror that ceiling here to avoid a 400.
    const clipped = bodyText.length > 1024 ? `${bodyText.slice(0, 1021)}...` : bodyText;
    setField('Body', clipped);
  }
  return { ...originalEmbed, fields };
}

async function updateApprovalEmbedContent(config, taskId, subject, bodyText) {
  const found = await findApprovalMessage(config, taskId);
  if (!found) {
    return false;
  }
  const original = found.message.embeds?.[0];
  if (!original) {
    return false;
  }
  const updatedEmbed = rewriteApprovalEmbedFields(original, subject, bodyText);
  const stampedContent = String(found.message.content || '').replace(/\n{0,2}\*\*Edited in Gmail on [^\*]+\*\*$/u, '').trim();
  const stamp = `**Edited in Gmail on ${new Date().toISOString().slice(0, 10)} — preview updated.**`;
  try {
    await fetch(`${DISCORD_API}/channels/${found.channelId}/messages/${found.message.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${config.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: stampedContent ? `${stampedContent}\n\n${stamp}` : stamp,
        embeds: [updatedEmbed, ...(found.message.embeds.slice(1) || [])],
        // Deliberately DO NOT touch components — approval buttons stay live.
      }),
    });
    return true;
  } catch {
    return false;
  }
}

// Persists a subject/body change back into the pending-task store so any later
// consumer (send flow, follow-up drafter) sees the current draft, not the
// original snapshot.
function syncPendingTaskContent(config, task, subject, bodyText, bodyPreview) {
  const nextTask = {
    ...task,
    gmail_draft: {
      ...(task.gmail_draft || {}),
      subject,
      bodyText,
      bodyPreview,
    },
    email_request: {
      ...(task.email_request || {}),
      subject,
      bodyText,
    },
  };
  upsertPersistedPendingTask(config, nextTask);
}

// Returns { sent, edited } counts. `sent` = drafts found already-sent and
// cleaned up; `edited` = still-pending drafts whose subject/body changed in
// Gmail and were mirrored back to the pending store + Discord card.
export async function reconcileDrafts(config) {
  if (!config.env.DISCORD_BOT_TOKEN) {
    return { sent: 0, edited: 0 };
  }

  const pending = loadPersistedPendingTasks(config).filter((t) => t?.gmail_draft?.draftId);
  let sent = 0;
  let edited = 0;

  for (const task of pending) {
    let current;
    try {
      current = await getGmailDraft(config.env, task.gmail_draft.draftId);
    } catch {
      // Transient lookup failure — leave this one for the next run rather
      // than guessing what happened.
      continue;
    }

    if (current === null) {
      // Draft is gone → it was sent (or deleted) manually. Reconcile.
      if (task.lead_id) {
        try {
          await updateLead(task.lead_id, { status: 'sent', sent_at: new Date().toISOString() });
        } catch {
          // lead-row sync is reconcilable later from ops metrics
        }
      }
      await markDiscordMessageSent(config, task.task_id);
      removePersistedPendingTask(config, task.task_id);
      sent += 1;
      continue;
    }

    // Draft still exists — check if the operator edited it in Gmail.
    const storedSubject = normalizeForCompare(task.gmail_draft.subject);
    const storedBody = normalizeForCompare(task.gmail_draft.bodyText);
    const currentSubject = normalizeForCompare(current.subject);
    const currentBody = normalizeForCompare(current.bodyText);

    const subjectChanged = currentSubject && currentSubject !== storedSubject;
    // Only accept a body change when Gmail actually returned decoded content
    // — an empty decode (unknown MIME shape, decode failure) must not silently
    // wipe our stored preview.
    const bodyChanged = currentBody.length > 0 && currentBody !== storedBody;

    if (!subjectChanged && !bodyChanged) {
      continue;
    }

    const nextSubject = subjectChanged ? current.subject : task.gmail_draft.subject;
    const nextBodyText = bodyChanged ? current.bodyText : task.gmail_draft.bodyText;
    const nextBodyPreview = bodyChanged ? current.bodyPreview : task.gmail_draft.bodyPreview;

    syncPendingTaskContent(config, task, nextSubject, nextBodyText, nextBodyPreview);
    const patched = await updateApprovalEmbedContent(config, task.task_id, nextSubject, nextBodyText);
    if (patched) {
      edited += 1;
    }
  }

  return { sent, edited };
}

// Back-compat wrapper — the older name only reported the manual-send count.
// New callers should use `reconcileDrafts` directly to see both counts.
export async function reconcileManuallySentDrafts(config) {
  const { sent } = await reconcileDrafts(config);
  return sent;
}
