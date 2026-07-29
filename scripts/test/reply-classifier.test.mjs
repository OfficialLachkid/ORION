import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyThreadReply } from '../lib/reply-classifier.mjs';

const OURS = 'vbjtechservices@gmail.com';

function msg(from, subject = '', extraHeaders = []) {
  return {
    payload: {
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
        ...extraHeaders,
      ],
    },
  };
}

test('single message (just our send) is not a reply', () => {
  assert.equal(classifyThreadReply([msg(OURS, 'Onze offerte')], OURS).kind, 'none');
});

test('a real human reply is classified as reply', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg('Jan de Vries <jan@loodgieterjan.nl>', 'Re: Onze offerte')];
  const result = classifyThreadReply(thread, OURS);
  assert.equal(result.kind, 'reply');
  assert.equal(result.from, 'jan@loodgieterjan.nl');
});

test('a bounce from mailer-daemon is classified as bounce, not reply', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg('Mail Delivery Subsystem <mailer-daemon@googlemail.com>', 'Delivery Status Notification (Failure)')];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'bounce');
});

test('a postmaster bounce is classified as bounce', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg('postmaster@example.nl', 'Undeliverable: Onze offerte')];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'bounce');
});

test('an out-of-office auto-reply is classified as auto_reply, not reply', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg('info@loodgieter.nl', 'Automatisch antwoord: Onze offerte')];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'auto_reply');
});

test('Auto-Submitted header marks an auto-reply even with a plain subject', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg('info@loodgieter.nl', 'Re: Onze offerte', [{ name: 'Auto-Submitted', value: 'auto-replied' }])];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'auto_reply');
});

test('a thread that only grew with our own follow-up is not a reply', () => {
  const thread = [msg(OURS, 'Onze offerte'), msg(`VBJ Services <${OURS}>`, 'Re: Onze offerte')];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'none');
});
