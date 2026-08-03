import process from 'node:process';
import { buildNoticeDiscordPayload } from '../../../services/discord-bot/src/message-formatting.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';

function getLeadDigestChannelId(config) {
  return config.channelIds.leadQualificationAgent || config.channelIds.leadGeneration;
}

export async function postDiscord(config, channelId, payload) {
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return;
  }
  try {
    await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    process.stderr.write(`Night-shift digest post failed (non-fatal): ${error.message}\n`);
  }
}

export function buildLeadNightShiftDigest(outcomes, backlogCount, openDraftCount, extras = {}) {
  const processedCount = outcomes.length;
  const drafted = outcomes.filter((outcome) => outcome.approvalTaskId).length;
  const noEmail = outcomes.filter((outcome) => outcome.status === 'qualified_no_email').length;
  const rejected = outcomes.filter((outcome) => outcome.status === 'rejected_fit').length;
  const unreachable = outcomes.filter((outcome) => outcome.status === 'site_unreachable').length;
  const extractionError = outcomes.filter((outcome) => outcome.status === 'extraction_error').length;
  const failed = outcomes.filter((outcome) => outcome.error).length;
  const {
    redrafted = 0,
    reconciled = 0,
    editedInGmail = 0,
    repointedInGmail = 0,
    followedUp = 0,
    replyResult = null,
    outreachChannel = '#outreach-agent',
    qualifiedCallLeadsChannel = '',
  } = extras;

  const parts = [
    drafted > 0 ? `**${drafted}** new draft(s) awaiting approval in ${outreachChannel}` : '',
    noEmail > 0
      ? `**${noEmail}** qualified, no email${
        qualifiedCallLeadsChannel ? ` (phone outreach in ${qualifiedCallLeadsChannel})` : ''
      }`
      : '',
    rejected > 0 ? `**${rejected}** rejected (weak fit)` : '',
    unreachable > 0 ? `**${unreachable}** site unreachable` : '',
    extractionError > 0 ? `**${extractionError}** extraction error` : '',
    failed > 0 ? `**${failed}** call failed (retried next run)` : '',
  ].filter(Boolean);

  const replyLine = replyResult && replyResult.available === false
    ? 'Reply detection is **paused** - Gmail needs re-authorizing with the read scope (follow-ups stay off until then).'
    : (replyResult && (replyResult.replies || replyResult.bounces || replyResult.autoReplies)
      ? `Replies checked: **${replyResult.replies}** reply, **${replyResult.bounces}** undeliverable, **${replyResult.autoReplies}** auto-reply (of ${replyResult.checked} sent thread(s)).`
      : '');

  const maintenance = [
    replyLine,
    followedUp > 0 ? `Drafted **${followedUp}** follow-up(s) for unanswered leads (approval-gated in #outreach-followups).` : '',
    redrafted > 0 ? `Re-drafted **${redrafted}** previously-rejected lead(s) using your feedback.` : '',
    reconciled > 0 ? `Reconciled **${reconciled}** draft(s) you sent manually in Gmail (marked sent, closed the approval).` : '',
    editedInGmail > 0 ? `Mirrored **${editedInGmail}** draft edit(s) you made in Gmail back into the Discord approval card.` : '',
    repointedInGmail > 0 ? `Repointed **${repointedInGmail}** draft(s) after mobile Gmail created a new draft on edit - the approval card now reflects your latest version.` : '',
  ].filter(Boolean);

  return [
    `Night shift processed **${processedCount}** lead(s)${parts.length ? ' - ' + parts.join(', ') : ''}.`,
    ...(maintenance.length ? ['', ...maintenance] : []),
    '',
    `Backlog: **${backlogCount}** leads still \`new\`. Open drafts awaiting your approval: **${openDraftCount}**.`,
  ].join('\n');
}

function buildVideoQueueMaintenanceLine(summary) {
  if (!summary) {
    return '';
  }
  const parts = [];
  if (summary.scheduled > 0) parts.push(`**${summary.scheduled}** scheduled`);
  if (summary.published > 0) parts.push(`**${summary.published}** marked live`);
  if (summary.returnedToApproval > 0) parts.push(`**${summary.returnedToApproval}** returned to approval`);
  if (summary.deleted > 0) parts.push(`**${summary.deleted}** marked deleted`);
  if (summary.changedSchedule > 0) parts.push(`**${summary.changedSchedule}** schedule(s) corrected`);
  if (summary.statusLookupFailures > 0) parts.push(`**${summary.statusLookupFailures}** lookup failure(s)`);
  if (summary.failedChannels > 0) parts.push(`**${summary.failedChannels}** channel run(s) failed`);
  if (parts.length === 0) {
    return summary.processedChannels > 0
      ? 'Video queue maintenance found no schedule corrections to apply.'
      : '';
  }
  return `Video queue maintenance: ${parts.join(', ')}.`;
}

