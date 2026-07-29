import test from 'node:test';
import assert from 'node:assert/strict';
import { createGmailDraft, sendGmailMessage } from '../src/send.mjs';

function baseConfig(overrides = {}) {
  return {
    clientId: 'client-abc.apps.googleusercontent.com',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    senderEmail: 'sender@example.com',
    senderName: 'VBJ Services',
    loopbackPort: 53682,
    bccAudit: [],
    draftOnly: false,
    ...overrides,
  };
}

function stubAccessTokenFn() {
  return async () => ({ accessToken: 'ya29.stub', expiresIn: 3599 });
}

test('sendGmailMessage refuses when required fields are missing', async () => {
  await assert.rejects(
    sendGmailMessage(baseConfig({ refreshToken: '' }), { to: 'p@example.com', subject: 'x', bodyText: 'y' }),
    /GMAIL_REFRESH_TOKEN/u
  );
});

test('sendGmailMessage posts a base64url raw payload to the Gmail send endpoint', async () => {
  let capturedUrl = '';
  let capturedBody = '';
  let capturedAuth = '';
  const stubFetch = async (url, options) => {
    capturedUrl = url;
    capturedBody = options.body;
    capturedAuth = options.headers?.Authorization || '';
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm-1', threadId: 't-1', labelIds: ['SENT'] }) };
  };
  const result = await sendGmailMessage(
    baseConfig(),
    { to: 'prospect@example.com', subject: 'hi', bodyText: 'body' },
    { fetch: stubFetch, fetchAccessToken: stubAccessTokenFn() }
  );
  assert.equal(result.mode, 'sent');
  assert.equal(result.messageId, 'm-1');
  assert.equal(result.threadId, 't-1');
  assert.equal(capturedUrl, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
  assert.equal(capturedAuth, 'Bearer ya29.stub');
  const payload = JSON.parse(capturedBody);
  assert.ok(payload.raw && !payload.raw.includes('+') && !payload.raw.includes('/'));
});

test('sendGmailMessage honours draftOnly by creating a draft', async () => {
  let capturedUrl = '';
  const stubFetch = async (url) => {
    capturedUrl = url;
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'd-1', message: { id: 'm-1', threadId: 't-1' } }) };
  };
  const result = await sendGmailMessage(
    baseConfig({ draftOnly: true }),
    { to: 'p@example.com', subject: 'x', bodyText: 'y' },
    { fetch: stubFetch, fetchAccessToken: stubAccessTokenFn() }
  );
  assert.equal(result.mode, 'draft_only');
  assert.equal(result.draftId, 'd-1');
  assert.equal(capturedUrl, 'https://gmail.googleapis.com/gmail/v1/users/me/drafts');
});

test('sendGmailMessage surfaces Gmail API errors', async () => {
  const stubFetch = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
  await assert.rejects(
    sendGmailMessage(
      baseConfig(),
      { to: 'p@example.com', subject: 'x', bodyText: 'y' },
      { fetch: stubFetch, fetchAccessToken: stubAccessTokenFn() }
    ),
    /Gmail send failed \(403\)/u
  );
});

test('createGmailDraft posts to the drafts endpoint and returns the draft id', async () => {
  const stubFetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ id: 'd-9', message: { id: 'm-9', threadId: 't-9' } }),
  });
  const result = await createGmailDraft(
    baseConfig(),
    { to: 'p@example.com', subject: 'x', bodyText: 'y' },
    { fetch: stubFetch, fetchAccessToken: stubAccessTokenFn() }
  );
  assert.equal(result.mode, 'draft_created');
  assert.equal(result.draftId, 'd-9');
  assert.equal(result.messageId, 'm-9');
});

test('sendGmailMessage attaches configured bccAudit when the draft has no explicit bcc', async () => {
  let payload;
  const stubFetch = async (_url, options) => {
    payload = options.body;
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm', threadId: 't', labelIds: [] }) };
  };
  await sendGmailMessage(
    baseConfig({ bccAudit: ['audit@example.com'] }),
    { to: 'p@example.com', subject: 'x', bodyText: 'y' },
    { fetch: stubFetch, fetchAccessToken: stubAccessTokenFn() }
  );
  const raw = JSON.parse(payload).raw;
  const decoded = Buffer.from(raw.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
  assert.ok(decoded.includes('Bcc: <audit@example.com>'));
});
