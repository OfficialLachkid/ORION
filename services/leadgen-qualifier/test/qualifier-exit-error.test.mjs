import test from 'node:test';
import assert from 'node:assert/strict';
import { formatQualifierExitError } from '../src/qualifier.mjs';

test('formatQualifierExitError prefers stderr when Claude Code itself throws (crash trace)', () => {
  const stdout = '{"partial": "data"}';
  const stderr = 'Uncaught exception: ReferenceError: foo is not defined';
  assert.equal(formatQualifierExitError(1, stdout, stderr), stderr);
});

test('formatQualifierExitError falls back to stdout when stderr is empty (Claude usage-limit case)', () => {
  // The whole point of this fix: Claude Code writes usage-limit rejections
  // to STDOUT (as part of the JSON error envelope) and exits with empty
  // stderr. Without surfacing stdout, the night-shift rate-limit detector
  // sees only "claude exited with code 1." and lets the marker be written.
  const stdout = 'Claude Code usage limit reached. Please try again after 2026-08-09T18:00:00Z.';
  const stderr = '';
  assert.equal(formatQualifierExitError(1, stdout, stderr), stdout);
});

test('formatQualifierExitError falls through to the exit-code string only when BOTH streams are empty', () => {
  assert.equal(formatQualifierExitError(1, '', ''), 'claude exited with code 1.');
  assert.equal(formatQualifierExitError(137, '', ''), 'claude exited with code 137.');
});

test('formatQualifierExitError trims whitespace from either stream', () => {
  assert.equal(formatQualifierExitError(1, '   ', '   \n  '), 'claude exited with code 1.');
  assert.equal(formatQualifierExitError(1, '  usage limit  ', ''), 'usage limit');
});
