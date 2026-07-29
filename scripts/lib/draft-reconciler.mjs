// Reconciles drafts the operator sent (or deleted) MANUALLY in Gmail, without
// clicking "Send Email" in Discord. Gmail deletes a draft the instant it's
// sent, so a persisted pending send-task whose draftId no longer exists means
// the email already went out by hand. For each such task this: marks the lead
// `sent`, flips its Discord approval message to a resolved "sent" state (buttons
// removed), and drops the pending task — so a stale "Approval Needed" card
// can't linger and can't be re-sent. Runs in the night shift (daily cleanup);
// a more frequent poll can call the same function later if desired.
import { gmailDraftExists } from '../../services/gmail/src/send.mjs';
import { loadPersistedPendingTasks, removePersistedPendingTask } from '../../services/discord-bot/src/pending-task-store.mjs';
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

// Returns the number of drafts reconciled (found already-sent and cleaned up).
export async function reconcileManuallySentDrafts(config) {
  if (!config.env.DISCORD_BOT_TOKEN) {
    return 0;
  }

  const pending = loadPersistedPendingTasks(config).filter((t) => t?.gmail_draft?.draftId);
  let reconciled = 0;

  for (const task of pending) {
    let exists;
    try {
      exists = await gmailDraftExists(config.env, task.gmail_draft.draftId);
    } catch {
      // Transient lookup failure — leave this one for the next run rather than
      // guessing it was sent.
      continue;
    }
    if (exists) {
      continue; // still an unsent draft — nothing to do
    }

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
    reconciled += 1;
  }

  return reconciled;
}
