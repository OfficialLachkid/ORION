import { createHash } from 'node:crypto';

export const ORION_JOB_STATUSES = Object.freeze([
  'queued',
  'running',
  'waiting_for_resources',
  'awaiting_review',
  'retry',
  'completed',
  'review',
  'failed',
  'cancelled',
]);

const TERMINAL_STATUSES = new Set(['completed', 'review', 'failed', 'cancelled']);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

export function createJobInputRevision(input) {
  return createHash('sha256').update(JSON.stringify(canonicalize(input))).digest('hex');
}

export function createJobIdempotencyKey({ namespace, jobType, subjectId, inputRevision }) {
  const parts = [namespace, jobType, subjectId, inputRevision].map((part) => String(part || '').trim());
  if (parts.some((part) => !part)) throw new Error('Every idempotency-key component is required.');
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

export function classifyJobForRecovery(job, options = {}) {
  const nowMs = (options.now || new Date()).getTime();
  const status = String(job?.status || '');
  if (!ORION_JOB_STATUSES.includes(status)) return { state: 'invalid', reason: 'unknown_status' };
  if (TERMINAL_STATUSES.has(status)) return { state: 'terminal', reason: status };
  if (status === 'awaiting_review') return { state: 'blocked', reason: 'human_review_required' };

  if (status === 'running') {
    const leaseExpiresAt = timestamp(job.lease_expires_at);
    const heartbeatAt = timestamp(job.heartbeat_at || job.claimed_at);
    const heartbeatTimeoutMs = Number(options.heartbeatTimeoutMs || 5 * 60_000);
    if (leaseExpiresAt === null || leaseExpiresAt <= nowMs) {
      return { state: 'stalled', reason: 'lease_expired' };
    }
    if (heartbeatAt === null || heartbeatAt <= nowMs - heartbeatTimeoutMs) {
      return { state: 'stalled', reason: 'heartbeat_overdue' };
    }
    return { state: 'active', reason: 'lease_and_heartbeat_current' };
  }

  const nextRetryAt = timestamp(job.next_retry_at);
  if (status === 'waiting_for_resources' || status === 'retry') {
    return nextRetryAt === null || nextRetryAt <= nowMs
      ? { state: 'runnable', reason: `${status}_due` }
      : { state: 'waiting', reason: `${status}_scheduled` };
  }
  return { state: 'runnable', reason: 'queued' };
}

export function buildJobFailureTransition(job, error, options = {}) {
  const now = options.now || new Date();
  const attemptCount = Math.max(1, Number(job?.attempt_count || 0));
  const maxAttempts = Math.max(1, Number(job?.max_attempts || options.maxAttempts || 5));
  const terminal = attemptCount >= maxAttempts;
  const baseDelayMs = Math.max(1_000, Number(options.baseDelayMs || 60_000));
  const delayMs = Math.min(24 * 60 * 60_000, baseDelayMs * (2 ** Math.max(0, attemptCount - 1)));
  return {
    status: terminal ? 'review' : 'retry',
    claim_token: null,
    claimed_at: null,
    heartbeat_at: null,
    lease_expires_at: null,
    next_retry_at: terminal ? null : new Date(now.getTime() + delayMs).toISOString(),
    last_error: String(error?.message || error || 'Unknown job failure').slice(0, 1200),
  };
}

export function findJobHealthFindings(jobs, options = {}) {
  const now = options.now || new Date();
  const queueWarningMs = Number(options.queueWarningMs || 30 * 60_000);
  const overdueWarningMs = Number(options.overdueWarningMs || 5 * 60_000);
  const findings = [];
  for (const job of jobs || []) {
    const classification = classifyJobForRecovery(job, { ...options, now });
    if (classification.state === 'stalled') {
      findings.push({ severity: 'critical', jobId: job.id, code: classification.reason });
      continue;
    }
    const createdAt = timestamp(job.created_at);
    if (job.status === 'queued' && createdAt !== null && createdAt <= now.getTime() - queueWarningMs) {
      findings.push({ severity: 'warning', jobId: job.id, code: 'queue_wait_overdue' });
    }
    const nextRetryAt = timestamp(job.next_retry_at);
    if (['retry', 'waiting_for_resources'].includes(job.status)
        && nextRetryAt !== null
        && nextRetryAt <= now.getTime() - overdueWarningMs) {
      findings.push({ severity: 'critical', jobId: job.id, code: 'scheduled_retry_not_claimed' });
    }
  }
  return findings;
}

export function assessOllamaModelHealth({
  endpointReachable,
  requiredModel,
  installedModels = [],
  loadedModels = [],
  smokeTestRequired = true,
  smokeTestStatus = 'not_run',
} = {}) {
  if (!endpointReachable) return { ready: false, reason: 'endpoint_unreachable', loaded: false };
  if (!installedModels.includes(requiredModel)) {
    return { ready: false, reason: 'model_not_installed', loaded: false };
  }
  const loaded = loadedModels.includes(requiredModel);
  if (smokeTestRequired && smokeTestStatus !== 'passed') {
    return { ready: false, reason: `smoke_test_${smokeTestStatus}`, loaded };
  }
  return { ready: true, reason: 'ready', loaded };
}

export function assessRuntimeResourceLock(lockState = {}) {
  if (lockState.reason === 'unreadable') {
    return { healthy: false, severity: 'critical', reason: 'resource_lock_unreadable' };
  }
  if (lockState.reason === 'stale') {
    return { healthy: false, severity: 'warning', reason: 'resource_lock_stale' };
  }
  if (lockState.held === true && lockState.reason === 'active') {
    return { healthy: true, severity: 'info', reason: 'resource_lock_active' };
  }
  return { healthy: true, severity: 'info', reason: 'resource_lock_free' };
}
