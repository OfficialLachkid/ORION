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

  const copyValue = phone.replace(/`/gu, "'");
  return `[${phone}](tel:${telTarget}) · copy: \`${copyValue}\``;
}

function renderCandidate(outcome) {
  const company = outcome.sourceUrl
    ? `[${outcome.lead}](${outcome.sourceUrl})`
    : outcome.lead;
  const angle = outcome.offer_angle || 'Qualified fit; review the saved qualification details';
  const kvk = outcome.kvkNumber ? `\n  KVK: \`${outcome.kvkNumber}\` (verify legal form)` : '';

  return `- ${company}\n  Phone: ${formatPhone(outcome.contactPhone)}${kvk}\n  Fit: ${angle}`;
}

export function buildQualifiedNoEmailReviewDescriptions({
  outcomes,
  runDate = new Date(),
}) {
  const candidates = outcomes.filter((outcome) => outcome.status === 'qualified_no_email');
  if (candidates.length === 0) {
    return [];
  }

  const header = [
    `**${candidates.length} qualified lead(s) have no public email.**`,
    '**Manual review required:** qualification confirms offer fit, not permission to call. Verify prior consent or an eligible legal-person company before making a sales call.',
  ].join('\n\n');

  return paginateDiscordLines({
    firstHeader: header,
    continuationHeader: `**Follow-up:** This belongs to **Qualified No-Email Review** from **${formatLocalDate(runDate)}**.`,
    lines: candidates.map(renderCandidate),
    separator: '\n\n',
  });
}

export async function postQualifiedNoEmailReview({
  channelId,
  outcomes,
  postMessage,
  runDate = new Date(),
}) {
  const descriptions = buildQualifiedNoEmailReviewDescriptions({ outcomes, runDate });
  if (descriptions.length === 0) {
    return null;
  }

  let firstMessage = null;
  for (let pageIndex = 0; pageIndex < descriptions.length; pageIndex += 1) {
    const payload = buildNoticeDiscordPayload({
      title: pageIndex === 0
        ? 'Qualified No-Email Review'
        : `Qualified No-Email Review — Continued (${pageIndex + 1}/${descriptions.length})`,
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
