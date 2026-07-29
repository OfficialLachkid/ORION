function encodeHeader(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }

  // eslint-disable-next-line no-control-regex -- ASCII detection for header encoding
  if (/^[\x20-\x7E]*$/u.test(text)) {
    return text;
  }

  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function assertRecipient(email) {
  if (!email || typeof email !== 'string') {
    throw new Error('Missing recipient email address.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())) {
    throw new Error(`Invalid recipient email address: ${email}`);
  }
}

function formatAddress(email, name = '') {
  const trimmed = String(email || '').trim();
  if (!trimmed) {
    return '';
  }
  const displayName = encodeHeader(name);
  if (displayName) {
    return `"${displayName.replace(/"/gu, '\\"')}" <${trimmed}>`;
  }
  return `<${trimmed}>`;
}

function toBcc(bccList) {
  if (!bccList) {
    return [];
  }
  if (Array.isArray(bccList)) {
    return bccList.filter(Boolean);
  }
  return String(bccList).split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function buildRfc822Message(draft) {
  const to = String(draft.to || '').trim();
  assertRecipient(to);
  const from = draft.fromEmail
    ? formatAddress(draft.fromEmail, draft.fromName || '')
    : '';
  const bccList = toBcc(draft.bcc);
  const replyTo = draft.replyTo ? String(draft.replyTo).trim() : '';
  const subject = String(draft.subject || '').trim();
  const bodyText = String(draft.bodyText || '').replace(/\r\n?/gu, '\n');

  const headers = [];
  if (from) {
    headers.push(`From: ${from}`);
  }
  headers.push(`To: <${to}>`);
  if (bccList.length > 0) {
    headers.push(`Bcc: ${bccList.map((address) => `<${address}>`).join(', ')}`);
  }
  if (replyTo) {
    headers.push(`Reply-To: <${replyTo}>`);
  }
  // Threading headers so a follow-up nests under the original in the
  // recipient's mail client (Gmail also threads via its own threadId on the
  // API request, but In-Reply-To/References is what other clients honour).
  const inReplyTo = String(draft.inReplyTo || '').trim();
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`);
    const references = String(draft.references || inReplyTo).trim();
    headers.push(`References: ${references}`);
  }
  headers.push(`Subject: ${encodeHeader(subject)}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push('Content-Transfer-Encoding: 7bit');
  headers.push('');
  headers.push(bodyText);

  return headers.join('\r\n');
}

export function toBase64Url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value || ''), 'utf8');
  return buffer.toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

function normalizeBody(bodyText) {
  return String(bodyText || '')
    .replace(/\r?\n/gu, '\r\n')
    .trim();
}

export function buildRawMimeMessage({ from, to, subject, bodyText }) {
  const normalizedTo = String(to || '').replace(/^<|>$/gu, '').trim();
  assertRecipient(normalizedTo);

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    normalizeBody(bodyText),
    '',
  ];

  return toBase64Url(Buffer.from(lines.join('\r\n'), 'utf8'));
}
