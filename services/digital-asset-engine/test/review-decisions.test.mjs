import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildDigitalAssetPackReviewComponents,
  buildDigitalAssetReviewModal,
  getDigitalAssetReviewModalRequest,
  parseDigitalAssetReviewDecision,
} from '../src/review-components.mjs';
import {
  buildResolvedDigitalAssetReviewEmbeds,
  DigitalAssetReviewDecisionStore,
  prepareDigitalAssetReviewModal,
  recordDigitalAssetReviewDecision,
} from '../src/review-decisions.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'c'.repeat(64);
const assets = [
  { asset_id: 'asset-rail-rifle', name: 'Rail Rifle', description: 'Long precision weapon.' },
  { asset_id: 'asset-arc-launcher', name: 'Arc Launcher', description: 'Heavy energy launcher.' },
];
const context = {
  productSlug: 'neon-plasma-armory',
  manifestHash,
  manifestUrl: 'https://discord.com/channels/guild-1/channel-1/overview-1',
  itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
};

function packInteraction(componentIndex = 0, overrides = {}) {
  return {
    id: 'interaction-1',
    type: 3,
    guild_id: 'guild-1',
    channel_id: 'channel-1',
    data: { custom_id: buildDigitalAssetPackReviewComponents(context)[0].components[componentIndex].custom_id },
    message: {
      id: 'overview-1',
      embeds: [{ title: 'Neon Plasma Armory · Pack Review · Revision 1', fields: [] }],
    },
    member: {
      nick: 'Valen',
      roles: ['operator-role'],
      user: { id: 'reviewer-1', username: 'vbjservices' },
    },
    ...overrides,
  };
}

async function createArchiveFixture(options = {}) {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-release-review-'));
  const productRoot = resolve(archiveRoot, context.productSlug);
  const packageRoot = options.packageRoot || 'exports/itch-preview';
  await Promise.all([
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
    mkdir(resolve(productRoot, packageRoot), { recursive: true }),
    mkdir(resolve(productRoot, 'validation'), { recursive: true }),
  ]);
  const productAssets = assets.map((asset, index) => ({
    ...asset,
    final_path: `assets/items/${index === 0 ? 'rail-rifle' : 'arc-launcher'}.png`,
    validation_path: `validation/${index === 0 ? 'rail-rifle' : 'arc-launcher'}.json`,
  }));
  const product = {
    product_id: 'asset-product-e7bd21e31c69c03a',
    slug: context.productSlug,
    assets: productAssets,
  };
  const state = {
    product_slug: context.productSlug,
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    review_revision: 1,
    channel_id: 'channel-1',
    thread_id: 'thread-1',
    overview_message_id: 'overview-1',
    asset_messages: {
      'asset-rail-rifle': 'asset-message-1',
      'asset-arc-launcher': 'asset-message-2',
    },
    itch_url: context.itchUrl,
    marketplace_review_mode: options.marketplaceReviewMode || 'draft',
    ...(options.marketplaceReviewMode === 'published_update' ? {
      current_marketplace_version: options.currentMarketplaceVersion || '0.1.0',
    } : {}),
    ...(options.targetVersion ? {
      target_version: options.targetVersion,
      package_root: packageRoot,
    } : {}),
  };
  const hashes = ['b'.repeat(64), 'd'.repeat(64)];
  const manifest = {
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    ...(options.targetVersion ? { target_version: options.targetVersion } : {}),
    ...(options.baseManifestHash ? { base_manifest_hash: options.baseManifestHash } : {}),
    files: productAssets.map((asset, index) => ({
      path: `${options.targetVersion ? 'download/' : ''}assets/individual/${asset.final_path.split('/').at(-1)}`,
      content_sha256: hashes[index],
    })),
  };
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify(product)),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify(state)),
    writeFile(resolve(productRoot, 'review', 'itch.json'), JSON.stringify(options.itchState || {
      status: 'verified',
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      public_url: context.itchUrl,
    })),
    ...(options.publishedState ? [writeFile(
      resolve(productRoot, 'review', 'itch-release.json'),
      JSON.stringify(options.publishedState),
    )] : []),
    writeFile(resolve(productRoot, packageRoot, 'manifest.json'), JSON.stringify(manifest)),
    ...productAssets.map((asset, index) => writeFile(
      resolve(productRoot, asset.validation_path),
      JSON.stringify({ metrics: { content_sha256: hashes[index] } }),
    )),
  ]);
  return archiveRoot;
}

test('package review exposes one approval gate plus draft and manifest links', () => {
  const rows = buildDigitalAssetPackReviewComponents(context);
  assert.deepEqual(rows[0].components.map((component) => component.label), [
    'Approve Pack',
    'Request Changes',
    'Reject Pack',
    'Open itch.io Draft',
    'Open Manifest',
  ]);
  assert.ok(rows[0].components.slice(0, 3).every((button) => button.custom_id.length <= 100));
});

