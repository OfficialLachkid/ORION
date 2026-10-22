import process from 'node:process';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AssetExpansionReviewPlanSchema } from './schemas.mjs';
import { prepareApprovedAssetExpansionRelease } from './asset-expansion-release.mjs';
import { discordRequest } from './discord-review.mjs';
import { postDigitalAssetReview } from './discord-review.mjs';

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

function assertApprovedState(state) {
  if (state.last_decision?.decision !== 'approve'
    || state.last_decision?.affected_asset_ids?.length) {
    throw new Error('Expansion release job requires a complete approval of the exact expansion manifest.');
  }
  const plan = AssetExpansionReviewPlanSchema.parse(state.release_plan);
  if (plan.product_slug !== state.product_slug
    || plan.expansion_id !== state.expansion_id
    || plan.target_version !== state.target_version) {
    throw new Error('Expansion release job plan no longer matches its Discord review state.');
  }
  return plan;
}

function jobLabel(job) {
  if (job?.status === 'running') return 'BUILDING VERSIONED BUYER PACKAGE';
  if (job?.status === 'completed') return 'PACKAGE REVIEW READY';
  if (job?.status === 'failed') return 'PACKAGE BUILD NEEDS ATTENTION';
  return 'PACKAGE BUILD QUEUED';
}

function jobDescription(state) {
  const job = state.release_job || {};
  if (job.status === 'completed') {
    return `Version **${state.target_version}** was built and its complete storefront media is ready for review.${job.package_review_url ? `\n${job.package_review_url}` : ''}`;
  }
  if (job.status === 'failed') {
    return `The build stopped safely; the public itch.io release remains unchanged. ${String(job.error || '').split('\n')[0].slice(0, 700)}`;
  }
  if (job.status === 'running') {
    return `ORION is assembling version **${state.target_version}**, buyer runtime files, the updated sprite sheet, license, cover, overview, and animated storefront montage.`;
  }
  return `The approved expansion is queued to build version **${state.target_version}**. The public itch.io release remains unchanged.`;
}

export function buildAssetExpansionReleaseJobEmbeds(embeds, state) {
  const job = state.release_job || { status: 'queued' };
  const color = job.status === 'completed' ? 0x57f287 : job.status === 'failed' ? 0xed4245 : 0xfee75c;
  return (Array.isArray(embeds) ? embeds : []).map((embed, index) => ({
    ...embed,
    ...(index === 0 ? {
      color,
      fields: [
        ...(embed.fields || []).filter((field) => field.name !== 'Release workflow'),
        { name: 'Release workflow', value: `**${jobLabel(job)}**\n${jobDescription(state)}`.slice(0, 1024), inline: false },
      ],
    } : {}),
  }));
}

async function updateDiscordStatus(runtimeConfig, state, fetchImpl) {
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token || !state.channel_id || !state.overview_message_id) return;
  const path = `/channels/${state.channel_id}/messages/${state.overview_message_id}`;
  const message = await discordRequest(token, path, { fetchImpl });
  await discordRequest(token, path, {
    method: 'PATCH',
    body: { embeds: buildAssetExpansionReleaseJobEmbeds(message?.embeds, state) },
    fetchImpl,
  });
}

export async function queueApprovedAssetExpansionRelease(options) {
  const statePath = resolve(String(options.statePath || ''));
  const state = await readJson(statePath);
  assertApprovedState(state);
  if (state.release_job?.status === 'completed'
    && state.release_job.expansion_manifest_hash === state.manifest_hash) {
    return { state, statePath, reused: true };
  }
  if (['queued', 'running'].includes(state.release_job?.status)
    && state.release_job.expansion_manifest_hash === state.manifest_hash) {
    return { state, statePath, reused: true };
  }
  const queuedAt = options.now || new Date().toISOString();
  state.release_job = {
    status: 'queued',
    expansion_manifest_hash: state.manifest_hash,
    target_version: state.target_version,
    worker_pid: null,
    queued_at: queuedAt,
    updated_at: queuedAt,
  };
  await writeJsonAtomic(statePath, state);
  return { state, statePath, reused: false };
}

