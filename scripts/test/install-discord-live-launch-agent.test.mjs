import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlistContent, LAUNCHAGENT_PATH, PLIST_LABEL } from '../install-discord-live-launch-agent.mjs';

test('bot plist includes EnvironmentVariables with a Homebrew-first PATH', () => {
  const plist = buildPlistContent({
    nodePath: '/opt/homebrew/Cellar/node/26.3.1/bin/node',
    scriptPath: '/repo/services/discord-bot/index.mjs',
    workingDirectory: '/repo',
    stdoutPath: '/tmp/bot.stdout.log',
    stderrPath: '/tmp/bot.stderr.log',
  });

  assert.ok(plist.includes(`<string>${PLIST_LABEL}</string>`));
  assert.ok(plist.includes('<key>EnvironmentVariables</key>'), 'plist must set EnvironmentVariables so subprocesses inherit a real PATH');
  assert.ok(plist.includes('<key>PATH</key>'));
  assert.ok(plist.includes(`<string>${LAUNCHAGENT_PATH}</string>`));
  assert.ok(LAUNCHAGENT_PATH.startsWith('/opt/homebrew/bin'), 'PATH must lead with /opt/homebrew/bin so playwright-cli + other Homebrew binaries resolve');
  assert.ok(LAUNCHAGENT_PATH.includes('/usr/bin'), 'PATH must still include standard system directories');
});
