import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
export const projectRoot = resolve(currentDir, '..', '..');

function splitCsv(value) {
  if (!value) {
    return [];
  }

  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDotEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const content = readFileSync(filePath, 'utf8');
  const entries = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    entries[key] = value;
  }

  return entries;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function resolveConfigPath(relativePathWithoutExample, exampleRelativePath) {
  const preferredPath = resolve(projectRoot, relativePathWithoutExample);
  if (existsSync(preferredPath)) {
    return preferredPath;
  }

  return resolve(projectRoot, exampleRelativePath);
}

function resolveEnvFilePath(explicitPath) {
  if (explicitPath) {
    return resolve(projectRoot, explicitPath);
  }

  const primary = resolve(projectRoot, 'config/discord/.env');
  if (existsSync(primary)) {
    return primary;
  }

  return resolve(projectRoot, 'config/discord/.env.example');
}

function parseBoolean(value, fallbackValue = false) {
  if (value === undefined || value === null || value === '') {
    return fallbackValue;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function loadRuntimeEnv(explicitEnvFilePath) {
  const envFilePath = resolveEnvFilePath(explicitEnvFilePath);
  const supabaseEnvPath = resolve(projectRoot, 'config/supabase/.env');
  const gmailEnvPath = resolve(projectRoot, 'config/gmail/.env');
  const productVideoEnvPath = resolve(projectRoot, 'config/product-video/.env');

  return {
    ...parseDotEnvFile(envFilePath),
    ...parseDotEnvFile(supabaseEnvPath),
    ...parseDotEnvFile(gmailEnvPath),
    ...parseDotEnvFile(productVideoEnvPath),
    ...process.env,
  };
}

function substituteEnvPlaceholders(value, env) {
  if (typeof value !== 'string') {
    return value;
  }

  if (Object.prototype.hasOwnProperty.call(env, value)) {
    return env[value];
  }

  if (/^[A-Z0-9_]+$/u.test(value)) {
    return '';
  }

  return value;
}

function getPositiveInteger(value, fallbackValue) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }

  return parsed;
}

