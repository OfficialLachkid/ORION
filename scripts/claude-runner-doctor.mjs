#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { loadRuntimeConfig, projectRoot } from '../services/lib/runtime-config.mjs';
import { resolveClaudeTasksRoot } from '../services/claude-runner/src/payload-store.mjs';
import {
  buildRuntimePath,
  classifyDoctorState,
  parseClaudeAuthStatusText,
  parseLaunchAgentPlistText,
  probeWritablePath,
  readPlistIfPresent,
} from './lib/claude-runner-diagnostics.mjs';
import { postToolReport } from './lib/discord-post.mjs';
import {
  getBooleanOption,
  getStringOption,
  parseArgs,
  printError,
  printInfo,
  printUsage,
  printWarn,
} from './lib/ruflo-wrapper-utils.mjs';

function ok(name, detail = '', extras = {}) {
  return { name, state: 'ready', detail, ...extras };
}
function degraded(name, detail, recovery = '', extras = {}) {
  return { name, state: 'degraded', detail, recovery, ...extras };
}
function blocked(name, detail, recovery = '', extras = {}) {
  return { name, state: 'blocked', detail, recovery, ...extras };
}

function runSync(command, args, env) {
  const result = spawnSync(command, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    code: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    error: result.error ? result.error.message : '',
  };
}

export async function runClaudeRunnerDoctor(config, options = {}) {
  const runCommand = options.runCommand || runSync;
  const readPlist = options.readPlist || readPlistIfPresent;
  const probe = options.probe || probeWritablePath;

  const runtimeEnv = { PATH: buildRuntimePath(config) };
  const checks = [];

  const whoAmI = runCommand('whoami', [], runtimeEnv);
  const uidResult = runCommand('id', ['-u'], runtimeEnv);
  const runtimeUser = whoAmI.stdout || 'unknown';
  const runtimeUid = uidResult.stdout || 'unknown';
  checks.push(ok('runtime_user', `${runtimeUser} (uid ${runtimeUid})`, { user: runtimeUser, uid: runtimeUid }));

  const commandName = config?.claude?.command || 'claude';
  const which = runCommand('/usr/bin/which', [commandName], runtimeEnv);
  if (which.code !== 0 || !which.stdout) {
    checks.push(blocked(
      'claude_cli_on_path',
      `'${commandName}' was not found on PATH: ${runtimeEnv.PATH}`,
      `Install the Claude CLI or add its directory to the LaunchAgent EnvironmentVariables PATH. Consider: npm i -g @anthropic-ai/claude-code`
    ));
  } else {
    checks.push(ok('claude_cli_on_path', which.stdout, { resolvedPath: which.stdout }));
  }

  if (which.code === 0 && which.stdout) {
    const version = runCommand(commandName, ['--version'], runtimeEnv);
    if (version.code !== 0) {
      checks.push(blocked(
        'claude_cli_version',
        version.stderr || version.stdout || 'claude --version failed.',
        `${commandName} --version`
      ));
    } else {
      checks.push(ok('claude_cli_version', version.stdout || 'ok', { version: version.stdout }));
    }

    const auth = runCommand(commandName, ['auth', 'status'], runtimeEnv);
    const parsedAuth = parseClaudeAuthStatusText(auth.stdout || auth.stderr);
    if (!parsedAuth.loggedIn) {
      checks.push(blocked(
        'claude_cli_auth',
        parsedAuth.raw || 'Claude CLI is installed but not logged in for this runtime user.',
        `${commandName} auth login --claudeai`,
        { authMethod: parsedAuth.authMethod, apiProvider: parsedAuth.apiProvider }
      ));
    } else {
      checks.push(ok('claude_cli_auth', `logged in via ${parsedAuth.authMethod || 'unknown'}`, {
        authMethod: parsedAuth.authMethod,
        apiProvider: parsedAuth.apiProvider,
      }));
    }
  }

  const workingDirectory = config?.claude?.workingDirectory || projectRoot;
  const workingDirState = existsSync(workingDirectory)
    ? ok('claude_working_directory', workingDirectory, { workingDirectory })
    : blocked(
      'claude_working_directory',
      `Missing working directory: ${workingDirectory}`,
      `mkdir -p "${workingDirectory}"`
    );
  checks.push(workingDirState);

  const tasksRoot = resolveClaudeTasksRoot(config);
  const tasksProbe = probe(tasksRoot);
  checks.push(tasksProbe.writable
    ? ok('claude_task_artifacts_writable', tasksRoot, { path: tasksRoot })
    : blocked(
      'claude_task_artifacts_writable',
      `Cannot write under ${tasksRoot}: ${tasksProbe.error}`,
      `chmod u+rwx "${tasksRoot}"`
    ));

  const checkpointRoot = resolve(projectRoot, 'data', 'session-checkpoints');
  const checkpointProbe = probe(checkpointRoot);
  checks.push(checkpointProbe.writable
    ? ok('session_checkpoints_writable', checkpointRoot, { path: checkpointRoot })
    : blocked(
      'session_checkpoints_writable',
      `Cannot write under ${checkpointRoot}: ${checkpointProbe.error}`,
      `chmod u+rwx "${checkpointRoot}"`
    ));

  const bridgeExport = resolve(projectRoot, 'data', 'vault-bridge', 'current');
  if (existsSync(bridgeExport)) {
    checks.push(ok('vault_bridge_export_present', bridgeExport, { path: bridgeExport }));
  } else {
    checks.push(degraded(
      'vault_bridge_export_present',
      `Bridge export directory is missing: ${bridgeExport}`,
      'npm run session:start'
    ));
  }

  const discordPlistPath = resolve(homedir(), 'Library', 'LaunchAgents', 'io.ruv.ruflo.discord-bot.plist');
  const plistText = readPlist(discordPlistPath);
  if (!plistText) {
    checks.push(degraded(
      'discord_bot_launchagent',
      `LaunchAgent plist not found at ${discordPlistPath}. Runner-under-managed-session cannot be verified.`,
      'npm run discord:install-live-launch-agent'
    ));
  } else {
    const parsed = parseLaunchAgentPlistText(plistText);
    const workingDirMatches = parsed.workingDirectory === projectRoot
      || resolve(parsed.workingDirectory || '') === projectRoot;
    if (!workingDirMatches) {
      checks.push(degraded(
        'discord_bot_launchagent',
        `LaunchAgent WorkingDirectory (${parsed.workingDirectory}) does not match project root (${projectRoot}).`,
        'Reinstall the Discord bot LaunchAgent: npm run discord:install-live-launch-agent'
      ));
    } else if (parsed.runAtLoad !== true || parsed.keepAlive !== true) {
      checks.push(degraded(
        'discord_bot_launchagent',
        `LaunchAgent is present but RunAtLoad=${parsed.runAtLoad}, KeepAlive=${parsed.keepAlive}.`,
        'Reinstall with RunAtLoad + KeepAlive: npm run discord:install-live-launch-agent'
      ));
    } else {
      checks.push(ok(
        'discord_bot_launchagent',
        `label=${parsed.label} RunAtLoad=true KeepAlive=true`,
        {
          label: parsed.label,
          workingDirectory: parsed.workingDirectory,
          programArguments: parsed.programArguments,
        }
      ));
    }
  }

  const runnerEnabled = config?.claude?.enabled;
  if (runnerEnabled === false) {
    checks.push(blocked(
      'claude_runner_enabled',
      'CLAUDE_RUNNER_ENABLED is set to a false value in the runtime env.',
      'Set CLAUDE_RUNNER_ENABLED=true in config/discord/.env or the LaunchAgent env.'
    ));
  } else {
    checks.push(ok('claude_runner_enabled', 'CLAUDE_RUNNER_ENABLED is truthy', { enabled: true }));
  }

  const state = classifyDoctorState(checks);
  return {
    state,
    generatedAtUtc: new Date().toISOString(),
    runtimeUser,
    runtimeUid,
    runtimeCommandPath: buildRuntimePath(config),
    workingDirectory,
    tasksRoot,
    checkpointRoot,
    claude: {
      command: commandName,
      model: config?.claude?.model || '',
      permissionMode: config?.claude?.permissionMode || '',
      workingDirectory,
    },
    checks,
  };
}

