#!/usr/bin/env node
// Qualify-and-draft: reads status='new' leads, has Claude judge fit against
// VBJ's offers, and for qualified leads with a public email creates a Gmail
// draft routed through the Discord approval flow.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { recordOpsMetric } from '../services/lib/metrics-store.mjs';
import { fetchLeads, updateLead } from './lib/leadgen-supabase.mjs';
import { measurePageSpeed, qualifyLead } from '../services/leadgen-qualifier/src/qualifier.mjs';
import { executeTask } from '../services/task-router/src/executor.mjs';
import { upsertPersistedPendingTask } from '../services/discord-bot/src/pending-task-store.mjs';
import {
  buildOutboundEventDiscordPayload,
  upgradeLegacyDiscordPayload,
} from '../services/discord-bot/src/message-formatting.mjs';
import { buildApprovalButtons } from '../services/discord-bot/src/approval-buttons.mjs';
import { postLeadQualificationReport, renderLiveProgressBody } from './lib/lead-qualification-report.mjs';
import { postQualifiedCallLeads } from './lib/qualified-call-leads.mjs';
import { routeLeadOutreachEvents } from './lib/lead-outreach-routing.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getArgValue(flag, fallbackValue = '') {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallbackValue : (process.argv[index + 1] || fallbackValue);
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function renderPageText(url) {
  const venvPython = resolve(projectRoot, '.venv-leadgen', 'bin', 'python3');
  const script = resolve(projectRoot, 'services', 'leadgen-scraper', 'render_page.py');
  const result = spawnSync(existsSync(venvPython) ? venvPython : 'python3', [script, url], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 90000,
  });

  const text = String(result.stdout || '').trim();
  return result.status === 0 && text ? text : null;
}

function buildTaskId(text) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/gu, '').slice(0, 12);
  const fingerprint = createHash('sha1').update(text).digest('hex').slice(0, 6).toUpperCase();
  return `TASK-${timestamp}-${fingerprint}${randomBytes(2).toString('hex').toUpperCase()}`;
}

async function postToChannel(config, channelId, body) {
  const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Discord post failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}

async function patchChannelMessage(config, channelId, messageId, body) {
  try {
    const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorText = await response.text();
      process.stderr.write(`Discord progress PATCH failed (${response.status}): ${errorText.slice(0, 200)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Discord progress PATCH failed: ${error.message}\n`);
  }
}

