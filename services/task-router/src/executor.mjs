import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { delimiter, join, resolve } from 'node:path';
import { projectRoot } from '../../lib/runtime-config.mjs';
import { executeClaudeTask } from '../../claude-runner/src/runner.mjs';
import { resolveClaudeTasksRoot } from '../../claude-runner/src/payload-store.mjs';
import { describeExplicitExecutionAction, executeGmailAction } from './gmail-executor.mjs';
import { describeExplicitLeadgenAction, executeLeadgenAction } from './leadgen-executor.mjs';
import {
  describeExplicitDeveloperAgentAction,
  executeDeveloperAgentAction,
} from './developer-agent-executor.mjs';
import {
  describeExplicitPullRequestMergeAction,
  executePullRequestMergeAction,
} from './pr-merge-executor.mjs';

function event(channelKey, type, body, metadata = {}) {
  return {
    channelKey,
    type,
    body,
    metadata,
  };
}

function isPausedExecutionReport(report = {}) {
  return report?.paused === true || String(report?.state || '').trim().toLowerCase() === 'paused';
}

function isAwaitingApprovalExecutionReport(report = {}) {
  return report?.awaitingApproval === true || String(report?.state || '').trim().toLowerCase() === 'awaiting_approval';
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function lowerText(task) {
  return normalizeWhitespace(task.full_text || task.summary || '').toLowerCase();
}

function isRufloDaemonHealthCheck(task) {
  const text = lowerText(task);
  const mentionsRuflo = text.includes('ruflo');
  const mentionsDaemon = text.includes('daemon');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsRuflo && mentionsDaemon && mentionsHealthOrStatus;
}

function isDiscordBotRuntimeHealthCheck(task) {
  const text = lowerText(task);
  const mentionsDiscord = text.includes('discord');
  const mentionsBot = text.includes('bot') || text.includes('vbj orchestrator');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsDiscord && mentionsBot && mentionsHealthOrStatus;
}

function isTailscaleHealthCheck(task) {
  const text = lowerText(task);
  return text.includes('tailscale') && (
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check')
  );
}

function isDockerColimaHealthCheck(task) {
  const text = lowerText(task);
  const mentionsRuntime = text.includes('docker') || text.includes('colima');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsRuntime && mentionsHealthOrStatus;
}

function isOllamaHealthCheck(task) {
  const text = lowerText(task);
  return text.includes('ollama') && (
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check')
  );
}

function isDiskSpaceHealthCheck(task) {
  const text = lowerText(task);
  const mentionsStorage = text.includes('disk') || text.includes('storage');
  const mentionsSpaceOrStatus =
    text.includes('space') ||
    text.includes('capacity') ||
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsStorage && mentionsSpaceOrStatus;
}

function isGitHubAuthHealthCheck(task) {
  const text = lowerText(task);
  const mentionsGitHub = text.includes('github') || text.includes('gh auth');
  const mentionsAuth =
    text.includes('auth') ||
    text.includes('authentication') ||
    text.includes('login') ||
    text.includes('status') ||
    text.includes('health') ||
    text.includes('check');

  return mentionsGitHub && mentionsAuth;
}

function isClaudeRuntimeHealthCheck(task) {
  const text = lowerText(task);
  const mentionsClaude = text.includes('claude');
  const mentionsRuntime =
    text.includes('runtime') ||
    text.includes('worker') ||
    text.includes('cli');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsClaude && (mentionsRuntime || mentionsHealthOrStatus) && mentionsHealthOrStatus;
}

function isLaunchAgentsHealthCheck(task) {
  const text = lowerText(task);
  const mentionsLaunchAgents =
    text.includes('launch agent') ||
    text.includes('launch agents') ||
    text.includes('launchctl');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsLaunchAgents && mentionsHealthOrStatus;
}

function isSessionCheckpointHealthCheck(task) {
  const text = lowerText(task);
  const mentionsCheckpoint = text.includes('checkpoint');
  const mentionsSession = text.includes('session') || text.includes('offboard') || text.includes('resume');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsCheckpoint && mentionsSession && mentionsHealthOrStatus;
}

function isRuntimeLogsHealthCheck(task) {
  const text = lowerText(task);
  const mentionsLogs = text.includes('runtime logs') || text.includes('logs health') || text.includes('log health');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check');

  return mentionsLogs && mentionsHealthOrStatus;
}

function isDiskHeavyFoldersCheck(task) {
  const text = lowerText(task);
  const mentionsDiskHeavy =
    text.includes('disk-heavy') ||
    text.includes('heavy folders') ||
    text.includes('largest folders') ||
    text.includes('disk heavy');
  const mentionsCheck =
    text.includes('check') ||
    text.includes('status') ||
    text.includes('health');

  return mentionsDiskHeavy && mentionsCheck;
}

function isMemoryBridgeSyncHealthCheck(task) {
  const text = lowerText(task);
  const mentionsBridge =
    text.includes('memory/bridge') ||
    text.includes('memory bridge') ||
    text.includes('bridge sync') ||
    text.includes('vault bridge');
  const mentionsHealthOrStatus =
    text.includes('health') ||
    text.includes('status') ||
    text.includes('check') ||
    text.includes('sync');

  return mentionsBridge && mentionsHealthOrStatus;
}

const OPS_TOOL_MATCHERS = [
  {
    tool: 'claude_runner_doctor',
    scriptPath: 'scripts/claude-runner-doctor.mjs',
    args: ['--json'],
    channelKey: 'agentResults',
    matches: (text) => text.includes('claude runner doctor') || text.includes('claude doctor'),
  },
  {
    tool: 'claude_runner_canary',
    scriptPath: 'scripts/claude-runner-canary.mjs',
    args: ['--json'],
    channelKey: 'agentResults',
    matches: (text) => text.includes('claude runner canary') || text.includes('claude canary'),
  },
  {
    tool: 'claude_runner_resume',
    scriptPath: 'scripts/claude-runner-resume.mjs',
    args: ['--json', '--resume-paused', '--mark-stalled'],
    channelKey: 'agentResults',
    matches: (text) => text.includes('claude runner resume') || text.includes('claude resume'),
  },
  {
    tool: 'session_pre_limit_checkpoint',
    scriptPath: 'scripts/session-pre-limit-checkpoint.mjs',
    args: ['--json', '--reason', 'operator-triggered via /ops'],
    channelKey: 'memoryUpdates',
    matches: (text) =>
      text.includes('session pre-limit checkpoint')
      || text.includes('pre-limit checkpoint')
      || text.includes('pre limit checkpoint'),
  },
  {
    tool: 'mac_reboot_recovery_check',
    scriptPath: 'scripts/mac-reboot-recovery-check.mjs',
    args: ['--json'],
    channelKey: 'agentResults',
    matches: (text) => text.includes('mac reboot recovery') || text.includes('reboot recovery check'),
  },
  {
    tool: 'verify_memory_promotion_rules',
    scriptPath: 'scripts/verify-memory-promotion-rules.mjs',
    args: ['--json'],
    channelKey: 'memoryUpdates',
    matches: (text) =>
      text.includes('verify memory promotion rules')
      || text.includes('memory promotion rules')
      || text.includes('promotion rules audit'),
  },
  {
    tool: 'restart_discord_bot',
    scriptPath: 'scripts/discord-bot-restart.mjs',
    args: ['--json'],
    channelKey: 'systemLogs',
    matches: (text) =>
      text.includes('restart the discord bot')
      || text.includes('restart discord bot')
      || text.includes('reload discord bot'),
  },
];

export function findOpsToolMatcher(task) {
  const text = lowerText(task);
  return OPS_TOOL_MATCHERS.find((matcher) => matcher.matches(text)) || null;
}

function isMacRuntimeSafeSync(task) {
  const text = lowerText(task);
  const mentionsRepositoryUpdate =
    text.includes('latest commit') ||
    text.includes('latest commits') ||
    text.includes('new commit') ||
    text.includes('new commits') ||
    text.includes('new changes') ||
    text.includes('recent changes') ||
    text.includes('repo changes') ||
    text.includes('repository changes') ||
    text.includes('up to date') ||
    text.includes('behind on commits') ||
    text.includes('behind by') ||
    text.includes('get the changes') ||
    text.includes('bring in the changes') ||
    text.includes('catch up');
  const mentionsSyncIntent =
    text.includes('sync the mac') ||
    text.includes('sync github') ||
    text.includes('github sync') ||
    text.includes('sync mac repo') ||
    text.includes('sync mac runtime') ||
    text.includes('sync github repo') ||
    text.includes('sync repo from github') ||
    text.includes('safe sync') ||
    text.includes('fast-forward pull') ||
    text.includes('pull from github') ||
    text.includes('pull latest changes') ||
    text.includes('pull the latest changes') ||
    text.includes('update mac runtime') ||
    text.includes('update the mac') ||
    text.includes('update the mac mini') ||
    text.includes('update the repo on the mac') ||
    text.includes('update the mac repo') ||
    (text.includes('sync') && text.includes('origin/main')) ||
    (text.includes('sync') && text.includes('github') && text.includes('repo')) ||
    (text.includes('sync') && text.includes('github') && text.includes('workflow')) ||
    (text.includes('sync') && text.includes('latest changes')) ||
    (text.includes('pull') && text.includes('latest')) ||
    (text.includes('update') && text.includes('runtime')) ||
    (
      mentionsRepositoryUpdate &&
      (
        text.includes('mac') ||
        text.includes('mac mini') ||
        text.includes('repo') ||
        text.includes('repository') ||
        text.includes('github') ||
        text.includes('origin/main')
      )
    );
  const mentionsTarget =
    text.includes('mac') ||
    text.includes('mac mini') ||
    text.includes('github') ||
    text.includes('ruflo') ||
    text.includes('runtime') ||
    text.includes('repository') ||
    text.includes('origin/main') ||
    (text.includes('repo') && text.includes('sync'));

  return mentionsSyncIntent && mentionsTarget;
}

export function buildExecutionPlan(task) {
  const explicitPullRequestMergeAction = describeExplicitPullRequestMergeAction(task);
  if (explicitPullRequestMergeAction) {
    return explicitPullRequestMergeAction;
  }

  const explicitDeveloperAgentAction = describeExplicitDeveloperAgentAction(task);
  if (explicitDeveloperAgentAction) {
    return explicitDeveloperAgentAction;
  }

  const explicitAction = describeExplicitExecutionAction(task);
  if (explicitAction) {
    return explicitAction;
  }

  const explicitLeadgenAction = describeExplicitLeadgenAction(task);
  if (explicitLeadgenAction) {
    return explicitLeadgenAction;
  }

  const opsToolMatcher = findOpsToolMatcher(task);
  if (opsToolMatcher) {
    return {
      action: 'ops_tool_run',
      description: `Run the ${opsToolMatcher.tool} operator tool on the Mac runtime.`,
      opsTool: opsToolMatcher.tool,
      opsToolScriptPath: opsToolMatcher.scriptPath,
      opsToolArgs: opsToolMatcher.args,
      opsToolChannelKey: opsToolMatcher.channelKey,
    };
  }

  if (isMacRuntimeSafeSync(task)) {
    return {
      action: 'mac_runtime_safe_sync',
      description: 'Run the safe Mac sync workflow for the live runtime.',
    };
  }

  if (isRufloDaemonHealthCheck(task)) {
    return {
      action: 'ruflo_daemon_health_check',
      description: 'Check Ruflo daemon health on the Mac runtime.',
    };
  }

  if (isDiscordBotRuntimeHealthCheck(task)) {
    return {
      action: 'discord_bot_runtime_health_check',
      description: 'Check Discord bot runtime health on the Mac runtime.',
    };
  }

  if (isTailscaleHealthCheck(task)) {
    return {
      action: 'tailscale_health_check',
      description: 'Check Tailscale network status on the Mac runtime.',
    };
  }

  if (isDockerColimaHealthCheck(task)) {
    return {
      action: 'docker_colima_health_check',
      description: 'Check Docker and Colima runtime health on the Mac runtime.',
    };
  }

  if (isOllamaHealthCheck(task)) {
    return {
      action: 'ollama_health_check',
      description: 'Check Ollama runtime health on the Mac runtime.',
    };
  }

  if (isDiskHeavyFoldersCheck(task)) {
    return {
      action: 'disk_heavy_folders_check',
      description: 'Inspect the heaviest runtime folders on the Mac runtime.',
    };
  }

  if (isDiskSpaceHealthCheck(task)) {
    return {
      action: 'disk_space_health_check',
      description: 'Check disk space on the Mac runtime.',
    };
  }

  if (isGitHubAuthHealthCheck(task)) {
    return {
      action: 'github_auth_health_check',
      description: 'Check GitHub CLI authentication health on the Mac runtime.',
    };
  }

  if (isClaudeRuntimeHealthCheck(task)) {
    return {
      action: 'claude_runtime_health_check',
      description: 'Check Claude CLI runtime health on the Mac runtime.',
    };
  }

  if (isLaunchAgentsHealthCheck(task)) {
    return {
      action: 'launch_agents_health_check',
      description: 'Check the required LaunchAgents on the Mac runtime.',
    };
  }

  if (isSessionCheckpointHealthCheck(task)) {
    return {
      action: 'session_checkpoint_health_check',
      description: 'Check session checkpoint files on the Mac runtime.',
    };
  }

  if (isRuntimeLogsHealthCheck(task)) {
    return {
      action: 'runtime_logs_health_check',
      description: 'Check runtime logs health on the Mac runtime.',
    };
  }

  if (isMemoryBridgeSyncHealthCheck(task)) {
    return {
      action: 'memory_bridge_sync_health_check',
      description: 'Check vault bridge export health on the Mac runtime.',
    };
  }

  return {
    action: 'claude_runtime_delegate',
    description: 'Delegate reasoning or coding work to the Claude runner on the Mac runtime.',
  };
}

export function buildExecutionStartedEvents(task, executionPlan) {
  return [
    event(
      'taskQueue',
      'task_queue_update',
      `${task.task_id} is running ${executionPlan.action}.`,
      {
        taskId: task.task_id,
        status: 'running',
        action: executionPlan.action,
        summary: task.summary,
        priority: task.priority,
        targetAgent: task.target_agent,
        domain: task.domain,
      }
    ),
    event(
      'systemLogs',
      'task_execution_started',
      `Started ${executionPlan.action} for ${task.task_id}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
      }
    ),
  ];
}

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || projectRoot,
      env: options.env || process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      rejectPromise(new Error(`Could not start command '${command}': ${error.message}`));
    });

    child.on('close', (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout,
        stderr,
      });
    });
  });
}

function buildRuntimePath(config) {
  const candidates = [
    config?.env?.PATH || '',
    process.env.PATH || '',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];

  return [...new Set(
    candidates
      .flatMap((entry) => String(entry || '').split(delimiter))
      .map((entry) => entry.trim())
      .filter(Boolean)
  )].join(delimiter);
}

function buildRuntimeEnv(config) {
  return {
    ...process.env,
    ...config.env,
    PATH: buildRuntimePath(config),
  };
}

export function parseLaunchctlReport(output) {
  const text = String(output || '');

  const readMatch = (pattern) => {
    const match = pattern.exec(text);
    return match ? match[1] : '';
  };

  return {
    state: readMatch(/state = ([^\n]+)/u),
    activeCount: Number.parseInt(readMatch(/active count = (\d+)/u) || '0', 10),
    lastExitCode: Number.parseInt(readMatch(/last exit code = (-?\d+)/u) || '0', 10),
    runs: Number.parseInt(readMatch(/runs = (\d+)/u) || '0', 10),
    stdoutPath: readMatch(/stdout path = ([^\n]+)/u),
    stderrPath: readMatch(/stderr path = ([^\n]+)/u),
  };
}

async function executeRufloDaemonHealthCheck(commandRunner) {
  const uidResult = await commandRunner('id', ['-u']);
  if (uidResult.code !== 0) {
    throw new Error(uidResult.stderr.trim() || 'Could not determine current user ID for launchctl health check.');
  }

  const uid = normalizeWhitespace(uidResult.stdout);
  const launchctlResult = await commandRunner('launchctl', ['print', `gui/${uid}/io.ruv.ruflo.daemon`]);
  if (launchctlResult.code !== 0) {
    throw new Error(launchctlResult.stderr.trim() || 'launchctl could not inspect io.ruv.ruflo.daemon.');
  }

  return {
    rawStdout: launchctlResult.stdout,
    report: parseLaunchctlReport(launchctlResult.stdout),
  };
}

function parsePsMatches(output, expectedSubstrings = []) {
  const candidates = String(output || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  return candidates.filter((line) => expectedSubstrings.some((pattern) => line.includes(pattern)));
}

async function executeDiscordBotRuntimeHealthCheck(commandRunner, config) {
  const patterns = [
    'services/discord-bot/index.mjs --live',
    'npm run discord:live',
  ];

  const processListResult = await commandRunner('ps', ['-axo', 'pid=,command=']);
  if (processListResult.code !== 0) {
    throw new Error(processListResult.stderr.trim() || 'ps could not inspect the Discord bot runtime.');
  }

  const matches = parsePsMatches(processListResult.stdout, patterns);
  return {
    rawStdout: matches.join('\n'),
    report: {
      state: matches.length > 0 ? 'running' : 'not running',
      processCount: matches.length,
      matches,
      logPath: resolve(config.runtimePaths.logDir, 'discord-bot.log'),
    },
  };
}

function parseTailscaleNetworkInterfaces(rawOutput) {
  const line = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((entry) => normalizeWhitespace(entry))
    .find((entry) => entry.startsWith('Network interfaces:'));

  if (!line) {
    return [];
  }

  return line
    .replace('Network interfaces:', '')
    .split(/\s+/u)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseIfconfigInterface(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  const ipv4Line = lines.find((line) => line.startsWith('inet '));
  const ipv6Line = lines.find((line) => line.startsWith('inet6 ') && line.includes('fd7a:'));

  return {
    ipv4: ipv4Line ? normalizeWhitespace(ipv4Line).split(/\s+/u)[1] || '' : '',
    ipv6: ipv6Line ? normalizeWhitespace(ipv6Line).split(/\s+/u)[1] || '' : '',
  };
}

async function executeTailscaleHealthCheck(commandRunner) {
  const processListResult = await commandRunner('ps', ['-axo', 'pid=,command=']);
  if (processListResult.code !== 0) {
    throw new Error(processListResult.stderr.trim() || 'Could not inspect Tailscale processes.');
  }

  const extensionMatches = parsePsMatches(processListResult.stdout, [
    'io.tailscale.ipn.macsys.network-extension',
  ]);
  const nwiResult = await commandRunner('scutil', ['--nwi']);
  if (nwiResult.code !== 0) {
    throw new Error(nwiResult.stderr.trim() || 'Could not inspect network interfaces for Tailscale.');
  }

  const candidateInterfaces = parseTailscaleNetworkInterfaces(nwiResult.stdout)
    .filter((entry) => entry.startsWith('utun'));

  const interfaceReports = [];
  for (const interfaceName of candidateInterfaces) {
    const ifconfigResult = await commandRunner('/sbin/ifconfig', [interfaceName]);
    if (ifconfigResult.code === 0) {
      const parsed = parseIfconfigInterface(ifconfigResult.stdout);
      interfaceReports.push({
        interfaceName,
        ...parsed,
      });
    }
  }

  const primaryInterface = interfaceReports.find((entry) => entry.ipv4.startsWith('100.')) || interfaceReports[0];
  const hostNameResult = await commandRunner('scutil', ['--get', 'LocalHostName']);
  const hostName = hostNameResult.code === 0 ? normalizeWhitespace(hostNameResult.stdout) : '';
  const hasTailscaleIp = Boolean(primaryInterface?.ipv4 && primaryInterface.ipv4.startsWith('100.'));

  return {
    rawStdout: [
      processListResult.stdout,
      nwiResult.stdout,
      interfaceReports.map((entry) => `${entry.interfaceName} ${entry.ipv4} ${entry.ipv6}`).join('\n'),
    ].join('\n'),
    report: {
      state: extensionMatches.length > 0 && hasTailscaleIp ? 'Running' : extensionMatches.length > 0 ? 'Degraded' : 'Stopped',
      backendState: extensionMatches.length > 0 && hasTailscaleIp ? 'Running' : extensionMatches.length > 0 ? 'Degraded' : 'Stopped',
      tailscaleIps: primaryInterface?.ipv4 ? [primaryInterface.ipv4] : [],
      hostName,
      dnsName: '',
      relay: '',
      version: '',
      interfaceName: primaryInterface?.interfaceName || '',
      extensionProcessCount: extensionMatches.length,
    },
  };
}

async function executeDockerColimaHealthCheck(commandRunner) {
  const colimaStatusResult = await commandRunner('colima', ['status']);
  if (colimaStatusResult.code !== 0) {
    throw new Error(colimaStatusResult.stderr.trim() || 'Could not inspect Colima status.');
  }

  const dockerContextResult = await commandRunner('docker', ['context', 'show']);
  if (dockerContextResult.code !== 0) {
    throw new Error(dockerContextResult.stderr.trim() || 'Could not inspect Docker context.');
  }

  const dockerVersionResult = await commandRunner('docker', ['info', '--format', '{{json .ServerVersion}}']);
  if (dockerVersionResult.code !== 0) {
    throw new Error(dockerVersionResult.stderr.trim() || 'Could not inspect Docker server info.');
  }

  const colimaStatusText = normalizeWhitespace(`${colimaStatusResult.stdout}\n${colimaStatusResult.stderr}`);
  const dockerServerVersion = normalizeWhitespace(dockerVersionResult.stdout).replace(/^"|"$/gu, '');
  const dockerContext = normalizeWhitespace(dockerContextResult.stdout);

  return {
    rawStdout: [
      colimaStatusResult.stdout,
      colimaStatusResult.stderr,
      dockerContextResult.stdout,
      dockerVersionResult.stdout,
    ].join('\n'),
    report: {
      state: dockerServerVersion ? 'running' : 'not running',
      colimaState: /colima is running/iu.test(colimaStatusText) ? 'running' : 'not running',
      dockerContext,
      dockerServerVersion,
      colimaStatusText,
    },
  };
}

function parseOllamaPs(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const rows = lines.length > 1 ? lines.slice(1) : [];
  return {
    activeModelCount: rows.length,
    activeModels: rows,
  };
}

async function executeOllamaHealthCheck(commandRunner) {
  const ollamaResult = await commandRunner('ollama', ['ps']);
  if (ollamaResult.code !== 0) {
    throw new Error(ollamaResult.stderr.trim() || 'Could not inspect Ollama status.');
  }

  const parsed = parseOllamaPs(ollamaResult.stdout);
  return {
    rawStdout: ollamaResult.stdout,
    report: {
      state: 'running',
      ...parsed,
    },
  };
}

function parseDiskUsage(rawOutput) {
  const lines = String(rawOutput || '')
    .split(/\r?\n/u)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const target = lines.at(-1) || '';
  const parts = target.split(/\s+/u);
  if (parts.length < 6) {
    throw new Error('Could not parse disk usage output.');
  }

  const filesystem = parts[0];
  const totalKb = Number.parseInt(parts[1] || '0', 10);
  const usedKb = Number.parseInt(parts[2] || '0', 10);
  const availableKb = Number.parseInt(parts[3] || '0', 10);
  const usePercent = parts[4];
  const mountPoint = parts[parts.length - 1];

  return {
    filesystem,
    totalKb,
    usedKb,
    availableKb,
    usePercent,
    state: usePercent,
    mountPoint,
  };
}

function resolveDiskHealthPath(config) {
  return config?.env?.HOME || process.env.HOME || projectRoot;
}

async function executeDiskSpaceHealthCheck(commandRunner, config) {
  const diskResult = await commandRunner('df', ['-k', resolveDiskHealthPath(config)]);
  if (diskResult.code !== 0) {
    throw new Error(diskResult.stderr.trim() || 'Could not inspect disk usage.');
  }

  return {
    rawStdout: diskResult.stdout,
    report: parseDiskUsage(diskResult.stdout),
  };
}

function parseGhAuthStatus(rawOutput) {
  const text = String(rawOutput || '');
  const accountMatch = /Logged in to github\.com account ([^\s(]+)/iu.exec(text);
  const protocolMatch = /Git operations protocol:\s+([^\s]+)/iu.exec(text);

  return {
    state: accountMatch ? 'authenticated' : 'unknown',
    host: 'github.com',
    account: accountMatch ? accountMatch[1] : '',
    gitProtocol: protocolMatch ? protocolMatch[1] : '',
  };
}

async function executeGitHubAuthHealthCheck(commandRunner) {
  const ghResult = await commandRunner('gh', ['auth', 'status', '--hostname', 'github.com']);
  const combinedOutput = `${ghResult.stdout}\n${ghResult.stderr}`;

  if (ghResult.code !== 0) {
    throw new Error(combinedOutput.trim() || 'Could not inspect GitHub auth status.');
  }

  return {
    rawStdout: combinedOutput,
    report: parseGhAuthStatus(combinedOutput),
  };
}

function parseJsonObject(rawOutput, fallbackMessage) {
  const text = normalizeWhitespace(rawOutput);
  if (!text) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage);
  }
}

async function executeClaudeRuntimeHealthCheck(commandRunner, config) {
  const command = config?.claude?.command || 'claude';
  const versionResult = await commandRunner(command, ['--version']);
  if (versionResult.code !== 0) {
    throw new Error(versionResult.stderr.trim() || `Could not execute '${command} --version'.`);
  }

  const authStatusResult = await commandRunner(command, ['auth', 'status']);
  const authStatus = parseJsonObject(
    authStatusResult.stdout || authStatusResult.stderr,
    'Claude auth status did not return valid JSON.'
  );

  const taskArtifactsPath = resolveClaudeTasksRoot(config);
  const probePath = join(taskArtifactsPath, '.health-write-test');
  let taskArtifactWritable = false;
  let writeError = '';

  try {
    mkdirSync(taskArtifactsPath, { recursive: true });
    writeFileSync(probePath, 'ok\n', 'utf8');
    unlinkSync(probePath);
    taskArtifactWritable = true;
  } catch (error) {
    writeError = error.message || 'Unknown write error.';
  }

  return {
    rawStdout: [versionResult.stdout, authStatusResult.stdout].filter(Boolean).join('\n'),
    report: {
      state: versionResult.code === 0 && authStatus.loggedIn === true && taskArtifactWritable
        ? 'ready'
        : authStatus.loggedIn === false
          ? 'auth_required'
          : taskArtifactWritable
            ? 'degraded'
            : 'blocked',
      version: normalizeWhitespace(versionResult.stdout),
      loggedIn: authStatus.loggedIn === true,
      authMethod: authStatus.authMethod || '',
      apiProvider: authStatus.apiProvider || '',
      workingDirectory: config?.claude?.workingDirectory || projectRoot,
      taskArtifactsPath,
      taskArtifactWritable,
      writeError,
    },
  };
}

async function executeLaunchAgentsHealthCheck(commandRunner) {
  const uidResult = await commandRunner('id', ['-u']);
  if (uidResult.code !== 0) {
    throw new Error(uidResult.stderr.trim() || 'Could not determine current user ID for LaunchAgent health check.');
  }

  const uid = normalizeWhitespace(uidResult.stdout);
  const labels = [
    'io.ruv.ruflo.daemon',
    'io.ruv.ruflo.discord-bot',
    'io.ruv.ruflo.daily-summary',
    'io.ruv.ruflo.health-monitor',
  ];

  const checkedAgents = [];
  for (const label of labels) {
    const result = await commandRunner('launchctl', ['print', `gui/${uid}/${label}`]);
    if (result.code === 0) {
      const parsed = parseLaunchctlReport(result.stdout);
      checkedAgents.push({
        label,
        present: true,
        state: parsed.state || 'unknown',
        runs: parsed.runs,
        lastExitCode: parsed.lastExitCode,
      });
    } else {
      checkedAgents.push({
        label,
        present: false,
        state: 'missing',
        error: result.stderr.trim() || `launchctl could not inspect ${label}.`,
      });
    }
  }

  const presentCount = checkedAgents.filter((entry) => entry.present).length;
  const missingCount = checkedAgents.length - presentCount;

  return {
    rawStdout: checkedAgents.map((entry) => `${entry.label} ${entry.state}`).join('\n'),
    report: {
      state: missingCount === 0 ? 'healthy' : 'warning',
      checkedAgents,
      presentCount,
      missingCount,
    },
  };
}

function resolveSessionCheckpointRoot(config) {
  return config?.env?.SESSION_CHECKPOINTS_PATH
    ? resolve(config.env.SESSION_CHECKPOINTS_PATH)
    : resolve(projectRoot, 'data', 'session-checkpoints');
}

function listCheckpointSessions(basePath) {
  if (!existsSync(basePath)) {
    return [];
  }

  return readdirSync(basePath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function readJsonFileSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function executeSessionCheckpointHealthCheck(_commandRunner, config) {
  const checkpointRoot = resolveSessionCheckpointRoot(config);
  const sessionIds = listCheckpointSessions(checkpointRoot);

  let latestSessionId = '';
  let latestUpdatedAtUtc = '';
  let latestAgeMs = 0;

  for (const sessionId of sessionIds) {
    const latestPath = join(checkpointRoot, sessionId, 'latest.json');
    if (!existsSync(latestPath)) {
      continue;
    }

    const payload = readJsonFileSafe(latestPath);
    const updatedAtUtc = payload?.updatedAtUtc || '';
    const updatedAtMs = updatedAtUtc ? new Date(updatedAtUtc).getTime() : 0;
    if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) {
      continue;
    }

    if (!latestUpdatedAtUtc || updatedAtMs > new Date(latestUpdatedAtUtc).getTime()) {
      latestSessionId = sessionId;
      latestUpdatedAtUtc = updatedAtUtc;
      latestAgeMs = Math.max(0, Date.now() - updatedAtMs);
    }
  }

  return {
    rawStdout: `${sessionIds.length} sessions`,
    report: {
      state: !existsSync(checkpointRoot) ? 'missing' : sessionIds.length > 0 ? 'healthy' : 'empty',
      checkpointRoot,
      sessionCount: sessionIds.length,
      latestSessionId,
      latestUpdatedAtUtc,
      latestAgeMs,
    },
  };
}

function resolveVaultBridgeExportRoot(config) {
  return config?.env?.VAULT_BRIDGE_EXPORT_PATH
    ? resolve(config.env.VAULT_BRIDGE_EXPORT_PATH)
    : resolve(projectRoot, 'data', 'vault-bridge', 'current');
}

function listLogFiles(logDir) {
  if (!existsSync(logDir)) {
    return [];
  }

  return readdirSync(logDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const absolutePath = join(logDir, entry.name);
      const stats = statSync(absolutePath);
      return {
        name: entry.name,
        absolutePath,
        sizeBytes: stats.size,
        modifiedAtUtc: stats.mtime.toISOString(),
      };
    });
}

async function executeRuntimeLogsHealthCheck(_commandRunner, config) {
  const logDir = config.runtimePaths.logDir;
  const files = listLogFiles(logDir);
  const totalBytes = files.reduce((sum, file) => sum + file.sizeBytes, 0);
  const sortedBySize = [...files].sort((left, right) => right.sizeBytes - left.sizeBytes);
  const largestFile = sortedBySize[0] || null;
  const staleCutoffMs = Date.now() - (24 * 60 * 60 * 1000);
  const staleCount = files.filter((file) => new Date(file.modifiedAtUtc).getTime() < staleCutoffMs).length;
  const newestFile = [...files].sort((left, right) => new Date(right.modifiedAtUtc).getTime() - new Date(left.modifiedAtUtc).getTime())[0] || null;
  const newestAgeMs = newestFile ? Math.max(0, Date.now() - new Date(newestFile.modifiedAtUtc).getTime()) : 0;

  return {
    rawStdout: `${files.length} log files`,
    report: {
      state: !existsSync(logDir) ? 'missing' : files.length > 0 ? 'healthy' : 'empty',
      logDir,
      fileCount: files.length,
      totalBytes,
      staleCount,
      newestAgeMs,
      largestFileName: largestFile?.name || '',
      largestFileBytes: largestFile?.sizeBytes || 0,
    },
  };
}

async function executeDiskHeavyFoldersCheck(commandRunner, config) {
  const homeDir = config.env.HOME || process.env.HOME || '';
  const candidates = [
    config.runtimePaths.logDir,
    resolve(projectRoot, 'data'),
    homeDir ? resolve(homeDir, '.ollama') : '',
  ].filter((value, index, array) => value && array.indexOf(value) === index && existsSync(value));

  const topFolders = [];
  for (const folderPath of candidates) {
    const result = await commandRunner('du', ['-sk', folderPath]);
    if (result.code !== 0) {
      continue;
    }

    const line = normalizeWhitespace(result.stdout);
    const sizeMatch = /^(\d+)\s+/u.exec(line);
    topFolders.push({
      path: folderPath,
      sizeKb: sizeMatch ? Number.parseInt(sizeMatch[1], 10) : 0,
    });
  }

  topFolders.sort((left, right) => right.sizeKb - left.sizeKb);

  return {
    rawStdout: topFolders.map((entry) => `${entry.sizeKb}\t${entry.path}`).join('\n'),
    report: {
      state: topFolders.length > 0 ? 'healthy' : 'empty',
      scannedPathsCount: candidates.length,
      topFolders,
    },
  };
}

async function executeMemoryBridgeSyncHealthCheck(_commandRunner, config) {
  const exportPath = resolveVaultBridgeExportRoot(config);
  const manifestPath = join(exportPath, 'manifest.json');

  if (!existsSync(manifestPath)) {
    return {
      rawStdout: 'manifest missing',
      report: {
        state: 'missing',
        exportPath,
        manifestPath,
        manifestEntries: 0,
        latestBridgeWriteTimeUtc: '',
        latestBridgeAgeMs: 0,
      },
    };
  }

  const manifest = readJsonFileSafe(manifestPath);
  const entries = Array.isArray(manifest) ? manifest : [];
  const latestEntry = [...entries]
    .filter((entry) => entry?.lastWriteTimeUtc)
    .sort((left, right) => new Date(right.lastWriteTimeUtc).getTime() - new Date(left.lastWriteTimeUtc).getTime())[0] || null;

  const latestBridgeWriteTimeUtc = latestEntry?.lastWriteTimeUtc || '';
  const latestBridgeAgeMs = latestBridgeWriteTimeUtc
    ? Math.max(0, Date.now() - new Date(latestBridgeWriteTimeUtc).getTime())
    : 0;

  return {
    rawStdout: `${entries.length} bridge notes`,
    report: {
      state: entries.length > 0 ? 'healthy' : 'empty',
      exportPath,
      manifestPath,
      manifestEntries: entries.length,
      latestBridgeWriteTimeUtc,
      latestBridgeAgeMs,
    },
  };
}

function parseJsonOutput(rawOutput, fallbackMessage) {
  const text = normalizeWhitespace(rawOutput);
  if (!text) {
    throw new Error(fallbackMessage);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(fallbackMessage);
  }
}

function truncateOutput(value, maxLength) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function summarizeOpsToolReport(tool, parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return {
      state: 'unknown',
      severity: 'warning',
      summary: `Operator tool ${tool} did not return a parsable report.`,
      details: [],
    };
  }
  if (tool === 'claude_runner_doctor') {
    const failing = (parsed.checks || []).filter((check) => check.state !== 'ready');
    const summary = failing.length === 0
      ? `Doctor is ${parsed.state || 'ready'}: ${parsed.checks?.length || 0} checks passed.`
      : `Doctor is ${parsed.state || 'unknown'}: ${failing.length}/${parsed.checks?.length || 0} checks not ready.`;
    return {
      state: parsed.state || 'unknown',
      severity: parsed.state === 'ready' ? 'healthy' : parsed.state === 'degraded' ? 'warning' : 'blocked',
      summary,
      details: failing.map((check) => `${check.name}: ${check.detail || 'not ready'}`),
    };
  }
  if (tool === 'claude_runner_canary') {
    return {
      state: parsed.state || 'unknown',
      severity: parsed.verdict === 'ok' ? 'healthy' : 'warning',
      summary: parsed.summary || `Canary verdict ${parsed.verdict || 'unknown'} (live=${parsed.live === true}).`,
      details: [
        `payload=${parsed.artifacts?.payloadExists}`,
        `prompt=${parsed.artifacts?.promptExists}`,
        `result=${parsed.artifacts?.resultExists}`,
      ],
    };
  }
  if (tool === 'claude_runner_resume') {
    const candidates = parsed.resumeCandidatesWithCommands || [];
    const stalled = parsed.stalledRunningWithCommands || [];
    const actions = parsed.actions || [];
    return {
      state: candidates.length + stalled.length === 0 ? 'clean' : 'actioned',
      severity: 'healthy',
      summary: `Scanned ${parsed.scannedSessionCount || 0} checkpoints. Resume candidates ${candidates.length}. Stalled ${stalled.length}. Actions ${actions.length}.`,
      details: actions.map((action) => `${action.type} ${action.sessionId}${action.state ? ` -> ${action.state}` : ''}`),
    };
  }
  if (tool === 'session_pre_limit_checkpoint') {
    return {
      state: parsed.checkpoint?.status || 'pre_limit',
      severity: 'warning',
      summary: `Pre-limit checkpoint written for '${parsed.sessionId}' capturing ${(parsed.activeTasks || []).length} active Claude task(s).`,
      details: (parsed.activeTasks || []).map((task) => `${task.taskId} (session ${task.sessionId}, ${task.state})`),
    };
  }
  if (tool === 'mac_reboot_recovery_check') {
    const failLines = [
      ...(parsed.failingRequired || []).map((entry) => `REQUIRED ${entry.action}: ${entry.state}`),
      ...(parsed.failingOptional || []).map((entry) => `optional ${entry.action}: ${entry.state}`),
    ];
    return {
      state: parsed.readiness || 'unknown',
      severity: parsed.readiness === 'ready' ? 'healthy' : parsed.readiness === 'degraded_soft' ? 'warning' : 'blocked',
      summary: `Reboot recovery ${String(parsed.readiness || 'unknown').toUpperCase()}: ${parsed.summary?.healthy || 0}/${parsed.summary?.total || 0} healthy, ${parsed.summary?.blocked || 0} blocked, ${parsed.summary?.degraded || 0} degraded.`,
      details: failLines,
    };
  }
  if (tool === 'verify_memory_promotion_rules') {
    const findings = parsed.audit?.findings || [];
    return {
      state: parsed.state || 'unknown',
      severity: parsed.state === 'ok' ? 'healthy' : parsed.state === 'degraded' ? 'warning' : 'blocked',
      summary: `Promotion rules audit ${String(parsed.state || 'unknown').toUpperCase()}: ${parsed.audit?.errorCount || 0} errors, ${parsed.audit?.warnCount || 0} warnings, ${parsed.audit?.namespaces?.length || 0} namespaces.`,
      details: findings.map((finding) => `[${finding.level}] ${finding.namespace} ${finding.code}: ${finding.detail}`),
    };
  }
  if (tool === 'restart_discord_bot') {
    return {
      state: parsed.verdict || 'scheduled',
      severity: 'warning',
      summary: parsed.summary || `Discord bot restart ${parsed.verdict || 'scheduled'}.`,
      details: [`serviceId=${parsed.serviceId || 'unknown'}`, `delaySeconds=${parsed.delaySeconds ?? 'default'}`],
    };
  }
  return {
    state: 'unknown',
    severity: 'warning',
    summary: `Operator tool ${tool} returned an unrecognised payload.`,
    details: [],
  };
}

async function executeOpsToolAction(commandRunner, executionPlan) {
  const scriptAbsolutePath = resolve(projectRoot, executionPlan.opsToolScriptPath || '');
  const result = await commandRunner(process.execPath, [scriptAbsolutePath, ...(executionPlan.opsToolArgs || [])]);
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join('\n');

  if (!result.stdout || !result.stdout.trim()) {
    return {
      rawStdout: combinedOutput,
      report: {
        state: 'blocked',
        severity: 'blocked',
        blocked: true,
        summary: `Operator tool ${executionPlan.opsTool} produced no JSON output (exit ${result.code ?? 'unknown'}).`,
        details: [truncateOutput(combinedOutput, 400)].filter(Boolean),
        opsTool: executionPlan.opsTool,
        opsToolScriptPath: executionPlan.opsToolScriptPath,
        exitCode: result.code ?? 0,
      },
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    return {
      rawStdout: combinedOutput,
      report: {
        state: 'blocked',
        severity: 'blocked',
        blocked: true,
        summary: `Operator tool ${executionPlan.opsTool} returned invalid JSON: ${error.message}`,
        details: [truncateOutput(result.stdout, 400)],
        opsTool: executionPlan.opsTool,
        opsToolScriptPath: executionPlan.opsToolScriptPath,
        exitCode: result.code ?? 0,
      },
    };
  }

  const summary = summarizeOpsToolReport(executionPlan.opsTool, parsed);
  return {
    rawStdout: combinedOutput,
    report: {
      state: summary.state,
      severity: summary.severity,
      blocked: summary.severity === 'blocked',
      summary: summary.summary,
      details: summary.details,
      opsTool: executionPlan.opsTool,
      opsToolScriptPath: executionPlan.opsToolScriptPath,
      channelKey: executionPlan.opsToolChannelKey || 'agentResults',
      rawReport: parsed,
      exitCode: result.code ?? 0,
    },
  };
}

async function executeMacRuntimeSafeSync(commandRunner) {
  const scriptPath = resolve(projectRoot, 'scripts', 'mac-sync-worker.mjs');
  const syncResult = await commandRunner(process.execPath, [scriptPath, '--json', '--no-post', '--skip-discord-restart']);
  const parsed = parseJsonOutput(
    syncResult.stdout,
    syncResult.stderr.trim() || 'Mac sync worker did not return valid JSON output.'
  );
  const healthSummary = parsed.healthSummary || {};
  const syncState = parsed.syncState || {};
  const gitState = parsed.gitState || {};
  const healthChecks = Array.isArray(parsed.healthChecks) ? parsed.healthChecks : [];

  return {
    rawStdout: syncResult.stdout,
    report: {
      state: syncState.status || 'unknown',
      summary: parsed.summary || '',
      branch: gitState.currentBranch || '',
      upstream: gitState.upstreamRef || '',
      aheadCount: gitState.aheadCount || 0,
      behindCount: gitState.behindCount || 0,
      didPull: parsed.didPull === true,
      dryRun: parsed.dryRun === true,
      restartedDiscordBot: parsed.restartedDiscordBot === true,
      restartDiscordBotDeferred: parsed.restartDiscordBotDeferred === true,
      restartedRufloWorkerService: parsed.restartedRufloWorkerService === true,
      healthyCount: healthSummary.healthyCount || 0,
      unhealthyCount: healthSummary.unhealthyCount || 0,
      unhealthyChecks: healthSummary.unhealthyChecks || [],
      blocked: syncState.blocked === true,
      syncStatus: syncState.status || 'unknown',
      healthChecks,
      exitCode: syncResult.code ?? 0,
      severity: syncState.blocked
        ? 'blocked'
        : (healthSummary.unhealthyCount || 0) > 0
          ? 'warning'
          : 'healthy',
    },
  };
}

function buildCompletedEvents(task, executionPlan, executionResult) {
  const report = executionResult.report || {};
  const state = report.state || 'unknown';
  const isAwaitingApproval = isAwaitingApprovalExecutionReport(report);
  const followUpTask = report.pendingApprovalTask || null;
  const isPaused = isPausedExecutionReport(report);
  const isBlocked = !isPaused && (
    report.blocked === true
    || String(report.severity || '').trim().toLowerCase() === 'blocked'
    || String(state).trim().toLowerCase().startsWith('blocked')
  );
  const displayAction = isAwaitingApproval ? (report.awaitingApprovalAction || executionPlan.action) : executionPlan.action;
  const queueStatus = isPaused ? 'paused' : isAwaitingApproval ? 'awaiting_approval' : isBlocked ? 'blocked' : 'completed';
  const queueVerb = isPaused
    ? 'paused'
    : isAwaitingApproval
      ? 'is awaiting approval for'
      : isBlocked
        ? 'blocked'
        : 'completed';
  const commonQueueEvent = event(
    'taskQueue',
    'task_queue_update',
    `${task.task_id} ${queueVerb} ${displayAction}.`,
    {
      taskId: task.task_id,
      status: queueStatus,
      action: displayAction,
      summary: isAwaitingApproval ? (followUpTask?.summary || task.summary) : task.summary,
      priority: isAwaitingApproval ? (followUpTask?.priority || task.priority) : task.priority,
      targetAgent: isAwaitingApproval ? (followUpTask?.target_agent || task.target_agent) : task.target_agent,
      domain: isAwaitingApproval ? (followUpTask?.domain || task.domain) : task.domain,
      state,
      severity: report.severity || '',
      reason: isPaused || isAwaitingApproval || isBlocked ? (report.summary || state) : '',
    }
  );
  const commonSystemEvent = event(
    'systemLogs',
    'task_execution_completed',
    `${isPaused ? 'Paused' : isAwaitingApproval ? 'Prepared approval for' : isBlocked ? 'Blocked' : 'Completed'} ${executionPlan.action} for ${task.task_id}.`,
    {
      taskId: task.task_id,
      action: executionPlan.action,
      state,
    }
  );
  const pausedAlertEvent = isPaused
    ? event(
        'alerts',
        'task_execution_paused',
        `Execution paused for ${task.task_id}: ${report.summary || state || executionPlan.action}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state,
          severity: report.severity || 'warning',
          reason: report.summary || state || '',
          recoveryCommand: report.recoveryCommand || '',
        }
      )
    : null;
  const blockedAlertEvent = isBlocked
    ? event(
        'alerts',
        'task_execution_blocked',
        `Execution reported a blocked state for ${task.task_id}: ${report.summary || state || executionPlan.action}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state,
          severity: report.severity || 'blocked',
          reason: report.summary || state || '',
          recoveryCommand: report.recoveryCommand || '',
        }
      )
    : null;
  const withTerminalAlert = (events) => pausedAlertEvent
    ? [...events, pausedAlertEvent]
    : blockedAlertEvent
      ? [...events, blockedAlertEvent]
      : events;
  const buildCompletedResultEvents = (channelKey, body, metadata) => withTerminalAlert([
    commonQueueEvent,
    event(
      channelKey,
      'task_execution_result',
      body,
      metadata,
    ),
    commonSystemEvent,
  ]);

  if (executionPlan.action === 'gmail_create_draft') {
    const pendingApprovalTask = report.pendingApprovalTask || null;
    return [
      commonQueueEvent,
      event(
        'agentResults',
        'task_execution_result',
        `Execution result for ${task.task_id}: Gmail draft created for ${report.emailTo || 'recipient'}.`,
        {
          taskId: task.task_id,
          action: executionPlan.action,
          state: report.state || 'unknown',
          severity: report.severity || 'warning',
          emailTo: report.emailTo || '',
          emailSubject: report.emailSubject || '',
          emailBody: report.emailBody || '',
          emailPreview: report.emailPreview || '',
          gmailDraftId: report.gmailDraftId || '',
          gmailMessageId: report.gmailMessageId || '',
          gmailThreadId: report.gmailThreadId || '',
        },
      ),
      pendingApprovalTask
        ? event(
            'approvals',
            'approval_request',
            `Approval needed for ${task.task_id}: ${pendingApprovalTask.summary}`,
            {
              taskId: task.task_id,
              summary: pendingApprovalTask.summary,
              targetAgent: pendingApprovalTask.target_agent || task.target_agent || '',
              domain: pendingApprovalTask.domain || task.domain || '',
              priority: pendingApprovalTask.priority || task.priority || '',
              submittedBy: pendingApprovalTask.submitted_by || task.submitted_by || '',
              approvalReason: pendingApprovalTask.approval_reason || '',
              automationType: pendingApprovalTask.automation_type || '',
              emailTo: report.emailTo || '',
              emailSubject: report.emailSubject || '',
              emailBody: report.emailBody || '',
              emailPreview: report.emailPreview || '',
              gmailDraftId: report.gmailDraftId || '',
              responsePattern: ['approve TASK-123', 'reject TASK-123 because <revision feedback>'],
            },
          )
        : null,
      commonSystemEvent,
    ].filter(Boolean);
  }

  if (executionPlan.action === 'gmail_send_draft') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Sent drafted email to ${report.emailTo || 'recipient'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        severity: report.severity || 'success',
        emailTo: report.emailTo || '',
        emailSubject: report.emailSubject || '',
        emailBody: report.emailBody || '',
        emailPreview: report.emailPreview || '',
        gmailDraftId: report.gmailDraftId || '',
        gmailMessageId: report.gmailMessageId || '',
        gmailThreadId: report.gmailThreadId || '',
      }
    );
  }

  if (executionPlan.action === 'discord_bot_runtime_health_check') {
    const processCount = Number(report.processCount || 0);
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Discord bot runtime is ${state}${processCount ? ` (${processCount} process)` : ''}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state,
        processCount,
        logPath: report.logPath || '',
      }
    );
  }

  if (executionPlan.action === 'tailscale_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Tailscale is ${report.backendState || 'unknown'} on ${report.hostName || 'this host'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.backendState || 'unknown',
        tailscaleIp: report.tailscaleIps?.[0] || '',
        dnsName: report.dnsName || '',
        relay: report.relay || '',
        version: report.version || '',
      }
    );
  }

  if (executionPlan.action === 'docker_colima_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Docker is ${report.state || 'unknown'} on context ${report.dockerContext || 'unknown'} and Colima is ${report.colimaState || 'unknown'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        dockerContext: report.dockerContext || '',
        dockerServerVersion: report.dockerServerVersion || '',
        colimaState: report.colimaState || '',
      }
    );
  }

  if (executionPlan.action === 'ollama_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Ollama is ${report.state || 'unknown'} with ${report.activeModelCount || 0} active model${report.activeModelCount === 1 ? '' : 's'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        activeModelCount: report.activeModelCount || 0,
      }
    );
  }

  if (executionPlan.action === 'disk_space_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Disk usage is ${report.usePercent || 'unknown'} on ${report.mountPoint || 'unknown'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.usePercent || 'unknown',
        mountPoint: report.mountPoint || '',
        availableKb: report.availableKb || 0,
        totalKb: report.totalKb || 0,
      }
    );
  }

  if (executionPlan.action === 'github_auth_health_check') {
    return buildCompletedResultEvents(
      'github',
      `Execution result for ${task.task_id}: GitHub auth is ${report.state || 'unknown'} for ${report.account || 'unknown account'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        githubHost: report.host || '',
        githubAccount: report.account || '',
        gitProtocol: report.gitProtocol || '',
      }
    );
  }

  if (executionPlan.action === 'claude_runtime_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Claude runtime is ${report.state || 'unknown'}${report.version ? ` on ${report.version}` : ''}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        claudeVersion: report.version || '',
        claudeLoggedIn: report.loggedIn === true,
        claudeAuthMethod: report.authMethod || '',
        claudeApiProvider: report.apiProvider || '',
        claudeWorkingDirectory: report.workingDirectory || '',
        claudeTaskArtifactsPath: report.taskArtifactsPath || '',
        claudeTaskArtifactWritable: report.taskArtifactWritable === true,
        reason: report.writeError || '',
      }
    );
  }

  if (executionPlan.action === 'launch_agents_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: ${report.presentCount || 0}/${(report.checkedAgents || []).length || 0} required LaunchAgents are present.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        presentCount: report.presentCount || 0,
        missingCount: report.missingCount || 0,
        checkedAgents: report.checkedAgents || [],
      }
    );
  }

  if (executionPlan.action === 'session_checkpoint_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Session checkpoints are ${report.state || 'unknown'} with ${report.sessionCount || 0} session folder${report.sessionCount === 1 ? '' : 's'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        checkpointRoot: report.checkpointRoot || '',
        sessionCount: report.sessionCount || 0,
        latestSessionId: report.latestSessionId || '',
        latestUpdatedAtUtc: report.latestUpdatedAtUtc || '',
        latestAgeMs: report.latestAgeMs || 0,
      }
    );
  }

  if (executionPlan.action === 'runtime_logs_health_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Runtime logs are ${report.state || 'unknown'} with ${report.fileCount || 0} file${report.fileCount === 1 ? '' : 's'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        logDir: report.logDir || '',
        fileCount: report.fileCount || 0,
        totalBytes: report.totalBytes || 0,
        staleCount: report.staleCount || 0,
        newestAgeMs: report.newestAgeMs || 0,
        largestFileName: report.largestFileName || '',
        largestFileBytes: report.largestFileBytes || 0,
      }
    );
  }

  if (executionPlan.action === 'disk_heavy_folders_check') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: Inspected ${report.scannedPathsCount || 0} runtime folder${report.scannedPathsCount === 1 ? '' : 's'} for disk usage.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        scannedPathsCount: report.scannedPathsCount || 0,
        topFolders: report.topFolders || [],
      }
    );
  }

  if (executionPlan.action === 'memory_bridge_sync_health_check') {
    return buildCompletedResultEvents(
      'memoryUpdates',
      `Execution result for ${task.task_id}: Memory bridge export is ${report.state || 'unknown'} with ${report.manifestEntries || 0} bridge note${report.manifestEntries === 1 ? '' : 's'}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        exportPath: report.exportPath || '',
        manifestPath: report.manifestPath || '',
        manifestEntries: report.manifestEntries || 0,
        latestBridgeWriteTimeUtc: report.latestBridgeWriteTimeUtc || '',
        latestBridgeAgeMs: report.latestBridgeAgeMs || 0,
      }
    );
  }

  if (executionPlan.action === 'ops_tool_run') {
    const channelKey = report.channelKey || executionPlan.opsToolChannelKey || 'agentResults';
    return buildCompletedResultEvents(
      channelKey,
      `Execution result for ${task.task_id}: ${report.summary || `${executionPlan.opsTool} completed.`}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        opsTool: executionPlan.opsTool || report.opsTool || '',
        state: report.state || 'unknown',
        severity: report.severity || '',
        details: report.details || [],
        exitCode: report.exitCode || 0,
        scriptPath: report.opsToolScriptPath || executionPlan.opsToolScriptPath || '',
      }
    );
  }

  if (executionPlan.action === 'leadgen_search') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: ${report.summary || 'Leadgen search completed.'}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        severity: report.severity || '',
        query: report.query || '',
        leadCount: report.leadCount || 0,
        skippedCount: report.skippedCount || 0,
        insertedCount: report.insertedCount || 0,
        leadsPreview: report.leadsPreview || [],
      }
    );
  }

  if (executionPlan.action === 'developer_agent_workflow') {
    return buildCompletedResultEvents(
      'github',
      `Execution result for ${task.task_id}: ${report.summary || 'Developer-agent workflow completed.'}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        severity: report.severity || '',
        issueUrl: report.issueUrl || '',
        issueNumber: report.issueNumber || 0,
        pullRequestUrl: report.pullRequestUrl || '',
        pullRequestNumber: report.pullRequestNumber || 0,
        branch: report.branch || '',
        baseBranch: report.baseBranch || '',
        commitSha: report.commitSha || '',
        files: report.files || [],
        nextSteps: report.nextSteps || [],
      }
    );
  }

  if (executionPlan.action === 'github_merge_pull_request') {
    return buildCompletedResultEvents(
      'github',
      `Execution result for ${task.task_id}: ${report.summary || 'Pull request merge completed.'}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        severity: report.severity || '',
        pullRequestUrl: report.pullRequestUrl || '',
        pullRequestNumber: report.pullRequestNumber || 0,
        branch: report.branch || '',
        baseBranch: report.baseBranch || '',
        commitSha: report.commitSha || '',
        mergeMethod: report.mergeMethod || '',
        merged: report.merged === true,
        mergeQueued: report.mergeQueued === true,
        nextSteps: report.nextSteps || [],
      }
    );
  }

  if (executionPlan.action === 'mac_runtime_safe_sync') {
    return buildCompletedResultEvents(
      report.didPull === true ? 'deployments' : 'agentResults',
      `Execution result for ${task.task_id}: ${report.summary || 'Mac sync worker completed.'}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.syncStatus || report.state || 'unknown',
        severity: report.severity || 'unknown',
        branch: report.branch || '',
        upstream: report.upstream || '',
        aheadCount: report.aheadCount || 0,
        behindCount: report.behindCount || 0,
        didPull: report.didPull === true,
        restartedDiscordBot: report.restartedDiscordBot === true,
        restartDiscordBotDeferred: report.restartDiscordBotDeferred === true,
        restartedRufloWorkerService: report.restartedRufloWorkerService === true,
        healthyCount: report.healthyCount || 0,
        unhealthyCount: report.unhealthyCount || 0,
        unhealthyChecks: report.unhealthyChecks || [],
        exitCode: report.exitCode || 0,
      }
    );
  }

  if (executionPlan.action === 'claude_runtime_delegate') {
    return buildCompletedResultEvents(
      'agentResults',
      `Execution result for ${task.task_id}: ${report.summary || 'Claude runner handled the task.'}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        state: report.state || 'unknown',
        severity: report.severity || '',
        claudeSessionId: report.claudeSessionId || '',
        taskPayloadPath: report.taskPayloadPath || '',
        promptPath: report.promptPath || '',
        resultPath: report.resultPath || '',
        checkpointRoot: report.checkpointRoot || '',
        bridgeExportPath: report.bridgeExportPath || '',
        supabaseCachePath: report.supabaseCachePath || '',
        attachmentCount: report.attachmentCount || 0,
        targetAgent: report.targetAgent || task.target_agent || '',
        files: report.files || [],
        nextSteps: report.nextSteps || [],
      }
    );
  }

  return buildCompletedResultEvents(
    'agentResults',
    `Execution result for ${task.task_id}: Ruflo daemon state is ${state}.`,
    {
      taskId: task.task_id,
      action: executionPlan.action,
      state,
      activeCount: report.activeCount,
      lastExitCode: report.lastExitCode,
      runs: report.runs,
      stdoutPath: report.stdoutPath,
      stderrPath: report.stderrPath,
    }
  );
}

