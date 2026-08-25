import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFollowUpSubject } from '../lib/follow-up-subject.mjs';

test('normalizeFollowUpSubject prepends Re: to the original subject', () => {
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: 'Uw website oogt gedateerd' }),
    'Re: Uw website oogt gedateerd',
  );
});

test('normalizeFollowUpSubject strips existing Re: from the original before re-adding', () => {
  // Guard against double-prefixing when the ORIGINAL subject already carried
  // a Re: (e.g. because it was itself a reply). Gmail's UI collapses
  // "Re: Re: X" into a single "Re: X" but our thread lookup should stay
  // consistent.
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: 'Re: Uw website oogt gedateerd' }),
    'Re: Uw website oogt gedateerd',
  );
});

test('normalizeFollowUpSubject strips Fwd: too so forwards do not leak into the follow-up subject', () => {
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: 'Fwd: Uw website oogt gedateerd' }),
    'Re: Uw website oogt gedateerd',
  );
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: 'FW: Uw website' }),
    'Re: Uw website',
  );
});

test('normalizeFollowUpSubject strips Dutch Antw: prefix', () => {
  // Antw: is the Dutch equivalent of Re:; Gmail Nederlands sometimes writes
  // it that way when the original was drafted in Outlook / another Dutch
  // mail client.
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: 'Antw: Uw website' }),
    'Re: Uw website',
  );
});

test('normalizeFollowUpSubject falls back to Claude subject when original is missing', () => {
  // Belt and braces: if the original subject somehow isn't on the lead row
  // (very old lead written before subjects were persisted), fall back to
  // whatever Claude produced rather than sending an empty subject.
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: '', fallbackSubject: 'Follow-up regarding my earlier email' }),
    'Follow-up regarding my earlier email',
  );
});

test('normalizeFollowUpSubject returns empty string if both original and fallback are missing', () => {
  assert.equal(normalizeFollowUpSubject({}), '');
});

test('normalizeFollowUpSubject trims whitespace around the original subject', () => {
  assert.equal(
    normalizeFollowUpSubject({ originalSubject: '   Uw website oogt gedateerd   ' }),
    'Re: Uw website oogt gedateerd',
  );
});
