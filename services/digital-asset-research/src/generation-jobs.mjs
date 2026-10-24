import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { loadEngineConfig, resolveOutputRoot } from '../../digital-asset-engine/src/config.mjs';
import { postDigitalAssetReview, discordRequest } from '../../digital-asset-engine/src/discord-review.mjs';
import { packageDigitalAssetPreview } from '../../digital-asset-engine/src/packager.mjs';
import { generateDigitalAssetProduct } from '../../digital-asset-engine/src/pipeline.mjs';
import { updateDigitalAssetGenerationProgress } from '../../digital-asset-engine/src/generation-progress.mjs';
import { ProductOpportunitySchema } from '../../digital-asset-engine/src/schemas.mjs';

const ENGINE_CONFIG = 'services/digital-asset-engine/config.example.json';

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(canonicalJson(value))).digest('hex');
}

function immutableJobInput(job) {
  return {
    recommendation_id: job.recommendation_id,
    evidence_hash: job.evidence_hash,
    simulation: job.simulation === true,
    opportunity: job.opportunity,
  };
}

function assertInside(rootPath, targetPath, label) {
  const child = relative(resolve(rootPath), resolve(targetPath));
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside the research archive.`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function generationJobPath(archiveRoot, recommendationId) {
  const path = resolve(archiveRoot, 'generation-jobs', `${recommendationId}.json`);
  assertInside(archiveRoot, path, 'Generation job');
  return path;
}

export async function enqueueResearchGenerationJob(options) {
  const opportunity = ProductOpportunitySchema.parse(options.recommendation.opportunity);
  const path = generationJobPath(options.archiveRoot, options.recommendation.recommendation_id);
  const payload = {
    schema_version: '1.0',
    job_id: `generation-${options.recommendation.recommendation_id}`,
    recommendation_id: options.recommendation.recommendation_id,
    evidence_hash: options.evidenceHash,
    simulation: options.recommendation.simulation === true,
    status: 'queued',
    attempt: 0,
    queued_at: options.queuedAt,
    queued_by_discord_id: options.queuedByDiscordId,
    research_channel_id: options.researchChannelId,
    research_message_id: options.researchMessageId,
    opportunity,
  };
  const jobHash = sha256(immutableJobInput(payload));
  let existing = null;
  try { existing = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (existing) {
    if (existing.evidence_hash !== payload.evidence_hash
      || existing.opportunity?.opportunity_id !== opportunity.opportunity_id) {
      throw new Error('An incompatible generation job already exists for this recommendation.');
    }
    return { path, job: existing, reused: true, jobHash: existing.job_hash };
  }
  const job = { ...payload, job_hash: jobHash };
  await writeJsonAtomic(path, job);
  return { path, job, reused: false, jobHash };
}

async function updateResearchMessage(runtimeConfig, job, content, fetchImpl) {
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token || !job.research_channel_id || !job.research_message_id) return;
  await discordRequest(token, `/channels/${job.research_channel_id}/messages/${job.research_message_id}`, {
    method: 'PATCH',
    body: { content },
    fetchImpl,
  });
}

export async function runResearchGenerationJob(options) {
  const jobPath = resolve(options.jobPath);
  let job = JSON.parse(await readFile(jobPath, 'utf8'));
  if (job.job_hash !== sha256(immutableJobInput(job))) {
    throw new Error('Generation job input hash does not match its approved opportunity.');
  }
  if (job.status === 'completed') return { ...job.result, reused: true };
  if (!['queued', 'failed'].includes(job.status)) {
    throw new Error(`Generation job is not runnable from status ${job.status}.`);
  }
  const projectRoot = resolve(options.projectRoot || process.cwd());
  const now = options.now || new Date().toISOString();
  job = {
    ...job,
    status: 'running',
    attempt: Number(job.attempt || 0) + 1,
    started_at: now,
    completed_at: null,
    error: null,
    worker_pid: process.pid,
  };
  await writeJsonAtomic(jobPath, job);

  let progressProduct = null;
  let progressQueue = Promise.resolve();
  let heartbeatTimer = null;
  const heartbeatIntervalMs = options.heartbeatIntervalMs === undefined
    ? 30_000
    : Math.max(0, Number(options.heartbeatIntervalMs) || 0);
  const updateProgress = options.updateProgress || updateDigitalAssetGenerationProgress;
  const enqueueProgress = (event, { required = true } = {}) => {
    if (event.product) progressProduct = event.product;
    if (!progressProduct) return Promise.resolve(null);
    const run = progressQueue
      .catch(() => null)
      .then(() => updateProgress({
        runtimeConfig: options.runtimeConfig,
        outputRoot: String(options.runtimeConfig?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim(),
        product: progressProduct,
        categoryName: options.categoryName || 'DIGITAL ASSETS',
        fetchImpl: options.fetchImpl,
        event,
      }));
    progressQueue = run;
    return required ? run : run.catch(() => null);
  };
  const reportProgress = async (event) => {
    await enqueueProgress(event);
    if (event.type === 'generation_started' && heartbeatIntervalMs > 0 && !heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        void enqueueProgress({ type: 'heartbeat', at: new Date().toISOString() }, { required: false });
      }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();
    }
  };

  try {
    const archiveRoot = String(options.runtimeConfig?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
    const runtimeEndpoint = String(options.runtimeConfig?.env?.OLLAMA_URL || '').trim();
    const runtimeModel = String(options.runtimeConfig?.env?.DIGITAL_ASSET_IMAGE_MODEL || '').trim();
    const config = await loadEngineConfig(
      options.engineConfigPath || ENGINE_CONFIG,
      projectRoot,
      {
        ...(archiveRoot ? { output_root: archiveRoot } : {}),
        ...((runtimeEndpoint || runtimeModel) ? {
          generation: {
            ...(runtimeEndpoint ? { endpoint: runtimeEndpoint } : {}),
            ...(runtimeModel ? { model: runtimeModel } : {}),
          },
        } : {}),
      },
    );
    const outputRoot = resolveOutputRoot(config, projectRoot);
    const generation = await (options.generateProduct || generateDigitalAssetProduct)({
      config,
      opportunity: ProductOpportunitySchema.parse(job.opportunity),
      outputRoot,
      projectRoot,
      fetchImpl: options.fetchImpl,
      now,
      onProgress: reportProgress,
    });
    if (!generation.gates.all_assets_valid) {
      throw new Error('One or more generated assets failed automated validation.');
    }
    await enqueueProgress({
      type: 'packaging_started',
      product: generation.product,
      at: new Date().toISOString(),
    });
    const packaged = await (options.packageProduct || packageDigitalAssetPreview)({
      outputRoot,
      slug: generation.product.slug,
      now: options.now,
    });
    const review = await (options.postReview || postDigitalAssetReview)({
      runtimeConfig: options.runtimeConfig,
      outputRoot,
      slug: generation.product.slug,
      categoryName: options.categoryName || 'DIGITAL ASSETS',
      localReview: true,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    const result = {
      product_id: generation.product.product_id,
      product_slug: generation.product.slug,
      manifest_hash: packaged.manifest.manifest_hash,
      listing_hash: packaged.manifest.listing_hash,
      review_channel_id: review.channel_id,
      review_message_id: review.overview_message_id,
      incurred_cost: 0,
    };
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await progressQueue.catch(() => null);
    job = {
      ...job,
      status: 'completed',
      completed_at: new Date().toISOString(),
      worker_pid: null,
      result,
    };
    await writeJsonAtomic(jobPath, job);
    await updateResearchMessage(
      options.runtimeConfig,
      job,
      `Generation completed locally at **€0 API cost**. Review the exact package in <#${review.channel_id}>. Marketplace staging has not started.`,
      options.fetchImpl,
    );
    return { ...result, reused: false };
  } catch (error) {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await enqueueProgress({
      type: 'failed',
      error: String(error?.message || error),
      at: new Date().toISOString(),
    }, { required: false });
    job = {
      ...job,
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: String(error?.stack || error?.message || error).slice(0, 8000),
      worker_pid: null,
    };
    await writeJsonAtomic(jobPath, job);
    await updateResearchMessage(
      options.runtimeConfig,
      job,
      `Generation stopped safely during attempt **${job.attempt}**. No marketplace action occurred. Error: ${String(error?.message || error).slice(0, 1200)}`,
      options.fetchImpl,
    ).catch(() => {});
    throw error;
  }
}
