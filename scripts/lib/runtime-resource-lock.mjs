import { existsSync, readFileSync } from 'node:fs';

export function processExists(pid, options = {}) {
  const normalizedPid = Number(pid);
  if (!Number.isInteger(normalizedPid) || normalizedPid <= 0) return false;
  try {
    (options.kill || process.kill)(normalizedPid, 0);
    return true;
  } catch {
    return false;
  }
}

export function inspectRuntimeResourceLock(lockPath, options = {}) {
  if (!(options.existsSync || existsSync)(lockPath)) {
    return { held: false, reason: 'missing', pid: null, startedAt: '' };
  }
  try {
    const parsed = JSON.parse((options.readFileSync || readFileSync)(lockPath, 'utf8'));
    const pid = Number(parsed.pid);
    const held = processExists(pid, options);
    return {
      held,
      reason: held ? 'active' : 'stale',
      pid: Number.isInteger(pid) ? pid : null,
      startedAt: String(parsed.startedAt || parsed.started_at || ''),
    };
  } catch {
    return { held: true, reason: 'unreadable', pid: null, startedAt: '' };
  }
}
