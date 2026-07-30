#!/usr/bin/env node

import process from 'node:process';
import { loadRuntimeConfig } from '../services/lib/runtime-config.mjs';
import { fetchLeads, updateLead } from './lib/leadgen-supabase.mjs';
import { postQualifiedNoEmailReview } from './lib/qualified-no-email-review.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function postToChannel(config, channelId, payload) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord post failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function main() {
  const config = loadRuntimeConfig();
  const requestedLimit = Number.parseInt(getArgValue('--limit', '500'), 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(requestedLimit, 1000))
    : 500;
  const dryRun = hasFlag('--dry-run');
  const threadId = config.channelIds.qualifiedNoEmailReview;
  const leads = await fetchLeads({
    status: 'qualified_no_email',
    limit,
    order: 'oldest',
  });
  const pending = leads.filter((lead) => !lead.qualification?.no_email_review_posted_at);

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      candidates: pending.length,
      withPhone: pending.filter((lead) => lead.contact_phone).length,
      threadConfigured: Boolean(threadId),
    }, null, 2)}\n`);
    return;
  }

  if (!threadId || !config.env.DISCORD_BOT_TOKEN) {
    throw new Error('Set DISCORD_QUALIFIED_NO_EMAIL_THREAD_ID before posting the review backlog.');
  }
  if (pending.length === 0) {
    process.stdout.write('No unposted qualified-no-email leads found.\n');
    return;
  }

  const outcomes = pending.map((lead) => ({
    lead: lead.business_name,
    sourceUrl: lead.source_url,
    status: 'qualified_no_email',
    contactPhone: lead.contact_phone || '',
    kvkNumber: lead.kvk_number || '',
    offer_angle: lead.qualification?.offer_angle || '',
  }));
  const firstMessage = await postQualifiedNoEmailReview({
    channelId: threadId,
    outcomes,
    postMessage: (payload) => postToChannel(config, threadId, payload),
  });
  if (!firstMessage?.id) {
    throw new Error('Discord did not return a message id for the no-email review backlog.');
  }

  const postedAt = new Date().toISOString();
  for (const lead of pending) {
    await updateLead(lead.id, {
      qualification: {
        ...(lead.qualification || {}),
        no_email_review_posted_at: postedAt,
        no_email_review_thread_id: threadId,
        no_email_review_message_id: firstMessage.id,
      },
    });
  }

  process.stdout.write(`${JSON.stringify({
    posted: pending.length,
    withPhone: pending.filter((lead) => lead.contact_phone).length,
    threadId,
    firstMessageId: firstMessage.id,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Qualified no-email review post failed: ${error.message}\n`);
  process.exitCode = 1;
});
