import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const DEFAULT_LOCK_PATH = 'data/runtime/digital-asset-engine/.itch-browser.lock';
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_WAIT_TIMEOUT_MS = Number.POSITIVE_INFINITY;
const DEFAULT_STALE_LOCK_MS = 4 * 60 * 60 * 1_000;
const RECOVERY_MARKER_STALE_MS = 30_000;

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function defaultSleep(delayMs) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
}

async function readLockState(lockPath) {
  try {
    const [contents, details] = await Promise.all([
      readFile(lockPath, 'utf8'),
      stat(lockPath),
    ]);
    let owner = null;
    try { owner = JSON.parse(contents); } catch { /* A fresh malformed lock is still treated as held. */ }
    return { owner, details };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function tryAcquireLock(lockPath, options) {
  const token = randomUUID();
  let handle;
  try {
    handle = await open(lockPath, 'wx');
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  if (handle) {
    try {
      await handle.writeFile(JSON.stringify({
        token,
        pid: options.pid,
        acquired_at: new Date(options.now).toISOString(),
      }));
      return { handle, token };
    } catch (error) {
      await handle.close().catch(() => {});
      await rm(lockPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  const existing = await readLockState(lockPath);
  if (!existing) return null;
  const ownerPid = Number(existing.owner?.pid);
  const ageMs = Math.max(0, options.now - existing.details.mtimeMs);
  const hasOwnerPid = Number.isInteger(ownerPid) && ownerPid > 0;
  if (ageMs <= options.staleLockMs
    && ((hasOwnerPid && options.processAlive(ownerPid)) || !hasOwnerPid)) {
    return null;
  }

  const recoveryPath = `${lockPath}.recovery`;
  let recoveryHandle;
  try {
    recoveryHandle = await open(recoveryPath, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const recovery = await readLockState(recoveryPath);
      if (recovery && options.now - recovery.details.mtimeMs > options.recoveryMarkerStaleMs) {
        await rm(recoveryPath, { force: true });
      }
      return null;
    }
    throw error;
  }
  try {
    const latest = await readLockState(lockPath);
    if (!latest) return null;
    const sameOwner = latest.owner?.token === existing.owner?.token
      && latest.details.mtimeMs === existing.details.mtimeMs;
    if (sameOwner) await rm(lockPath, { force: true });
  } finally {
    await recoveryHandle.close();
    await rm(recoveryPath, { force: true });
  }
  return null;
}

async function releaseLock(lockPath, lock) {
  await lock.handle.close();
  const current = await readLockState(lockPath);
  if (current?.owner?.token === lock.token) {
    await rm(lockPath, { force: true });
  }
}

export async function withItchBrowserLock(options = {}, operation) {
  if (typeof operation !== 'function') throw new Error('Itch browser lock requires an operation.');
  const lockPath = resolve(
    options.projectRoot || process.cwd(),
    options.lockPath || DEFAULT_LOCK_PATH,
  );
  const sleep = options.sleep || defaultSleep;
  const processAlive = options.processAlive || defaultProcessAlive;
  const pid = Number(options.pid || process.pid);
  const pollIntervalMs = Math.max(1, Number(options.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS));
  const waitTimeoutMs = Math.max(0, Number(options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS));
  const staleLockMs = Math.max(1, Number(options.staleLockMs || DEFAULT_STALE_LOCK_MS));
  const startedAt = Date.now();
  let waitReported = false;
  await mkdir(dirname(lockPath), { recursive: true });

  while (true) {
    const now = Date.now();
    const lock = await tryAcquireLock(lockPath, {
      now,
      pid,
      processAlive,
      staleLockMs,
      recoveryMarkerStaleMs: Math.max(
        1,
        Number(options.recoveryMarkerStaleMs || RECOVERY_MARKER_STALE_MS),
      ),
    });
    if (lock) {
      try {
        return await operation();
      } finally {
        await releaseLock(lockPath, lock);
      }
    }
    if (!waitReported) {
      waitReported = true;
      options.onWait?.({ lockPath, waitedMs: now - startedAt });
    }
    if (now - startedAt >= waitTimeoutMs) {
      const busy = new Error(`Timed out waiting for the authenticated itch.io browser resource at ${lockPath}.`);
      busy.code = 'RUNTIME_RESOURCE_BUSY';
      busy.resource = 'itch_browser_profile';
      busy.lockPath = lockPath;
      throw busy;
    }
    await sleep(Math.min(pollIntervalMs, Math.max(1, waitTimeoutMs - (now - startedAt))));
  }
}

