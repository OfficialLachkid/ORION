import { assertGmailRuntimeConfig, resolveGmailRuntimeConfig } from './config.mjs';
import { fetchAccessToken } from './oauth.mjs';

const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';
const GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

function resolveInputConfig(envOrConfig) {
  if (envOrConfig?.clientId || envOrConfig?.clientSecret || envOrConfig?.refreshToken || envOrConfig?.senderEmail) {
    return envOrConfig;
  }
  return resolveGmailRuntimeConfig(envOrConfig || {});
}

// Reads a thread's messages. `format` defaults to 'metadata' (headers only,
// needs the gmail.metadata scope) for backward compatibility with existing
// callers; pass 'full' to also fetch message bodies (needs gmail.readonly
// or gmail.modify scope — reply-detector uses this to scan for opt-out
// language, and falls back to metadata when the broader scope isn't
// granted). Returns { messages: [...] } where each message has id,
// labelIds, requested headers, and (in 'full' mode) a decoded payload.
// Throws with a recognizable message on 403 so callers can detect the
// "read scope not yet authorized" state and skip reply detection
// gracefully.
export async function getGmailThread(envOrConfig, threadId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const id = String(threadId || '').trim();
  if (!id) {
    throw new Error('Missing Gmail thread ID.');
  }

  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });

  const format = options.format === 'full' ? 'full' : 'metadata';
  const url = new URL(`${GMAIL_THREADS_URL}/${encodeURIComponent(id)}`);
  url.searchParams.set('format', format);
  if (format === 'metadata') {
    for (const header of ['From', 'Subject', 'Auto-Submitted', 'Message-Id']) {
      url.searchParams.append('metadataHeaders', header);
    }
  }

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 403) {
    throw new Error(`GMAIL_READ_SCOPE_MISSING: reading the thread returned 403 — re-authorize Gmail with the ${format === 'full' ? 'gmail.readonly' : 'gmail.metadata'} scope by running "node scripts/gmail-authorize.mjs".`);
  }
  if (response.status === 404) {
    return { messages: [], notFound: true };
  }
  if (!response.ok) {
    const errorText = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Gmail thread read failed (${response.status}): ${errorText || 'no body'}`);
  }

  return response.json();
}

// Cheap probe: can this token read mail metadata at all? Used to gate reply
// detection (and therefore follow-ups) so they simply don't run until the
// operator has re-authorized with the read scope — fail-safe, never guessing.
export async function gmailReadScopeAvailable(envOrConfig, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  try {
    const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
    const res = await fetchImpl(`${GMAIL_THREADS_URL}?maxResults=1`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function findHeader(headers, name) {
  const lowered = String(name || '').toLowerCase();
  const match = (Array.isArray(headers) ? headers : [])
    .find((header) => String(header?.name || '').toLowerCase() === lowered);
  return String(match?.value || '').trim();
}

export async function findSentGmailMessages(envOrConfig, query, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const url = new URL(GMAIL_MESSAGES_URL);
  url.searchParams.set('q', `in:sent ${String(query || '').trim()}`.trim());
  url.searchParams.set('maxResults', String(Math.max(1, Math.min(50, options.maxResults || 10))));
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 403) {
    throw new Error('GMAIL_READ_SCOPE_MISSING: sent-message recovery requires gmail.readonly. Run "node scripts/gmail-authorize.mjs".');
  }
  if (!response.ok) {
    const errorText = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Gmail sent-message search failed (${response.status}): ${errorText || 'no body'}`);
  }
  const payload = await response.json();
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  const results = [];
  for (const message of messages) {
    const detailUrl = new URL(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(message.id)}`);
    detailUrl.searchParams.set('format', 'metadata');
    for (const header of ['To', 'Subject', 'Date', 'Message-Id']) {
      detailUrl.searchParams.append('metadataHeaders', header);
    }
    const detailResponse = await fetchImpl(detailUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!detailResponse.ok) continue;
    const detail = await detailResponse.json();
    const headers = detail?.payload?.headers || [];
    results.push({
      messageId: String(detail?.id || message.id || '').trim(),
      threadId: String(detail?.threadId || message.threadId || '').trim(),
      internalDate: Number(detail?.internalDate || 0),
      to: findHeader(headers, 'To'),
      subject: findHeader(headers, 'Subject'),
      rfcMessageId: findHeader(headers, 'Message-Id'),
    });
  }
  return results;
}
