import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isNoResultsLeadgenError,
  mapLeadToRow,
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
