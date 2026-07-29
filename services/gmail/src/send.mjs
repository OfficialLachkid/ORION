import { assertGmailRuntimeConfig, resolveGmailRuntimeConfig } from './config.mjs';
import { buildRfc822Message, toBase64Url } from './mime.mjs';
import { fetchAccessToken } from './oauth.mjs';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts';
const GMAIL_DRAFT_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send';

function normalizeConfigObject(gmailConfig = {}) {
  return {
    clientId: String(gmailConfig.clientId || '').trim(),
    clientSecret: String(gmailConfig.clientSecret || '').trim(),
    refreshToken: String(gmailConfig.refreshToken || '').trim(),
    senderEmail: String(gmailConfig.senderEmail || gmailConfig.fromEmail || '').trim(),
    senderName: String(gmailConfig.senderName || '').trim(),
    loopbackPort: Number.isFinite(gmailConfig.loopbackPort) && gmailConfig.loopbackPort > 0
      ? gmailConfig.loopbackPort
      : 53682,
    redirectUri: String(gmailConfig.redirectUri || '').trim(),
    bccAudit: Array.isArray(gmailConfig.bccAudit) ? gmailConfig.bccAudit.filter(Boolean) : [],
    draftOnly: gmailConfig.draftOnly === true,
  };
}

function resolveInputConfig(envOrConfig) {
  if (envOrConfig?.clientId || envOrConfig?.clientSecret || envOrConfig?.refreshToken || envOrConfig?.senderEmail) {
    return normalizeConfigObject(envOrConfig);
  }

  return resolveGmailRuntimeConfig(envOrConfig || {});
}

function normalizeDraft(gmailConfig, draft) {
  return {
    to: draft.to,
    subject: draft.subject,
    bodyText: draft.bodyText,
    fromEmail: draft.fromEmail || gmailConfig.senderEmail,
    fromName: draft.fromName || gmailConfig.senderName || '',
    replyTo: draft.replyTo || '',
    bcc: draft.bcc && draft.bcc.length > 0 ? draft.bcc : gmailConfig.bccAudit,
    // Threading (follow-ups): In-Reply-To/References go into the MIME headers;
    // threadId goes on the Gmail API request so Gmail nests it in the thread.
    inReplyTo: draft.inReplyTo || '',
    references: draft.references || '',
    threadId: draft.threadId || '',
  };
}

function previewBody(bodyText) {
  return String(bodyText || '').replace(/\s+/gu, ' ').trim().slice(0, 240);
}

function preserveBodyText(bodyText) {
  return String(bodyText || '')
    .replace(/\r\n/gu, '\n')
    .replace(/\r/gu, '\n')
    .trim();
}

async function readJsonResponse(response) {
  if (typeof response?.text === 'function') {
    const bodyText = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = {};
    }
    return { bodyText, payload };
  }

  if (typeof response?.json === 'function') {
    const payload = await response.json();
    return {
      bodyText: JSON.stringify(payload || {}),
      payload: payload || {},
    };
  }

  return { bodyText: '', payload: {} };
}

async function sendGmailApiRequest(gmailConfig, url, body, options = {}) {
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const { bodyText, payload } = await readJsonResponse(response);
  if (!response.ok) {
    const label = options.errorLabel || 'Gmail API request';
    throw new Error(`${label} failed (${response.status}): ${bodyText || 'no body'}`);
  }

  return payload;
}

export async function sendGmailMessage(envOrConfig, draft, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const normalized = normalizeDraft(gmailConfig, draft);
  const raw = toBase64Url(buildRfc822Message(normalized));

  if (gmailConfig.draftOnly === true || options.draftOnly === true) {
    const draftResult = await createGmailDraft(gmailConfig, normalized, {
      ...options,
      fetch: fetchImpl,
      fetchAccessToken: fetchAccessTokenImpl,
      __precomputedRaw: raw,
    });
    return { ...draftResult, mode: 'draft_only' };
  }

  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_SEND_URL, { raw }, {
    fetch: fetchImpl,
    fetchAccessToken: fetchAccessTokenImpl,
    errorLabel: 'Gmail send',
  });

  return {
    mode: 'sent',
    messageId: payload.id || '',
    threadId: payload.threadId || '',
    labelIds: payload.labelIds || [],
    to: normalized.to,
    from: normalized.fromEmail,
    subject: normalized.subject,
    sentAtUtc: new Date().toISOString(),
  };
}

