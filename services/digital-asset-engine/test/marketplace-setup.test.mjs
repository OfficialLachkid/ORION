import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildMarketplaceSetupComponents,
  isMarketplaceSetupInteraction,
  postMarketplaceSetupReview,
  recordMarketplaceSetupRequest,
  recoverMarketplaceSetupJobs,
  runMarketplaceSetupJob,
} from '../src/marketplace-setup.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'b'.repeat(64);

async function createFixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-marketplace-setup-'));
  const product = {
    product_id: 'product-1',
    slug: 'arcane-relics-potions',
    title: 'Arcane Relics & Potions',
    version: '0.1.0',
    assets: [{ asset_id: 'asset-1' }, { asset_id: 'asset-2' }],
  };
  const productRoot = resolve(outputRoot, product.slug);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  await Promise.all([
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
    mkdir(resolve(exportRoot, 'download'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify(product)),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
      product_slug: product.slug,
      channel_id: 'channel-1',
      overview_message_id: 'review-message-1',
      marketplace_review_mode: 'local_generation',
      creative_approval: {
        status: 'approved',
        manifest_hash: manifestHash,
        listing_hash: listingHash,
      },
    })),
    writeFile(resolve(exportRoot, 'manifest.json'), JSON.stringify({
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      product_version: '0.1.0',
      release_state: 'internal_preview',
      distribution_ready: false,
      asset_count: 2,
    })),
    writeFile(resolve(exportRoot, 'itch-listing-preview.json'), JSON.stringify({
      title: product.title,
      short_description: 'Fantasy inventory assets.',
      description: 'Listing.',
      suggested_price: { amount: 3.99, currency: 'USD' },
      tags: ['2D'],
      cover_path: 'cover.png',
      screenshot_paths: ['preview.png'],
      listing_hash: listingHash,
    })),
  ]);
  return {
    outputRoot,
    product,
    productRoot,
    store: {
      async loadProduct() { return product; },
      productRoot() { return productRoot; },
    },
  };
}

function runtimeConfig() {
  return {
    guildId: 'guild-1',
    operatorRoleId: 'operator-role',
    operatorUserIds: [],
    env: { DISCORD_BOT_TOKEN: 'token' },
  };
}

test('marketplace setup card exposes creation without implying publication', () => {
  const components = buildMarketplaceSetupComponents({
    status: 'awaiting_setup',
    product_slug: 'arcane-relics-potions',
    manifest_hash: manifestHash,
    manifest_url: 'https://discord.com/channels/guild/channel/message',
  })[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Create itch.io Draft',
    'Open Manifest',
  ]);
  assert.equal(isMarketplaceSetupInteraction({ type: 3, data: { custom_id: components[0].custom_id } }), true);
});

test('creative approval posts one reusable marketplace setup card', async () => {
  const fixture = await createFixture();
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async json() { return { id: 'setup-message-1' }; },
      async text() { return ''; },
    };
  };
  const options = {
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    product: fixture.product,
    store: fixture.store,
    runtimeConfig: runtimeConfig(),
    fetchImpl,
    now: '2026-10-21T08:00:00.000Z',
  };
  const created = await postMarketplaceSetupReview(options);
  assert.equal(created.status, 'awaiting_setup');
  assert.equal(created.discord_message_id, 'setup-message-1');
  assert.equal(calls.filter((call) => (call.options.method || 'GET') === 'POST').length, 1);
  const reused = await postMarketplaceSetupReview(options);
  assert.equal(reused.discord_message_id, 'setup-message-1');
  assert.equal(calls.filter((call) => (call.options.method || 'GET') === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.options.method === 'PATCH').length, 1);
});

test('authorized Discord request queues a manifest-bound marketplace job', async () => {
  const fixture = await createFixture();
  const posted = await postMarketplaceSetupReview({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    product: fixture.product,
    store: fixture.store,
    runtimeConfig: runtimeConfig(),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { id: 'setup-message-1' }; },
      async text() { return ''; },
    }),
  });
  const createButton = buildMarketplaceSetupComponents(posted)[0].components[0];
  const recorded = await recordMarketplaceSetupRequest({
    archiveRoot: fixture.outputRoot,
    config: runtimeConfig(),
    now: '2026-10-21T08:05:00.000Z',
    interaction: {
      id: 'interaction-1',
      type: 3,
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      data: { custom_id: createButton.custom_id },
      message: { id: 'setup-message-1' },
      member: { roles: ['operator-role'], user: { id: 'reviewer-1', username: 'vbjservices' } },
    },
  });
  assert.equal(recorded.state.status, 'queued');
  assert.equal(recorded.state.request.discord_interaction_id, 'interaction-1');
  assert.equal(recorded.messagePatch.components[0].components[0].label, 'Open Manifest');
});

test('marketplace worker stages, verifies seller state, and posts the separate publication gate', async () => {
  const fixture = await createFixture();
  const setupPath = resolve(fixture.productRoot, 'review', 'marketplace-setup.json');
  await writeFile(setupPath, JSON.stringify({
    schema_version: '1.0',
    status: 'queued',
    product_id: fixture.product.product_id,
    product_slug: fixture.product.slug,
    title: fixture.product.title,
    target_version: '0.1.0',
    release_version: null,
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    asset_count: 2,
    price_label: 'USD 3.99',
    channel_id: 'channel-1',
    discord_message_id: 'setup-message-1',
    manifest_url: 'https://discord.com/channels/guild-1/channel-1/review-message-1',
  }));
  const result = await runMarketplaceSetupJob({
    statePath: setupPath,
    outputRoot: fixture.outputRoot,
    runtimeConfig: runtimeConfig(),
    store: fixture.store,
    stageDraft: async () => ({
      public_url: 'https://vbjservices.itch.io/arcane-relics-potions?secret=review',
      edit_url: 'https://itch.io/game/edit/12345',
      butler_target: 'vbjservices/arcane-relics-potions:assets',
      staged_at: '2026-10-21T08:10:00.000Z',
    }),
    inspectSeller: async () => ({ status: 'ready' }),
    postDistribution: async () => ({
      channel_id: 'channel-1',
      discord_message_id: 'distribution-message-1',
      seller_ready: true,
    }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() { return { id: 'setup-message-1' }; },
      async text() { return ''; },
    }),
    now: '2026-10-21T08:10:00.000Z',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.distribution_message_id, 'distribution-message-1');
  const discordState = JSON.parse(await readFile(resolve(fixture.productRoot, 'review', 'discord.json'), 'utf8'));
  assert.equal(discordState.marketplace_review_mode, 'draft');
  assert.match(discordState.itch_url, /secret=review/u);
});

test('startup recovery requeues an interrupted marketplace setup worker', async () => {
  const fixture = await createFixture();
  const path = resolve(fixture.productRoot, 'review', 'marketplace-setup.json');
  await writeFile(path, JSON.stringify({
    status: 'running',
    product_slug: fixture.product.slug,
    worker_pid: 999999,
  }));
  const scheduled = [];
  const report = await recoverMarketplaceSetupJobs({
    archiveRoot: fixture.outputRoot,
    processAlive: () => false,
    scheduleJob(statePath) { scheduled.push(statePath); return true; },
    now: '2026-10-21T08:15:00.000Z',
  });
  assert.equal(report.recovered.length, 1);
  assert.equal(report.recovered[0].scheduled, true);
  assert.deepEqual(scheduled, [path]);
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.status, 'queued');
  assert.equal(state.recovery_count, 1);
});
