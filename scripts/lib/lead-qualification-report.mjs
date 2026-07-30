import {
  formatLocalDate,
  paginateDiscordLines,
} from '../../services/discord-bot/src/embed-pagination.mjs';
import { buildNoticeDiscordPayload } from '../../services/discord-bot/src/message-formatting.mjs';

function countStatus(outcomes, status) {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function renderOutcome(outcome) {
  const name = outcome.sourceUrl
    ? `[${outcome.lead}](${outcome.sourceUrl})`
    : outcome.lead;

  if (outcome.error) {
    return `- ${name}: qualification failed (${outcome.error.slice(0, 80)})`;
  }
  if (outcome.draftError) {
    return `- ${name}: qualified but draft failed (${outcome.draftError.slice(0, 80)})`;
  }

  const angle = outcome.offer_angle ? ` — ${outcome.offer_angle}` : '';
  const lcp = Number.isFinite(outcome.lcp_seconds) ? `, LCP ${outcome.lcp_seconds}s` : '';
  const age = Number.isFinite(outcome.leadAgeDays)
    ? ` (found ${outcome.leadAgeDays}d ago${lcp})`
    : '';
  const approval = outcome.approvalTaskId
    ? ` (draft awaiting approval: ${outcome.approvalTaskId})`
    : '';
  const why = (
    outcome.status === 'rejected_fit'
    || outcome.status === 'extraction_error'
  ) && outcome.reasoning
    ? ` — ${outcome.reasoning.slice(0, 200)}`
    : '';

  return `- ${name}: **${outcome.status}**${angle}${age}${approval}${why}`;
}

export function buildLeadQualificationDescriptions({
  outcomes,
  outreachChannel,
  runTitle,
  runDate = new Date(),
}) {
  const draftCount = outcomes.filter((outcome) => outcome.approvalTaskId).length;
  const failedCount = outcomes.filter((outcome) => outcome.error).length;
  const rollupParts = [
    draftCount > 0 ? `**${draftCount}** draft(s) awaiting approval in ${outreachChannel}` : '',
    countStatus(outcomes, 'qualified_no_email') > 0
      ? `**${countStatus(outcomes, 'qualified_no_email')}** qualified but no email found (no draft possible)`
      : '',
    countStatus(outcomes, 'qualified_draft_failed') > 0
      ? `**${countStatus(outcomes, 'qualified_draft_failed')}** qualified but draft creation failed`
      : '',
    countStatus(outcomes, 'rejected_fit') > 0
      ? `**${countStatus(outcomes, 'rejected_fit')}** rejected — weak fit`
      : '',
    countStatus(outcomes, 'site_unreachable') > 0
      ? `**${countStatus(outcomes, 'site_unreachable')}** site unreachable (parked for retry)`
      : '',
    countStatus(outcomes, 'extraction_error') > 0
      ? `**${countStatus(outcomes, 'extraction_error')}** extraction error`
      : '',
    failedCount > 0
      ? `**${failedCount}** qualification call failed (timeout/error — stays \`new\`, retried in a future run)`
      : '',
  ].filter(Boolean);

  const rollup = rollupParts.length > 0 ? ` — ${rollupParts.join(', ')}` : '';
  const header = `Processed ${outcomes.length} lead(s)${rollup}.`;
  const continuationHeader = `**Follow-up:** This belongs to **${runTitle}** from **${formatLocalDate(runDate)}**.`;

  return paginateDiscordLines({
    firstHeader: header,
    continuationHeader,
    lines: outcomes.map(renderOutcome),
    separator: '\n\n',
  });
}

export async function postLeadQualificationReport({
  channelId,
  outcomes,
  outreachChannel,
  runTitle,
  postMessage,
  runDate = new Date(),
}) {
  const descriptions = buildLeadQualificationDescriptions({
    outcomes,
    outreachChannel,
    runTitle,
    runDate,
  });

  let firstMessage = null;
  for (let pageIndex = 0; pageIndex < descriptions.length; pageIndex += 1) {
    const payload = buildNoticeDiscordPayload({
      title: pageIndex === 0
        ? runTitle
        : `${runTitle} — Continued (${pageIndex + 1}/${descriptions.length})`,
      description: descriptions[pageIndex],
      color: 0x5865F2,
      footerText: 'ORION lead qualification',
    });
    if (pageIndex > 0 && firstMessage?.id) {
      payload.message_reference = {
        message_id: firstMessage.id,
        channel_id: channelId,
        fail_if_not_exists: false,
      };
    }

    const postedMessage = await postMessage(payload);
    firstMessage ||= postedMessage;
  }

  return firstMessage;
}
