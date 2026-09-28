import test from 'node:test';
import assert from 'node:assert/strict';
import { PS_OPT_OUT_FOOTER, ensureOptOutFooter, hasOptOutFooter } from '../src/opt-out-footer.mjs';

test('hasOptOutFooter recognizes the canonical PS line', () => {
  assert.equal(hasOptOutFooter(`Beste,\n\ntekst\n\n${PS_OPT_OUT_FOOTER}`), true);
});

test('hasOptOutFooter recognizes alternative Dutch opt-out phrasings', () => {
  assert.equal(hasOptOutFooter('...\n\nStuur me niet meer mailen aub.'), true);
  assert.equal(hasOptOutFooter('...\n\nPS: laat weten als u wilt afmelden.'), true);
  assert.equal(hasOptOutFooter('...\n\nGraag verwijderen uit uw lijst.'), true);
});

test('hasOptOutFooter is diacritics-insensitive', () => {
  assert.equal(hasOptOutFooter('...\n\nGraag afmelden aub.'), true);
});

test('hasOptOutFooter picks up English fallbacks', () => {
  assert.equal(hasOptOutFooter('regards,\n\nps: unsubscribe if you prefer.'), true);
  assert.equal(hasOptOutFooter('please remove me from this list'), true);
});

test('hasOptOutFooter returns false for a normal body with no opt-out language', () => {
  assert.equal(hasOptOutFooter('Beste team,\n\nWij hebben interessante ideeen. Bent u benieuwd?'), false);
  assert.equal(hasOptOutFooter(''), false);
  assert.equal(hasOptOutFooter(null), false);
});

test('ensureOptOutFooter is idempotent — no-op when a phrase is already present', () => {
  const withFooter = `Beste team,\n\ntekst\n\n${PS_OPT_OUT_FOOTER}`;
  assert.equal(ensureOptOutFooter(withFooter), withFooter);
  // Also idempotent for alt-phrase presence
  const alt = 'Beste,\n\nZeg maar als u wilt afmelden.';
  assert.equal(ensureOptOutFooter(alt), alt);
});

test('ensureOptOutFooter appends the PS with a blank-line separator when missing', () => {
  const body = 'Beste team,\n\ntekst\n\nMet vriendelijke groet,\nValentijn';
  const patched = ensureOptOutFooter(body);
  assert.ok(patched.endsWith(PS_OPT_OUT_FOOTER), 'must end with the canonical PS line');
  assert.ok(patched.includes('\n\nPS:'), 'must separate with a blank line before the PS');
  assert.equal(patched.startsWith(body.replace(/\s+$/u, '')), true, 'must preserve the original body');
});

test('ensureOptOutFooter handles empty input gracefully', () => {
  assert.equal(ensureOptOutFooter('').trim(), PS_OPT_OUT_FOOTER.trim());
  assert.equal(ensureOptOutFooter(null).trim(), PS_OPT_OUT_FOOTER.trim());
});

test('ensureOptOutFooter strips trailing whitespace before appending (no triple newline)', () => {
  const body = 'Beste,\n\ntekst\n\n\n\n\n';
  const patched = ensureOptOutFooter(body);
  assert.ok(!patched.includes('\n\n\n\nPS:'), 'must collapse extra trailing newlines when computing separator');
});
