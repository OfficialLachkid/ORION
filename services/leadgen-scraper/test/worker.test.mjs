import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractContactFromHtml,
  hasValidEmailTld,
  isNoResultsLeadgenError,
  mapLeadToRow,
  pickFirstValidEmail,
  sanitizeBusinessType,
  sanitizePlaceholderString,
} from '../src/worker.mjs';

test('isNoResultsLeadgenError matches DuckDuckGo empty-result failures', () => {
  const error = new Error([
    'DuckDuckGo search failed (attempt 1), retrying in 15s: DuckDuckGo search failed: No results found.',
    'scrapegraphai.utils.research_web.SearchRequestError: DuckDuckGo search failed: No results found.',
  ].join('\n'));

  assert.equal(isNoResultsLeadgenError(error), true);
});

test('isNoResultsLeadgenError ignores non-empty-result failures', () => {
  assert.equal(isNoResultsLeadgenError(new Error('DuckDuckGo search failed: connection reset by peer')), false);
  assert.equal(isNoResultsLeadgenError(new Error('Discord API request failed (500): upstream timeout')), false);
});

test('sanitizePlaceholderString nulls out common LLM stand-ins', () => {
  // Observed live 2026-09-05 across 8/48 rows: raw_extraction.kvk_number
  // held literal strings like these instead of the sanitized null the
  // top-level column carried. Cleaning them keeps raw_extraction honest
  // as an audit blob.
  assert.equal(sanitizePlaceholderString('NA'), null);
  assert.equal(sanitizePlaceholderString('N/A'), null);
  assert.equal(sanitizePlaceholderString('None'), null);
  assert.equal(sanitizePlaceholderString('Unknown'), null);
  assert.equal(sanitizePlaceholderString('Not available in the provided text'), null);
  assert.equal(sanitizePlaceholderString('Not found in the provided text.'), null);
  assert.equal(sanitizePlaceholderString('Not provided'), null);
  assert.equal(sanitizePlaceholderString('   '), null);
  assert.equal(sanitizePlaceholderString(''), null);
  assert.equal(sanitizePlaceholderString(null), null);
  assert.equal(sanitizePlaceholderString(undefined), null);
});

test('sanitizePlaceholderString preserves real values', () => {
  assert.equal(sanitizePlaceholderString('EpilepsieNL'), 'EpilepsieNL');
  assert.equal(sanitizePlaceholderString('12345678'), '12345678');
  assert.equal(sanitizePlaceholderString('  Stichting  '), 'Stichting');
});

test('sanitizeBusinessType strips search-query leakage', () => {
  // Real 2026-09-05 observation: business_type was stored as "loodgieters Heeze"
  // — the LLM echoed the query back as the business type when it couldn't
  // find an actual classification. Filter that out so analytics stays clean.
  assert.equal(sanitizeBusinessType('loodgieters Heeze', 'loodgieters Heeze'), '');
  assert.equal(sanitizeBusinessType('LOODGIETERS HEEZE', 'loodgieters Heeze'), '');
});

test('sanitizeBusinessType nulls out placeholders and caps oversized strings', () => {
  assert.equal(sanitizeBusinessType('NA'), '');
  assert.equal(sanitizeBusinessType(null), '');
  const long = 'a'.repeat(200);
  assert.equal(sanitizeBusinessType(long).length, 80);
});

test('sanitizeBusinessType preserves normal values', () => {
  assert.equal(sanitizeBusinessType('Makelaar', 'makelaars Oostburg'), 'Makelaar');
  assert.equal(sanitizeBusinessType('Elektriciteit en installatietechniek'), 'Elektriciteit en installatietechniek');
});

test('mapLeadToRow marks rows with no email and no phone as no_contact', () => {
  // Fail-fast so the qualifier doesn't burn a slot on a row it can't
  // possibly reach. Original behavior: always "new" regardless of
  // contact info. 6/13 unqualified rows in the 2026-09-05 batch hit this.
  const row = mapLeadToRow({
    source_url: 'https://example.nl/',
    business_name: 'Example BV',
  }, { query: 'test', niche: 'plumbing', location: 'Test' });
  assert.equal(row.status, 'no_contact');
});

test('mapLeadToRow keeps rows with at least one contact channel as new', () => {
  const withEmail = mapLeadToRow({
    source_url: 'https://example.nl/',
    business_name: 'Example BV',
    contact_email: 'info@example.nl',
  }, { query: 'test', niche: 'plumbing', location: 'Test' });
  assert.equal(withEmail.status, 'new');

  const withPhone = mapLeadToRow({
    source_url: 'https://example.nl/',
    business_name: 'Example BV',
    contact_phone: '+31 20 555 0100',
  }, { query: 'test', niche: 'plumbing', location: 'Test' });
  assert.equal(withPhone.status, 'new');
});

test('mapLeadToRow uses existing contact info from prior extraction when current run has none', () => {
  const existing = new Map([['example.nl', {
    contact_email: 'kept@example.nl',
    contact_phone: '+31 20 555 0100',
  }]]);
  const row = mapLeadToRow(
    { source_url: 'https://example.nl/', business_name: 'Example BV' },
    { query: 'test', niche: 'plumbing', location: 'Test' },
    existing,
  );
  assert.equal(row.contact_email, 'kept@example.nl');
  assert.equal(row.status, 'new', 'existing contact info should keep the row qualifiable');
});

