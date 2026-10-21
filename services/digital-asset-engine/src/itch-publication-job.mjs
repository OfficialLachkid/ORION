import process from 'node:process';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { publishApprovedItchRelease } from './itch-publisher.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

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

export async function runItchPublicationJob(options) {
  const statePath = resolve(String(options.statePath || ''));
  let state = await readJson(statePath);
  if (!['distribution_approved', 'published'].includes(state.status)
    || state.last_decision?.decision !== 'approve_publish') {
    throw new Error('Itch publication job requires an exact approved distribution receipt.');
  }
  if (state.status === 'published') {
    return { ...state, reused: true, statePath };
  }
  const startedAt = options.now || new Date().toISOString();
  state.publication_job = {
    status: 'running',
    worker_pid: options.pid || process.pid,
    attempt: Number(state.publication_job?.attempt || 0) + 1,
    started_at: startedAt,
    updated_at: startedAt,
  };
  await writeJsonAtomic(statePath, state);
  const productRoot = dirname(dirname(statePath));
  const outputRoot = dirname(productRoot);
  try {
    const publication = await (options.publish || publishApprovedItchRelease)({
      runtimeConfig: options.runtimeConfig,
      outputRoot,
      slug: state.product_slug || basename(productRoot),
      releaseVersion: state.marketplace_review_mode === 'published_update'
        ? state.target_version
        : undefined,
      profileDir: options.profileDir,
      headed: options.headed,
      env: options.env,
      now: options.now,
    });
    const publishedState = await readJson(statePath);
    const completedAt = options.now || new Date().toISOString();
    publishedState.publication_job = {
      ...state.publication_job,
      status: 'completed',
      worker_pid: null,
      completed_at: completedAt,
      updated_at: completedAt,
      error: null,
    };
    await writeJsonAtomic(statePath, publishedState);
    return { ...publishedState, publication, reused: publication.reused === true, statePath };
  } catch (error) {
    const failedState = await readJson(statePath).catch(() => state);
    const failedAt = new Date().toISOString();
    failedState.publication_job = {
      ...state.publication_job,
      status: 'failed',
      worker_pid: null,
      failed_at: failedAt,
      updated_at: failedAt,
      error: String(error?.stack || error?.message || error).slice(0, 8000),
    };
    await writeJsonAtomic(statePath, failedState);
    throw error;
  }
}

export async function recoverItchPublicationJobs(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) return { scanned: 0, recovered: [], active: [] };
  let entries;
  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { scanned: 0, recovered: [], active: [] };
    throw error;
  }
  const processAlive = options.processAlive || defaultProcessAlive;
  const report = { scanned: 0, recovered: [], active: [] };
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const statePath = resolve(archiveRoot, entry.name, 'review', 'distribution.json');
    const state = await readOptionalJson(statePath);
    if (!state) continue;
    report.scanned += 1;
    if (state.status !== 'distribution_approved'
      || state.last_decision?.decision !== 'approve_publish') continue;
    const job = state.publication_job || {};
    if (job.status === 'running' && processAlive(Number(job.worker_pid))) {
      report.active.push({ product_slug: state.product_slug, worker_pid: Number(job.worker_pid) });
      continue;
    }
    const recoveredAt = options.now || new Date().toISOString();
    state.publication_job = {
      ...job,
      status: 'queued',
      worker_pid: null,
      recovery_count: Number(job.recovery_count || 0) + 1,
      recovered_at: recoveredAt,
      updated_at: recoveredAt,
      ...(job.status === 'running' ? { interrupted_at: recoveredAt } : {}),
    };
    await writeJsonAtomic(statePath, state);
    report.recovered.push({
      product_slug: state.product_slug || entry.name,
      path: statePath,
      scheduled: options.scheduleJob?.(statePath) === true,
    });
  }
  return report;
}
