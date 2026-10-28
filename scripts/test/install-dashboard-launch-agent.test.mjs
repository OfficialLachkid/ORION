import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDashboardPlistContent } from '../install-dashboard-launch-agent.mjs';

test('dashboard LaunchAgent stays loopback-backed and escapes filesystem paths', () => {
  const plist = buildDashboardPlistContent({
    nodePath: '/opt/homebrew/bin/node',
    scriptPath: '/Users/Agent/Workspace/ORION/services/dashboard/index.mjs',
    workingDirectory: '/Users/Agent/Workspace/ORION & tools',
    stdoutPath: '/tmp/dashboard.out.log',
    stderrPath: '/tmp/dashboard.err.log',
  });

  assert.match(plist, /io\.vbj\.orion\.dashboard/u);
  assert.match(plist, /services\/dashboard\/index\.mjs/u);
  assert.match(plist, /ORION &amp; tools/u);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<true\/>/u);
  assert.doesNotMatch(plist, /--host/u);
});

