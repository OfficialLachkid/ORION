import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRfc822Message, toBase64Url } from '../src/mime.mjs';

test('buildRfc822Message emits headers, MIME, and body', () => {
  const raw = buildRfc822Message({
    to: 'prospect@example.com',
    fromEmail: 'sender@example.com',
    fromName: 'VBJ Services',
    subject: 'Hello there',
    bodyText: 'Line one\nLine two',
  });
  const lines = raw.split('\r\n');
  assert.ok(lines.includes('From: "VBJ Services" <sender@example.com>'));
  assert.ok(lines.includes('To: <prospect@example.com>'));
  assert.ok(lines.includes('Subject: Hello there'));
  assert.ok(lines.includes('MIME-Version: 1.0'));
  assert.ok(lines.includes('Content-Type: text/plain; charset="UTF-8"'));
  assert.ok(raw.endsWith('\r\nLine one\nLine two'));
});

test('buildRfc822Message encodes non-ASCII subjects as RFC 2047', () => {
  const raw = buildRfc822Message({
    to: 'p@example.com',
    fromEmail: 'sender@example.com',
    subject: 'Groeten uit Nederland',
    bodyText: 'x',
  });
  // "Groeten uit Nederland" is ASCII; use a real non-ASCII case to prove encoding.
  const raw2 = buildRfc822Message({
    to: 'p@example.com',
    fromEmail: 'sender@example.com',
    subject: 'Café — invitation',
    bodyText: 'x',
  });
  assert.ok(raw.includes('Subject: Groeten uit Nederland'));
  assert.ok(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/u.test(raw2));
});

test('buildRfc822Message includes BCC when provided', () => {
  const raw = buildRfc822Message({
    to: 'p@example.com',
    fromEmail: 's@example.com',
    subject: 'x',
    bodyText: 'y',
    bcc: ['audit@example.com', 'copy@example.com'],
  });
  assert.ok(raw.includes('Bcc: <audit@example.com>, <copy@example.com>'));
});

test('buildRfc822Message rejects invalid recipient', () => {
  assert.throws(() => buildRfc822Message({
    to: 'not-an-email',
    subject: 'x',
    bodyText: 'y',
    fromEmail: 's@example.com',
  }), /Invalid recipient/u);
});

test('toBase64Url produces url-safe output without padding', () => {
  const encoded = toBase64Url('hello?world/');
  assert.ok(!encoded.includes('+'));
  assert.ok(!encoded.includes('/'));
  assert.ok(!encoded.endsWith('='));
});
