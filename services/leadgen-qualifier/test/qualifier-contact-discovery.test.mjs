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