export async function createGmailDraft(envOrConfig, draft, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const normalized = normalizeDraft(gmailConfig, draft);
  const raw = options.__precomputedRaw || toBase64Url(buildRfc822Message(normalized));

  // threadId on the message nests a follow-up draft in the original thread.
  const message = normalized.threadId ? { raw, threadId: normalized.threadId } : { raw };
  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_DRAFTS_URL, { message }, {
    fetch: fetchImpl,
    fetchAccessToken: fetchAccessTokenImpl,
    errorLabel: 'Gmail draft create',
  });

  return {
    mode: 'draft_created',
    draftId: payload.id || '',
    messageId: payload.message?.id || '',
    threadId: payload.message?.threadId || '',
    to: normalized.to,
    from: normalized.fromEmail,
    subject: normalized.subject,
    bodyText: preserveBodyText(normalized.bodyText),
    bodyPreview: previewBody(normalized.bodyText),
    createdAtUtc: new Date().toISOString(),
  };
}

export async function sendGmailDraft(envOrConfig, draftId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const draftIdentifier = String(draftId || '').trim();
  if (!draftIdentifier) {
    throw new Error('Missing Gmail draft ID.');
  }

  const payload = await sendGmailApiRequest(gmailConfig, GMAIL_DRAFT_SEND_URL, { id: draftIdentifier }, {
    ...options,
    errorLabel: 'Gmail draft send',
  });

  return {
    mode: 'sent',
    draftId: draftIdentifier,
    messageId: String(payload.id || '').trim(),
    threadId: String(payload.threadId || '').trim(),
    labelIds: Array.isArray(payload.labelIds) ? payload.labelIds : [],
  };
}

// Deletes an UNSENT draft (DELETE /drafts/{id}). Used when a draft is
// superseded/regenerated so a stale version can't be sent by mistake. Only
// ever touches drafts, never sent mail.
export async function deleteGmailDraft(envOrConfig, draftId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const draftIdentifier = String(draftId || '').trim();
  if (!draftIdentifier) {
    throw new Error('Missing Gmail draft ID.');
  }

  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(`${GMAIL_DRAFTS_URL}/${encodeURIComponent(draftIdentifier)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 204 No Content = deleted; 404 = already gone (idempotent-friendly).
  if (!response.ok && response.status !== 404) {
    const errorText = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Gmail draft delete failed (${response.status}): ${errorText || 'no body'}`);
  }

  return { deleted: true, draftId: draftIdentifier };
}

