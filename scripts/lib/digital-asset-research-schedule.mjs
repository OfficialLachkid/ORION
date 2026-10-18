import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import {
  acquireResourceLock,
  inspectOllama,
  runStructuredProcess,
} from './ecommerce-discovery.mjs';
import { inspectRuntimeResourceLock } from './runtime-resource-lock.mjs';

export const RESEARCH_SCHEDULE_SCHEMA = 'orion-digital-asset-research-schedule.v1';
export const DEFAULT_MAX_RUNTIME_MS = 20 * 60 * 1000;
export const DEFAULT_MINIMUM_INTERVAL_MS = 23 * 60 * 60 * 1000;

const BLOCKING_PROCESS_PATTERNS = Object.freeze([
  /run-night-shift\.mjs/iu,
  /run-scheduled-leadgen\.mjs/iu,
  /run-ecommerce-discovery\.mjs/iu,
  /digital-asset-engine[\\/]index\.mjs/iu,
  /product-video-agent[\\/]/iu,
  /mac-sync-worker\.mjs/iu,
  /\bffmpeg\b/iu,
  /\bbutler\b/iu,
]);

function parseDate(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function evaluateResearchCadence({ lastSuccessfulAt, now = new Date(), minimumIntervalMs }) {
  const lastTimestamp = parseDate(lastSuccessfulAt);
  if (lastTimestamp === null) return { eligible: true, remainingMs: 0 };
  const elapsedMs = now.getTime() - lastTimestamp;
  const remainingMs = Math.max(0, minimumIntervalMs - elapsedMs);
  return { eligible: remainingMs === 0, remainingMs };
}

export function parseProcessTable(output, currentPid = process.pid) {
  return String(output || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d+)\s+(.+)$/u.exec(line);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter((entry) => entry && entry.pid !== currentPid);
}

export function findBlockingProcesses(processes, patterns = BLOCKING_PROCESS_PATTERNS) {
  return processes.filter((entry) => patterns.some((pattern) => pattern.test(entry.command)));
}

export function readScheduleState(statePath) {
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    throw new Error(`Research schedule state is unreadable: ${statePath}`);
  }
}

function writeScheduleState(statePath, value) {
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function listProcesses() {
  const result = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Could not inspect running processes.');
  return parseProcessTable(result.stdout);
}

function deferredResult(reason, details = {}) {
  return {
    schema: RESEARCH_SCHEDULE_SCHEMA,
    status: 'deferred',
    reason,
    ...details,
  };
}

export async function runScheduledDigitalAssetResearch(options) {
  const now = options.now || new Date();
  const state = (options.readState || readScheduleState)(options.statePath);
  const cadence = evaluateResearchCadence({
    lastSuccessfulAt: state.lastSuccessfulCollectionAt,
    now,
    minimumIntervalMs: options.minimumIntervalMs || DEFAULT_MINIMUM_INTERVAL_MS,
  });
  if (!cadence.eligible) {
    return deferredResult('minimum_interval', { remainingMs: cadence.remainingMs });
  }

  if (!(options.exists || existsSync)(options.archiveRoot)) {
    return deferredResult('archive_unavailable', { archiveRoot: options.archiveRoot });
  }

  const generationLock = inspectRuntimeResourceLock(options.generationLockPath);
  if (generationLock.held) {
    return deferredResult('digital_asset_generation_running', { lock: generationLock });
  }

  const processes = (options.listProcesses || listProcesses)();
  const blockingProcesses = findBlockingProcesses(processes);
  if (blockingProcesses.length > 0) {
    return deferredResult('blocking_process_running', {
      processes: blockingProcesses.map((entry) => ({ pid: entry.pid, command: entry.command.slice(0, 160) })),
    });
  }

  let releaseResearchLock;
  let releaseOllamaLock;
  try {
    releaseResearchLock = (options.acquireLock || acquireResourceLock)(options.researchLockPath);
    releaseOllamaLock = (options.acquireLock || acquireResourceLock)(options.ollamaLockPath);
    await (options.inspectOllama || inspectOllama)({
      baseUrl: options.ollamaBaseUrl,
      model: options.ollamaModel,
      fetchImpl: options.fetchImpl,
      requireIdle: true,
    });

    const execution = await (options.runProcess || runStructuredProcess)({
      command: process.execPath,
      args: [
        options.researchScriptPath,
        'collect',
        '--scheduled',
        '--config', options.configPath,
        '--archive-root', options.archiveRoot,
        '--runtime-env', options.runtimeEnvPath,
        '--post-to-discord',
      ],
      cwd: options.projectRoot,
      timeoutMs: options.maxRuntimeMs || DEFAULT_MAX_RUNTIME_MS,
    });

    if (execution.timedOut) throw new Error('Digital-asset research exceeded its execution limit.');
    if (execution.exitCode !== 0) {
      throw new Error(String(execution.stderr || execution.stdout || 'Research collection failed.').trim().slice(0, 500));
    }
    const result = JSON.parse(String(execution.stdout || '').trim());
    const completedAt = new Date().toISOString();
    (options.writeState || writeScheduleState)(options.statePath, {
      schema: RESEARCH_SCHEDULE_SCHEMA,
      lastSuccessfulCollectionAt: completedAt,
      runId: String(result.runId || ''),
    });
    return {
      schema: RESEARCH_SCHEDULE_SCHEMA,
      status: 'completed',
      runId: String(result.runId || ''),
      observationCount: Number(result.observationCount || 0),
      reportStatus: String(result.report?.status || ''),
      completedAt,
    };
  } catch (error) {
    if (/already held|Ollama is already in use/iu.test(String(error?.message || ''))) {
      return deferredResult('resource_busy', { detail: String(error.message).slice(0, 300) });
    }
    throw error;
  } finally {
    releaseOllamaLock?.();
    releaseResearchLock?.();
  }
}

export function resolveResearchSchedulePaths(projectRoot, archiveRoot) {
  return {
    projectRoot,
    archiveRoot,
    configPath: resolve(projectRoot, 'services/digital-asset-research/config.example.json'),
    researchScriptPath: resolve(projectRoot, 'services/digital-asset-research/index.mjs'),
    runtimeEnvPath: resolve(projectRoot, 'config/discord/.env'),
    statePath: resolve(projectRoot, 'data/runtime/digital-asset-research/schedule-state.json'),
    researchLockPath: resolve(projectRoot, 'data/runtime/resource-locks/digital-asset-research.lock'),
    ollamaLockPath: resolve(projectRoot, 'data/runtime/resource-locks/ollama.lock'),
    generationLockPath: resolve(projectRoot, 'data/runtime/digital-asset-engine/.generation.lock'),
  };
}
