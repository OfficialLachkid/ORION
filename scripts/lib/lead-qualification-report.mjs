import {
  formatLocalDate,
  paginateDiscordLines,
} from '../../services/discord-bot/src/embed-pagination.mjs';
import { buildNoticeDiscordPayload } from '../../services/discord-bot/src/message-formatting.mjs';

// Discord's message-content ceiling is 2000 chars. Leave headroom for the
// header + a truncation notice so we never post an over-long message that gets
// silently rejected.
const LIVE_PROGRESS_CONTENT_BUDGET = 1900;

const STATUS_ICONS = {
  qualified: '✅',
  qualified_no_email: '📞',
  qualified_draft_failed: '⚠️',
  rejected_fit: '❌',
  site_unreachable: '⏭',
  extraction_error: '⚠️',
};

function statusIcon(outcome) {
  if (outcome?.error) return '💥';
  if (outcome?.draftError) return '⚠️';
  return STATUS_ICONS[outcome?.status] || '•';
}

function renderLiveProgressLine(outcome) {
  const name = outcome.sourceUrl
    ? `[${outcome.lead}](${outcome.sourceUrl})`
    : (outcome.lead || 'unknown');
  const icon = statusIcon(outcome);
  if (outcome.error) {
    return `${icon} ${name} — call failed`;
  }
  if (outcome.draftError) {
    return `${icon} ${name} — qualified but draft failed`;
  }
  const angle = outcome.offer_angle ? ` · ${outcome.offer_angle}` : '';
  return `${icon} ${name} — ${outcome.status || outcome.decision || 'processed'}${angle}`;
}

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

// Renders the live-progress message body posted at the start of a
// qualification run and PATCHed after each lead is processed. Purpose is
// visibility DURING the run — the full rich summary still posts via
// postLeadQualificationReport when the loop finishes. Format is compact by
// design so a 30-lead batch fits well inside Discord's 2000-char content
// budget; when it doesn't (very long business names, mostly), the oldest
// lines are dropped so the current lead + a "… N earlier lead(s) omitted"
// notice always survive.
export function renderLiveProgressBody({
  outcomes = [],
  total,
  runTitle = 'Lead Qualification',
  state = 'in_progress',
  currentLead = '',
} = {}) {
  const processed = outcomes.length;
  const stateLabel = state === 'completed' ? 'completed' : (state === 'failed' ? 'failed' : 'in progress');
  const stateIcon = state === 'completed' ? '✅' : (state === 'failed' ? '💥' : '🌙');
  const headerLines = [
    `${stateIcon} **${runTitle}** — ${stateLabel}`,
    `Processed **${processed}/${Number.isFinite(total) ? total : '?'}** lead(s)`,
  ];
  if (state === 'in_progress' && currentLead) {
    headerLines.push(`Currently: ${currentLead}`);
  }
  const header = headerLines.join('\n');

  if (processed === 0) {
    return `${header}\n\n_Waiting for the first lead to finish…_`;
  }

  const rendered = outcomes.map(renderLiveProgressLine);
  const budget = LIVE_PROGRESS_CONTENT_BUDGET - header.length - 4; // header + \n\n

  let body = rendered.join('\n');
  if (body.length <= budget) {
    return `${header}\n\n${body}`;
  }

  // Drop oldest lines until we fit, always keeping the last line (the most
  // recent lead) — operator glancing at the message wants "what just
  // happened" more than a full history that got mid-word truncated.
  let kept = rendered.slice();
  let dropped = 0;
  while (kept.length > 1) {
    kept = kept.slice(1);
    dropped += 1;
    const notice = `_… ${dropped} earlier lead(s) omitted for length; see the summary below._`;
    body = [notice, ...kept].join('\n');
    if (body.length <= budget) {
      return `${header}\n\n${body}`;
    }
  }

  // Even the single last line overflowed — truncate it.
  const single = rendered[rendered.length - 1];
  return `${header}\n\n${single.slice(0, budget - 4)}...`;
}
