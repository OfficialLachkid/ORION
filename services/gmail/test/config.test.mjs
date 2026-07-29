import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGmailConfig, summarizeGmailReadiness } from '../src/config.mjs';

test('resolveGmailConfig applies defaults for loopbackPort and draftOnly', () => {
  const config = resolveGmailConfig({ gmail: { clientId: 'a' } });
  assert.equal(config.clientId, 'a');
  assert.equal(config.loopbackPort, 53682);
  assert.equal(config.draftOnly, false);
});

test('summarizeGmailReadiness reports missing credentials', () => {
  const readiness = summarizeGmailReadiness(resolveGmailConfig({ gmail: {} }));
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing.sort(), [
    'GMAIL_CLIENT_ID',
    'GMAIL_CLIENT_SECRET',
    'GMAIL_REFRESH_TOKEN',
    'GMAIL_SENDER_EMAIL',
  ]);
});

test('summarizeGmailReadiness reports ready when all fields present', () => {
  const readiness = summarizeGmailReadiness(resolveGmailConfig({
    gmail: {
      clientId: 'a',
      clientSecret: 'b',
      refreshToken: 'c',
      senderEmail: 'd@e.com',
    },
  }));
  assert.equal(readiness.ready, true);
  assert.equal(readiness.senderEmail, 'd@e.com');
});
