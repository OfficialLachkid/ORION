import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { enqueueResearchGenerationJob, runResearchGenerationJob } from '../src/generation-jobs.mjs';

test('generation enqueue is durable and idempotent for exact research evidence', async () => {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-job-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const recommendation = {
    recommendation_id: 'durable-test-job',
    simulation: true,
    opportunity,
  };
  const options = {
    archiveRoot,
    recommendation,
    evidenceHash: 'a'.repeat(64),
    queuedAt: '2026-10-20T12:00:00.000Z',
    queuedByDiscordId: 'operator-1',
    researchChannelId: 'channel-1',
    researchMessageId: 'message-1',
  };
  const first = await enqueueResearchGenerationJob(options);
  const second = await enqueueResearchGenerationJob(options);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.job.status, 'queued');
  assert.equal(second.job.job_hash, first.jobHash);
});

test('generation worker advances a queued job through package review without marketplace staging', async () => {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-run-'));
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-products-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const queued = await enqueueResearchGenerationJob({
    archiveRoot,
    recommendation: { recommendation_id: 'worker-test-job', simulation: true, opportunity },
    evidenceHash: 'b'.repeat(64),
    queuedAt: '2026-10-20T12:00:00.000Z',
    queuedByDiscordId: 'operator-1',
    researchChannelId: 'channel-1',
    researchMessageId: 'message-1',
  });
  const calls = [];
  const result = await runResearchGenerationJob({
    jobPath: queued.path,
    runtimeConfig: { env: {
      DIGITAL_ASSET_ARCHIVE_ROOT: outputRoot,
      DIGITAL_ASSET_IMAGE_MODEL: 'x/flux2-klein:4b-fp8',
    } },
    projectRoot: process.cwd(),
    now: '2026-10-20T12:01:00.000Z',
    heartbeatIntervalMs: 0,
    updateProgress: async () => null,
    generateProduct: async ({ config }) => {
      calls.push('generate');
      assert.equal(config.generation.model, 'x/flux2-klein:4b-fp8');
      return { product: { product_id: 'product-1', slug: 'test-pack' }, gates: { all_assets_valid: true } };
    },
    packageProduct: async () => {
      calls.push('package');
      return { manifest: { manifest_hash: 'c'.repeat(64), listing_hash: 'd'.repeat(64) } };
    },
    postReview: async (options) => {
      calls.push(['review', options.localReview]);
      return { channel_id: 'review-channel', overview_message_id: 'overview-1' };
    },
  });
  const completed = JSON.parse(await readFile(queued.path, 'utf8'));
  assert.deepEqual(calls, ['generate', 'package', ['review', true]]);
  assert.equal(result.review_channel_id, 'review-channel');
  assert.equal(completed.status, 'completed');
  assert.equal(completed.result.incurred_cost, 0);
});

test('generation worker rejects a job whose approved opportunity was changed on disk', async () => {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-tamper-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const queued = await enqueueResearchGenerationJob({
    archiveRoot,
    recommendation: { recommendation_id: 'tamper-test-job', simulation: false, opportunity },
    evidenceHash: 'e'.repeat(64),
    queuedAt: '2026-10-20T12:00:00.000Z',
    queuedByDiscordId: 'operator-1',
    researchChannelId: 'channel-1',
    researchMessageId: 'message-1',
  });
  const changed = JSON.parse(await readFile(queued.path, 'utf8'));
  changed.opportunity.title = 'Changed after approval';
  await writeFile(queued.path, JSON.stringify(changed), 'utf8');
  await assert.rejects(
    runResearchGenerationJob({ jobPath: queued.path, runtimeConfig: {}, projectRoot: process.cwd() }),
    /input hash does not match/iu,
  );
});

test('generation worker defers resource contention without failing the approved job', async () => {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-wait-'));
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-wait-products-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const queued = await enqueueResearchGenerationJob({
    archiveRoot,
    recommendation: { recommendation_id: 'resource-wait-job', simulation: true, opportunity },
    evidenceHash: 'f'.repeat(64),
    queuedAt: '2026-10-20T12:00:00.000Z',
    queuedByDiscordId: 'operator-1',
    researchChannelId: 'channel-1',
    researchMessageId: 'message-1',
  });
  const progressEvents = [];
  await assert.rejects(
    runResearchGenerationJob({
      jobPath: queued.path,
      runtimeConfig: { env: { DIGITAL_ASSET_ARCHIVE_ROOT: outputRoot } },
      projectRoot: process.cwd(),
      heartbeatIntervalMs: 0,
      resourceRetryDelayMs: 1250,
      updateProgress: async ({ event }) => { progressEvents.push(event.type); },
      generateProduct: async ({ onProgress }) => {
        await onProgress({
          type: 'generation_started',
          product: { product_id: 'product-wait', slug: 'wait-pack', title: 'Wait Pack', assets: [] },
        });
        const error = new Error('Another digital-asset generation job holds /tmp/.generation.lock.');
        error.code = 'RUNTIME_RESOURCE_BUSY';
        throw error;
      },
    }),
    (error) => error.code === 'RESEARCH_GENERATION_RESOURCE_BUSY' && error.retryAfterMs === 1250,
  );
  const waiting = JSON.parse(await readFile(queued.path, 'utf8'));
  assert.equal(waiting.status, 'waiting_for_resources');
  assert.equal(waiting.completed_at, null);
  assert.equal(waiting.error, null);
  assert.equal(waiting.resource_wait_count, 1);
  assert.ok(waiting.next_retry_at);
  assert.deepEqual(progressEvents, ['generation_started', 'waiting_for_resources']);
});
