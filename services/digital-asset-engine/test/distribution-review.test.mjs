import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildDigitalAssetDistributionComponents,
  buildDistributionReviewEmbeds,
  DigitalAssetDistributionDecisionStore,
  parseDigitalAssetDistributionCustomId,
  postDigitalAssetDistributionReview,
  resolveDistributionMarketplaceState,
} from '../src/distribution-review.mjs';
import { buildItchSellerPreflightCode } from '../src/itch-seller-preflight.mjs';

const context = {
  status: 'awaiting_distribution_approval',
  productSlug: 'neon-plasma-armory',
  manifestHash: 'a'.repeat(64),
  itchUrl: 'https://vbjservices.itch.io/asset-pack-test?secret=review',
  taxInformationUrl: 'https://itch.io/user/settings/seller/tax-information',
  manifestUrl: 'https://discord.com/channels/guild/channel/message',
};

test('ready distribution gate is separate and bound to the exact manifest', () => {
  const components = buildDigitalAssetDistributionComponents(context)[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Approve itch.io Publish',
    'Keep Draft',
    'Open itch.io Draft',
    'Open Manifest',
  ]);
  assert.deepEqual(parseDigitalAssetDistributionCustomId(components[0].custom_id), {
    decision: 'approve_publish',
    productSlug: context.productSlug,
    manifestHashPrefix: 'a'.repeat(16),
  });
});

test('blocked seller setup exposes remediation but no publish action', () => {
  const components = buildDigitalAssetDistributionComponents({
    ...context,
    status: 'blocked_seller_setup',
  })[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Open itch.io Draft',
    'Complete Tax Setup',
    'Open Manifest',
  ]);
  assert.ok(components.every((component) => component.style === 5));
});

test('published update gate keeps the current release visible until separately approved', () => {
  const components = buildDigitalAssetDistributionComponents({
    ...context,
    marketplaceReviewMode: 'published_update',
    itchUrl: 'https://vbjservices.itch.io/neon-plasma-armory',
  })[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Approve itch.io Update',
    'Keep Current Release',
    'Open Current itch.io Page',
    'Open Manifest',
  ]);
});

test('distribution embed communicates creative approval without implying publication', () => {
  const [embed] = buildDistributionReviewEmbeds([{
    title: 'Neon Plasma Armory · Pack Review · PACK APPROVED',
    fields: [{ name: 'Manifest', value: '`hash`' }],
  }], {
    status: 'blocked_seller_setup',
    seller_ready: false,
    blockers: ['tax_interview_incomplete'],
  });
  assert.match(embed.title, /DISTRIBUTION BLOCKED/u);
  assert.match(embed.description, /creatively approved/u);
  assert.match(embed.fields.find((field) => field.name === 'Seller readiness').value, /tax_interview_incomplete/u);
});

test('published update embed explains that the current public version remains live', () => {
  const [embed] = buildDistributionReviewEmbeds([{
    title: 'Neon Plasma Armory Pack Review',
    fields: [],
  }], {
    status: 'awaiting_distribution_approval',
    seller_ready: true,
    marketplace_review_mode: 'published_update',
    current_marketplace_version: '0.2.0',
    target_version: '0.3.0',
  });
  assert.match(embed.description, /update package is creatively approved/iu);
  assert.match(embed.fields.find((field) => field.name === 'Distribution').value, /remains on 0\.2\.0/iu);
});

test('published update binds the approved candidate to the verified current release', () => {
  const currentManifestHash = 'b'.repeat(64);
  const result = resolveDistributionMarketplaceState({
    product: { product_id: 'product-1', slug: 'neon-plasma-armory' },
    manifest: {
      manifest_hash: 'a'.repeat(64),
      listing_hash: 'c'.repeat(64),
      base_manifest_hash: currentManifestHash,
      target_version: '0.3.0',
    },
    discordState: {
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      itch_url: 'https://vbjservices.itch.io/neon-plasma-armory',
    },
    itchState: null,
    publishedState: {
      status: 'verified_public',
      product_id: 'product-1',
      product_slug: 'neon-plasma-armory',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'd'.repeat(64),
      public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/neon-plasma-armory:assets',
    },
  });
  assert.deepEqual(result, {
    mode: 'published_update',
    currentVersion: '0.2.0',
    publicUrl: 'https://vbjservices.itch.io/neon-plasma-armory',
    editUrl: 'https://itch.io/game/edit/5144533',
    butlerTarget: 'vbjservices/neon-plasma-armory:assets',
  });
});

test('published update rejects a candidate whose base is not the current public manifest', () => {
  assert.throws(() => resolveDistributionMarketplaceState({
    product: { product_id: 'product-1', slug: 'neon-plasma-armory' },
    manifest: {
      manifest_hash: 'a'.repeat(64),
      listing_hash: 'c'.repeat(64),
      base_manifest_hash: 'e'.repeat(64),
      target_version: '0.3.0',
    },
    discordState: {
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      itch_url: 'https://vbjservices.itch.io/neon-plasma-armory',
    },
    publishedState: {
      status: 'verified_public',
      product_id: 'product-1',
      product_slug: 'neon-plasma-armory',
      target_version: '0.2.0',
      manifest_hash: 'b'.repeat(64),
      public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/neon-plasma-armory:assets',
    },
  }), /exact verified current itch\.io release/iu);
});

