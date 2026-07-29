import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDoctorState,
  parseClaudeAuthStatusText,
  parseLaunchAgentPlistText,
} from '../lib/claude-runner-diagnostics.mjs';

test('classifyDoctorState prefers blocked over degraded and ready', () => {
  assert.equal(
    classifyDoctorState([
      { state: 'ready' },
      { state: 'degraded' },
      { state: 'blocked' },
    ]),
    'blocked'
  );
});

test('classifyDoctorState returns degraded when only degraded present', () => {
  assert.equal(
    classifyDoctorState([
      { state: 'ready' },
      { state: 'degraded' },
    ]),
    'degraded'
  );
});

test('classifyDoctorState returns ready when all ready', () => {
  assert.equal(
    classifyDoctorState([{ state: 'ready' }, { state: 'ready' }]),
    'ready'
  );
});

test('parseClaudeAuthStatusText handles JSON payload', () => {
  const parsed = parseClaudeAuthStatusText('{"loggedIn":true,"authMethod":"claudeai","apiProvider":"anthropic"}');
  assert.equal(parsed.loggedIn, true);
  assert.equal(parsed.authMethod, 'claudeai');
  assert.equal(parsed.apiProvider, 'anthropic');
});

test('parseClaudeAuthStatusText detects logged-in text fallback', () => {
  const parsed = parseClaudeAuthStatusText('You are logged in as agent@example.com');
  assert.equal(parsed.loggedIn, true);
  assert.equal(parsed.raw, 'You are logged in as agent@example.com');
});

test('parseClaudeAuthStatusText detects not-logged-in text', () => {
  const parsed = parseClaudeAuthStatusText('You are not logged in. Please run claude auth login.');
  assert.equal(parsed.loggedIn, false);
});

test('parseLaunchAgentPlistText extracts key fields', () => {
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>Label</key>
    <string>io.ruv.ruflo.discord-bot</string>
    <key>WorkingDirectory</key>
    <string>/Users/Agent/Workspace/ruflo</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/node</string>
      <string>/Users/Agent/Workspace/ruflo/services/discord-bot/index.mjs</string>
      <string>--live</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    </dict>
  </dict>
  </plist>`;
  const parsed = parseLaunchAgentPlistText(plist);
  assert.equal(parsed.label, 'io.ruv.ruflo.discord-bot');
  assert.equal(parsed.workingDirectory, '/Users/Agent/Workspace/ruflo');
  assert.equal(parsed.runAtLoad, true);
  assert.equal(parsed.keepAlive, true);
  assert.deepEqual(parsed.programArguments, [
    '/opt/homebrew/bin/node',
    '/Users/Agent/Workspace/ruflo/services/discord-bot/index.mjs',
    '--live',
  ]);
  assert.equal(parsed.environmentVariables.PATH, '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin');
});