function buildFailedEvents(task, executionPlan, error) {
  return [
    event(
      'taskQueue',
      'task_queue_update',
      `${task.task_id} failed ${executionPlan.action}.`,
      {
        taskId: task.task_id,
        status: 'failed',
        action: executionPlan.action,
        summary: task.summary,
        priority: task.priority,
        targetAgent: task.target_agent,
        domain: task.domain,
      }
    ),
    event(
      'alerts',
      'task_execution_failed',
      `Execution failed for ${task.task_id}: ${error.message}`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
      }
    ),
    event(
      'systemLogs',
      'task_execution_failed',
      `Failed ${executionPlan.action} for ${task.task_id}.`,
      {
        taskId: task.task_id,
        action: executionPlan.action,
        error: error.message,
      }
    ),
  ];
}

export async function executeTask(task, config, options = {}) {
  const executionPlan = buildExecutionPlan(task);
  if (!executionPlan) {
    return {
      handled: false,
      executionPlan: null,
      outboundEvents: [],
    };
  }

  try {
    let executionState = null;

    if (executionPlan.action === 'claude_runtime_delegate') {
      const claudeTaskRunner = options.claudeTaskRunner || executeClaudeTask;
      const claudeResult = await claudeTaskRunner(task, config, {
        commandRunner: options.claudeCommandRunner,
      });
      executionState = claudeResult?.executionResult
        ? claudeResult
        : {
            outcome: 'completed',
            executionResult: claudeResult,
          };
    } else if (executionPlan.action === 'gmail_create_draft' || executionPlan.action === 'gmail_send_draft') {
      executionState = {
        outcome: 'completed',
        executionResult: await executeGmailAction(executionPlan.action, task, config, {
          fetchImpl: options.fetchImpl,
        }),
      };

      // Outreach lifecycle: a qualified lead's draft carries lead_id through
      // the approval flow — when the approved send completes, close the loop
      // in the leads table. Best-effort: a Supabase hiccup must not fail the
      // send report (the email is already gone at this point).
      if (executionPlan.action === 'gmail_send_draft' && task?.lead_id) {
        try {
          const { updateLead, fetchLeadById } = await import('../../../scripts/lib/leadgen-supabase.mjs');
          // Capture the Gmail thread id so reply detection can later check this
          // exact thread for a response. Merged into the qualification jsonb
          // (no dedicated column / no migration). Best-effort fetch-merge so a
          // Supabase blip never fails the send report — the email is already
          // gone by this point.
          const threadId = executionState?.executionResult?.report?.gmailThreadId || '';
          const patch = { status: 'sent', sent_at: new Date().toISOString() };
          if (threadId) {
            const existing = await fetchLeadById(task.lead_id).catch(() => null);
            const qualification = existing?.qualification && typeof existing.qualification === 'object' ? existing.qualification : {};
            patch.qualification = { ...qualification, gmail_thread_id: threadId };
          }
          await updateLead(task.lead_id, patch);
        } catch {
          // Lead-row sync is reconcilable later from ops metrics.
        }
      }
    } else if (executionPlan.action === 'leadgen_search') {
      executionState = {
        outcome: 'completed',
        executionResult: await executeLeadgenAction(task, config, options),
      };
    } else if (executionPlan.action === 'developer_agent_workflow') {
      executionState = {
        outcome: 'completed',
        executionResult: await executeDeveloperAgentAction(task, config, {
          workflowRunner: options.developerAgentWorkflow,
          commandRunner: options.developerAgentCommandRunner,
          claudeTaskRunner: options.claudeTaskRunner,
          claudeCommandRunner: options.claudeCommandRunner,
        }),
      };
    } else if (executionPlan.action === 'github_merge_pull_request') {
      executionState = {
        outcome: 'completed',
        executionResult: await executePullRequestMergeAction(task, config, {
          workflowRunner: options.pullRequestMergeWorkflow,
          commandRunner: options.pullRequestMergeCommandRunner,
        }),
      };
    } else {
      const commandRunner = options.commandRunner
        ? options.commandRunner
        : (command, args) => runProcess(command, args, {
            cwd: projectRoot,
            env: buildRuntimeEnv(config),
          });

      executionState = await executeHealthAction(executionPlan.action, config, { commandRunner, executionPlan });
    }

    return {
      handled: true,
      executionPlan,
      outcome: executionState.outcome,
      executionResult: executionState.executionResult || null,
      outboundEvents: executionState.outcome === 'completed'
        ? buildCompletedEvents(task, executionPlan, executionState.executionResult)
        : buildFailedEvents(task, executionPlan, executionState.error),
    };
  } catch (error) {
    return {
      handled: true,
      executionPlan,
      outcome: 'failed',
      error,
      outboundEvents: buildFailedEvents(task, executionPlan, error),
    };
  }
}

