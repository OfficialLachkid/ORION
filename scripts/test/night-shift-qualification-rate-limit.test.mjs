import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hasClaudeUsageLimitOutcome,
  isClaudeUsageLimitError,
} from '../lib/night-shift/qualification.mjs';

test('isClaudeUsageLimitError matches the shapes claude -p surfaces on quota exhaustion', () => {
  // Verbatim / near-verbatim strings observed in the wild (2026-08-06 + 2026-08-09).
  assert.equal(isClaudeUsageLimitError('Claude Code usage limit reached. Please try again after 2026-08-06T18:00:00Z.'), true);
  assert.equal(isClaudeUsageLimitError('claude exited with code 1. rate_limit_error: quota exceeded'), true);
  assert.equal(isClaudeUsageLimitError('Anthropic API returned HTTP 429: Too Many Requests'), true);
  assert.equal(isClaudeUsageLimitError('overloaded_error: please try again after a short backoff'), true);
  assert.equal(isClaudeUsageLimitError('resource_exhausted for organization quota'), true);
  // Case + whitespace tolerance
  assert.equal(isClaudeUsageLimitError('  USAGE LIMIT  '), true);
  assert.equal(isClaudeUsageLimitError('Rate-limit hit'), true);
  // Expanded patterns (2026-08-09) — Claude Code sometimes surfaces
  // shorter human-readable phrases without the "usage" keyword.
  assert.equal(isClaudeUsageLimitError('5-hour limit reached'), true);
  assert.equal(isClaudeUsageLimitError('5 hour limit reached'), true);
  assert.equal(isClaudeUsageLimitError('Please wait until 20:00 CET'), true);
  assert.equal(isClaudeUsageLimitError('Try again in 4h'), true);
  assert.equal(isClaudeUsageLimitError('Retry after 2026-08-09T18:00:00Z'), true);
  assert.equal(isClaudeUsageLimitError('Insufficient credits on your account'), true);
  assert.equal(isClaudeUsageLimitError('Message limit reached for this conversation'), true);
});

test('isClaudeUsageLimitError does not misfire on benign errors we want to leave as-is', () => {
  // Non-rate-limit errors that must NOT trigger a marker-skip — otherwise a
  // consistently-failing site (e.g., a 404 site or a Playwright timeout)
  // would perpetually re-arm the 07:00 fallback and never resolve.
  assert.equal(isClaudeUsageLimitError('Qualification timed out after 180s.'), false);
  assert.equal(isClaudeUsageLimitError('Could not parse qualification output: Unexpected token'), false);
  assert.equal(isClaudeUsageLimitError('Unexpected decision \'foo\'.'), false);
  assert.equal(isClaudeUsageLimitError('WebFetch failed: ECONNREFUSED'), false);
  assert.equal(isClaudeUsageLimitError('Site returned 404'), false);
  assert.equal(isClaudeUsageLimitError(''), false);
  assert.equal(isClaudeUsageLimitError(null), false);
  assert.equal(isClaudeUsageLimitError(undefined), false);
});

test('hasClaudeUsageLimitOutcome reports true when any outcome errored with a usage-limit shape', () => {
  const outcomes = [
    { lead: 'A', status: 'qualified' },
    { lead: 'B', error: 'Qualification timed out after 180s.' },
    { lead: 'C', error: 'Claude Code usage limit reached.' },
    { lead: 'D', status: 'rejected_fit' },
  ];
  assert.equal(hasClaudeUsageLimitOutcome(outcomes), true);
});

test('hasClaudeUsageLimitOutcome reports false when only non-rate-limit errors are present', () => {
  const outcomes = [
    { lead: 'A', status: 'qualified' },
    { lead: 'B', error: 'Qualification timed out after 180s.' },
    { lead: 'C', error: 'WebFetch failed: ECONNREFUSED' },
  ];
  assert.equal(hasClaudeUsageLimitOutcome(outcomes), false);
});

test('hasClaudeUsageLimitOutcome handles empty / missing inputs gracefully', () => {
  assert.equal(hasClaudeUsageLimitOutcome([]), false);
  assert.equal(hasClaudeUsageLimitOutcome(null), false);
  assert.equal(hasClaudeUsageLimitOutcome(undefined), false);
  assert.equal(hasClaudeUsageLimitOutcome([{ lead: 'X', status: 'qualified' }]), false);
});