async function deleteChannelMessage(config, channelId, messageId) {
  try {
    const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages/${messageId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}` },
    });
    if (!response.ok && response.status !== 404) {
      const errorText = await response.text();
      process.stderr.write(`Discord progress DELETE failed (${response.status}): ${errorText.slice(0, 200)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Discord progress DELETE failed: ${error.message}\n`);
  }
}

async function dispatchOutboundEvents(config, outboundEvents = []) {
  for (const outboundEvent of outboundEvents) {
    const channelId = config.channelIds[outboundEvent.channelKey];
    if (!channelId) {
      continue;
    }

    if (outboundEvent.type === 'approval_request') {
      const roleMentions = config.operatorRoleId ? [`<@&${config.operatorRoleId}>`] : [];
      const userMentions = (config.operatorUserIds || []).map((userId) => `<@${userId}>`);
      outboundEvent.metadata = {
        ...outboundEvent.metadata,
        approverMentions: [...roleMentions, ...userMentions].join(' '),
        approverUserIds: config.operatorUserIds || [],
        approverRoleIds: config.operatorRoleId ? [config.operatorRoleId] : [],
      };
    }

    const body = upgradeLegacyDiscordPayload(buildOutboundEventDiscordPayload(outboundEvent));
    if (outboundEvent.type === 'approval_request' && outboundEvent.metadata?.taskId) {
      body.components = buildApprovalButtons(outboundEvent.metadata.taskId, {
        isEmailAction: Boolean(outboundEvent.metadata?.emailTo),
      });
    }

    await postToChannel(config, channelId, body);
  }
}

async function dispatchLeadOutreachEvents(config, outboundEvents = []) {
  const merged = routeLeadOutreachEvents(config.channelIds || {}, outboundEvents);
  await dispatchOutboundEvents(config, merged);
}

async function createDraftWithApproval(config, lead, qualification) {
  const subject = String(qualification.draft_subject || '').trim();
  const bodyText = String(qualification.draft_body || '').trim();
  const task = {
    task_id: buildTaskId(`${lead.id}:${subject}`),
    source_type: 'lead_qualification',
    source_channel: 'leadGeneration',
    submitted_by: 'lead-qualifier',
    submitted_at: new Date().toISOString(),
    summary: lead.source_url
      ? `Draft outreach to [${lead.business_name}](${lead.source_url}) (${qualification.offer_angle})`
      : `Draft outreach to ${lead.business_name} (${qualification.offer_angle})`,
    full_text: `draft email to ${lead.contact_email} subject: ${subject} body: ${bodyText}`,
    target_agent: 'outreach-agent',
    domain: 'sales',
    priority: 'normal',
    approval_required: false,
    status: 'queued',
    runtime_action: 'gmail_create_draft',
    email_request: { to: lead.contact_email, subject, bodyText },
    lead_id: lead.id,
    lead_domain: lead.domain,
    lead_business_name: lead.business_name,
    lead_source_url: lead.source_url || '',
  };

  const result = await executeTask(task, config);
  if (result.outcome !== 'completed') {
    throw new Error(result.error?.message || 'Gmail draft creation failed.');
  }

  const pendingApprovalTask = result.executionResult?.report?.pendingApprovalTask;
  if (pendingApprovalTask) {
    upsertPersistedPendingTask(config, pendingApprovalTask);
  }

  await dispatchLeadOutreachEvents(config, result.outboundEvents);
  return task.task_id;
}

async function main() {
  const limit = Number(getArgValue('--limit', '3'));
  const niche = getArgValue('--niche', '');
  const dryRun = hasFlag('--dry-run');
  const retryUnreachable = hasFlag('--retry-unreachable');
  const redraftRejected = hasFlag('--redraft-rejected');
  const recoverEmails = hasFlag('--recover-emails');
  const noScreenshot = hasFlag('--no-screenshot');
  const config = loadRuntimeConfig();

  const status = redraftRejected ? 'draft_rejected'
    : recoverEmails ? 'qualified_no_email'
    : (retryUnreachable ? 'site_unreachable' : 'new');

  const allNew = await fetchLeads({
    status,
    niche: niche || undefined,
    limit: 100,
    order: 'oldest',
  });
  const batch = allNew.slice(0, Math.max(1, Math.min(limit, 100)));

  if (batch.length === 0) {
    process.stdout.write(`No leads with status=${status} to process.\n`);
    return;
  }

  const channelId = config.channelIds.leadQualificationAgent
    || config.channelIds.leadGeneration
    || config.channelIds.agentResults;
  const runTitle = redraftRejected ? 'Lead Qualification - Redraft (rejected drafts)'
    : recoverEmails ? 'Lead Qualification - Email recovery'
    : retryUnreachable ? 'Lead Qualification - Retry (unreachable sites)'
    : 'Lead Qualification';
  const canPostLive = Boolean(!dryRun && channelId && config.env.DISCORD_BOT_TOKEN);
  const outcomes = [];
  const pendingQualifiedCallLeads = [];
  let progressMessageId = null;

  if (canPostLive) {
    try {
      const initialBody = renderLiveProgressBody({
        outcomes,
        total: batch.length,
        runTitle,
        state: 'in_progress',
      });
      const posted = await postToChannel(config, channelId, { content: initialBody });
      progressMessageId = posted?.id || null;
    } catch (error) {
      process.stderr.write(`Live-progress initial post failed (non-fatal): ${error.message}\n`);
    }
  }

  const updateProgress = async ({ state: progressState = 'in_progress', currentLead = '' } = {}) => {
    if (!canPostLive || !progressMessageId) {
      return;
    }
    const body = renderLiveProgressBody({
      outcomes,
      total: batch.length,
      runTitle,
      state: progressState,
      currentLead,
    });
    await patchChannelMessage(config, channelId, progressMessageId, { content: body });
  };

  for (const lead of batch) {
    await updateProgress({ currentLead: lead.business_name });

    const pageSpeed = await measurePageSpeed(
      lead.source_url,
      config.env.PAGESPEED_API_KEY || process.env.PAGESPEED_API_KEY,
    );

    const renderedSiteText = retryUnreachable ? renderPageText(lead.source_url) : null;
    const operatorFeedback = redraftRejected ? (lead.qualification?.rejection_feedback || null) : null;

    let qualification;
    try {
      qualification = await qualifyLead(lead, config, {
        pageSpeed,
        renderedSiteText,
        enableScreenshot: !noScreenshot,
        operatorFeedback,
      });
    } catch (error) {
      outcomes.push({ lead: lead.business_name, sourceUrl: lead.source_url, error: error.message });
      await updateProgress();
      continue;
    }
    qualification.page_speed = pageSpeed;

    const discoveredEmail = String(qualification.contact_email || '').trim().toLowerCase();
    const emailLooksValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(discoveredEmail);
    if (!lead.contact_email && emailLooksValid) {
      lead.contact_email = discoveredEmail;
      qualification.contact_email_recovered = true;
      if (!dryRun) {
        await updateLead(lead.id, { contact_email: discoveredEmail }).catch(() => {});
      }
    }

    let finalStatus;
    let approvalTaskId = null;
    let draftError = '';
    if (qualification.decision === 'qualified') {
      finalStatus = lead.contact_email ? 'qualified' : 'qualified_no_email';
    } else if (qualification.decision === 'extraction_error') {
      finalStatus = 'extraction_error';
    } else if (qualification.decision === 'unverifiable') {
      finalStatus = 'site_unreachable';
    } else {
      finalStatus = 'rejected_fit';
    }

    if (!dryRun && finalStatus === 'qualified') {
      try {
        approvalTaskId = await createDraftWithApproval(config, lead, qualification);
      } catch (error) {
        draftError = error.message;
        finalStatus = 'qualified_draft_failed';
      }
    }

    let storedQualification = null;
    if (!dryRun) {
      storedQualification = {
        ...qualification,
        ...(lead.qualification?.rejection_feedback ? {
          rejection_feedback: lead.qualification.rejection_feedback,
          rejected_by: lead.qualification.rejected_by,
          rejected_at: lead.qualification.rejected_at,
          redrafted_after_feedback_at: new Date().toISOString(),
        } : {}),
        ...(lead.qualification?.qualified_call_leads_posted_at ? {
          qualified_call_leads_posted_at: lead.qualification.qualified_call_leads_posted_at,
          qualified_call_leads_thread_id: lead.qualification.qualified_call_leads_thread_id,
          qualified_call_leads_message_id: lead.qualification.qualified_call_leads_message_id,
        } : {}),
        approval_task_id: approvalTaskId,
        qualified_by: 'claude',
      };
      await updateLead(lead.id, {
        status: finalStatus,
        qualification: storedQualification,
        qualified_at: new Date().toISOString(),
      });
    }

    recordOpsMetric(config, 'lead_qualification', {
      leadId: lead.id,
      domain: lead.domain,
      decision: qualification.decision,
      status: finalStatus,
      offerAngle: qualification.offer_angle || '',
      approvalTaskId: approvalTaskId || '',
      dryRun,
    });

    const outcome = {
      lead: lead.business_name,
      domain: lead.domain,
      sourceUrl: lead.source_url,
      contactPhone: lead.contact_phone || '',
      kvkNumber: lead.kvk_number || '',
      leadAgeDays: Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 86400000),
      decision: qualification.decision,
      status: finalStatus,
      offer_angle: qualification.offer_angle,
      confidence: qualification.confidence,
      lcp_seconds: pageSpeed?.lcp_seconds ?? null,
      screenshot_reviewed: qualification.screenshot_reviewed ?? null,
      reasoning: qualification.reasoning || '',
      approvalTaskId,
      ...(draftError ? { draftError } : {}),
    };
    outcomes.push(outcome);

    if (
      !dryRun
      && finalStatus === 'qualified_no_email'
      && !lead.qualification?.qualified_call_leads_posted_at
    ) {
      pendingQualifiedCallLeads.push({
        leadId: lead.id,
        qualification: storedQualification,
        outcome,
      });
    }

    await updateProgress();
  }

  await updateProgress({ state: 'completed' });

  if (canPostLive) {
    const outreachChannel = config.channelIds.outreachAgent
      ? `<#${config.channelIds.outreachAgent}>`
      : '#outreach-agent';
    const qualifiedCallLeadsChannel = config.channelIds.qualifiedCallLeads
      ? `<#${config.channelIds.qualifiedCallLeads}>`
      : '';

    let summaryPosted = false;
    try {
      await postLeadQualificationReport({
        channelId,
        outcomes,
        outreachChannel,
        qualifiedCallLeadsChannel,
        runTitle,
        postMessage: (payload) => postToChannel(config, channelId, payload),
      });
      summaryPosted = true;
    } catch (error) {
      process.stderr.write(`Lead qualification summary post failed (non-fatal): ${error.message}\n`);
    }

    if (config.channelIds.qualifiedCallLeads && pendingQualifiedCallLeads.length > 0) {
      try {
        const threadId = config.channelIds.qualifiedCallLeads;
        const firstMessage = await postQualifiedCallLeads({
          channelId: threadId,
          outcomes: pendingQualifiedCallLeads.map((record) => record.outcome),
          postMessage: (payload) => postToChannel(config, threadId, payload),
        });

        if (firstMessage?.id) {
          const postedAt = new Date().toISOString();
          for (const record of pendingQualifiedCallLeads) {
            await updateLead(record.leadId, {
              qualification: {
                ...record.qualification,
                qualified_call_leads_posted_at: postedAt,
                qualified_call_leads_thread_id: threadId,
                qualified_call_leads_message_id: firstMessage.id,
              },
            });
          }
        }
      } catch (error) {
        process.stderr.write(`Qualified call-leads post failed (non-fatal): ${error.message}\n`);
      }
    }

    if (summaryPosted && progressMessageId) {
      await deleteChannelMessage(config, channelId, progressMessageId);
    }
  }

  process.stdout.write(`${JSON.stringify(outcomes, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Lead qualification failed: ${error.message}\n`);
  process.exitCode = 1;
});
