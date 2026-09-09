import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeGeneratedDraftFields,
  sanitizeGeneratedDraftPunctuation,
} from '../src/draft-style.mjs';

test('sanitizeGeneratedDraftPunctuation replaces long dashes with commas', () => {
  assert.equal(
    sanitizeGeneratedDraftPunctuation('Beste klant — korte vraag – over uw website'),
    'Beste klant , korte vraag , over uw website',
  );
});

test('sanitizeGeneratedDraftFields only normalizes generated subject and body', () => {
  const payload = sanitizeGeneratedDraftFields({
    decision: 'qualified',
    reasoning: 'The website has a slow load — useful signal.',
    draft_subject: 'uw website — kort',
    draft_body: 'Beste Testbedrijf,\n\nIk zag iets op uw site – mag ik een ontwerp maken?\n\nVBJ Services',
  });

  assert.equal(payload.reasoning, 'The website has a slow load — useful signal.');
  assert.equal(payload.draft_subject, 'uw website , kort');
  assert.equal(
    payload.draft_body,
    'Beste Testbedrijf,\n\nIk zag iets op uw site , mag ik een ontwerp maken?\n\nVBJ Services',
  );
});