// Reads a still-unsent draft's current subject/body from Gmail. The Gmail
// draft is the source of truth once the operator opens Gmail and starts
// editing — our stored copy is only the snapshot we produced. Returns null if
// the draft is gone (sent/deleted); returns { subject, bodyText, bodyPreview }
// if it still exists. Uses format=full and walks the MIME tree for the first
// text/plain part, base64url-decoded. gmail.compose scope covers reading own
// drafts, so no new OAuth scope is needed.
export async function getGmailDraft(envOrConfig, draftId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const draftIdentifier = String(draftId || '').trim();
  if (!draftIdentifier) {
    return null;
  }

  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const url = `${GMAIL_DRAFTS_URL}/${encodeURIComponent(draftIdentifier)}?format=full`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const errorText = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Gmail draft read failed (${response.status}): ${errorText || 'no body'}`);
  }

  const payload = await response.json();
  const messagePayload = payload?.message?.payload || {};
  const headers = Array.isArray(messagePayload.headers) ? messagePayload.headers : [];
  const subjectHeader = headers.find((h) => String(h?.name || '').toLowerCase() === 'subject');
  const subject = String(subjectHeader?.value || '').trim();
  const bodyText = extractTextPlainBody(messagePayload);
  const preserved = preserveBodyText(bodyText);
  return {
    subject,
    bodyText: preserved,
    bodyPreview: previewBody(preserved),
  };
}

function decodeBase64Url(data) {
  const normalized = String(data || '').replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    return Buffer.from(padded, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Walks a Gmail message payload tree looking for the first text/plain part.
// Our own drafts are always plain text (buildRfc822Message writes text/plain),
// but if the operator's Gmail client rewrites the draft as multipart/alternative
// on edit, the text/plain part will still be inside — this handles both.
function extractTextPlainBody(payload) {
  if (!payload || typeof payload !== 'object') {
    return '';
  }
  const mimeType = String(payload.mimeType || '').toLowerCase();
  if (mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = extractTextPlainBody(part);
      if (found) {
        return found;
      }
    }
  }
  // Last resort: single-part message with no explicit mimeType handling.
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return '';
}

// Enumerates every unsent Gmail draft with light metadata (id, To, subject,
// internalDate). Used by the reconciler to detect the "mobile Gmail edit"
// pattern — the operator opens a draft on their phone/iPad, edits, saves,
// and Gmail creates a NEW draft under the hood instead of updating the
// existing one in place. Our stored draftId then points at the untouched
// original while the actual edited version lives under a new id. Matching
// by recipient (+ newer internalDate) lets us find and repoint to the edit.
// Uses format=metadata so we don't decode bodies for drafts we won't touch.
export async function listGmailDraftsSummary(envOrConfig, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const maxResults = Math.max(1, Math.min(500, options.maxResults || 200));
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });

  const listUrl = `${GMAIL_DRAFTS_URL}?maxResults=${maxResults}`;
  const listResponse = await fetchImpl(listUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listResponse.ok) {
    const errorText = typeof listResponse.text === 'function' ? await listResponse.text() : '';
    throw new Error(`Gmail draft list failed (${listResponse.status}): ${errorText || 'no body'}`);
  }
  const listPayload = await listResponse.json();
  const ids = Array.isArray(listPayload.drafts)
    ? listPayload.drafts.map((d) => String(d?.id || '')).filter(Boolean)
    : [];

  const summaries = [];
  for (const id of ids) {
    const detailUrl = `${GMAIL_DRAFTS_URL}/${encodeURIComponent(id)}?format=metadata&metadataHeaders=To&metadataHeaders=Subject`;
    const res = await fetchImpl(detailUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // One draft failing to fetch shouldn't kill the whole enumeration —
      // reconciler treats a missing summary as "no candidate found" and skips.
      continue;
    }
    const detail = await res.json();
    const headers = detail?.message?.payload?.headers || [];
    const to = normalizeEmail(findHeader(headers, 'To'));
    const subject = String(findHeader(headers, 'Subject') || '').trim();
    const internalDate = Number(detail?.message?.internalDate || 0);
    summaries.push({ id, to, subject, internalDate });
  }
  return summaries;
}

function findHeader(headers, name) {
  const lowered = String(name || '').toLowerCase();
  const match = headers.find((h) => String(h?.name || '').toLowerCase() === lowered);
  return match ? String(match.value || '') : '';
}

// Strip display name + angle brackets, lowercase — so "Foo <a@b.com>" and
// "a@b.com" compare equal.
function normalizeEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  const angle = value.match(/<([^>]+)>/u);
  return angle ? angle[1].trim() : value;
}

// Checks whether an unsent draft still exists (GET /drafts/{id}). Returns
// true if it's still a draft, false if it's gone (sent — via API or the Gmail
// UI — or deleted). The reconciler uses this to detect drafts the operator
// sent manually, so the Discord approval can be flipped to "sent" and the
// lead marked, without a click. Throws only on unexpected errors (not 404).
export async function gmailDraftExists(envOrConfig, draftId, options = {}) {
  const gmailConfig = resolveInputConfig(envOrConfig);
  assertGmailRuntimeConfig(gmailConfig);
  const draftIdentifier = String(draftId || '').trim();
  if (!draftIdentifier) {
    return false;
  }

  const fetchImpl = options.fetch || options.fetchImpl || fetch;
  const fetchAccessTokenImpl = options.fetchAccessToken || fetchAccessToken;
  const { accessToken } = await fetchAccessTokenImpl(gmailConfig, { fetch: fetchImpl });
  const response = await fetchImpl(`${GMAIL_DRAFTS_URL}/${encodeURIComponent(draftIdentifier)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    const errorText = typeof response.text === 'function' ? await response.text() : '';
    throw new Error(`Gmail draft lookup failed (${response.status}): ${errorText || 'no body'}`);
  }
  return true;
}
