import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function recoverResearchGenerationJobs(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) return { scanned: 0, recovered: [], active: [], skipped: [] };
  const jobsRoot = resolve(archiveRoot, 'generation-jobs');
  let filenames;
  try {
    filenames = (await readdir(jobsRoot)).filter((name) => name.endsWith('.json')).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') return { scanned: 0, recovered: [], active: [], skipped: [] };
    throw error;
  }
  const processAlive = options.processAlive || defaultProcessAlive;
  const scheduleJob = options.scheduleJob;
  const report = { scanned: filenames.length, recovered: [], active: [], skipped: [] };
  for (const filename of filenames) {
    const path = resolve(jobsRoot, filename);
    const job = JSON.parse(await readFile(path, 'utf8'));
    if (job.status === 'completed' || job.status === 'failed') {
      report.skipped.push({ job_id: job.job_id, status: job.status });
      continue;
    }
    if (job.status === 'running' && processAlive(Number(job.worker_pid))) {
      report.active.push({ job_id: job.job_id, worker_pid: Number(job.worker_pid) });
      continue;
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      report.skipped.push({ job_id: job.job_id, status: job.status || 'unknown' });
      continue;
    }
    const recoveredAt = options.now || new Date().toISOString();
    const recoveredJob = {
      ...job,
      status: 'queued',
      worker_pid: null,
      recovery_count: Number(job.recovery_count || 0) + 1,
      recovered_at: recoveredAt,
      ...(job.status === 'running' ? { interrupted_at: recoveredAt } : {}),
    };
    await writeJsonAtomic(path, recoveredJob);
    const scheduled = scheduleJob?.(path) === true;
    report.recovered.push({
      job_id: recoveredJob.job_id,
      path,
      previous_status: job.status,
      scheduled,
    });
  }
  return report;
}
