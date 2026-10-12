import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, isAbsolute, dirname, resolve } from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';

export const ECOMMERCE_DISCOVERY_RESULT_SCHEMA = 'orion-ecommerce-discovery-run.v1';
export const DISCOVERY_BATCH_SCHEMA = 'product-discovery-batch.v1';
export const DISCOVERY_VALIDATION_SCHEMA = 'product-discovery-plan-validation.v1';
export const REQUIRED_ECOMMERCE_ENV_NAMES = Object.freeze([
  'CJ_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OLLAMA_BASE_URL',
  'OLLAMA_MODEL',
]);
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const TERMINATION_GRACE_MS = 5_000;

export class EcommerceDiscoveryPilotEndedError extends Error {
  constructor(pilotEnd) {
    super(`The ecommerce discovery pilot ended on ${pilotEnd}.`);
    this.name = 'EcommerceDiscoveryPilotEndedError';
    this.pilotEnd = pilotEnd;
  }
}

export class EcommerceDiscoveryBatchError extends Error {
  constructor(summary) {
    super('Ecommerce discovery reported a failed batch.');
    this.name = 'EcommerceDiscoveryBatchError';
    this.summary = summary;
  }
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readEnvironmentFile(filePath) {
  if (!existsSync(filePath)) return {};
  return parseEnv(readFileSync(filePath, 'utf8'));
}

export function readEcommerceEnvironment(repoPath, processEnv = {}) {
  return {
    ...readEnvironmentFile(resolve(repoPath, '.env')),
    ...readEnvironmentFile(resolve(repoPath, '.env.local')),
    ...processEnv,
  };
}

export function missingEcommerceEnvironmentNames(environment) {
  return REQUIRED_ECOMMERCE_ENV_NAMES.filter((name) => !String(environment[name] || '').trim());
}

export function resolveEcommerceDiscoveryConfig(environment, orionRoot) {
  const repoValue = String(environment.ECOMMERCE_REPO_PATH || '').trim();
  if (!repoValue) throw new Error('ECOMMERCE_REPO_PATH is required.');
  const repoPath = isAbsolute(repoValue) ? resolve(repoValue) : resolve(orionRoot, repoValue);
  const planValue = String(environment.ECOMMERCE_DISCOVERY_PLAN_PATH || 'config/discovery-plan.example.json').trim();
  const planPath = isAbsolute(planValue) ? resolve(planValue) : resolve(repoPath, planValue);
  return {
    repoPath,
    planPath,
    npmBin: String(environment.ECOMMERCE_NPM_BIN || 'npm').trim(),
    timeoutMs: positiveInteger(environment.ECOMMERCE_DISCOVERY_TIMEOUT_MS, DEFAULT_DISCOVERY_TIMEOUT_MS),
    lockPath: resolve(orionRoot, 'data', 'runtime', 'resource-locks', 'ecommerce-discovery.lock'),
    ollamaLockPath: resolve(orionRoot, 'data', 'runtime', 'resource-locks', 'ollama.lock'),
  };
}

function appendCaptured(current, chunk, limit) {
  if (Buffer.byteLength(current) >= limit) return current;
  const remaining = limit - Buffer.byteLength(current);
  return current + Buffer.from(chunk).subarray(0, remaining).toString('utf8');
}

function terminateProcessTree(child, signal) {
  if (!child?.pid) return;
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process may already have exited between the timeout and the signal.
  }
}

