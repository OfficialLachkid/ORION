import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInstagramAnalyticsSweepPlistContent,
  DEFAULT_HOUR,
  DEFAULT_LAUNCH_AGENT_PATH,
  DEFAULT_MINUTE,
  PLIST_LABEL,
  SWEEP_SCRIPT_RELATIVE_PATH,
} from '../install-instagram-analytics-sweep-schedule.mjs';

test('install-schedule plist uses the daily 09:00 schedule and exposes Homebrew tools', () => {
  const plist = buildInstagramAnalyticsSweepPlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: `/repo/${SWEEP_SCRIPT_RELATIVE_PATH}`,
    workingDirectory: '/repo',
    stdoutPath: '/tmp/ig-out.log',
    stderrPath: '/tmp/ig-err.log',
    hour: DEFAULT_HOUR,
    minute: DEFAULT_MINUTE,
  });
  assert.ok(plist.includes(`<string>${PLIST_LABEL}</string>`));
  assert.ok(plist.includes(`<string>/repo/${SWEEP_SCRIPT_RELATIVE_PATH}</string>`));
  // No Weekday key — launchd reads Hour+Minute-only as "daily."
  assert.ok(!plist.includes('<key>Weekday</key>'), 'daily sweep plist must NOT include a Weekday key');
  assert.ok(plist.includes('<key>Hour</key>\n    <integer>9</integer>'));
  assert.ok(plist.includes('<key>Minute</key>\n    <integer>0</integer>'));
  assert.ok(plist.includes(`<string>${DEFAULT_LAUNCH_AGENT_PATH}</string>`));
  assert.ok(DEFAULT_LAUNCH_AGENT_PATH.includes('/opt/homebrew/bin'));
  assert.ok(plist.includes('/tmp/ig-err.log'));
});

test('install-schedule plist honors custom hour + minute overrides', () => {
  const plist = buildInstagramAnalyticsSweepPlistContent({
    nodePath: '/usr/local/bin/node',
    scriptPath: `/repo/${SWEEP_SCRIPT_RELATIVE_PATH}`,
    workingDirectory: '/repo',
    stdoutPath: '/tmp/ig-out.log',
    stderrPath: '/tmp/ig-err.log',
    hour: 14,
    minute: 30,
  });
  assert.ok(plist.includes('<key>Hour</key>\n    <integer>14</integer>'));
  assert.ok(plist.includes('<key>Minute</key>\n    <integer>30</integer>'));
});
