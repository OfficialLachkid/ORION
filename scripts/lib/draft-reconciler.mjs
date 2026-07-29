// Keeps the Discord approval message in sync with the current Gmail draft.
// Runs in the night shift. Three concerns:
//   1. If the draft is gone → it was sent (or deleted) manually in Gmail.
//      Gmail deletes drafts the instant they're sent, so a persisted pending
//      send-task whose draftId no longer exists means the email already went
//      out by hand. Mark the lead `sent`, flip the Discord card to a resolved
//      "sent" state (buttons removed), drop the pending task.
//   2. If the draft still exists but its subject/body no longer match our
//      stored snapshot → the operator edited the draft in Gmail in place.
//      Mirror the new content into the pending-task store AND rewrite the
//      Discord approval embed's Subject/Body fields.
//   3. If a NEWER draft exists to the same recipient (mobile Gmail creates
//      a fresh draft under a new id when the operator opens & edits — the
//      TFG Loodgieters case, 2026-07-29): repoint the pending task to the
//      new draftId and sync content from it. Guarded — the new draft must
//      still start with a "Beste <business name>" greeting so we don't
//      accidentally repoint to an unrelated draft to the same recipient.
//
// Approve sends the current Gmail draft by ID — Gmail sends whatever the
// current content is regardless — so the risk here is a stale-looking
// preview, not a wrong send. Repointing DOES change which draftId gets sent
// on approval, so the guard on (3) matters.
import { getGmailDraft, listGmailDraftsSummary } from '../../services/gmail/src/send.mjs';
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

function normalizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const angle = value.match(/<([^>]+)>/u);
  return angle ? angle[1].trim() : value;
}

// Rewrites Subject / Body / Draft-id fields on an existing approval embed —
// preserves color, title, description, and every other field/link. Keeps the
// approval buttons intact (still waiting for the operator's click).
function rewriteApprovalEmbedFields(originalEmbed, { subject, bodyText, draftId } = {}) {
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
    const clipped = bodyText.length > 1024 ? `${bodyText.slice(0, 1021)}...` : bodyText;
    setField('Body', clipped);
  }
  if (draftId) {
    setField('Draft', `\`${draftId}\``);
  }
  return { ...originalEmbed, fields };
}

