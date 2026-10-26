import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInstagramAnalyticsSweepPlistContent,
  DEFAULT_HOUR,
  DEFAULT_LAUNCH_AGENT_PATH,
  DEFAULT_MINUTE,
  DEFAULT_WEEKDAY,
  PLIST_LABEL,
  SWEEP_SCRIPT_RELATIVE_PATH,
} from '../install-instagram-analytics-sweep-schedule.mjs';

test('install-schedule plist uses the Sunday 23:00 pre-review schedule and exposes Homebrew tools', () => {
  const plist = buildInstagramAnalyticsSweepPlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: `/repo/${SWEEP_SCRIPT_RELATIVE_PATH}`,
    workingDirectory: '/repo',
    stdoutPath: '/tmp/ig-out.log',
    stderrPath: '/tmp/ig-err.log',
    weekday: DEFAULT_WEEKDAY,
    hour: DEFAULT_HOUR,
    minute: DEFAULT_MINUTE,
  });
  assert.ok(plist.includes(`<string>${PLIST_LABEL}</string>`));
  assert.ok(plist.includes(`<string>/repo/${SWEEP_SCRIPT_RELATIVE_PATH}</string>`));
  // Weekly cadence requires a Weekday key; omitting it would fire daily.
  assert.ok(plist.includes('<key>Weekday</key>\n    <integer>0</integer>'), 'weekly sweep plist must include Weekday=0 (Sunday)');
  assert.ok(plist.includes('<key>Hour</key>\n    <integer>23</integer>'));
  assert.ok(plist.includes('<key>Minute</key>\n    <integer>0</integer>'));
  assert.ok(plist.includes(`<string>${DEFAULT_LAUNCH_AGENT_PATH}</string>`));
  assert.ok(DEFAULT_LAUNCH_AGENT_PATH.includes('/opt/homebrew/bin'));
  assert.ok(plist.includes('/tmp/ig-err.log'));
});

test('install-schedule plist honors custom weekday + hour + minute overrides', () => {
  const plist = buildInstagramAnalyticsSweepPlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: `/repo/${SWEEP_SCRIPT_RELATIVE_PATH}`,
    workingDirectory: '/repo',
    stdoutPath: '/tmp/ig-out.log',
    stderrPath: '/tmp/ig-err.log',
    weekday: 3,
    hour: 14,
    minute: 30,
  });
  assert.ok(plist.includes('<key>Weekday</key>\n    <integer>3</integer>'));
  assert.ok(plist.includes('<key>Hour</key>\n    <integer>14</integer>'));
  assert.ok(plist.includes('<key>Minute</key>\n    <integer>30</integer>'));
});