test('published update rejects an older semantic version even when its base manifest matches', () => {
  const currentManifestHash = 'b'.repeat(64);
  assert.throws(() => resolveDistributionMarketplaceState({
    product: { product_id: 'product-1', slug: 'neon-plasma-armory' },
    manifest: {
      manifest_hash: 'a'.repeat(64),
      listing_hash: 'c'.repeat(64),
      base_manifest_hash: currentManifestHash,
      target_version: '0.1.9',
    },
    discordState: {
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      itch_url: 'https://vbjservices.itch.io/neon-plasma-armory',
    },
    publishedState: {
      status: 'verified_public',
      product_id: 'product-1',
      product_slug: 'neon-plasma-armory',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/neon-plasma-armory:assets',
    },
  }), /newer than the current itch\.io release/iu);
});

test('published update posts and reuses a dedicated distribution gate message', async () => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-update-distribution-'));
  const product = {
    product_id: 'product-1',
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.3.0',
  };
  const productRoot = resolve(outputRoot, product.slug);
  const candidatePath = 'releases/0.3.0/candidates/0123456789abcdef';
  const candidateRoot = resolve(productRoot, candidatePath);
  const currentManifestHash = 'b'.repeat(64);
  const manifest = {
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'c'.repeat(64),
    base_manifest_hash: currentManifestHash,
    target_version: '0.3.0',
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
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify({
      listing_hash: manifest.listing_hash,
    })),
    writeFile(resolve(productRoot, 'releases', '0.3.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.3.0',
      candidate_path: candidatePath,
      manifest_hash: manifest.manifest_hash,
    })),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
      manifest_hash: manifest.manifest_hash,
      listing_hash: manifest.listing_hash,
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      itch_url: 'https://vbjservices.itch.io/neon-plasma-armory',
      channel_id: 'channel-1',
      overview_message_id: 'package-message-1',
      last_decision: { decision: 'approve' },
    })),
    writeFile(resolve(productRoot, 'review', 'itch-release.json'), JSON.stringify({
      status: 'verified_public',
      product_id: product.product_id,
      product_slug: product.slug,
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'd'.repeat(64),
      public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/neon-plasma-armory:assets',
    })),
    writeFile(resolve(productRoot, 'review', 'itch-seller.json'), JSON.stringify({
      status: 'ready',
      manifest_hash: manifest.manifest_hash,
      listing_hash: manifest.listing_hash,
      payout_mode: 'collected_by_itch',
      tax_interview_complete: true,
      blockers: [],
      checked_at: '2026-10-19T19:45:00.000Z',
    })),
    writeFile(resolve(productRoot, 'review', 'distribution.json'), JSON.stringify({
      status: 'published',
      manifest_hash: currentManifestHash,
      listing_hash: 'd'.repeat(64),
      discord_message_id: 'package-message-1',
    })),
  ]);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const method = options.method || 'GET';
    if (method === 'GET') {
      return {
        ok: true,
        status: 200,
        async json() { return { embeds: [{ title: 'Neon Plasma Armory Pack Review', fields: [] }] }; },
        async text() { return ''; },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() { return { id: 'distribution-message-1' }; },
      async text() { return ''; },
    };
  };
  const options = {
    outputRoot,
    slug: product.slug,
    releaseVersion: '0.3.0',
    product,
    store: {
      async loadProduct() { return product; },
      productRoot() { return productRoot; },
    },
    runtimeConfig: { guildId: 'guild-1', env: { DISCORD_BOT_TOKEN: 'token' } },
    fetchImpl,
    now: '2026-10-19T19:46:00.000Z',
  };
  const created = await postDigitalAssetDistributionReview(options);
  assert.equal(created.discord_message_id, 'distribution-message-1');
  assert.equal(created.package_review_message_id, 'package-message-1');
  assert.equal(created.status, 'awaiting_distribution_approval');
  assert.equal(calls.filter((call) => (call.options.method || 'GET') === 'POST').length, 1);

  const reused = await postDigitalAssetDistributionReview(options);
  assert.equal(reused.discord_message_id, 'distribution-message-1');
  assert.equal(calls.filter((call) => (call.options.method || 'GET') === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.options.method === 'PATCH').length, 1);
  const persisted = JSON.parse(await readFile(resolve(productRoot, 'review', 'distribution.json'), 'utf8'));
  assert.equal(persisted.discord_message_id, 'distribution-message-1');
});

test('seller preflight checks payout mode and fails closed on incomplete tax setup', () => {
  const code = buildItchSellerPreflightCode();
  assert.match(code, /user\/settings\/seller/u);
  assert.match(code, /collected by itch/u);
  assert.match(code, /tax_interview_incomplete/u);
  assert.match(code, /begin interview/u);
});

test('distribution store uses the append-only Supabase endpoint', async () => {
  const calls = [];
  const store = new DigitalAssetDistributionDecisionStore({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 201, async text() { return '[]'; } };
    },
  });
  await store.insert({ discord_interaction_id: 'interaction-1' });
  assert.equal(
    calls[0].url,
    'https://project.supabase.co/rest/v1/digital_asset_distribution_reviews?on_conflict=discord_interaction_id',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer service-secret');
});
