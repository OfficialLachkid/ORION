import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEveningQualificationPlistContent } from '../install-evening-qualification-schedule.mjs';

const baseArgs = {
  nodePath: '/opt/homebrew/Cellar/node/26.3.1/bin/node',
  nodeBinDir: '/opt/homebrew/Cellar/node/26.3.1/bin',
  scriptPath: '/Users/Agent/Workspace/ORION/scripts/run-lead-qualification.mjs',
  workingDirectory: '/Users/Agent/Workspace/ORION',
  stdoutPath: '/Users/Agent/Library/Logs/vbj/evening-qualification.stdout.log',
  stderrPath: '/Users/Agent/Library/Logs/vbj/evening-qualification.stderr.log',
  hour: 19,
  minute: 0,
  limit: 30,
};

test('buildEveningQualificationPlistContent wires the label + working directory', () => {
  const plist = buildEveningQualificationPlistContent(baseArgs);
  assert.match(plist, /<key>Label<\/key>\s*<string>io\.vbj\.orion\.evening-qualification<\/string>/u);
  assert.match(plist, /<key>WorkingDirectory<\/key>\s*<string>\/Users\/Agent\/Workspace\/ORION<\/string>/u);
});

test('buildEveningQualificationPlistContent runs run-lead-qualification.mjs directly (NOT run-night-shift.mjs)', () => {
  // Regression guard for the deliberate design decision: this schedule
  // triggers qualification only, not the full night-shift with reconcile /
  // follow-ups / video queue maintenance / backlog replenishment. Running
  // the full night-shift twice a day could over-fill the video review queue.
  const plist = buildEveningQualificationPlistContent(baseArgs);
  assert.match(plist, /<string>[^<]*run-lead-qualification\.mjs<\/string>/u);
  assert.doesNotMatch(plist, /run-night-shift\.mjs/u);
});

test('buildEveningQualificationPlistContent passes --limit through to the qualification script', () => {
  const plist = buildEveningQualificationPlistContent({ ...baseArgs, limit: 42 });
  assert.match(plist, /<string>--limit<\/string>\s*<string>42<\/string>/u);
});

test('buildEveningQualificationPlistContent respects custom hour + minute', () => {
  const plist = buildEveningQualificationPlistContent({ ...baseArgs, hour: 20, minute: 30 });
  assert.match(plist, /<key>Hour<\/key>\s*<integer>20<\/integer>/u);
  assert.match(plist, /<key>Minute<\/key>\s*<integer>30<\/integer>/u);
});

test('buildEveningQualificationPlistContent uses StartCalendarInterval (once/day at a fixed time), not StartInterval', () => {
  // Guard against accidentally switching to interval-based polling — this
  // job MUST fire once per day at 19:00, not every N seconds.
  const plist = buildEveningQualificationPlistContent(baseArgs);
  assert.match(plist, /<key>StartCalendarInterval<\/key>/u);
  assert.doesNotMatch(plist, /<key>StartInterval<\/key>/u);
});

test('buildEveningQualificationPlistContent puts the node executable directory on PATH so subprocess spawns find node', () => {
  const plist = buildEveningQualificationPlistContent(baseArgs);
  assert.match(plist, /<key>PATH<\/key>/u);
  assert.match(plist, /\/opt\/homebrew\/Cellar\/node\/26\.3\.1\/bin/u);
});
