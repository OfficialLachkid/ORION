import test from 'node:test';
import assert from 'node:assert/strict';
import { findSentGmailMessages } from '../src/read.mjs';

test('findSentGmailMessages searches sent mail and returns receipt metadata', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/messages?')) {
      return { ok: true, json: async () => ({ messages: [{ id: 'm1', threadId: 't1' }] }) };
    }
    return {
      ok: true,
      json: async () => ({
        id: 'm1',
        threadId: 't1',
        internalDate: '1794056400000',
        payload: {
          headers: [
            { name: 'To', value: 'Lead <lead@example.nl>' },
            { name: 'Subject', value: 'Hello' },
            { name: 'Message-Id', value: '<rfc-1@example>' },
          ],
        },
      }),
    };
  };
  const result = await findSentGmailMessages({
    clientId: 'id',
    clientSecret: 'secret',
    refreshToken: 'refresh',
    senderEmail: 'sender@example.nl',
  }, 'to:lead@example.nl after:1 before:2', {
    fetchImpl,
    fetchAccessToken: async () => ({ accessToken: 'token' }),
  });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0], {
    messageId: 'm1',
    threadId: 't1',
    internalDate: 1794056400000,
    to: 'Lead <lead@example.nl>',
    subject: 'Hello',
    rfcMessageId: '<rfc-1@example>',
  });
  assert.match(calls[0], /q=in%3Asent\+to%3Alead%40example\.nl/u);
});
