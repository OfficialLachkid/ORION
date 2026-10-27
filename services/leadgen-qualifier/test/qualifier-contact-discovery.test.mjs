import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQualificationPrompt } from '../src/qualifier.mjs';

function baseLead(overrides = {}) {
  return {
    id: 'lead-1',
    business_name: 'Testbedrijf',
    source_url: 'https://example.com/',
    domain: 'example.com',
    contact_email: null,
    contact_phone: null,
    kvk_number: '12345678',
    services: [],
    social_links: [],
    niche: 'plumbing',
    ...overrides,
  };
}

test('qualifier prompt tells Claude to check the FOOTER explicitly', () => {
  // Operator flagged 2026-08-14: many "no email" leads had emails visible in
  // the footer. Regression guard so the footer-check instruction stays.
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /FOOTER/u);
});

test('qualifier prompt tells Claude to look for mailto: and tel: links', () => {
  // WebFetch markdown surfaces mailto/tel as machine-readable links; these
  // are often the ONLY parseable contact even when the visible text hides it.
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /mailto:/u);
  assert.match(prompt, /tel:/u);
});

test('qualifier prompt lists multiple dedicated contact-page URLs to try', () => {
  const prompt = buildQualificationPrompt(baseLead());
  // At minimum: /contact, /over-ons, /colofon should be listed.
  assert.match(prompt, /\/contact/u);
  assert.match(prompt, /\/over-ons/u);
  assert.match(prompt, /\/colofon/u);
});

test('qualifier prompt asks Claude to return contact_phone alongside contact_email', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /"contact_phone"/u);
  assert.match(prompt, /"contact_email"/u);
});

test('qualifier prompt notes when we already have a contact_email so Claude leaves it alone unless a better one is found', () => {
  const prompt = buildQualificationPrompt(baseLead({ contact_email: 'existing@example.com' }));
  assert.match(prompt, /existing@example\.com/u);
  assert.match(prompt, /return it unchanged|leave it/iu);
});

test('qualifier prompt notes when we already have a contact_phone so Claude leaves it alone unless a better one is found', () => {
  const prompt = buildQualificationPrompt(baseLead({ contact_phone: '+31 20 123 4567' }));
  assert.match(prompt, /\+31 20 123 4567/u);
});

test('qualifier prompt includes the operator email style inspiration', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /Draft style inspiration to follow/u);
  assert.match(prompt, /Tijdens het bekijken van de website/u);
  assert.match(prompt, /Zou het een gekke gedachte zijn/u);
  assert.match(prompt, /Valentijn Jacobs/u);
});

test('qualifier prompt forbids long dashes in generated email copy', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /Do NOT use em dashes or en dashes in generated draft_subject or draft_body/u);
});

// Regressions for the 2026-10-27 contact_email tightening. The
// morning-shift pre-send check (outreach-presend-checks.mjs) and the
// scraper + qualifier gates (email-tld-allowlist.mjs) already catch
// these at later stages, but the earliest + cheapest place to kill
// them is the local LLM itself. Pin the specific guidance so a
// prompt refactor can't silently drop it.

test('qualifier prompt rejects asset-TLD addresses from the contact_email candidates', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /File-extension TLDs/u, 'prompt must name the asset-TLD rejection rule');
  assert.match(prompt, /\.webp/u, 'prompt must mention the production case (.webp)');
  assert.match(prompt, /flags@2x\.webp/u, 'prompt must reference the actual 2026-10-27 production failure so the LLM has a concrete example to pattern-match against');
});

test('qualifier prompt rejects glued-word TLDs (scraper swallowed the next word)', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /Glued-word TLDs/u);
  assert.match(prompt, /\.commaandag/u, 'prompt must mention the .commaandag production case');
  assert.match(prompt, /\.comtelefoonnummer/u, 'prompt must mention the .comtelefoonnummer production case');
});

test('qualifier prompt tells the LLM to strip punctuation / markdown cruft before returning', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /Punctuation-glued addresses/u);
  assert.match(prompt, /\[info@foo\.nl\]\(mailto:info@foo\.nl\)/u, 'prompt must call out the markdown-wrapper form');
});

test('qualifier prompt rejects placeholder strings as contact_email', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /Placeholder/u);
  assert.match(prompt, /Contact via website/u);
  assert.match(prompt, /\*protected email\*/u);
});

test('qualifier prompt tells the LLM to decode HTML entities before returning (or return null)', () => {
  const prompt = buildQualificationPrompt(baseLead());
  assert.match(prompt, /HTML-entity/u, 'prompt must call out the HTML-entity-encoded case');
  assert.match(prompt, /decode the entities/u, 'prompt must tell the LLM to decode, not pass through');
});

test('contact_email JSON-schema line references the rejection rules so the LLM re-reads them before writing', () => {
  const prompt = buildQualificationPrompt(baseLead());
  // The JSON output block's inline description of contact_email now
  // points back at step 3's rejection rules. Prevents a tired prompt
  // reader from relying only on the schema line.
  assert.match(prompt, /"contact_email":[^\n]*rejection rules/u);
});
