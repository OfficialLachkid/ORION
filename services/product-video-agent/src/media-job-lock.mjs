import { mkdir, open, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { resolveInsideRoot } from './paths.mjs';

const DEFAULT_LOCK_PATH = 'data/runtime/product-video-agent/.media-job.lock';
const STALE_LOCK_MS = 4 * 60 * 60 * 1_000;

async function openLock(lockPath) {
  try {
    return await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lockStat = await stat(lockPath);
    if (Date.now() - lockStat.mtimeMs <= STALE_LOCK_MS) {
      throw new Error(`Another O.R.I.O.N. media job holds ${lockPath}.`);
    }
    await rm(lockPath);
    return open(lockPath, 'wx');
  }
}

export async function withLocalMediaJobLock(options, operation) {
  const projectRoot = options.projectRoot || process.cwd();
  const lockPath = resolveInsideRoot(
    projectRoot,
    options.mediaLockPath || DEFAULT_LOCK_PATH,
    'Media job lock path',
  );
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await openLock(lockPath);
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() }));
    return await operation();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}