async function updateApprovalEmbedContent(config, taskId, { subject, bodyText, draftId, note } = {}) {
  const found = await findApprovalMessage(config, taskId);
  if (!found) {
    return false;
  }
  const original = found.message.embeds?.[0];
  if (!original) {
    return false;
  }
  const updatedEmbed = rewriteApprovalEmbedFields(original, { subject, bodyText, draftId });
  // Strip any previous edit stamp so we don't keep appending them across runs.
  const stampedContent = String(found.message.content || '')
    .replace(/\n{0,2}\*\*Edited in Gmail on [^*]+\*\*$/u, '')
    .trim();
  const stamp = `**Edited in Gmail on ${new Date().toISOString().slice(0, 10)}${note ? ` — ${note}` : ' — preview updated.'}**`;
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

// Persists a subject/body/draftId change back into the pending-task store
// so any later consumer (send flow, follow-up drafter) sees the current
// draft, not the original snapshot.
function syncPendingTaskContent(config, task, { subject, bodyText, bodyPreview, draftId } = {}) {
  const nextTask = {
    ...task,
    gmail_draft: {
      ...(task.gmail_draft || {}),
      ...(draftId ? { draftId } : {}),
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

// Guard against mis-repointing to an unrelated draft that happens to share
// the recipient. Real edits keep the "Beste <business name>," greeting and
// the "VBJ Services" sign-off — a wholly new independent draft usually
// won't have BOTH. Business-name match is case-insensitive on the first
// significant word (skips generic "B.V." / "LLC" style suffixes).
function looksLikeEditedVersion(bodyText, task) {
  const body = String(bodyText || '').toLowerCase();
  if (!body) return false;
  if (!body.includes('vbj services')) return false;
  const bizName = String(task.lead_business_name || '').trim();
  if (!bizName) return false;
  // Compare against the first two words of the business name (case-insensitive)
  // — enough to catch "TFG Loodgieters" while still matching if the operator
  // trimmed a trailing "b.v." or "Rotterdam" from the greeting.
  const firstWord = bizName.toLowerCase().split(/\s+/u).find((w) => w.length >= 3);
  return firstWord ? body.includes(firstWord) : false;
}

// Enumerates all current Gmail drafts once per reconcile run and returns a
// Map<recipient_email_lowercased, Array<{id, subject, internalDate}>>.
// Returns an empty Map on failure — callers treat that as "no supersessions
// detected" and fall back to the in-place-edit path.
async function buildDraftsByRecipient(config) {
  try {
    const summaries = await listGmailDraftsSummary(config.env, { maxResults: 200 });
    const map = new Map();
    for (const s of summaries) {
      const key = normalizeEmail(s.to);
      if (!key) continue;
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    return map;
  } catch {
    return new Map();
  }
}

// Given a pending task and the drafts-by-recipient index, find a draft that
// is (a) NEWER than the task's stored draft, (b) still to the same recipient,
// and (c) looks like an edited version of ours (`looksLikeEditedVersion`).
// Returns the id of the superseding draft, or null if none qualifies.
async function findSupersedingDraft(config, task, draftsByRecipient) {
  const recipient = normalizeEmail(task?.gmail_draft?.to || task?.email_request?.to);
  if (!recipient) return null;
  const candidates = (draftsByRecipient.get(recipient) || []).filter((d) => d.id !== task.gmail_draft.draftId);
  if (candidates.length === 0) return null;

  // Get our stored draft's internalDate so we only consider strictly-newer
  // candidates — an older draft to the same recipient is an old regeneration,
  // not an edit.
  const own = (draftsByRecipient.get(recipient) || []).find((d) => d.id === task.gmail_draft.draftId);
  const ownInternalDate = own ? own.internalDate : 0;
  const newer = candidates.filter((d) => d.internalDate > ownInternalDate);
  if (newer.length === 0) return null;

  // Pick the newest and verify content shape before repointing.
  newer.sort((a, b) => b.internalDate - a.internalDate);
  const best = newer[0];
  const detail = await getGmailDraft(config.env, best.id).catch(() => null);
  if (!detail || !looksLikeEditedVersion(detail.bodyText, task)) return null;
  return { id: best.id, subject: detail.subject, bodyText: detail.bodyText, bodyPreview: detail.bodyPreview };
}

// Returns { sent, edited, repointed } counts.
//   sent      = drafts found already-sent and cleaned up
//   edited    = still-pending drafts whose subject/body changed in place
//   repointed = pending tasks whose stored draftId was superseded by a
//               newer draft to the same recipient (mobile Gmail edit)
export async function reconcileDrafts(config) {
  if (!config.env.DISCORD_BOT_TOKEN) {
    return { sent: 0, edited: 0, repointed: 0 };
  }

  const pending = loadPersistedPendingTasks(config).filter((t) => t?.gmail_draft?.draftId);
  const draftsByRecipient = await buildDraftsByRecipient(config);
  let sent = 0;
  let edited = 0;
  let repointed = 0;

  for (const task of pending) {
    let current;
    try {
      current = await getGmailDraft(config.env, task.gmail_draft.draftId);
    } catch {
      // Transient lookup failure — leave for the next run rather than guessing.
      continue;
    }

    if (current === null) {
      // Draft is gone → sent or deleted manually.
      if (task.lead_id) {
        try {
          await updateLead(task.lead_id, { status: 'sent', sent_at: new Date().toISOString() });
        } catch {
          // reconcilable later from ops metrics
        }
      }
      await markDiscordMessageSent(config, task.task_id);
      removePersistedPendingTask(config, task.task_id);
      sent += 1;
      continue;
    }

    // Check for the mobile-Gmail edit pattern FIRST — a newer draft to the
    // same recipient wins over an unchanged stored draft. Doing this before
    // the in-place diff means we correctly repoint even when the stored
    // draft's body is byte-identical to what we wrote (typical, since mobile
    // never wrote to the stored draft at all).
    const superseding = await findSupersedingDraft(config, task, draftsByRecipient);
    if (superseding) {
      syncPendingTaskContent(config, task, {
        subject: superseding.subject,
        bodyText: superseding.bodyText,
        bodyPreview: superseding.bodyPreview,
        draftId: superseding.id,
      });
      const patched = await updateApprovalEmbedContent(config, task.task_id, {
        subject: superseding.subject,
        bodyText: superseding.bodyText,
        draftId: superseding.id,
        note: 'edited via Gmail on mobile — repointed to the newer draft.',
      });
      if (patched) {
        repointed += 1;
      }
      continue;
    }

    // In-place edit: same draftId, different subject/body.
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

    syncPendingTaskContent(config, task, {
      subject: nextSubject,
      bodyText: nextBodyText,
      bodyPreview: nextBodyPreview,
    });
    const patched = await updateApprovalEmbedContent(config, task.task_id, {
      subject: nextSubject,
      bodyText: nextBodyText,
    });
    if (patched) {
      edited += 1;
    }
  }

  return { sent, edited, repointed };
}

// Back-compat wrapper — the older name only reported the manual-send count.
// New callers should use `reconcileDrafts` directly to see all three counts.
export async function reconcileManuallySentDrafts(config) {
  const { sent } = await reconcileDrafts(config);
  return sent;
}