export async function runAssetExpansionReleaseJob(options) {
  const statePath = resolve(String(options.statePath || ''));
  let state = await readJson(statePath);
  const plan = assertApprovedState(state);
  if (state.release_job?.status === 'completed'
    && state.release_job.expansion_manifest_hash === state.manifest_hash) {
    return { ...state, reused: true, statePath };
  }
  if (!['queued', 'failed'].includes(state.release_job?.status)) {
    throw new Error(`Expansion release job is not runnable from status ${state.release_job?.status || 'missing'}.`);
  }
  const runtimeConfig = options.runtimeConfig || {};
  const outputRoot = String(options.outputRoot || runtimeConfig?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!outputRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for expansion release jobs.');
  const startedAt = options.now || new Date().toISOString();
  state.release_job = {
    ...state.release_job,
    status: 'running',
    worker_pid: options.pid || process.pid,
    attempt: Number(state.release_job?.attempt || 0) + 1,
    started_at: startedAt,
    updated_at: startedAt,
    error: null,
  };
  await writeJsonAtomic(statePath, state);
  await updateDiscordStatus(runtimeConfig, state, options.fetchImpl).catch(() => {});
  try {
    const release = await (options.prepareRelease || prepareApprovedAssetExpansionRelease)({
      outputRoot,
      plan,
      now: options.now,
    });
    const review = await (options.postReview || postDigitalAssetReview)({
      runtimeConfig,
      outputRoot,
      slug: plan.product_slug,
      categoryName: state.category_name || 'DIGITAL ASSETS',
      releaseVersion: plan.target_version,
      now: options.now,
      fetchImpl: options.fetchImpl,
    });
    const completedAt = options.now || new Date().toISOString();
    state = await readJson(statePath);
    state.release_job = {
      ...state.release_job,
      status: 'completed',
      worker_pid: null,
      completed_at: completedAt,
      updated_at: completedAt,
      release_manifest_hash: release.manifest.manifest_hash,
      release_candidate_root: release.candidateRoot,
      package_review_message_id: review.overview_message_id,
      package_review_url: `https://discord.com/channels/${runtimeConfig.guildId}/${review.channel_id}/${review.overview_message_id}`,
      error: null,
    };
    await writeJsonAtomic(statePath, state);
    await updateDiscordStatus(runtimeConfig, state, options.fetchImpl).catch(() => {});
    return { ...state, release, review, reused: false, statePath };
  } catch (error) {
    state = await readJson(statePath).catch(() => state);
    const failedAt = new Date().toISOString();
    state.release_job = {
      ...state.release_job,
      status: 'failed',
      worker_pid: null,
      failed_at: failedAt,
      updated_at: failedAt,
      error: String(error?.stack || error?.message || error).slice(0, 8000),
    };
    await writeJsonAtomic(statePath, state);
    await updateDiscordStatus(runtimeConfig, state, options.fetchImpl).catch(() => {});
    throw error;
  }
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

export async function recoverAssetExpansionReleaseJobs(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) return { scanned: 0, recovered: [], active: [] };
  let products;
  try {
    products = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { scanned: 0, recovered: [], active: [] };
    throw error;
  }
  const processAlive = options.processAlive || defaultProcessAlive;
  const report = { scanned: 0, recovered: [], active: [] };
  for (const product of products.filter((entry) => entry.isDirectory())) {
    const extensionsRoot = resolve(archiveRoot, product.name, 'extensions');
    let extensions;
    try {
      extensions = await readdir(extensionsRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const extension of extensions.filter((entry) => entry.isDirectory())) {
      const statePath = resolve(extensionsRoot, extension.name, 'review', 'discord.json');
      const state = await readOptionalJson(statePath);
      if (!state?.release_plan || state.last_decision?.decision !== 'approve') continue;
      report.scanned += 1;
      const job = state.release_job || {};
      if (job.status === 'completed' && job.expansion_manifest_hash === state.manifest_hash) continue;
      if (job.status === 'running' && processAlive(Number(job.worker_pid))) {
        report.active.push({ product_slug: state.product_slug, expansion_id: state.expansion_id, worker_pid: Number(job.worker_pid) });
        continue;
      }
      if (job.status === 'failed') continue;
      const recoveredAt = options.now || new Date().toISOString();
      state.release_job = {
        ...job,
        status: 'queued',
        expansion_manifest_hash: state.manifest_hash,
        target_version: state.target_version,
        worker_pid: null,
        recovery_count: Number(job.recovery_count || 0) + 1,
        recovered_at: recoveredAt,
        updated_at: recoveredAt,
        ...(job.status === 'running' ? { interrupted_at: recoveredAt } : {}),
      };
      await writeJsonAtomic(statePath, state);
      report.recovered.push({
        product_slug: state.product_slug,
        expansion_id: state.expansion_id,
        path: statePath,
        scheduled: options.scheduleJob?.(statePath) === true,
      });
    }
  }
  return report;
}
