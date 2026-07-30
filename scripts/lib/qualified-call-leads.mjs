import {
  formatLocalDate,
  paginateDiscordLines,
} from '../../services/discord-bot/src/embed-pagination.mjs';
import { buildNoticeDiscordPayload } from '../../services/discord-bot/src/message-formatting.mjs';

export function normalizePhoneForTel(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  let normalized = text.replace(/[^\d+]/gu, '');
  normalized = normalized.replace(/(?!^)\+/gu, '');
  if (normalized.startsWith('00')) {
    normalized = `+${normalized.slice(2)}`;
  }
  // Dutch numbers are often printed as "+31 (0)23 ..."; the trunk 0 is
  // omitted when dialing through the +31 country code.
  normalized = normalized.replace(/^\+310/u, '+31');

  return /\d/u.test(normalized) ? normalized : '';
}

function formatPhone(value) {
  const phone = String(value || '').trim();
  const telTarget = normalizePhoneForTel(phone);
  if (!phone || !telTarget) {
    return '**No public phone found**';
  }

  return `[${phone}](tel:${telTarget})`;
}

function formatFit(value) {
  const fit = String(value || '').trim();
  if (fit.toLowerCase() === 'website_builder') {
    return 'New website';
  }

  return fit || 'Qualified fit; review the saved qualification details';
}

function renderCandidate(outcome) {
  const company = outcome.sourceUrl
    ? `[${outcome.lead}](${outcome.sourceUrl})`
    : outcome.lead;
  const angle = formatFit(outcome.offer_angle);
  const kvk = outcome.kvkNumber ? `\n  KVK: \`${outcome.kvkNumber}\`` : '';

  return `- ${company}\n  Phone: ${formatPhone(outcome.contactPhone)}${kvk}\n  Fit: ${angle}`;
}

export function buildQualifiedCallLeadDescriptions({
  outcomes,
  runDate = new Date(),
}) {
  const candidates = outcomes.filter((outcome) => outcome.status === 'qualified_no_email');
  if (candidates.length === 0) {
    return [];
  }

  const header = `**${candidates.length} qualified lead(s) have no public email and are queued for phone outreach.**`;

  return paginateDiscordLines({
    firstHeader: header,
    continuationHeader: `**Follow-up:** This belongs to **Qualified Call Leads** from **${formatLocalDate(runDate)}**.`,
    lines: candidates.map(renderCandidate),
    separator: '\n\n',
  });
}

export async function postQualifiedCallLeads({
  channelId,
  outcomes,
  postMessage,
  runDate = new Date(),
}) {
  const descriptions = buildQualifiedCallLeadDescriptions({ outcomes, runDate });
  if (descriptions.length === 0) {
    return null;
  }

  let firstMessage = null;
  for (let pageIndex = 0; pageIndex < descriptions.length; pageIndex += 1) {
    const payload = buildNoticeDiscordPayload({
      title: pageIndex === 0
        ? 'Qualified Call Leads'
        : `Qualified Call Leads — Continued (${pageIndex + 1}/${descriptions.length})`,
      description: descriptions[pageIndex],
      color: 0xFEE75C,
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
