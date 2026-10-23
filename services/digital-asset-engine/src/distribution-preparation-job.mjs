import process from 'node:process';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { postDigitalAssetDistributionReview } from './distribution-review.mjs';
import { inspectItchSellerReadiness } from './itch-seller-preflight.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

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

function assertApprovedPackage(discordState, manifest) {
  if (discordState.last_decision?.decision !== 'approve'
    || discordState.manifest_hash !== manifest.manifest_hash
    || discordState.listing_hash !== manifest.listing_hash
    || discordState.marketplace_review_mode !== 'published_update') {
    throw new Error('Distribution preparation requires an approved published-update package review.');
  }
}

function preparationStatePath(productRoot) {
  return resolve(productRoot, 'review', 'distribution-preparation.json');
}

export async function queueDigitalAssetDistributionPreparation(options) {
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: options.releaseVersion,
  });
  const discordState = await readJson(resolve(productRoot, 'review', 'discord.json'));
  assertApprovedPackage(discordState, packaged.manifest);
  const statePath = preparationStatePath(productRoot);
  const previous = await readOptionalJson(statePath);
  const exactPrevious = previous?.manifest_hash === packaged.manifest.manifest_hash
    && previous?.listing_hash === packaged.manifest.listing_hash;
  if (exactPrevious && ['queued', 'running', 'completed'].includes(previous.status)) {
    return { state: previous, statePath, reused: true };
  }
  const queuedAt = options.now || new Date().toISOString();
  const state = {
    schema_version: '1.0',
    status: 'queued',
    product_id: product.product_id,
    product_slug: product.slug,
    target_version: packaged.manifest.target_version || product.version || null,
    release_version: options.releaseVersion || packaged.manifest.target_version || null,
    manifest_hash: packaged.manifest.manifest_hash,
    listing_hash: packaged.manifest.listing_hash,
    package_review_message_id: discordState.overview_message_id,
    worker_pid: null,
    attempt: exactPrevious ? Number(previous.attempt || 0) : 0,
    queued_at: queuedAt,
    updated_at: queuedAt,
  };
  await writeJsonAtomic(statePath, state);
  return { state, statePath, reused: false };
}

export async function runDigitalAssetDistributionPreparation(options) {
  const statePath = resolve(String(options.statePath || ''));
  let state = await readJson(statePath);
  if (state.status === 'completed') return { ...state, reused: true, statePath };
  if (!['queued', 'failed'].includes(state.status)) {
    throw new Error(`Distribution preparation job is not runnable from status ${state.status || 'missing'}.`);
  }
  const productRoot = dirname(dirname(statePath));
  const outputRoot = dirname(productRoot);
  const startedAt = options.now || new Date().toISOString();
  state = {
    ...state,
    status: 'running',
    worker_pid: options.pid || process.pid,
    attempt: Number(state.attempt || 0) + 1,
    started_at: startedAt,
    updated_at: startedAt,
    error: null,
  };
  await writeJsonAtomic(statePath, state);
  try {
    const runtimeConfig = options.runtimeConfig || {};
    const seller = await (options.inspectSellerReadiness || inspectItchSellerReadiness)({
      outputRoot,
      slug: state.product_slug || basename(productRoot),
      releaseVersion: state.release_version || state.target_version,
      profileDir: runtimeConfig.env?.ITCH_PLAYWRIGHT_PROFILE,
      env: runtimeConfig.env,
      now: options.now,
    });
    const distribution = await (options.postDistributionReview || postDigitalAssetDistributionReview)({
      runtimeConfig,
      outputRoot,
      slug: state.product_slug || basename(productRoot),
      releaseVersion: state.release_version || state.target_version,
      now: options.now,
      fetchImpl: options.fetchImpl,
    });
    const completedAt = options.now || new Date().toISOString();
    state = {
      ...await readJson(statePath),
      status: 'completed',
      worker_pid: null,
      completed_at: completedAt,
      updated_at: completedAt,
      seller_status: seller.status,
      distribution_status: distribution.status,
      distribution_message_id: distribution.discord_message_id,
      error: null,
    };
    await writeJsonAtomic(statePath, state);
    return { ...state, seller, distribution, reused: false, statePath };
  } catch (error) {
    const failedAt = new Date().toISOString();
    state = {
      ...await readJson(statePath).catch(() => state),
      status: 'failed',
      worker_pid: null,
      failed_at: failedAt,
      updated_at: failedAt,
      error: String(error?.stack || error?.message || error).slice(0, 8000),
    };
    await writeJsonAtomic(statePath, state);
    throw error;
  }
}

export async function recoverDigitalAssetDistributionPreparationJobs(options) {
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
    const productRoot = resolve(archiveRoot, entry.name);
    const discordState = await readOptionalJson(resolve(productRoot, 'review', 'discord.json'));
    if (discordState?.last_decision?.decision !== 'approve'
      || discordState.marketplace_review_mode !== 'published_update') continue;
    report.scanned += 1;
    const distribution = await readOptionalJson(resolve(productRoot, 'review', 'distribution.json'));
    if (distribution?.manifest_hash === discordState.manifest_hash
      && distribution?.listing_hash === discordState.listing_hash
      && ['awaiting_distribution_approval', 'distribution_approved', 'held', 'published'].includes(distribution.status)) {
      continue;
    }
    const statePath = preparationStatePath(productRoot);
    let state = await readOptionalJson(statePath);
    if (!state || state.manifest_hash !== discordState.manifest_hash
      || state.listing_hash !== discordState.listing_hash) {
      const queued = await queueDigitalAssetDistributionPreparation({
        outputRoot: archiveRoot,
        slug: entry.name,
        releaseVersion: discordState.target_version,
        now: options.now,
      });
      state = queued.state;
    }
    if (state.status === 'completed' || state.status === 'failed') continue;
    if (state.status === 'running' && processAlive(Number(state.worker_pid))) {
      report.active.push({ product_slug: state.product_slug, worker_pid: Number(state.worker_pid) });
      continue;
    }
    const recoveredAt = options.now || new Date().toISOString();
    state = {
      ...state,
      status: 'queued',
      worker_pid: null,
      recovery_count: Number(state.recovery_count || 0) + 1,
      recovered_at: recoveredAt,
      updated_at: recoveredAt,
      ...(state.status === 'running' ? { interrupted_at: recoveredAt } : {}),
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
