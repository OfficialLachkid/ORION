import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { loadEngineConfig } from '../../digital-asset-engine/src/config.mjs';
import { withGenerationLock } from '../../digital-asset-engine/src/generation-lock.mjs';
import { OllamaImageAdapter } from '../../digital-asset-engine/src/ollama-image-adapter.mjs';
import { assertGenerationResourcesAvailable } from '../../digital-asset-engine/src/resource-preflight.mjs';
import { createManualImagePlan, ManualImagePlanSchema } from './planner.mjs';
import {
  deliverManualImages,
  formatManualImagePrompt,
  updateManualImageStatus,
} from './discord.mjs';
import { ensureManualImageStorage } from './config.mjs';
import { ManualImageRequestSchema } from './request.mjs';
import { removeConnectedChromaBackground } from './transparency.mjs';

const ENGINE_CONFIG_PATH = 'services/digital-asset-engine/config.example.json';
const ACTIVE_STATUSES = new Set(['queued', 'running', 'delivery_failed']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function hashBuffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertInside(rootPath, targetPath, label) {
  const child = relative(resolve(rootPath), resolve(targetPath));
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside the manual image archive.`);
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export function manualImageJobPath(archiveRoot, jobId) {
  const path = resolve(archiveRoot, 'jobs', jobId, 'job.json');
  assertInside(archiveRoot, path, 'Manual image job');
  return path;
}

async function listJobPaths(archiveRoot) {
  const jobsRoot = resolve(archiveRoot, 'jobs');
  let entries;
  try {
    entries = await readdir(jobsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => manualImageJobPath(archiveRoot, entry.name))
    .sort();
}

async function readJob(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function enqueueManualImageGenerationJob(options) {
  const config = options.config;
  await ensureManualImageStorage(config);
  const request = ManualImageRequestSchema.parse(options.request);
  const existingPaths = await listJobPaths(config.archiveRoot);
  const existingJobs = [];
  for (const path of existingPaths) {
    try { existingJobs.push({ path, job: await readJob(path) }); } catch { /* incomplete temp jobs are ignored */ }
  }
  const duplicate = existingJobs.find(({ job }) => job.request?.interaction_id === request.interaction_id);
  if (duplicate) return { ...duplicate, reused: true };
  const activeCount = existingJobs.filter(({ job }) => ACTIVE_STATUSES.has(job.status)).length;
  if (activeCount >= config.maximumQueueDepth) {
    throw new Error(`The manual image queue is full (${activeCount}/${config.maximumQueueDepth}). Try again after a current job finishes.`);
  }
  const jobId = `manual-image-${randomUUID()}`;
  const path = manualImageJobPath(config.archiveRoot, jobId);
  const queuedAt = options.now || request.requested_at || new Date().toISOString();
  const job = {
    schema_version: '1.0',
    job_id: jobId,
    request_hash: hashJson(request),
    status: 'queued',
    attempt: 0,
    delivery_attempts: 0,
    queued_at: queuedAt,
    started_at: null,
    completed_at: null,
    worker_pid: null,
    status_message_id: null,
    plan_path: null,
    outputs: [],
    delivery: null,
    error: null,
    request,
  };
  await writeJsonAtomic(path, job);
  return { path, job, reused: false };
}

export async function bindManualImageStatusMessage(jobPath, message) {
  const path = resolve(jobPath);
  const job = await readJob(path);
  if (String(message.channelId) !== String(job.request.channel_id)) {
    throw new Error('Manual image status message must be in the originating Discord channel.');
  }
  const updated = {
    ...job,
    status_message_id: String(message.messageId),
    status_message_bound_at: message.boundAt || new Date().toISOString(),
  };
  await writeJsonAtomic(path, updated);
  return updated;
}

function outputFilename(image, format) {
  const label = String(image.label || `image-${image.index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 60) || `image-${image.index}`;
  return `${String(image.index).padStart(2, '0')}-${label}.${format === 'jpeg' ? 'jpg' : format}`;
}

async function outputIsValid(output) {
  try {
    const buffer = await readFile(output.path);
    return hashBuffer(buffer) === output.sha256;
  } catch {
    return false;
  }
}

async function completeOutputs(job, plan) {
  if ((job.outputs || []).length !== plan.inferred_count) return false;
  const checks = await Promise.all(job.outputs.map(outputIsValid));
  return checks.every(Boolean);
}

function generationAsset(image, plan) {
  return {
    generation_prompt: [
      image.prompt,
      plan.shared_style_context,
      ...(plan.consistency_constraints || []),
    ].filter(Boolean).join(' '),
    seed: image.seed,
  };
}

async function loadPlan(job, jobPath) {
  if (!job.plan_path) return null;
  const planPath = resolve(dirname(jobPath), job.plan_path);
  assertInside(dirname(jobPath), planPath, 'Manual image plan');
  return ManualImagePlanSchema.parse(JSON.parse(await readFile(planPath, 'utf8')));
}

function isResourceBusy(error) {
  return error?.code === 'RUNTIME_RESOURCE_BUSY'
    || /Another digital-asset generation job holds/iu.test(String(error?.message || ''));
}

async function markQueuedForResource(jobPath, job, error) {
  const updated = {
    ...job,
    status: 'queued',
    worker_pid: null,
    wait_reason: String(error?.message || error),
    updated_at: new Date().toISOString(),
  };
  await writeJsonAtomic(jobPath, updated);
  return updated;
}

export async function runManualImageGenerationJob(options) {
  const jobPath = resolve(options.jobPath);
  let job = await readJob(jobPath);
  if (job.request_hash !== hashJson(job.request)) throw new Error('Manual image job request hash does not match its stored request.');
  if (job.status === 'completed' || job.status === 'clarification_required') return { job, reused: true };
  if (!['queued', 'running', 'delivery_failed'].includes(job.status)) {
    throw new Error(`Manual image job is not runnable from status ${job.status}.`);
  }
  const runtimeConfig = options.runtimeConfig;
  const config = options.config;
  const projectRoot = resolve(options.projectRoot || process.cwd());
  const startedAt = job.started_at || options.now || new Date().toISOString();
  job = {
    ...job,
    status: 'running',
    attempt: Number(job.attempt || 0) + 1,
    started_at: startedAt,
    completed_at: null,
    worker_pid: process.pid,
    wait_reason: null,
    error: null,
  };
  await writeJsonAtomic(jobPath, job);
  await (options.updateStatus || updateManualImageStatus)({
    runtimeConfig,
    job,
    completed: job.outputs.length,
    total: job.request.count,
    current: 'Planning the requested image set',
    fetchImpl: options.fetchImpl,
  }).catch(() => null);

  let plan = await loadPlan(job, jobPath).catch(() => null);
  let phase = 'generation';
  try {
    const alreadyGenerated = plan && await completeOutputs(job, plan);
    if (!alreadyGenerated) {
      const runWithLock = options.withGenerationLock || withGenerationLock;
      await runWithLock({ projectRoot }, async () => {
        const engineConfig = await loadEngineConfig(
          options.engineConfigPath || ENGINE_CONFIG_PATH,
          projectRoot,
        );
        await (options.assertResources || assertGenerationResourcesAvailable)(engineConfig, {
          fetchImpl: options.fetchImpl,
        });
        if (!plan) {
          plan = await (options.createPlan || createManualImagePlan)(job.request, {
            jobId: job.job_id,
            maximumCount: config.maximumCount,
            endpoint: config.planner.endpoint,
            model: config.planner.model,
            timeoutMs: config.planner.timeoutMs,
            fetchImpl: options.fetchImpl,
          });
          const planPath = resolve(dirname(jobPath), 'plan.json');
          await writeJsonAtomic(planPath, plan);
          job = { ...job, plan_path: 'plan.json', inferred_count: plan.inferred_count };
          await writeJsonAtomic(jobPath, job);
        }
        if (plan.status === 'clarification_required') return;
        const adapter = options.adapter || new OllamaImageAdapter({
          ...engineConfig.generation,
          endpoint: config.generation.endpoint,
          model: config.generation.model,
          timeout_ms: config.generation.timeoutMs,
          negative_prompt: config.generation.negativePrompt,
          require_local_endpoint: true,
        });
        const readiness = await adapter.checkReadiness();
        if (readiness.status !== 'ready') throw new Error(readiness.detail);
        const outputsRoot = resolve(dirname(jobPath), 'outputs');
        await mkdir(outputsRoot, { recursive: true });
        for (const image of plan.images) {
          const existing = job.outputs.find((output) => output.index === image.index);
          if (existing && await outputIsValid(existing)) continue;
          await (options.updateStatus || updateManualImageStatus)({
            runtimeConfig,
            job,
            completed: job.outputs.filter((output) => output.sha256).length,
            total: plan.inferred_count,
            current: image.label,
            fetchImpl: options.fetchImpl,
          }).catch(() => null);
          const generated = await adapter.generateAsset({
            asset: generationAsset(image, plan),
            sourceWidth: plan.width,
            sourceHeight: plan.height,
          });
          const processed = plan.transparent_background
            ? await (options.removeBackground || removeConnectedChromaBackground)(generated.buffer)
            : { buffer: generated.buffer };
          const format = plan.transparent_background ? 'png' : generated.format;
          const path = resolve(outputsRoot, outputFilename(image, format));
          assertInside(dirname(jobPath), path, 'Generated image');
          await writeFile(path, processed.buffer);
          const output = {
            index: image.index,
            label: image.label,
            path,
            format,
            bytes: processed.buffer.length,
            sha256: hashBuffer(processed.buffer),
            model: generated.model,
            seed: generated.seed,
            generated_at: generated.created_at || new Date().toISOString(),
            transparent_background: plan.transparent_background,
          };
          job = {
            ...job,
            outputs: [...job.outputs.filter((item) => item.index !== image.index), output]
              .sort((left, right) => left.index - right.index),
          };
          await writeJsonAtomic(jobPath, job);
        }
      });
    }

    if (plan?.status === 'clarification_required') {
      job = {
        ...job,
        status: 'clarification_required',
        worker_pid: null,
        completed_at: new Date().toISOString(),
      };
      await writeJsonAtomic(jobPath, job);
      await (options.updateStatus || updateManualImageStatus)({
        runtimeConfig,
        job,
        content: `<@${job.request.requested_by_discord_id}> ORION needs clarification before generating anything:\n**Prompt:** ${formatManualImagePrompt(job.request.prompt, 500)}\n\n${plan.clarification_message}\n\nNo image model call was made.`,
        fetchImpl: options.fetchImpl,
      });
      return { job, plan, clarificationRequired: true };
    }
    if (!plan || !(await completeOutputs(job, plan))) {
      throw new Error('Manual image generation did not produce the complete planned output set.');
    }

    phase = 'delivery';
    job = {
      ...job,
      status: 'delivering',
      delivery_attempts: Number(job.delivery_attempts || 0) + 1,
    };
    await writeJsonAtomic(jobPath, job);
    const delivery = await (options.deliver || deliverManualImages)({
      runtimeConfig,
      config,
      job,
      plan,
      fetchImpl: options.fetchImpl,
    });
    job = {
      ...job,
      status: 'delivered',
      worker_pid: null,
      delivered_at: new Date().toISOString(),
      delivery: {
        channel_id: job.request.channel_id,
        message_id: String(delivery?.id || job.status_message_id || ''),
        attachment_ids: (delivery?.attachments || []).map((attachment) => String(attachment.id)),
        output_hashes: job.outputs.map((output) => output.sha256),
      },
    };
    await writeJsonAtomic(jobPath, job);
    let cleanupError = null;
    try {
      await rm(resolve(dirname(jobPath), 'outputs'), { recursive: true, force: true });
    } catch (error) {
      cleanupError = String(error?.message || error);
    }
    job = {
      ...job,
      status: 'completed',
      completed_at: new Date().toISOString(),
      cleaned_at: cleanupError ? null : new Date().toISOString(),
      cleanup_error: cleanupError,
    };
    await writeJsonAtomic(jobPath, job);
    return { job, plan, delivery, reused: false };
  } catch (error) {
    if (isResourceBusy(error)) {
      job = await markQueuedForResource(jobPath, job, error);
      await (options.updateStatus || updateManualImageStatus)({
        runtimeConfig,
        job,
        content: `<@${job.request.requested_by_discord_id}> your image job is safely queued and waiting for the shared local generation slot. No concurrent Ollama generation was started.`,
        fetchImpl: options.fetchImpl,
      }).catch(() => null);
      const busy = new Error(error.message);
      busy.code = 'MANUAL_IMAGE_RESOURCE_BUSY';
      throw busy;
    }
    const deliveryFailure = phase === 'delivery';
    job = {
      ...job,
      status: deliveryFailure ? 'delivery_failed' : 'failed',
      worker_pid: null,
      completed_at: new Date().toISOString(),
      error: String(error?.stack || error?.message || error).slice(0, 8000),
    };
    await writeJsonAtomic(jobPath, job);
    await (options.updateStatus || updateManualImageStatus)({
      runtimeConfig,
      job,
      content: [
        `<@${job.request.requested_by_discord_id}> image job \`${job.job_id}\` stopped safely.`,
        `**Prompt:** ${formatManualImagePrompt(job.request.prompt, 400)}`,
        `**Phase:** ${deliveryFailure ? 'Discord delivery' : 'local generation'}`,
        `**Error:** ${String(error?.message || error).slice(0, 800)}`,
        deliveryFailure
          ? 'The generated files remain on the T7 for retry.'
          : 'Any completed temporary output remains on the T7 for diagnosis.',
      ].join('\n'),
      fetchImpl: options.fetchImpl,
    }).catch(() => null);
    throw error;
  }
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export async function recoverManualImageGenerationJobs(options) {
  const paths = await listJobPaths(options.config.archiveRoot);
  const processAlive = options.processAlive || defaultProcessAlive;
  const report = { scanned: paths.length, recovered: [], active: [], runnable: [] };
  for (const path of paths) {
    let job = await readJob(path);
    if (['running', 'delivering'].includes(job.status) && processAlive(Number(job.worker_pid))) {
      report.active.push({ job_id: job.job_id, worker_pid: job.worker_pid });
      continue;
    }
    if (job.status === 'running' || job.status === 'delivering') {
      const recoveredAt = options.now || new Date().toISOString();
      job = {
        ...job,
        status: job.outputs?.length ? 'delivery_failed' : 'queued',
        worker_pid: null,
        recovered_at: recoveredAt,
        recovery_count: Number(job.recovery_count || 0) + 1,
      };
      await writeJsonAtomic(path, job);
      report.recovered.push({ job_id: job.job_id, path });
    }
    if (job.status === 'queued'
      || (job.status === 'delivery_failed'
        && Number(job.delivery_attempts || 0) < options.config.maximumDeliveryAttempts)) {
      report.runnable.push({ job_id: job.job_id, path, status: job.status });
    }
  }
  return report;
}

export async function cleanupAbandonedManualImageJobs(options) {
  const paths = await listJobPaths(options.config.archiveRoot);
  const nowMs = Date.parse(options.now || new Date().toISOString());
  const ttlMs = options.config.abandonedTtlHours * 60 * 60 * 1000;
  const cleaned = [];
  for (const path of paths) {
    let job = await readJob(path);
    const outputsRoot = resolve(dirname(path), 'outputs');
    const ageMs = nowMs - Date.parse(job.completed_at || job.queued_at || 0);
    const completedNeedsCleanup = job.status === 'completed' && !job.cleaned_at;
    const abandoned = ['failed', 'delivery_failed', 'clarification_required'].includes(job.status) && ageMs >= ttlMs;
    if (!completedNeedsCleanup && !abandoned) continue;
    await rm(outputsRoot, { recursive: true, force: true });
    job = {
      ...job,
      ...(abandoned ? { status: 'abandoned' } : {}),
      cleaned_at: options.now || new Date().toISOString(),
      cleanup_error: null,
    };
    await writeJsonAtomic(path, job);
    cleaned.push({ job_id: job.job_id, abandoned });
  }
  return { scanned: paths.length, cleaned };
}

export async function listRunnableManualImageJobs(config) {
  const recovery = await recoverManualImageGenerationJobs({ config });
  return recovery.runnable.map((item) => item.path);
}

export const __testables = {
  completeOutputs,
  hashJson,
  isResourceBusy,
  listJobPaths,
  outputFilename,
  writeJsonAtomic,
};
