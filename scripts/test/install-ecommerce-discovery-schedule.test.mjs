import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEcommerceDiscoveryPlist,
  defaultPilotEnd,
  ECOMMERCE_DISCOVERY_WEEKDAYS,
} from '../install-ecommerce-discovery-schedule.mjs';

test('ecommerce discovery plist schedules Monday, Wednesday, and Friday at 00:15', () => {
  const plist = buildEcommerceDiscoveryPlist({
    nodePath: '/opt/homebrew/bin/node',
    nodeBinDir: '/opt/homebrew/bin',
    scriptPath: '/Users/Agent/Workspace/ORION/scripts/run-ecommerce-discovery.mjs',
    workingDirectory: '/Users/Agent/Workspace/ORION',
    stdoutPath: '/tmp/ecommerce.stdout.log',
    stderrPath: '/tmp/ecommerce.stderr.log',
    pilotEnd: '2026-11-09',
  });
  for (const weekday of ECOMMERCE_DISCOVERY_WEEKDAYS) {
    assert.match(plist, new RegExp(`<key>Weekday</key>\\n    <integer>${weekday}</integer>`, 'u'));
  }
  assert.equal((plist.match(/<key>Hour<\/key>\n    <integer>0<\/integer>/gu) || []).length, 3);
  assert.equal((plist.match(/<key>Minute<\/key>\n    <integer>15<\/integer>/gu) || []).length, 3);
  assert.match(plist, /<string>--pilot-end<\/string>\n    <string>2026-11-09<\/string>/u);
  assert.match(plist, /<key>StandardOutPath<\/key>/u);
  assert.match(plist, /<key>StandardErrorPath<\/key>/u);
  assert.doesNotMatch(plist, /bash|sh -c/u);
});

test('default pilot end is four calendar weeks after installation', () => {
  assert.equal(defaultPilotEnd(new Date('2026-10-12T10:00:00.000Z')), '2026-11-09');
});
