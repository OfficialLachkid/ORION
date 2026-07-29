import { assertGmailRuntimeConfig, resolveGmailRuntimeConfig } from './config.mjs';
import { fetchAccessToken } from './oauth.mjs';

const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads';

function resolveInputConfig(envOrConfig) {
  if (envOrConfig?.clientId || envOrConfig?.clientSecret || envOrConfig?.refreshToken || envOrConfig?.senderEmail) {
    return envOrConfig;
  }
  return resolveGmailRuntimeConfig(envOrConfig || {});
}

// Reads a thread's messages with header metadata only (format=metadata — no
// bodies; needs the gmail.metadata read scope). Returns { messages: [...] }
// where each message has id, labelIds, and the requested headers. Throws with
// a recognizable message on 403 so callers can detect the "read scope not yet
// authorized" state and skip reply detection gracefully.
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

  const url = new URL(`${GMAIL_THREADS_URL}/${encodeURIComponent(id)}`);
  url.searchParams.set('format', 'metadata');
  for (const header of ['From', 'Subject', 'Auto-Submitted', 'Message-Id']) {
    url.searchParams.append('metadataHeaders', header);
  }

  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 403) {
    throw new Error('GMAIL_READ_SCOPE_MISSING: reading the thread returned 403 — re-authorize Gmail with the gmail.metadata scope.');
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
