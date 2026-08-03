import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseLastJsonObject,
  parseTrailingJsonArray,
} from '../lib/night-shift/process-utils.mjs';

test('parseTrailingJsonArray extracts the final JSON array from mixed stdout', () => {
  const stdout = [
    '[info] starting step',
    '[info] more logs',
    JSON.stringify([{ id: 'a' }, { id: 'b' }], null, 2),
  ].join('\n');

  assert.deepEqual(parseTrailingJsonArray(stdout), [
    { id: 'a' },
    { id: 'b' },
  ]);
});

test('parseLastJsonObject extracts the final JSON object from mixed stdout', () => {
  const stdout = [
    '[info] refreshed 3 messages',
    JSON.stringify({ refreshed: 3, failed: 0 }, null, 2),
  ].join('\n');

  assert.deepEqual(parseLastJsonObject(stdout), {
    refreshed: 3,
    failed: 0,
  });
});
