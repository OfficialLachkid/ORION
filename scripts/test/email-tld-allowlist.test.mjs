import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EMAIL_TLD_ALLOWLIST,
  hasValidEmailTld,
  isObviouslyBogusContactEmail,
  pickFirstValidEmail,
} from '../lib/email-tld-allowlist.mjs';

test('EMAIL_TLD_ALLOWLIST covers the common European + global business TLDs', () => {
  for (const tld of ['nl', 'be', 'de', 'fr', 'uk', 'eu', 'com', 'org', 'net', 'io', 'ai', 'co']) {
    assert.ok(EMAIL_TLD_ALLOWLIST.has(tld), `${tld} must be in the allowlist`);
  }
});

test('hasValidEmailTld accepts the TLDs real Dutch SME contact pages use', () => {
  const ok = [
    'info@shop.nl',
    'contact@example.com',
    'hello@example.co.uk',
    'ops@example.io',
    'team@example.ai',
    'kontakt@example.de',
    'bonjour@example.fr',
  ];
  for (const email of ok) {
    assert.equal(hasValidEmailTld(email), true, `${email} must pass`);
  }
});

test('hasValidEmailTld rejects the asset-TLDs the scraper + qualifier can emit by accident', () => {
  const bogus = [
    'flags@2x.webp',          // the production case 2026-10-27
    'logo@sprite.png',
    'icon@menu.svg',
    'bundle@app.js',
    'style@theme.css',
    'brochure@assets.pdf',
    'font@body.woff2',
  ];
  for (const email of bogus) {
    assert.equal(hasValidEmailTld(email), false, `${email} must be rejected`);
  }
});

test('hasValidEmailTld refuses empty, null, no-@, and no-dot inputs', () => {
  assert.equal(hasValidEmailTld(''), false);
  assert.equal(hasValidEmailTld(null), false);
  assert.equal(hasValidEmailTld(undefined), false);
  assert.equal(hasValidEmailTld('no-at-sign'), false);
  assert.equal(hasValidEmailTld('user@localhost'), false, 'no dot after the @');
});

test('hasValidEmailTld reads the TLD from AFTER the @, not any dot in the local-part', () => {
  // A legitimate address can carry a dot (e.g. a filename-like token)
  // in its local part. The check must still look at the domain's TLD.
  assert.equal(hasValidEmailTld('foo.bar@example.com'), true);
  assert.equal(hasValidEmailTld('report.pdf@example.nl'), true, '.pdf in local part is fine; .nl is the real TLD');
});

test('pickFirstValidEmail returns the first address with an allowlisted TLD, skipping bogus matches', () => {
  const html = `
    <img src="/img/flags@2x.webp" />
    <style>bundle@app.js</style>
    <a href="mailto:hello@shop.nl">Contact</a>
    <a href="mailto:spam@spammer.com">Spam</a>
  `;
  // flags@2x.webp and bundle@app.js both match the plain regex but
  // their TLDs are blocked. hello@shop.nl is the first allowlisted hit.
  assert.equal(pickFirstValidEmail(html), 'hello@shop.nl');
});

test('pickFirstValidEmail returns null when the text has no allowlisted address', () => {
  assert.equal(pickFirstValidEmail('<img src="/x@foo.webp" />'), null);
  assert.equal(pickFirstValidEmail(''), null);
  assert.equal(pickFirstValidEmail(null), null);
});

// ─── isObviouslyBogusContactEmail (sweep verdict) ───────────────────

test('isObviouslyBogusContactEmail: catches placeholder text and no-TLD junk', () => {
  // The sweep saw 35 of these in production: "Contact via website",
  // "*protected email*", "geen email adres op de website".
  assert.equal(isObviouslyBogusContactEmail('Contact via website'), true);
  assert.equal(isObviouslyBogusContactEmail('*protected email*'), true);
  assert.equal(isObviouslyBogusContactEmail('geen email adres op de website'), true);
  assert.equal(isObviouslyBogusContactEmail('user@localhost'), true, 'no dot in the domain');
  assert.equal(isObviouslyBogusContactEmail(''), true);
  assert.equal(isObviouslyBogusContactEmail(null), true);
});

test('isObviouslyBogusContactEmail: catches asset-TLDs (same as the pre-send blocklist)', () => {
  assert.equal(isObviouslyBogusContactEmail('flags@2x.webp'), true);
  assert.equal(isObviouslyBogusContactEmail('icons@2x-1f26d508.png'), true);
  assert.equal(isObviouslyBogusContactEmail('bundle@app.js'), true);
  assert.equal(isObviouslyBogusContactEmail('style@theme.css'), true);
});

test('isObviouslyBogusContactEmail: catches scraper-glued Dutch words (the real production noise)', () => {
  // Scraper swallowed the next word on the page. From the sweep: 7 of
  // these each.
  assert.equal(isObviouslyBogusContactEmail('contact@hoveniertilburg.commaandag'), true);
  assert.equal(isObviouslyBogusContactEmail('contact@glaszetternijmegen.netmaandag'), true);
  assert.equal(isObviouslyBogusContactEmail('klantenservice@amsterdamdakdekker.comtelefoonnummer'), true);
  assert.equal(isObviouslyBogusContactEmail('contact@elektricienamersfoort.netwij'), true);
});

test('isObviouslyBogusContactEmail: LEAVES recoverable formatting cruft alone when a real email is still in there', () => {
  // Both of these still contain a well-formed `foo@bar.nl` buried in
  // punctuation. The sweep must not throw them away — a future
  // cleanup pass can strip the cruft and recover a real address.
  assert.equal(isObviouslyBogusContactEmail('info@dienstje.nl\\'), false, 'trailing backslash');
  assert.equal(isObviouslyBogusContactEmail('[info@loodgietersbedrijfdenhaag.nl](mailto:info@loodgietersbedrijfdenhaag.nl)'), false, 'markdown wrapper');
});

test('isObviouslyBogusContactEmail: a URL stored in the contact_email field (no @ at all) IS obviously bogus', () => {
  // loodgietersbedrijfvanderlely.nl/contact/ — no @ anywhere, just a
  // URL the scraper mis-filed under contact_email. Not an email, not
  // recoverable, correctly rejected.
  assert.equal(isObviouslyBogusContactEmail('loodgietersbedrijfvanderlely.nl/contact/'), true);
  assert.equal(isObviouslyBogusContactEmail('loodgieterdienst.nl'), true, 'bare domain string, no @');
});

test('isObviouslyBogusContactEmail: legit emails are left alone (regression — no over-reject)', () => {
  const ok = [
    'info@example.nl',
    'contact@firstlast.co.uk',
    'hello@my-business.com',
    'ops@orion.io',
    'team@startup.ai',
    'info@westlanders.nu',  // Niue — real Dutch ccTLD, added 2026-10-27
  ];
  for (const email of ok) {
    assert.equal(isObviouslyBogusContactEmail(email), false, `${email} must be left alone`);
  }
});
