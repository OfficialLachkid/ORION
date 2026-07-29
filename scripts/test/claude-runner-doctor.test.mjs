import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runClaudeRunnerDoctor } from '../claude-runner-doctor.mjs';

function buildConfig(overrides = {}) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'ruflo-doctor-'));
  return {
    env: {},
    runtimePaths: { tmpDir: join(tmpRoot, 'tmp') },
    claude: {
      enabled: true,
      command: 'claude',
      permissionMode: 'acceptEdits',
      workingDirectory: tmpRoot,
      ...overrides.claude,
    },
    ...overrides.root,
  };
}

function stubRunner(responses) {
  return (command, args) => {
    const key = `${command} ${(args || []).join(' ')}`.trim();
    if (Object.prototype.hasOwnProperty.call(responses, key)) {
      return responses[key];
    }
    if (Object.prototype.hasOwnProperty.call(responses, command)) {
      return responses[command];
    }
    return { code: 0, stdout: '', stderr: '', error: '' };
  };
}

test('runClaudeRunnerDoctor reports blocked when claude CLI is not on PATH', async () => {
  const config = buildConfig();
  const report = await runClaudeRunnerDoctor(config, {
    runCommand: stubRunner({
      'whoami': { code: 0, stdout: 'agent', stderr: '' },
      'id -u': { code: 0, stdout: '501', stderr: '' },
      '/usr/bin/which claude': { code: 1, stdout: '', stderr: 'claude not found' },
    }),
    readPlist: () => '',
    probe: () => ({ writable: true, error: '' }),
  });
  assert.equal(report.state, 'blocked');
  assert.ok(report.checks.some((check) => check.name === 'claude_cli_on_path' && check.state === 'blocked'));
});

test('runClaudeRunnerDoctor reports blocked when auth status shows not logged in', async () => {
  const config = buildConfig();
  const report = await runClaudeRunnerDoctor(config, {
    runCommand: stubRunner({
      'whoami': { code: 0, stdout: 'agent', stderr: '' },
      'id -u': { code: 0, stdout: '501', stderr: '' },
      '/usr/bin/which claude': { code: 0, stdout: '/opt/homebrew/bin/claude', stderr: '' },
      'claude --version': { code: 0, stdout: '1.2.3 (Claude Code)', stderr: '' },
      'claude auth status': { code: 0, stdout: '{"loggedIn":false}', stderr: '' },
    }),
    readPlist: () => '',
    probe: () => ({ writable: true, error: '' }),
  });
  assert.equal(report.state, 'blocked');
  assert.ok(report.checks.some((check) => check.name === 'claude_cli_auth' && check.state === 'blocked'));
});

test('runClaudeRunnerDoctor returns ready when everything passes', async () => {
  const config = buildConfig();
  const plist = `<plist>
    <dict>
      <key>Label</key><string>io.ruv.ruflo.discord-bot</string>
      <key>WorkingDirectory</key><string>${config.claude.workingDirectory}</string>
      <key>RunAtLoad</key><true/>
      <key>KeepAlive</key><true/>
    </dict>
  </plist>`;
  const report = await runClaudeRunnerDoctor(config, {
    runCommand: stubRunner({
      'whoami': { code: 0, stdout: 'agent', stderr: '' },
      'id -u': { code: 0, stdout: '501', stderr: '' },
      '/usr/bin/which claude': { code: 0, stdout: '/opt/homebrew/bin/claude', stderr: '' },
      'claude --version': { code: 0, stdout: '1.2.3 (Claude Code)', stderr: '' },
      'claude auth status': { code: 0, stdout: '{"loggedIn":true,"authMethod":"claudeai"}', stderr: '' },
    }),
    readPlist: () => plist,
    probe: () => ({ writable: true, error: '' }),
  });
  const nonReady = report.checks.filter((check) => check.state !== 'ready');
  const softChecks = new Set(['vault_bridge_export_present', 'discord_bot_launchagent']);
  const meaningfulFailures = nonReady.filter((check) => !softChecks.has(check.name));
  assert.deepEqual(meaningfulFailures, [], `unexpected doctor failures: ${JSON.stringify(nonReady, null, 2)}`);
  assert.ok(['ready', 'degraded'].includes(report.state));
});
