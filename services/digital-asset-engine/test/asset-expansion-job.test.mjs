import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildAssetExpansionReleaseJobEmbeds,
  queueApprovedAssetExpansionRelease,
  recoverAssetExpansionReleaseJobs,
  runAssetExpansionReleaseJob,
} from '../src/asset-expansion-job.mjs';

const manifestHash = 'a'.repeat(64);
const baseManifestHash = 'b'.repeat(64);

function releasePlan() {
  return {
    schema_version: '1.0',
    product_slug: 'arcane-relics-potions',
    expansion_id: 'arcane-animation-upgrade-v1',
    title: 'Arcane Relics & Potions Animation Upgrade',
    base_version: '0.1.0',
    target_version: '0.2.0',
    base_manifest_hash: baseManifestHash,
    assets: [
      {
        operation: 'enhance_existing',
        source_product_slug: 'arcane-relics-potions',
        source_asset_key: 'mana-potion',
        target_asset_key: 'mana-potion',
        target_name: 'Mana Potion',
        buyer_group: 'items',
        interactive_proof: {
          batch_id: 'arcane-animation-upgrade-v1',
          asset_key: 'mana-potion',
        },
      },
    ],
  };
}

function approvedState(overrides = {}) {
  return {
    schema_version: '1.0',
    product_id: 'asset-product-arcane',
    product_slug: 'arcane-relics-potions',
    expansion_id: 'arcane-animation-upgrade-v1',
    target_version: '0.2.0',
    manifest_hash: manifestHash,
    category_name: 'DIGITAL ASSETS',
    channel_id: 'channel-1',
    overview_message_id: 'overview-1',
    release_plan: releasePlan(),
    last_decision: {
      decision: 'approve',
      affected_asset_ids: [],
      manifest_hash: manifestHash,
    },
    ...overrides,
  };
}

async function writeState(root, state = approvedState()) {
  const statePath = resolve(root, 'arcane-relics-potions', 'extensions', 'arcane-animation-upgrade-v1', 'review', 'discord.json');
  await mkdir(resolve(statePath, '..'), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return statePath;
}

test('queues an exact approved expansion idempotently', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-expansion-job-'));
  const statePath = await writeState(root);
  const first = await queueApprovedAssetExpansionRelease({ statePath, now: '2026-10-22T15:00:00.000Z' });
  assert.equal(first.reused, false);
  assert.equal(first.state.release_job.status, 'queued');
  assert.equal(first.state.release_job.expansion_manifest_hash, manifestHash);
  const second = await queueApprovedAssetExpansionRelease({ statePath, now: '2026-10-22T15:01:00.000Z' });
  assert.equal(second.reused, true);
});

test('builds the immutable release and posts the complete package review', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-expansion-job-'));
  const statePath = await writeState(root);
  await queueApprovedAssetExpansionRelease({ statePath, now: '2026-10-22T15:00:00.000Z' });
  const calls = [];
  const result = await runAssetExpansionReleaseJob({
    statePath,
    outputRoot: root,
    runtimeConfig: { guildId: 'guild-1', env: {} },
    now: '2026-10-22T15:02:00.000Z',
    pid: 4321,
    async prepareRelease(options) {
      calls.push(['release', options.plan.target_version]);
      return {
        candidateRoot: resolve(root, 'candidate'),
        manifest: { manifest_hash: 'c'.repeat(64) },
      };
    },
    async postReview(options) {
      calls.push(['review', options.releaseVersion, options.categoryName]);
      return { channel_id: 'channel-1', overview_message_id: 'package-review-1' };
    },
  });
  assert.deepEqual(calls, [
    ['release', '0.2.0'],
    ['review', '0.2.0', 'DIGITAL ASSETS'],
  ]);
  assert.equal(result.release_job.status, 'completed');
  assert.equal(result.release_job.worker_pid, null);
  assert.equal(result.release_job.release_manifest_hash, 'c'.repeat(64));
  assert.equal(result.release_job.package_review_url, 'https://discord.com/channels/guild-1/channel-1/package-review-1');
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(persisted.release_job.status, 'completed');
});

test('recovers an approved job that was interrupted before completion', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-expansion-job-'));
  const statePath = await writeState(root, approvedState({
    release_job: {
      status: 'running',
      expansion_manifest_hash: manifestHash,
      worker_pid: 9999,
    },
  }));
  const scheduled = [];
  const report = await recoverAssetExpansionReleaseJobs({
    archiveRoot: root,
    now: '2026-10-22T15:03:00.000Z',
    processAlive: () => false,
    scheduleJob(path) {
      scheduled.push(path);
      return true;
    },
  });
  assert.equal(report.scanned, 1);
  assert.equal(report.recovered.length, 1);
  assert.deepEqual(scheduled, [statePath]);
  const persisted = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(persisted.release_job.status, 'queued');
  assert.equal(persisted.release_job.worker_pid, null);
  assert.equal(persisted.release_job.recovery_count, 1);
  assert.equal(persisted.release_job.interrupted_at, '2026-10-22T15:03:00.000Z');
});

test('renders a visible release workflow status on the existing overview', () => {
  const embeds = buildAssetExpansionReleaseJobEmbeds(
    [{ title: 'Animation upgrade', fields: [{ name: 'Safety', value: 'Public release unchanged.' }] }],
    approvedState({ release_job: { status: 'running' } }),
  );
  assert.equal(embeds.length, 1);
  assert.match(embeds[0].fields.at(-1).value, /BUILDING VERSIONED BUYER PACKAGE/u);
  assert.match(embeds[0].fields.at(-1).value, /cover, overview, and animated storefront montage/u);
});
