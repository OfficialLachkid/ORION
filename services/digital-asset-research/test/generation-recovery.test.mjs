import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { recoverResearchGenerationJobs } from '../src/generation-recovery.mjs';

async function writeJob(root, name, job) {
  const jobsRoot = resolve(root, 'generation-jobs');
  await mkdir(jobsRoot, { recursive: true });
  const path = resolve(jobsRoot, `${name}.json`);
  await writeFile(path, JSON.stringify(job), 'utf8');
  return path;
}

test('restart recovery requeues interrupted and queued jobs but leaves completed jobs alone', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-generation-recovery-'));
  const runningPath = await writeJob(root, 'running-job', {
    job_id: 'running-job', status: 'running', worker_pid: 501, recovery_count: 0,
  });
  const queuedPath = await writeJob(root, 'queued-job', {
    job_id: 'queued-job', status: 'queued', worker_pid: null,
  });
  await writeJob(root, 'completed-job', { job_id: 'completed-job', status: 'completed' });
  const scheduled = [];
  const report = await recoverResearchGenerationJobs({
    archiveRoot: root,
    now: '2026-10-20T20:00:00.000Z',
    processAlive: () => false,
    scheduleJob(path) { scheduled.push(path); return true; },
  });
  assert.deepEqual(scheduled.sort(), [queuedPath, runningPath].sort());
  assert.equal(report.recovered.length, 2);
  assert.equal(report.skipped[0].status, 'completed');
  const recovered = JSON.parse(await readFile(runningPath, 'utf8'));
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.worker_pid, null);
  assert.equal(recovered.recovery_count, 1);
  assert.equal(recovered.interrupted_at, '2026-10-20T20:00:00.000Z');
});

test('restart recovery does not duplicate a live generation worker', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-generation-active-'));
  await writeJob(root, 'active-job', { job_id: 'active-job', status: 'running', worker_pid: 777 });
  const report = await recoverResearchGenerationJobs({
    archiveRoot: root,
    processAlive: (pid) => pid === 777,
    scheduleJob() { throw new Error('must not schedule'); },
  });
  assert.deepEqual(report.active, [{ job_id: 'active-job', worker_pid: 777 }]);
  assert.equal(report.recovered.length, 0);
});
