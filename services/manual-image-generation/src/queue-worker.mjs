import { open, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  cleanupAbandonedManualImageJobs,
  listRunnableManualImageJobs,
  runManualImageGenerationJob,
} from './jobs.mjs';

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function acquireWorkerLock(archiveRoot) {
  const lockPath = resolve(archiveRoot, '.manual-image-worker.lock');
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    return { handle, lockPath };
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let existing = null;
    try { existing = JSON.parse(await readFile(lockPath, 'utf8')); } catch { /* stale malformed lock */ }
    if (processAlive(Number(existing?.pid))) return null;
    await rm(lockPath, { force: true });
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
    return { handle, lockPath };
  }
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function drainManualImageGenerationQueue(options) {
  const lock = await acquireWorkerLock(options.config.archiveRoot);
  if (!lock) return { acquired: false, processed: [], failed: [], deferred: [] };
  const report = { acquired: true, processed: [], failed: [], deferred: [] };
  const sleep = options.sleep || wait;
  const maximumResourceWaitCycles = options.maximumResourceWaitCycles ?? 240;
  let resourceWaitCycles = 0;
  try {
    await cleanupAbandonedManualImageJobs({ config: options.config }).catch(() => null);
    while (true) {
      const runnable = await listRunnableManualImageJobs(options.config);
      if (runnable.length === 0) break;
      let resourceDeferred = false;
      for (const jobPath of runnable) {
        try {
          const result = await (options.runJob || runManualImageGenerationJob)({
            jobPath,
            runtimeConfig: options.runtimeConfig,
            config: options.config,
            projectRoot: options.projectRoot,
            fetchImpl: options.fetchImpl,
          });
          report.processed.push({ jobPath, status: result.job.status });
        } catch (error) {
          if (error?.code === 'MANUAL_IMAGE_RESOURCE_BUSY') {
            resourceDeferred = true;
            report.deferred.push({ jobPath, reason: error.message });
            break;
          }
          report.failed.push({ jobPath, error: String(error?.message || error) });
        }
      }
      if (resourceDeferred) {
        resourceWaitCycles += 1;
        if (resourceWaitCycles >= maximumResourceWaitCycles) break;
        await sleep(options.resourceRetryDelayMs ?? 30_000);
      } else {
        resourceWaitCycles = 0;
        const retryableDeliveryFailure = report.failed.some((failure) => failure.jobPath);
        if (retryableDeliveryFailure) await sleep(options.deliveryRetryDelayMs ?? 5_000);
      }
    }
    return report;
  } finally {
    await lock.handle.close();
    await rm(lock.lockPath, { force: true });
  }
}
