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

test('restart recovery resumes resource waits and legacy lock failures only', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-generation-resource-recovery-'));
  const waitingPath = await writeJob(root, 'waiting-job', {
    job_id: 'waiting-job',
    status: 'waiting_for_resources',
    worker_pid: 888,
    wait_reason: '[RUNTIME_RESOURCE_BUSY] image model occupied',
    resource_wait_count: 2,
  });
  const legacyPath = await writeJob(root, 'legacy-job', {
    job_id: 'legacy-job',
    status: 'failed',
    worker_pid: null,
    started_at: '2026-10-20T19:00:00.000Z',
    completed_at: '2026-10-20T19:01:00.000Z',
    error: 'Error: Another digital-asset generation job holds /tmp/.generation.lock.',
  });
  await writeJob(root, 'real-failure', {
    job_id: 'real-failure',
    status: 'failed',
    error: 'Asset validation failed.',
  });
  const scheduled = [];
  const report = await recoverResearchGenerationJobs({
    archiveRoot: root,
    now: '2026-10-20T20:00:00.000Z',
    processAlive: () => false,
    scheduleJob(path) { scheduled.push(path); return true; },
  });
  assert.deepEqual(scheduled.sort(), [legacyPath, waitingPath].sort());
  assert.equal(report.recovered.length, 2);
  assert.deepEqual(report.skipped, [{ job_id: 'real-failure', status: 'failed' }]);
  const legacy = JSON.parse(await readFile(legacyPath, 'utf8'));
  assert.equal(legacy.status, 'queued');
  assert.equal(legacy.completed_at, null);
  assert.equal(legacy.error, null);
  assert.match(legacy.last_resource_wait_error, /generation job holds/iu);
});

test('restart recovery leaves a live resource-wait worker alone', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-generation-live-wait-'));
  await writeJob(root, 'waiting-job', {
    job_id: 'waiting-job', status: 'waiting_for_resources', worker_pid: 999,
  });
  const report = await recoverResearchGenerationJobs({
    archiveRoot: root,
    processAlive: (pid) => pid === 999,
    scheduleJob() { throw new Error('must not schedule'); },
  });
  assert.deepEqual(report.active, [{ job_id: 'waiting-job', worker_pid: 999 }]);
  assert.equal(report.recovered.length, 0);
});
