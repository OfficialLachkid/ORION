import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import sharp from 'sharp';
import {
  bindManualImageStatusMessage,
  cleanupAbandonedManualImageJobs,
  enqueueManualImageGenerationJob,
  recoverManualImageGenerationJobs,
  runManualImageGenerationJob,
} from '../src/jobs.mjs';

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-manual-images-'));
  const permanentAssetRoot = resolve(root, 'permanent-assets');
  const archiveRoot = resolve(root, 'manual-jobs');
  await mkdir(permanentAssetRoot, { recursive: true });
  return {
    root,
    config: {
      archiveRoot,
      permanentAssetRoot,
      maximumCount: 8,
      maximumQueueDepth: 4,
      maximumAttachmentBytes: 8 * 1024 * 1024,
      abandonedTtlHours: 24,
      cleanupIntervalHours: 6,
      maximumDeliveryAttempts: 3,
      planner: { endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b', timeoutMs: 1000 },
      generation: {
        endpoint: 'http://127.0.0.1:11434',
        model: 'flux-test',
        timeoutMs: 1000,
        negativePrompt: 'watermark',
      },
      discord: { categoryName: 'DIGITAL ASSETS', channelName: 'manual-image-generation' },
    },
    request: {
      prompt: 'One blue orb',
      count: 1,
      aspect_ratio: '1:1',
      transparent_background: false,
      requested_by_discord_id: 'operator-1',
      requested_by_display_name: 'Valen',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      interaction_id: 'interaction-1',
      requested_at: '2026-10-23T12:00:00.000Z',
    },
  };
}

test('queues idempotently and binds progress to the originating Discord channel', async (t) => {
  const setup = await fixture();
  t.after(() => rm(setup.root, { recursive: true, force: true }));
  const first = await enqueueManualImageGenerationJob({ config: setup.config, request: setup.request });
  const second = await enqueueManualImageGenerationJob({ config: setup.config, request: setup.request });
  assert.equal(second.reused, true);
  assert.equal(second.job.job_id, first.job.job_id);
  const bound = await bindManualImageStatusMessage(first.path, {
    channelId: 'channel-1',
    messageId: 'message-1',
  });
  assert.equal(bound.status_message_id, 'message-1');
  await assert.rejects(
    () => bindManualImageStatusMessage(first.path, { channelId: 'other-channel', messageId: 'message-2' }),
    /originating Discord channel/u,
  );
});

test('generates, delivers, records hashes, then deletes temporary image bytes', async (t) => {
  const setup = await fixture();
  t.after(() => rm(setup.root, { recursive: true, force: true }));
  const queued = await enqueueManualImageGenerationJob({ config: setup.config, request: setup.request });
  await bindManualImageStatusMessage(queued.path, { channelId: 'channel-1', messageId: 'message-1' });
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: { r: 0, g: 120, b: 255, alpha: 1 } },
  }).png().toBuffer();
  let deliveredPath = '';
  const result = await runManualImageGenerationJob({
    jobPath: queued.path,
    config: setup.config,
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    projectRoot: process.cwd(),
    withGenerationLock: async (_options, operation) => operation(),
    assertResources: async () => ({ status: 'ready' }),
    createPlan: async () => ({
      schema_version: '1.0',
      status: 'ready',
      inferred_count: 1,
      aspect_ratio: '1:1',
      width: 1024,
      height: 1024,
      shared_style_context: 'Matching style.',
      consistency_constraints: [],
      transparent_background: false,
      clarification_message: '',
      images: [{ index: 1, label: 'Blue orb', prompt: 'One blue orb.', seed: 7 }],
      planner: { provider: 'ollama', model: 'llama3.1:8b', execution: 'local', estimated_cost: 0 },
    }),
    adapter: {
      async checkReadiness() { return { status: 'ready' }; },
      async generateAsset() {
        return { buffer: png, format: 'png', model: 'flux-test', seed: 7, created_at: '2026-10-23T12:01:00.000Z' };
      },
    },
    updateStatus: async () => null,
    deliver: async ({ job }) => {
      deliveredPath = job.outputs[0].path;
      assert.equal(createHash('sha256').update(await readFile(deliveredPath)).digest('hex'), job.outputs[0].sha256);
      return { id: 'message-1', attachments: [{ id: 'attachment-1' }] };
    },
  });
  assert.equal(result.job.status, 'completed');
  assert.equal(result.job.delivery.message_id, 'message-1');
  await assert.rejects(() => readFile(deliveredPath), /ENOENT/u);
  assert.doesNotReject(() => readFile(resolve(queued.path, '..', 'plan.json')));
});

test('startup recovery requeues interrupted work and cleanup expires abandoned output', async (t) => {
  const setup = await fixture();
  t.after(() => rm(setup.root, { recursive: true, force: true }));
  const queued = await enqueueManualImageGenerationJob({ config: setup.config, request: setup.request });
  const job = JSON.parse(await readFile(queued.path, 'utf8'));
  job.status = 'running';
  job.worker_pid = 999999;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(queued.path, `${JSON.stringify(job, null, 2)}\n`));
  const recovery = await recoverManualImageGenerationJobs({
    config: setup.config,
    processAlive: () => false,
    now: '2026-10-23T13:00:00.000Z',
  });
  assert.equal(recovery.recovered.length, 1);
  assert.equal(recovery.runnable.length, 1);

  const recovered = JSON.parse(await readFile(queued.path, 'utf8'));
  recovered.status = 'failed';
  recovered.completed_at = '2026-10-20T12:00:00.000Z';
  await mkdir(resolve(queued.path, '..', 'outputs'), { recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(
    resolve(queued.path, '..', 'outputs', 'partial.png'),
    'partial',
  ));
  await import('node:fs/promises').then(({ writeFile }) => writeFile(queued.path, `${JSON.stringify(recovered, null, 2)}\n`));
  const cleanup = await cleanupAbandonedManualImageJobs({
    config: setup.config,
    now: '2026-10-23T14:00:00.000Z',
  });
  assert.equal(cleanup.cleaned[0].abandoned, true);
  const abandoned = JSON.parse(await readFile(queued.path, 'utf8'));
  assert.equal(abandoned.status, 'abandoned');
});
