import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  queueDigitalAssetDistributionPreparation,
  recoverDigitalAssetDistributionPreparationJobs,
  runDigitalAssetDistributionPreparation,
} from '../src/distribution-preparation-job.mjs';

async function createApprovedUpdateFixture() {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-distribution-preparation-'));
  const product = {
    schema_version: '1.0',
    product_id: 'product-arcane',
    opportunity_id: 'opportunity-arcane',
    slug: 'arcane-relics-potions',
    title: 'Arcane Relics & Potions',
    version: '0.1.0',
    status: 'approved',
    category: 'Pixel Art',
    product_type: 'Asset Pack',
    theme: 'Arcane fantasy',
    target_audience: ['game developers'],
    style: {
      medium: 'pixel_art',
      perspective: 'front view',
      width: 128,
      height: 128,
      max_palette_colors: 32,
      palette: ['#10131d', '#35d9ff'],
      outline: 'one pixel',
      lighting: 'arcane glow',
      background: 'transparent',
      chroma_key: '#ff00ff',
    },
    assets: [{
      asset_id: 'asset-tome',
      asset_key: 'spell-tome',
      name: 'Spell Tome',
      kind: 'book',
      description: 'A spell tome.',
      generation_prompt: 'Create a spell tome.',
      seed: 1,
      status: 'generated',
      source_path: 'assets/source/spell-tome.png',
      final_path: 'assets/individual/spell-tome.png',
      validation_path: 'validation/spell-tome.json',
    }],
    pricing: {
      base_price: { amount: 4.99, currency: 'USD' },
      marketplace_prices: {},
      human_approval_required: true,
    },
    distribution: { marketplaces: ['itch.io'], status: 'not_started' },
    license: { status: 'draft', redistribution_of_raw_assets: false },
    generation_provider: {
      provider: 'ollama',
      model: 'local-image',
      estimated_cost: 0,
      execution: 'local',
    },
    approvals: { generation: 'approved', distribution: 'pending' },
    created_at: '2026-10-20T00:00:00.000Z',
    updated_at: '2026-10-22T00:00:00.000Z',
  };
  const productRoot = resolve(archiveRoot, product.slug);
  const candidatePath = 'releases/0.2.0/candidates/0123456789abcdef';
  const candidateRoot = resolve(productRoot, candidatePath);
  const manifest = {
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'b'.repeat(64),
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
  };
  await Promise.all([
    mkdir(candidateRoot, { recursive: true }),
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify(product)),
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify({ listing_hash: manifest.listing_hash })),
    writeFile(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.2.0',
      candidate_path: candidatePath,
      manifest_hash: manifest.manifest_hash,
    })),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
      manifest_hash: manifest.manifest_hash,
      listing_hash: manifest.listing_hash,
      target_version: '0.2.0',
      marketplace_review_mode: 'published_update',
      overview_message_id: 'package-review-1',
      last_decision: { decision: 'approve' },
    })),
  ]);
  return { archiveRoot, productRoot, product, manifest };
}

test('approved published update queues an exact durable distribution preparation job', async () => {
  const fixture = await createApprovedUpdateFixture();
  const queued = await queueDigitalAssetDistributionPreparation({
    outputRoot: fixture.archiveRoot,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    now: '2026-10-22T21:00:00.000Z',
  });
  assert.equal(queued.reused, false);
  assert.equal(queued.state.status, 'queued');
  assert.equal(queued.state.manifest_hash, fixture.manifest.manifest_hash);
  assert.equal(queued.state.package_review_message_id, 'package-review-1');

  const reused = await queueDigitalAssetDistributionPreparation({
    outputRoot: fixture.archiveRoot,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
  });
  assert.equal(reused.reused, true);
});

test('distribution preparation refreshes seller readiness before posting the separate gate', async () => {
  const fixture = await createApprovedUpdateFixture();
  const queued = await queueDigitalAssetDistributionPreparation({
    outputRoot: fixture.archiveRoot,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
  });
  const calls = [];
  const result = await runDigitalAssetDistributionPreparation({
    statePath: queued.statePath,
    pid: 42,
    now: '2026-10-22T21:05:00.000Z',
    runtimeConfig: { guildId: 'guild-1', env: { DISCORD_BOT_TOKEN: 'token' } },
    async inspectSellerReadiness(options) {
      calls.push(['seller', options.slug, options.releaseVersion]);
      return { status: 'ready' };
    },
    async postDistributionReview(options) {
      calls.push(['distribution', options.slug, options.releaseVersion]);
      return { status: 'awaiting_distribution_approval', discord_message_id: 'distribution-1' };
    },
  });
  assert.deepEqual(calls, [
    ['seller', fixture.product.slug, '0.2.0'],
    ['distribution', fixture.product.slug, '0.2.0'],
  ]);
  assert.equal(result.status, 'completed');
  assert.equal(result.worker_pid, null);
  assert.equal(result.distribution_message_id, 'distribution-1');
});

test('startup recovery queues an approved update when the bot stopped before preparation', async () => {
  const fixture = await createApprovedUpdateFixture();
  const scheduled = [];
  const recovery = await recoverDigitalAssetDistributionPreparationJobs({
    archiveRoot: fixture.archiveRoot,
    now: '2026-10-22T21:10:00.000Z',
    scheduleJob(path) {
      scheduled.push(path);
      return true;
    },
  });
  assert.equal(recovery.scanned, 1);
  assert.equal(recovery.recovered.length, 1);
  assert.equal(scheduled.length, 1);
  const state = JSON.parse(await readFile(scheduled[0], 'utf8'));
  assert.equal(state.status, 'queued');
  assert.equal(state.recovery_count, 1);
  assert.equal(state.manifest_hash, fixture.manifest.manifest_hash);
});

test('startup recovery does not duplicate an existing exact distribution gate', async () => {
  const fixture = await createApprovedUpdateFixture();
  await writeFile(resolve(fixture.productRoot, 'review', 'distribution.json'), JSON.stringify({
    status: 'awaiting_distribution_approval',
    manifest_hash: fixture.manifest.manifest_hash,
    listing_hash: fixture.manifest.listing_hash,
    discord_message_id: 'distribution-1',
  }));
  const recovery = await recoverDigitalAssetDistributionPreparationJobs({
    archiveRoot: fixture.archiveRoot,
    scheduleJob() { throw new Error('an exact gate must not be scheduled again'); },
  });
  assert.equal(recovery.scanned, 1);
  assert.deepEqual(recovery.recovered, []);
  assert.deepEqual(recovery.active, []);
});