test('mapLeadToRow cleans placeholder strings out of raw_extraction', () => {
  const row = mapLeadToRow({
    source_url: 'https://example.nl/',
    business_name: 'Example BV',
    business_type: 'Not available in the provided text',
    kvk_number: 'NA',
    contact_email: 'info@example.nl',
  }, { query: 'test', niche: 'plumbing', location: 'Test' });
  assert.equal(row.raw_extraction.business_type, null);
  assert.equal(row.raw_extraction.kvk_number, null);
  assert.equal(row.raw_extraction.business_name, 'Example BV');
});

test('extractContactFromHtml prefers mailto/tel hrefs over plain-text matches', () => {
  // Contact-page fallback lands on a /contact page and needs to reliably
  // pull the ONE canonical email + phone even when the surrounding page
  // mentions other addresses (e.g. dev contact, partner emails). Href
  // attributes are the authoritative signal — the operator's business
  // wants their own contact, not the site vendor's.
  const html = `
    <p>Vragen? Bel of mail: <a href="mailto:info@voorbeeld.nl">Stuur mail</a></p>
    <p>Bereikbaar via <a href="tel:+31 20 555 0100">020 555 0100</a></p>
    <p>Website gemaakt door dev@leverancier.nl</p>
  `;
  const contact = extractContactFromHtml(html);
  assert.equal(contact.email, 'info@voorbeeld.nl');
  assert.match(contact.phone, /555 ?0100/u);
});

test('extractContactFromHtml falls back to a plain-text Dutch phone number when no tel: href', () => {
  const html = 'Bel ons op 020-1234599 tijdens kantooruren.';
  const contact = extractContactFromHtml(html);
  assert.equal(contact.email, null);
  assert.equal(contact.phone, '020-1234599');
});

test('extractContactFromHtml strips placeholder phone numbers (123456 signature)', () => {
  // sanitizePhone runs on the extracted phone too — a fabricated
  // placeholder like +31 20 1234567 is worse than an empty field for
  // outreach.
  const html = 'Voorbeeld: +31 20 1234567';
  const contact = extractContactFromHtml(html);
  assert.equal(contact.phone, null);
});

test('extractContactFromHtml returns nulls on empty input', () => {
  assert.deepEqual(extractContactFromHtml(''), { email: null, phone: null });
  assert.deepEqual(extractContactFromHtml(null), { email: null, phone: null });
  assert.deepEqual(extractContactFromHtml(undefined), { email: null, phone: null });
});

test('hasValidEmailTld: accepts common ccTLDs + gTLDs, rejects known false-positives', () => {
  // Real-world business TLDs — must pass
  for (const email of [
    'info@acme.nl', 'contact@example.com', 'hello@foo.co.uk', 'sales@shop.be',
    'test@startup.io', 'contact@firm.app', 'info@shop.store', 'me@acme.me',
    'info@firma.de', 'office@entreprise.fr',
  ]) {
    assert.equal(hasValidEmailTld(email), true, `${email} should pass`);
  }
  // Known false-positives from the 2026-10-20 bulk-send dedup report — must reject
  for (const bogus of [
    'flags@2x.webp',                                   // image filename parsed as email
    'contact@verhuisbedrijfhaarlem.commaandag',        // Dutch "maandag" glued to .com
    'klantenservice@arnhemglaszetter.comtelefoonnummer', // "telefoonnummer" glued to .com
    'logo@site.png',                                    // image ref
    'file@thing.pdf',                                   // doc ref
    'intro@video.mp4',                                  // video ref
  ]) {
    assert.equal(hasValidEmailTld(bogus), false, `${bogus} should be rejected`);
  }
  // Edge cases
  assert.equal(hasValidEmailTld(''), false);
  assert.equal(hasValidEmailTld(null), false);
  assert.equal(hasValidEmailTld('no-at-sign'), false);
});

test('pickFirstValidEmail: scans text, skips bogus TLDs, returns first valid email', () => {
  // Image attr followed by a real contact link — must skip the image, pick the real one
  const html = '<img src="flags@2x.webp" alt="flag"><a href="mailto:hello@shop.nl">Contact</a>';
  assert.equal(pickFirstValidEmail(html), 'hello@shop.nl');
  // All-bogus text — returns null (nothing valid)
  assert.equal(pickFirstValidEmail('junk flags@2x.webp more flags@foo.pdf'), null);
  // Null-safe
  assert.equal(pickFirstValidEmail(null), null);
  assert.equal(pickFirstValidEmail(''), null);
});

test('extractContactFromHtml: rejects a `<img src="flags@2x.webp">` false positive even when it is the only "email" in the page', () => {
  // Regression guard for the 2026-10-20 incident: the pre-fix regex
  // pulled `flags@2x.webp` as a contact email, which bounced on send.
  const html = '<html><body><img src="flags@2x.webp"></body></html>';
  assert.equal(extractContactFromHtml(html).email, null);
});

test('extractContactFromHtml: a bogus mailto: href falls through to body-scan (if body has a valid one)', () => {
  // If someone encodes a bogus TLD in a mailto: href (e.g. template
  // output), we should NOT prefer it — fall through to body text.
  const html = '<a href="mailto:foo@bar.commaandag">bad</a> <p>Reach us: real@shop.nl</p>';
  assert.equal(extractContactFromHtml(html).email, 'real@shop.nl');
});

test('extractContactFromHtml: picks the real email even when the HTML also contains an image-attr lookalike', () => {
  const html = '<img src="logo@2x.png" alt="logo"><p>Mail <a href="mailto:info@firm.nl">info@firm.nl</a></p>';
  assert.equal(extractContactFromHtml(html).email, 'info@firm.nl');
});