export function runStructuredProcess({
  command,
  args,
  cwd,
  env = process.env,
  timeoutMs,
  maxCaptureBytes = DEFAULT_MAX_CAPTURE_BYTES,
  spawnImpl = spawn,
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    const child = spawnImpl(command, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      stdout = appendCaptured(stdout, chunk, maxCaptureBytes);
    });
    child.stderr?.on('data', (chunk) => {
      stderr = appendCaptured(stderr, chunk, maxCaptureBytes);
    });
    child.once('error', rejectPromise);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, 'SIGTERM');
      killTimer = setTimeout(() => terminateProcessTree(child, 'SIGKILL'), TERMINATION_GRACE_MS);
      killTimer.unref?.();
    }, timeoutMs);
    timeout.unref?.();
    child.once('close', (exitCode, signal) => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise({
        exitCode: Number.isInteger(exitCode) ? exitCode : null,
        signal: signal || null,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export function sanitizeOperationalError(value, secretValues = []) {
  let message = value instanceof Error ? value.message : String(value || 'Unknown failure.');
  for (const secret of secretValues) {
    const normalized = String(secret || '');
    if (normalized.length >= 4) message = message.split(normalized).join('[REDACTED]');
  }
  message = message
    .replace(/\b(CJ_API_KEY|SUPABASE_SERVICE_ROLE_KEY|Authorization|token|secret)\s*[=:]\s*[^\s,;]+/giu, '$1=[REDACTED]')
    .replace(/([?&](?:access_token|api_key|apikey|key|token|secret)=)[^&\s]+/giu, '$1[REDACTED]')
    .replace(/[\r\n\t]+/gu, ' ')
    .trim();
  return message.slice(0, 500) || 'Unknown failure.';
}

export function parseSingleJsonObject(value, label = 'process output') {
  const trimmed = String(value || '').trim();
  if (!trimmed) throw new Error(`${label} was empty.`);
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(`${label} was not one JSON object.`);
  }
}

export function validatePlanValidationOutput(value) {
  if (value?.schema !== DISCOVERY_VALIDATION_SCHEMA || value?.valid !== true) {
    throw new Error('Ecommerce discovery plan validation returned an unexpected schema or status.');
  }
  if (!Number.isInteger(value.jobCount) || value.jobCount < 1 || value.jobCount > 4) {
    throw new Error('Ecommerce discovery plan must contain between one and four jobs.');
  }
  return value;
}

export function summarizeDiscoveryBatch(value, exitCode = 0) {
  if (value?.schema !== DISCOVERY_BATCH_SCHEMA) {
    throw new Error('Ecommerce discovery returned an unexpected output schema.');
  }
  if (!['completed', 'completed_with_warnings', 'failed'].includes(value.status)) {
    throw new Error('Ecommerce discovery returned an unexpected status.');
  }
  const results = Array.isArray(value.results) ? value.results : [];
  const completedResults = results.filter((entry) => entry && typeof entry === 'object' && 'runId' in entry);
  return {
    schema: ECOMMERCE_DISCOVERY_RESULT_SCHEMA,
    planId: String(value.planId || ''),
    status: value.status,
    startedAt: value.startedAt || null,
    completedAt: value.completedAt || null,
    durationMs: value.startedAt && value.completedAt
      ? Math.max(0, new Date(value.completedAt).getTime() - new Date(value.startedAt).getTime())
      : null,
    jobCount: Number(value.jobCount || 0),
    completedJobCount: Number(value.completedJobCount || 0),
    failedJobCount: Number(value.failedJobCount || 0),
    candidateCount: Number(value.totals?.candidateCount || 0),
    observationCount: Number(value.totals?.observationCount || 0),
    apiRequestsUsed: Number(value.totals?.apiRequestsUsed || 0),
    cachedJobCount: completedResults.filter((entry) => entry.source === 'cache').length,
    supplierJobCount: completedResults.filter((entry) => entry.source === 'supplier').length,
    warningCount: completedResults.reduce(
      (total, entry) => total + (Array.isArray(entry.warnings) ? entry.warnings.length : 0),
      0,
    ),
    exitCode,
  };
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function acquireResourceLock(lockPath, options = {}) {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    try {
      const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (processExists(Number(existing.pid))) {
        throw new Error(`Resource lock is already held: ${lockPath}`);
      }
      unlinkSync(lockPath);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`Resource lock is unreadable: ${lockPath}`);
      if (String(error?.message || '').startsWith('Resource lock is already held:')) throw error;
      if (existsSync(lockPath)) throw error;
    }
  }
  const token = randomUUID();
  let descriptor;
  try {
    descriptor = openSync(lockPath, 'wx');
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }));
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw new Error(`Could not acquire resource lock: ${lockPath}`, { cause: error });
  }
  closeSync(descriptor);
  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (current.token === token) unlinkSync(lockPath);
    } catch {
      // Never remove another process's lock when ownership cannot be proven.
    }
  };
}

export function localDateInTimeZone(date = new Date(), timeZone = 'Europe/Amsterdam') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function ensurePilotIsActive(pilotEnd, now = new Date()) {
  if (!pilotEnd) return;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(pilotEnd)) throw new Error('Pilot end must use YYYY-MM-DD.');
  if (localDateInTimeZone(now) >= pilotEnd) {
    throw new EcommerceDiscoveryPilotEndedError(pilotEnd);
  }
}

