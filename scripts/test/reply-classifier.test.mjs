import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyThreadReply, detectOptOutInText, extractGmailMessageBodyText } from '../lib/reply-classifier.mjs';

const OURS = 'vbjtechservices@gmail.com';

// Encode plain text as base64url the way Gmail returns it in message parts.
function b64url(text) {
  return Buffer.from(text, 'utf8').toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/u, '');
}

function msg(from, subject = '', extraHeaders = [], bodyText = null) {
  const payload = {
    headers: [
      { name: 'From', value: from },
      { name: 'Subject', value: subject },
      ...extraHeaders,
    ],
  };
  if (bodyText !== null) {
    payload.mimeType = 'text/plain';
    payload.body = { data: b64url(bodyText) };
  }
  return { payload };
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

// ── Opt-out detection ─────────────────────────────────────────────────

test('detectOptOutInText marks Dutch "afmelden" as HIGH-confidence opt-out', () => {
  const r = detectOptOutInText('Graag afmelden, ik heb hier geen behoefte aan.');
  assert.equal(r.level, 'high');
  assert.ok(r.matched.includes('afmelden'));
});

test('detectOptOutInText matches diacritics-insensitively (geïnteresseerd)', () => {
  const r = detectOptOutInText('Sorry, wij zijn niet geïnteresseerd op dit moment.');
  assert.equal(r.level, 'low', 'soft "niet geïnteresseerd" must be low-confidence, not auto-suppress');
});

test('detectOptOutInText prefers HIGH when both signals present', () => {
  const r = detectOptOutInText('Geen interesse, graag verwijderen uit jullie systeem.');
  assert.equal(r.level, 'high');
  assert.ok(r.matched.includes('graag verwijderen'));
});

test('detectOptOutInText returns none for a normal reply body', () => {
  assert.equal(detectOptOutInText('Bedankt voor je bericht, ik neem het mee.').level, 'none');
  assert.equal(detectOptOutInText('').level, 'none');
});

test('detectOptOutInText picks up an English unsubscribe request', () => {
  const r = detectOptOutInText('Please remove me from this list, unsubscribe me.');
  assert.equal(r.level, 'high');
});

test('detectOptOutInText scans subject line too (empty body)', () => {
  const r = detectOptOutInText('', 'AFMELDEN');
  assert.equal(r.level, 'high');
});

// ── Full classifyThreadReply with body scanning ───────────────────────

test('classifyThreadReply flags kind=opt_out on a reply whose body says afmelden', () => {
  const thread = [
    msg(OURS, 'uw website'),
    msg('info@boutiquestore.nl', 'Re: uw website', [], 'Graag afmelden, bedankt.'),
  ];
  const r = classifyThreadReply(thread, OURS);
  assert.equal(r.kind, 'opt_out');
  assert.equal(r.optOut.level, 'high');
  assert.ok(r.optOut.matched.includes('afmelden'));
});

test('classifyThreadReply keeps kind=reply but attaches soft opt-out flag for "niet geïnteresseerd"', () => {
  const thread = [
    msg(OURS, 'uw website'),
    msg('info@boutiquestore.nl', 'Re: uw website', [], 'Bedankt, maar wij zijn niet geïnteresseerd.'),
  ];
  const r = classifyThreadReply(thread, OURS);
  assert.equal(r.kind, 'reply', 'soft signal must NOT auto-unsubscribe');
  assert.ok(r.optOut, 'soft signal must still surface via optOut field for operator review');
  assert.equal(r.optOut.level, 'low');
});

test('classifyThreadReply falls back cleanly when message has no body (metadata-only fetch)', () => {
  const thread = [
    msg(OURS, 'uw website'),
    msg('info@boutiquestore.nl', 'Re: uw website'), // no body
  ];
  const r = classifyThreadReply(thread, OURS);
  assert.equal(r.kind, 'reply');
  assert.equal(r.optOut, undefined, 'no body + neutral subject → no opt-out flag');
});

test('classifyThreadReply catches opt-out on subject alone in metadata-only mode', () => {
  const thread = [
    msg(OURS, 'uw website'),
    msg('info@boutiquestore.nl', 'Afmelden'), // metadata-only, opt-out in subject
  ];
  const r = classifyThreadReply(thread, OURS);
  assert.equal(r.kind, 'opt_out', 'subject-only opt-out must still fire in metadata-only mode');
});

test('bounce is classified as bounce even when body would otherwise match opt-out', () => {
  const thread = [
    msg(OURS, 'uw website'),
    msg('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', [], 'Address does not exist, unsubscribe.'),
  ];
  assert.equal(classifyThreadReply(thread, OURS).kind, 'bounce', 'bounce classification wins over body opt-out scan');
});

test('extractGmailMessageBodyText handles nested multipart parts', () => {
  const nested = {
    payload: {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>ignored</p>') } },
        { mimeType: 'text/plain', body: { data: b64url('afmelden aub') } },
      ],
    },
  };
  assert.ok(extractGmailMessageBodyText(nested).includes('afmelden aub'));
});