export function loadRuntimeConfig(options = {}) {
  const env = loadRuntimeEnv(options.envFilePath);

  const channelMapPath = resolveConfigPath('config/discord/channel-map.json', 'config/discord/channel-map.example.json');
  const approvalRulesPath = resolveConfigPath('config/discord/approval-rules.json', 'config/discord/approval-rules.example.json');
  const memoryNamespacesPath = resolve(projectRoot, 'config/runtime/memory-namespaces.json');
  const memoryPromotionRulesPath = resolve(projectRoot, 'config/runtime/memory-promotion-rules.json');

  const channelMap = readJson(channelMapPath);
  const channelIds = Object.fromEntries(
    Object.entries(channelMap.channels || {}).map(([key, value]) => [key, substituteEnvPlaceholders(value, env)])
  );

  const resolvedTmpDir = env.RUNTIME_TMP_DIR || resolve(projectRoot, 'data', 'runtime', 'tmp');
  const resolvedLogDir = env.RUNTIME_LOG_DIR || resolve(projectRoot, 'data', 'runtime', 'logs');
  const resolvedMetricsEventsFile = env.METRICS_EVENTS_PATH || resolve(resolvedLogDir, 'ops-events.jsonl');
  const resolvedHealthMonitorStateFile =
    env.HEALTH_MONITOR_STATE_PATH || resolve(resolvedLogDir, 'health-monitor-state.json');

  return {
    env,
    operatorRoleId: env.DISCORD_OPERATOR_ROLE_ID || '',
    operatorUserIds: splitCsv(env.DISCORD_OPERATOR_USER_IDS || env.DISCORD_ALLOWED_OPERATOR_USER_IDS || ''),
    guildId: substituteEnvPlaceholders(channelMap.guildId, env),
    channelIds,
    approvalRules: readJson(approvalRulesPath),
    memoryNamespaces: readJson(memoryNamespacesPath),
    memoryPromotionRules: readJson(memoryPromotionRulesPath),
    runtimePaths: {
      tmpDir: resolvedTmpDir,
      logDir: resolvedLogDir,
      metricsEventsFile: resolvedMetricsEventsFile,
      healthMonitorStateFile: resolvedHealthMonitorStateFile,
    },
    transcription: {
      provider: env.TRANSCRIPTION_PROVIDER || 'local',
      whisperModel: env.WHISPER_MODEL || 'medium',
      pythonBin: env.TRANSCRIPTION_PYTHON_BIN || '',
    },
    healthThresholds: {
      diskUsageWarnPercent: getPositiveInteger(env.HEALTH_DISK_WARN_PERCENT, 85),
      diskUsageCriticalPercent: getPositiveInteger(env.HEALTH_DISK_CRITICAL_PERCENT, 92),
      healthMonitorIntervalSeconds: getPositiveInteger(env.HEALTH_MONITOR_INTERVAL_SECONDS, 600),
      alertConsecutiveUnhealthy: getPositiveInteger(env.HEALTH_ALERT_CONSECUTIVE_UNHEALTHY, 2),
      recoveryConsecutiveHealthy: getPositiveInteger(env.HEALTH_RECOVERY_CONSECUTIVE_HEALTHY, 2),
    },
    rufloWorkerService: {
      expected: parseBoolean(env.RUFLO_WORKER_SERVICE_EXPECTED ?? env.RUFLO_DAEMON_EXPECTED, true),
    },
    claude: {
      enabled: parseBoolean(env.CLAUDE_RUNNER_ENABLED, true),
      command: env.CLAUDE_COMMAND || 'claude',
      model: env.CLAUDE_MODEL || '',
      fallbackModel: env.CLAUDE_FALLBACK_MODEL || '',
      permissionMode: env.CLAUDE_PERMISSION_MODE || 'acceptEdits',
      allowedTools: splitCsv(env.CLAUDE_ALLOWED_TOOLS || ''),
      appendSystemPrompt: env.CLAUDE_APPEND_SYSTEM_PROMPT || '',
      workingDirectory: env.CLAUDE_WORKING_DIRECTORY
        ? resolve(projectRoot, env.CLAUDE_WORKING_DIRECTORY)
        : projectRoot,
    },
    developerAgent: {
      enabled: parseBoolean(env.DEVELOPER_AGENT_ENABLED, true),
      repositoryRoot: projectRoot,
      worktreesRoot: env.DEVELOPER_AGENT_WORKTREES_PATH
        ? resolve(projectRoot, env.DEVELOPER_AGENT_WORKTREES_PATH)
        : resolve(resolvedTmpDir, 'developer-worktrees'),
      stateRoot: env.DEVELOPER_AGENT_STATE_PATH
        ? resolve(projectRoot, env.DEVELOPER_AGENT_STATE_PATH)
        : resolve(resolvedTmpDir, 'developer-agent'),
      remote: env.DEVELOPER_AGENT_REMOTE || 'origin',
      baseBranch: env.DEVELOPER_AGENT_BASE_BRANCH || 'main',
      sourceBranchPrefix: env.DEVELOPER_AGENT_SOURCE_BRANCH_PREFIX || 'agent/',
      mergeOnApproval: parseBoolean(env.DEVELOPER_AGENT_MERGE_ON_APPROVAL, true),
      mergeMethod: env.DEVELOPER_AGENT_MERGE_METHOD || 'squash',
    },
    gmail: {
      clientId: env.GMAIL_CLIENT_ID || '',
      clientSecret: env.GMAIL_CLIENT_SECRET || '',
      refreshToken: env.GMAIL_REFRESH_TOKEN || '',
      senderEmail: env.GMAIL_SENDER_EMAIL || '',
      senderName: env.GMAIL_SENDER_NAME || '',
      loopbackPort: getPositiveInteger(env.GMAIL_OAUTH_LOOPBACK_PORT, 53682),
      bccAudit: splitCsv(env.GMAIL_BCC_AUDIT || ''),
      draftOnly: parseBoolean(env.GMAIL_DRAFT_ONLY, false),
    },
  };
}

export function readJsonInput(filePath) {
  const absolutePath = resolve(projectRoot, filePath);
  return readJson(absolutePath);
}

export function readStdin() {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolvePromise(data));
    process.stdin.on('error', rejectPromise);
  });
}

export function parseJsonFromString(input, fallbackLabel = 'input payload') {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new Error(`Could not parse ${fallbackLabel} as JSON: ${error.message}`);
  }
}