export async function inspectOllama({ baseUrl, model, fetchImpl = fetch, requireIdle = false }) {
  const normalizedBaseUrl = String(baseUrl || '').replace(/\/+$/u, '');
  if (!normalizedBaseUrl || !model) throw new Error('Ollama configuration is incomplete.');
  const tagsResponse = await fetchImpl(`${normalizedBaseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
  if (!tagsResponse.ok) throw new Error(`Ollama model inventory returned HTTP ${tagsResponse.status}.`);
  const tags = await tagsResponse.json();
  const installed = (Array.isArray(tags.models) ? tags.models : []).some((entry) => entry?.name === model);
  if (!installed) throw new Error('The configured Ollama model is not installed.');
  const psResponse = await fetchImpl(`${normalizedBaseUrl}/api/ps`, { signal: AbortSignal.timeout(5_000) });
  if (!psResponse.ok) throw new Error(`Ollama process inventory returned HTTP ${psResponse.status}.`);
  const ps = await psResponse.json();
  const loadedModelCount = Array.isArray(ps.models) ? ps.models.length : 0;
  if (requireIdle && loadedModelCount > 0) throw new Error('Ollama is already in use; ecommerce discovery did not start.');
  return { installed: true, loadedModelCount };
}

function discoveryCommand(config, validate) {
  const npmBinDirectory = isAbsolute(config.npmBin) ? dirname(config.npmBin) : '';
  return {
    command: config.npmBin,
    args: [
      'run',
      '--silent',
      'discovery:batch',
      '--',
      '--plan',
      config.planPath,
      ...(validate ? ['--validate'] : []),
    ],
    cwd: config.repoPath,
    env: {
      ...process.env,
      ...(npmBinDirectory
        ? { PATH: [npmBinDirectory, process.env.PATH || ''].filter(Boolean).join(delimiter) }
        : {}),
    },
  };
}

export async function runEcommerceDiscovery(options) {
  const {
    environment,
    orionRoot,
    validateOnly = false,
    pilotEnd = '',
    now = new Date(),
    runProcess = runStructuredProcess,
    fetchImpl = fetch,
  } = options;
  const config = resolveEcommerceDiscoveryConfig(environment, orionRoot);
  if (!existsSync(config.repoPath)) throw new Error('Configured ecommerce repository does not exist.');
  if (!existsSync(config.planPath)) throw new Error('Configured ecommerce discovery plan does not exist.');
  ensurePilotIsActive(pilotEnd, now);

  const ecommerceEnv = readEcommerceEnvironment(config.repoPath, environment);
  const missing = missingEcommerceEnvironmentNames(ecommerceEnv);
  if (missing.length) throw new Error(`Ecommerce environment is missing: ${missing.join(', ')}.`);

  const validation = await runProcess({
    ...discoveryCommand(config, true),
    timeoutMs: Math.min(config.timeoutMs, 120_000),
  });
  if (validation.timedOut) throw new Error('Ecommerce discovery plan validation timed out.');
  if (validation.exitCode !== 0) throw new Error('Ecommerce discovery plan validation failed.');
  const validatedPlan = validatePlanValidationOutput(parseSingleJsonObject(validation.stdout, 'plan validation output'));
  if (validatedPlan.jobCount !== 2) {
    throw new Error('The ecommerce discovery pilot plan must contain exactly two jobs.');
  }
  if (validateOnly) {
    const ollama = await inspectOllama({
      baseUrl: ecommerceEnv.OLLAMA_BASE_URL,
      model: ecommerceEnv.OLLAMA_MODEL,
      fetchImpl,
    });
    return {
      schema: ECOMMERCE_DISCOVERY_RESULT_SCHEMA,
      status: 'validated',
      planId: validatedPlan.planId,
      jobCount: validatedPlan.jobCount,
      requiredEnvironmentNamesPresent: true,
      ollamaModelInstalled: ollama.installed,
      ollamaLoadedModelCount: ollama.loadedModelCount,
    };
  }

  const releaseDiscoveryLock = acquireResourceLock(config.lockPath);
  let releaseOllamaLock;
  try {
    releaseOllamaLock = acquireResourceLock(config.ollamaLockPath);
    await inspectOllama({
      baseUrl: ecommerceEnv.OLLAMA_BASE_URL,
      model: ecommerceEnv.OLLAMA_MODEL,
      fetchImpl,
      requireIdle: true,
    });
    const execution = await runProcess({
      ...discoveryCommand(config, false),
      timeoutMs: config.timeoutMs,
    });
    if (execution.timedOut) throw new Error('Ecommerce discovery exceeded its 30-minute execution limit.');
    const rawOutput = execution.stdout.trim() || execution.stderr.trim();
    const parsed = parseSingleJsonObject(rawOutput, 'discovery batch output');
    const summary = summarizeDiscoveryBatch(parsed, execution.exitCode);
    if (execution.exitCode !== 0 || summary.status === 'failed') {
      throw new EcommerceDiscoveryBatchError(summary);
    }
    return summary;
  } finally {
    releaseOllamaLock?.();
    releaseDiscoveryLock();
  }
}