function printReport(report) {
  const stateLabel = report.state.toUpperCase();
  printInfo(`Claude runner doctor: ${stateLabel} (${report.checks.length} checks)`);
  for (const check of report.checks) {
    const line = `[${check.state.padEnd(8)}] ${check.name}: ${check.detail || 'ok'}`;
    if (check.state === 'ready') {
      process.stdout.write(`${line}\n`);
    } else {
      process.stderr.write(`${line}\n`);
      if (check.recovery) {
        process.stderr.write(`         recovery: ${check.recovery}\n`);
      }
    }
  }
}

async function postDoctorReportToDiscord(config, report, explicit) {
  const failing = report.checks.filter((check) => check.state !== 'ready');
  const summary = failing.length === 0
    ? `All ${report.checks.length} doctor checks passed.`
    : `${failing.length}/${report.checks.length} checks not ready: ${failing.map((check) => check.name).join(', ')}.`;
  const fields = report.checks.slice(0, 24).map((check) => ({
    name: `${check.state.toUpperCase()} ${check.name}`,
    value: check.detail || 'ok',
    inline: check.state === 'ready',
  }));
  return postToolReport(config, 'claude_runner_doctor', report.state, summary, fields, { explicit });
}

async function main() {
  const options = parseArgs();
  if (options.help) {
    printUsage([
      'Usage: node scripts/claude-runner-doctor.mjs [options]',
      '',
      'Options:',
      '  --json                  Print the report as JSON instead of a table.',
      '  --allow-degraded        Exit 0 even when the report is degraded.',
      '  --post-to-discord       Post the report to the agent-results Discord channel.',
    ]);
    return;
  }

  const config = loadRuntimeConfig();
  const report = await runClaudeRunnerDoctor(config);

  if (getBooleanOption(options, 'json', false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printReport(report);
  }

  if (getBooleanOption(options, 'post-to-discord', false)) {
    try {
      const post = await postDoctorReportToDiscord(config, report, true);
      if (post.posted) {
        printInfo(`Posted doctor report to Discord channel ${post.channelKey}.`);
      } else {
        printWarn(`Discord post skipped: ${post.reason || 'unknown reason'}.`);
      }
    } catch (error) {
      printError(`Could not post doctor report to Discord: ${error.message || error}`);
    }
  }

  if (report.state === 'ready') {
    return;
  }
  if (report.state === 'degraded' && getBooleanOption(options, 'allow-degraded', false)) {
    printWarn('Doctor reported degraded state; continuing because --allow-degraded is set.');
    return;
  }

  process.exitCode = 1;
}

// eslint-disable-next-line no-underscore-dangle -- CLI entrypoint sentinel
const isDirectInvocation = import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  main().catch((error) => {
    process.stderr.write(`${error.message || error}\n`);
    process.exitCode = 1;
  });
}
