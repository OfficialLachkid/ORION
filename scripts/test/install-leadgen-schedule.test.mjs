import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLeadgenPlistContent } from '../install-leadgen-schedule.mjs';

const baseArgs = {
  nodePath: '/opt/homebrew/Cellar/node/26.3.1/bin/node',
  scriptPath: '/Users/Agent/Workspace/ORION/scripts/run-scheduled-leadgen.mjs',
  workingDirectory: '/Users/Agent/Workspace/ORION',
  stdoutPath: '/Users/Agent/Library/Logs/vbj/leadgen-schedule.stdout.log',
  stderrPath: '/Users/Agent/Library/Logs/vbj/leadgen-schedule.stderr.log',
  hour: 7,
  minute: 0,
};

test('buildLeadgenPlistContent OMITS --times when times=1 (preserves existing single-sweep behavior)', () => {
  const plist = buildLeadgenPlistContent({ ...baseArgs, times: 1 });
  assert.doesNotMatch(plist, /<string>--times<\/string>/u);
});

test('buildLeadgenPlistContent EMITS --times when times is unspecified (defaults to 4 post-2026-09-06 contact-fallback bump)', () => {
  // Bumped 3→4 after contact-fallback lifted usable-leads rate 43% → 79.7%.
  // See DEFAULT_TIMES in install-leadgen-schedule.mjs for the reasoning.
  const plist = buildLeadgenPlistContent(baseArgs);
  assert.match(plist, /<string>--times<\/string>\s*<string>4<\/string>/u);
});

test('buildLeadgenPlistContent EMITS --times when times>1 so leadgen chains sequential sweeps', () => {
  // Regression guard: without this passthrough the "chain 2 sweeps back-to-back
  // in the 07:00-09:00 quiet-machine window" mechanism silently falls back to
  // a single sweep.
  const plist = buildLeadgenPlistContent({ ...baseArgs, times: 2 });
  assert.match(plist, /<string>--times<\/string>\s*<string>2<\/string>/u);
});

test('buildLeadgenPlistContent passes through custom times values', () => {
  const plist = buildLeadgenPlistContent({ ...baseArgs, times: 3 });
  assert.match(plist, /<string>--times<\/string>\s*<string>3<\/string>/u);
});

test('buildLeadgenPlistContent wires label + schedule + working directory', () => {
  const plist = buildLeadgenPlistContent({ ...baseArgs, hour: 8, minute: 15 });
  assert.match(plist, /<string>io\.vbj\.orion\.leadgen-schedule<\/string>/u);
  assert.match(plist, /<key>Hour<\/key>\s*<integer>8<\/integer>/u);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>15<\/integer>/u);
  assert.match(plist, /<string>\/Users\/Agent\/Workspace\/ORION<\/string>/u);
});
