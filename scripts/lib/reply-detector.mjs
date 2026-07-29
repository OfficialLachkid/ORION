// Reply detection — the prerequisite for the follow-up sequence. For each lead
// whose first outreach was SENT, reads the Gmail thread and decides whether
// something came back, then updates the lead so follow-ups act only on genuine
// non-responses:
//   real reply  → set responded_at (stop the sequence; a human reads/tags it)
//   bounce      → status 'bounced' (suppress; the address is bad)
//   auto-reply  → note it, but leave responded_at null (not a real answer)
//   nothing     → leave as-is (a follow-up may be due later)
//
// Gated on the gmail.metadata read scope: if it isn't authorized yet, this is a
// no-op that reports it, so it (and therefore follow-ups) never run blind.
import { getGmailThread, gmailReadScopeAvailable } from '../../services/gmail/src/read.mjs';
import { resolveGmailConfig } from '../../services/gmail/src/config.mjs';
import { classifyThreadReply } from './reply-classifier.mjs';
import { fetchLeads, updateLead } from './leadgen-supabase.mjs';

const DISCORD_API = 'https://discord.com/api/v10';

async function postNotice(config, description, color) {
  const channelId = config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration;
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return;
  }
  try {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ embeds: [{ title: 'Outreach reply detection', description, color, footer: { text: 'Ruflo reply detection' } }] }),
    });
  } catch {
    // notice is non-critical
  }
}

// Returns { available, replies, bounces, autoReplies, checked }.
export async function detectReplies(config) {
  const gmailConfig = resolveGmailConfig(config);
  const senderEmail = String(gmailConfig.senderEmail || gmailConfig.fromEmail || '').trim();

  const available = await gmailReadScopeAvailable(gmailConfig);
  if (!available) {
    return { available: false, replies: 0, bounces: 0, autoReplies: 0, checked: 0 };
  }

  const sent = await fetchLeads({ status: 'sent', limit: 500 }).catch(() => []);
  // Only leads that carry a gmail_thread_id (captured at send time) and haven't
  // already been marked as responded.
  const candidates = sent.filter((l) => l.qualification?.gmail_thread_id && !l.responded_at);

  let replies = 0;
  let bounces = 0;
  let autoReplies = 0;
  let checked = 0;

  for (const lead of candidates) {
    let thread;
    try {
      thread = await getGmailThread(gmailConfig, lead.qualification.gmail_thread_id);
    } catch {
      continue; // transient / not found — try again next run
    }
    checked += 1;
    const result = classifyThreadReply(thread.messages, senderEmail);

    if (result.kind === 'reply') {
      replies += 1;
      await updateLead(lead.id, {
        responded_at: new Date().toISOString(),
        qualification: { ...lead.qualification, reply_from: result.from, reply_subject: result.subject },
      }).catch(() => {});
      await postNotice(config, `📬 Reply detected from **${lead.business_name}** (${result.from}). The sequence stops here — read it in Gmail and tag the outcome.`, 0x57F287);
    } else if (result.kind === 'bounce') {
      bounces += 1;
      await updateLead(lead.id, {
        status: 'bounced',
        qualification: { ...lead.qualification, bounce_detected_at: new Date().toISOString() },
      }).catch(() => {});
      await postNotice(config, `⚠️ Undeliverable — **${lead.business_name}**'s email address didn't accept the mail (it came back). Suppressed; no follow-up will be sent.`, 0xED4245);
    } else if (result.kind === 'auto_reply') {
      autoReplies += 1;
      await updateLead(lead.id, {
        qualification: { ...lead.qualification, auto_reply_seen_at: new Date().toISOString() },
      }).catch(() => {});
    }
  }

  return { available: true, replies, bounces, autoReplies, checked };
}