function buildPreviewFallbackLine(report) {
  if (!report) {
    return '';
  }
  if (report.preferredAvailable === false) {
    return report.strandedCount > 0
      ? `Preview fallback storage: SSD still unavailable, **${report.strandedCount}** preview(s) remain on Desktop fallback.`
      : 'Preview fallback storage: SSD still unavailable, but no stranded previews were found on Desktop fallback.';
  }
  if (report.moved.length > 0 || report.deduped.length > 0) {
    const parts = [];
    if (report.moved.length > 0) parts.push(`moved **${report.moved.length}** back to SSD`);
    if (report.deduped.length > 0) parts.push(`removed **${report.deduped.length}** duplicate fallback copy/copies`);
    if (report.skipped.length > 0) parts.push(`skipped **${report.skipped.length}** conflicted preview(s)`);
    return `Preview fallback storage: ${parts.join(', ')}.`;
  }
  return report.strandedCount > 0
    ? `Preview fallback storage: SSD reachable, but **${report.skipped.length}** preview(s) still need manual review.`
    : '';
}

function buildReviewBacklogReplenishmentLine(report) {
  if (!report) {
    return '';
  }
  if (report.errors?.length && report.generated === 0) {
    return `Review backlog replenish failed: ${report.errors[0]}`;
  }
  if (report.generated > 0) {
    return `Review backlog replenish: generated **${report.generated}** preview(s), review queue now holds **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready for approval.`;
  }
  return report.finalReviewReadyCount < report.targetReviewReadyCount
    ? `Review backlog replenish is still below target at **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready preview(s).`
    : `Review backlog replenish found **${report.finalReviewReadyCount}/${report.targetReviewReadyCount}** ready preview(s); no fill-up was needed.`;
}

function buildReviewMessageRefreshLine(report) {
  if (!report) {
    return '';
  }
  if (report.error) {
    return `Review card refresh failed: ${report.error}`;
  }
  if (report.failed > 0) {
    return `Review card refresh updated **${report.refreshed || 0}** card(s), but **${report.failed}** still need another pass.`;
  }
  if (report.refreshed > 0) {
    const retryNote = report.retried > 0
      ? ` after **${report.retried}** rate-limit retry/retries`
      : '';
    return `Review card refresh updated **${report.refreshed}** card(s)${retryNote}.`;
  }
  return '';
}

export function buildPokemonNightShiftDigest({
  videoQueueMaintenance = null,
  previewFallback = null,
  reviewBacklogReplenishment = null,
  reviewMessageRefresh = null,
  videoQueueMaintenanceError = '',
  previewFallbackError = '',
} = {}) {
  const lines = [];
  if (videoQueueMaintenanceError) {
    lines.push(`Video queue maintenance failed: ${videoQueueMaintenanceError}`);
  } else {
    const queueLine = buildVideoQueueMaintenanceLine(videoQueueMaintenance);
    if (queueLine) {
      lines.push(queueLine);
    }
  }

  if (previewFallbackError) {
    lines.push(`Preview fallback reconcile failed: ${previewFallbackError}`);
  } else {
    const fallbackLine = buildPreviewFallbackLine(previewFallback);
    if (fallbackLine) {
      lines.push(fallbackLine);
    }
  }

  const reviewBacklogLine = buildReviewBacklogReplenishmentLine(reviewBacklogReplenishment);
  if (reviewBacklogLine) {
    lines.push(reviewBacklogLine);
  }

  const reviewMessageRefreshLine = buildReviewMessageRefreshLine(reviewMessageRefresh);
  if (reviewMessageRefreshLine) {
    lines.push(reviewMessageRefreshLine);
  }

  if (lines.length === 0) {
    return 'Poke Quizz night shift found no queue or SSD preview corrections to apply.';
  }

  return lines.join('\n');
}

export async function postNightShiftFailure(config, { label, isFallback }) {
  await postDiscord(config, getLeadDigestChannelId(config), buildNoticeDiscordPayload({
    title: `${label} - Failed`,
    description: `Qualification failed systemically (likely a usage/rate limit or startup error). No leads were processed. This will retry automatically at the next scheduled slot${isFallback ? ' (tomorrow 01:30)' : ' (07:00 today)'} - nothing is lost.`,
    color: 0xED4245,
    footerText: 'ORION night shift',
  }));
}

export async function countOpenDrafts(config) {
  const channelId = config.channelIds.outreachAgent;
  if (!channelId || !config.env.DISCORD_BOT_TOKEN) {
    return 0;
  }
  try {
    const response = await fetch(`${DISCORD_API_BASE_URL}/channels/${channelId}/messages?limit=50`, {
      headers: { Authorization: `Bot ${config.env.DISCORD_BOT_TOKEN}` },
    });
    const messages = await response.json();
    return Array.isArray(messages)
      ? messages.filter((message) => message.embeds?.[0]?.title?.includes('Approval Needed')).length
      : 0;
  } catch {
    return 0;
  }
}

export async function postLeadNightShiftDigest(config, { label, outcomes, backlog, openDrafts, extras = {} }) {
  await postDiscord(config, getLeadDigestChannelId(config), buildNoticeDiscordPayload({
    title: label,
    description: buildLeadNightShiftDigest(outcomes, backlog, openDrafts, extras),
    color: 0x5865F2,
    footerText: 'ORION night shift',
  }));
}

export async function postPokemonNightShiftDigest(config, title, options = {}) {
  const channelId = config.channelIds.pokemon || '';
  if (!channelId) {
    return;
  }

  const hasError = Boolean(options.videoQueueMaintenanceError || options.previewFallbackError);
  await postDiscord(config, channelId, buildNoticeDiscordPayload({
    title,
    description: buildPokemonNightShiftDigest(options),
    color: hasError ? 0xED4245 : 0x57F287,
    footerText: 'ORION video gen night shift',
  }));
}