test('request changes uses a selectable numbered asset list and shared feedback', () => {
  const request = getDigitalAssetReviewModalRequest(packInteraction(1));
  const modal = buildDigitalAssetReviewModal(request, assets);
  assert.equal(modal.title, 'Request Pack Changes');
  assert.match(modal.components[0].content, /\*\*01\*\* — Rail Rifle/u);
  assert.deepEqual(modal.components[1].component.options.map((option) => option.label), [
    '01 · Rail Rifle',
    '02 · Arc Launcher',
  ]);
  const decision = parseDigitalAssetReviewDecision({
    type: 5,
    data: {
      custom_id: modal.custom_id,
      components: [
        { type: 18, component: { custom_id: 'affected_assets', values: ['asset-arc-launcher'] } },
        { type: 18, component: { custom_id: 'reason', value: 'Reduce the rear silhouette.' } },
      ],
    },
  });
  assert.deepEqual(decision.affectedAssetIds, ['asset-arc-launcher']);
  assert.equal(decision.reason, 'Reduce the rear silhouette.');
});

test('prepares modal only after canonical package and operator validation', async () => {
  const archiveRoot = await createArchiveFixture();
  const modal = await prepareDigitalAssetReviewModal({
    interaction: packInteraction(1),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
  });
  assert.equal(modal.components[1].component.options.length, 2);
});

test('approves every exact asset hash in one package decision', async () => {
  const archiveRoot = await createArchiveFixture();
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
    now: '2026-10-14T10:00:00.000Z',
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.decision, 'approve');
  assert.equal(result.row.listing_hash, listingHash);
  assert.deepEqual(result.row.asset_decisions.map((item) => item.decision), ['approve', 'approve']);
  assert.equal(result.assetMessagePatches.length, 2);
  const resolved = buildResolvedDigitalAssetReviewEmbeds(
    packInteraction().message.embeds,
    result.decision,
    result.actor,
  );
  assert.match(resolved[0].title, /PACK APPROVED/u);
});

test('local creative approval marks the package ready for separate marketplace setup', async () => {
  const archiveRoot = await createArchiveFixture({ marketplaceReviewMode: 'local_generation' });
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
    now: '2026-10-20T17:00:00.000Z',
  });
  const product = JSON.parse(await readFile(resolve(archiveRoot, context.productSlug, 'product.json'), 'utf8'));
  const state = JSON.parse(await readFile(resolve(archiveRoot, context.productSlug, 'review', 'discord.json'), 'utf8'));
  assert.equal(result.nextAction, 'marketplace_setup');
  assert.equal(product.status, 'approved');
  assert.equal(product.approvals.distribution, 'pending');
  assert.equal(state.creative_approval.next_step, 'marketplace_setup');
  assert.deepEqual(result.messagePatch.components[0].components.map((component) => component.label), [
    'Open Manifest',
  ]);
});

test('approves the exact immutable versioned candidate stored in the Discord review state', async () => {
  const packageRoot = 'releases/0.2.0/candidates/0123456789abcdef';
  const archiveRoot = await createArchiveFixture({ packageRoot, targetVersion: '0.2.0' });
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.manifest_hash, manifestHash);
  assert.deepEqual(result.row.asset_decisions.map((item) => item.decision), ['approve', 'approve']);
});

test('approves a published update against the verified current public release instead of a draft', async () => {
  const packageRoot = 'releases/0.3.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.3.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    itchState: {
      status: 'verified',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.manifest_hash, manifestHash);
  assert.equal(result.messagePatch.components[0].components[0].label, 'Open Current itch.io Page');
});

test('rejects a published update when its verified current release receipt changed', async () => {
  const archiveRoot = await createArchiveFixture({
    packageRoot: 'releases/0.3.0/candidates/0123456789abcdef',
    targetVersion: '0.3.0',
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.1.0',
      manifest_hash: 'e'.repeat(64),
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /verified current itch\.io release no longer matches/u,
  );
});

test('rejects a versioned package path outside its target version candidate directory', async () => {
  const archiveRoot = await createArchiveFixture({
    packageRoot: 'releases/0.3.0/candidates/0123456789abcdef',
    targetVersion: '0.2.0',
  });
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /not an immutable release candidate/u,
  );
});

test('request changes accepts unselected assets and flags only selected assets', async () => {
  const archiveRoot = await createArchiveFixture();
  const request = getDigitalAssetReviewModalRequest(packInteraction(1));
  const modal = buildDigitalAssetReviewModal(request, assets);
  const interaction = packInteraction(1, {
    type: 5,
    data: {
      custom_id: modal.custom_id,
      components: [
        { type: 18, component: { custom_id: 'affected_assets', values: ['asset-arc-launcher'] } },
        { type: 18, component: { custom_id: 'reason', value: 'Reduce the rear silhouette.' } },
      ],
    },
  });
  const result = await recordDigitalAssetReviewDecision({
    interaction,
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert() {} },
  });
  assert.deepEqual(result.row.asset_decisions.map((item) => [item.asset_id, item.decision]), [
    ['asset-rail-rifle', 'approve'],
    ['asset-arc-launcher', 'request_changes'],
  ]);
});

test('rejects package decisions from users outside the operator allowlist', async () => {
  const archiveRoot = await createArchiveFixture();
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(0, { member: { roles: [], user: { id: 'unknown', username: 'unknown' } } }),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /approved ORION operator/u,
  );
});

test('Supabase release review store uses service credentials and interaction conflict safety', async () => {
  const calls = [];
  const store = new DigitalAssetReviewDecisionStore({
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
    'https://project.supabase.co/rest/v1/digital_asset_release_reviews?on_conflict=discord_interaction_id',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer service-secret');
});