export async function executeHealthAction(action, config, options = {}) {
  const commandRunner = options.commandRunner
    ? options.commandRunner
    : (command, args) => runProcess(command, args, {
        cwd: projectRoot,
        env: buildRuntimeEnv(config),
      });

  try {
    let executionResult = null;

    if (action === 'ruflo_daemon_health_check') {
      executionResult = await executeRufloDaemonHealthCheck(commandRunner);
    } else if (action === 'mac_runtime_safe_sync') {
      executionResult = await executeMacRuntimeSafeSync(commandRunner);
    } else if (action === 'ops_tool_run') {
      executionResult = await executeOpsToolAction(commandRunner, options.executionPlan || {});
    } else if (action === 'discord_bot_runtime_health_check') {
      executionResult = await executeDiscordBotRuntimeHealthCheck(commandRunner, config);
    } else if (action === 'tailscale_health_check') {
      executionResult = await executeTailscaleHealthCheck(commandRunner);
    } else if (action === 'docker_colima_health_check') {
      executionResult = await executeDockerColimaHealthCheck(commandRunner);
    } else if (action === 'ollama_health_check') {
      executionResult = await executeOllamaHealthCheck(commandRunner);
    } else if (action === 'disk_space_health_check') {
      executionResult = await executeDiskSpaceHealthCheck(commandRunner, config);
    } else if (action === 'claude_runtime_health_check') {
      executionResult = await executeClaudeRuntimeHealthCheck(commandRunner, config);
    } else if (action === 'github_auth_health_check') {
      executionResult = await executeGitHubAuthHealthCheck(commandRunner);
    } else if (action === 'launch_agents_health_check') {
      executionResult = await executeLaunchAgentsHealthCheck(commandRunner);
    } else if (action === 'session_checkpoint_health_check') {
      executionResult = await executeSessionCheckpointHealthCheck(commandRunner, config);
    } else if (action === 'runtime_logs_health_check') {
      executionResult = await executeRuntimeLogsHealthCheck(commandRunner, config);
    } else if (action === 'disk_heavy_folders_check') {
      executionResult = await executeDiskHeavyFoldersCheck(commandRunner, config);
    } else if (action === 'memory_bridge_sync_health_check') {
      executionResult = await executeMemoryBridgeSyncHealthCheck(commandRunner, config);
    } else {
      throw new Error(`Unsupported execution action '${action}'.`);
    }

    return {
      outcome: 'completed',
      executionResult,
    };
  } catch (error) {
    return {
      outcome: 'failed',
      error,
    };
  }
}
