import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  recoverItchPublicationJobs,
  runItchPublicationJob,
} from '../src/itch-publication-job.mjs';

async function createState(status = 'distribution_approved') {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-publication-job-'));
  const productRoot = resolve(archiveRoot, 'arcane-relics-potions');
  const statePath = resolve(productRoot, 'review', 'distribution.json');
  await mkdir(resolve(productRoot, 'review'), { recursive: true });
  await writeFile(resolve(productRoot, 'product.json'), JSON.stringify({
    product_id: 'asset-product-arcane',
    slug: 'arcane-relics-potions',
    title: 'Arcane Relics & Potions',
  }));
  await writeFile(statePath, JSON.stringify({
    schema_version: '1.0',
    status,
    product_slug: 'arcane-relics-potions',
    target_version: '0.1.0',
    marketplace_review_mode: 'draft',
    last_decision: { decision: 'approve_publish' },
  }));
  return { archiveRoot, productRoot, statePath };
}

test('publication job records a durable running and completed lifecycle', async () => {
  const fixture = await createState();
  const result = await runItchPublicationJob({
    statePath: fixture.statePath,
    pid: 42,
    now: '2026-10-21T13:00:00.000Z',
    async publish(options) {
      assert.equal(options.outputRoot, fixture.archiveRoot);
      assert.equal(options.slug, 'arcane-relics-potions');
      assert.equal(options.releaseVersion, undefined);
      const state = JSON.parse(await readFile(fixture.statePath, 'utf8'));
      state.status = 'published';
      state.publication = { public_url: 'https://vbjservices.itch.io/arcane-relics-potions' };
      await writeFile(fixture.statePath, JSON.stringify(state));
      return { status: 'verified_public', reused: false };
    },
  });
  assert.equal(result.status, 'published');
  assert.equal(result.publication_job.status, 'completed');
  assert.equal(result.publication_job.worker_pid, null);
  assert.equal(result.publication.status, 'verified_public');
});

test('publication recovery schedules approved receipts without a completed publication', async () => {
  const fixture = await createState();
  const scheduled = [];
  const recovery = await recoverItchPublicationJobs({
    archiveRoot: fixture.archiveRoot,
    now: '2026-10-21T13:05:00.000Z',
    scheduleJob(path) {
      scheduled.push(path);
      return true;
    },
  });
  assert.equal(recovery.scanned, 1);
  assert.equal(recovery.recovered.length, 1);
  assert.deepEqual(scheduled, [fixture.statePath]);
  const state = JSON.parse(await readFile(fixture.statePath, 'utf8'));
  assert.equal(state.publication_job.status, 'queued');
  assert.equal(state.publication_job.recovery_count, 1);
});

test('publication recovery ignores completed public releases', async () => {
  const fixture = await createState('published');
  const recovery = await recoverItchPublicationJobs({
    archiveRoot: fixture.archiveRoot,
    scheduleJob() { throw new Error('published release must not be scheduled'); },
  });
  assert.equal(recovery.scanned, 1);
  assert.deepEqual(recovery.recovered, []);
});
