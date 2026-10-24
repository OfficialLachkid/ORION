import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const STALE_LOCK_MS = 4 * 60 * 60 * 1_000;

async function acquireLock(lockPath) {
  try {
    return await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const details = await stat(lockPath);
    if (Date.now() - details.mtimeMs <= STALE_LOCK_MS) {
      const busy = new Error(`Another digital-asset generation job holds ${lockPath}.`);
      busy.code = 'RUNTIME_RESOURCE_BUSY';
      busy.resource = 'digital_asset_generation_lock';
      busy.lockPath = lockPath;
      throw busy;
    }
    await rm(lockPath, { force: true });
    return open(lockPath, 'wx');
  }
}

export async function withGenerationLock(options, operation) {
  const lockPath = resolve(
    options.projectRoot || process.cwd(),
    options.lockPath || 'data/runtime/digital-asset-engine/.generation.lock',
  );
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await acquireLock(lockPath);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
