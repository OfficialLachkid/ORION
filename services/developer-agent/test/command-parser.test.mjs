import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseDeveloperTaskCommand,
  serializeDeveloperTaskCommand,
} from '../src/command-parser.mjs';

test('parseDeveloperTaskCommand recognizes an explicit developer issue request', () => {
  assert.deepEqual(parseDeveloperTaskCommand('create issue for developer: fix the queue ordering bug'), {
    objective: 'fix the queue ordering bug',
    baseBranch: 'main',
  });
});

test('parseDeveloperTaskCommand ignores ordinary coding discussion', () => {
  assert.equal(parseDeveloperTaskCommand('How should a developer agent work?'), null);
});

test('serializeDeveloperTaskCommand creates the deterministic Discord form', () => {
  assert.equal(
    serializeDeveloperTaskCommand({ objective: 'add a CI branch label' }),
    'create issue for developer: add a CI branch label'
  );
});
