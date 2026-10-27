import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
    ...(options.targetVersion && options.marketplaceReviewMode === 'local_generation'
      ? { product_version: options.targetVersion }
      : options.targetVersion ? { target_version: options.targetVersion } : {}),
    ...(options.baseManifestHash ? { base_manifest_hash: options.baseManifestHash } : {}),
    files: productAssets.map((asset, index) => ({
      path: `${packageRoot.startsWith('releases/') || options.marketplaceReviewMode === 'local_generation' ? 'download/' : ''}assets/individual/${asset.final_path.split('/').at(-1)}`,
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
  if (options.marketplaceReviewMode === 'published_update') {
    const baseVersion = options.currentMarketplaceVersion || '0.1.0';
    const baseManifestHash = options.publishedState?.manifest_hash
      || options.baseManifestHash
      || 'e'.repeat(64);
    const baseListingHash = options.publishedState?.listing_hash || 'f'.repeat(64);
    const baseCandidateKey = 'fedcba9876543210';
    const baseCandidatePath = `releases/${baseVersion}/candidates/${baseCandidateKey}`;
    const baseVersionRoot = resolve(productRoot, 'releases', baseVersion);
    const baseCandidateRoot = resolve(productRoot, baseCandidatePath);
    const baseManifest = {
      manifest_hash: baseManifestHash,
      listing_hash: baseListingHash,
      target_version: baseVersion,
      release_state: 'awaiting_extension_review',
      distribution_ready: false,
      quality_holds: [],
      gates: { quality_holds_resolved: true },
      files: productAssets.map((asset, index) => ({
        path: `download/assets/individual/${asset.final_path.split('/').at(-1)}`,
        content_sha256: hashes[index],
      })),
    };
    await mkdir(baseCandidateRoot, { recursive: true });
    await Promise.all([
      writeFile(resolve(baseVersionRoot, 'latest-candidate.json'), JSON.stringify({
        target_version: baseVersion,
        candidate_path: baseCandidatePath,
        manifest_hash: baseManifestHash,
      })),
      writeFile(resolve(baseCandidateRoot, 'manifest.json'), JSON.stringify(baseManifest)),
      writeFile(resolve(baseCandidateRoot, 'itch-listing.json'), JSON.stringify({
        listing_hash: baseListingHash,
      })),
    ]);
  }
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

test('local creative approval accepts the canonical preview path with a target version', async () => {
  const archiveRoot = await createArchiveFixture({
    marketplaceReviewMode: 'local_generation',
    targetVersion: '0.1.0',
  });
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert() {} },
    now: '2026-10-20T19:30:00.000Z',
  });
  assert.equal(result.nextAction, 'marketplace_setup');
  assert.equal(result.row.decision, 'approve');
});

test('local creative approval rejects a preview whose product version changed', async () => {
  const archiveRoot = await createArchiveFixture({
    marketplaceReviewMode: 'local_generation',
    targetVersion: '0.1.0',
  });
  const manifestPath = resolve(
    archiveRoot,
    context.productSlug,
    'exports',
    'itch-preview',
    'manifest.json',
  );
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.product_version = '0.2.0';
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /does not match its target version/u,
  );
});

test('local creative approval rejects a package path outside the canonical preview', async () => {
  const archiveRoot = await createArchiveFixture({
    marketplaceReviewMode: 'local_generation',
    packageRoot: 'exports/other-preview',
    targetVersion: '0.1.0',
  });
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /must use the canonical packaged preview/u,
  );
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
  assert.equal(result.nextAction, 'distribution_review');
  assert.equal(result.releaseVersion, '0.3.0');
});

test('published update inherits an unchanged asset from the verified base after the canonical workspace changes', async () => {
  const packageRoot = 'releases/0.3.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.3.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  await writeFile(
    resolve(archiveRoot, context.productSlug, 'validation', 'arc-launcher.json'),
    JSON.stringify({ metrics: { content_sha256: '9'.repeat(64) } }),
  );
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.asset_decisions[1].asset_hash, 'd'.repeat(64));
});

test('published update resolves a verified legacy initial release without a version pointer', async () => {
  const packageRoot = 'releases/0.3.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.3.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  const productRoot = resolve(archiveRoot, context.productSlug);
  const versionRoot = resolve(productRoot, 'releases', '0.2.0');
  const baseCandidateRoot = resolve(versionRoot, 'candidates', 'fedcba9876543210');
  const baseManifest = JSON.parse(await readFile(resolve(baseCandidateRoot, 'manifest.json'), 'utf8'));
  const product = JSON.parse(await readFile(resolve(productRoot, 'product.json'), 'utf8'));
  const previewRoot = resolve(productRoot, 'exports', 'itch-preview');
  const { target_version: _targetVersion, ...legacyManifestFields } = baseManifest;
  await mkdir(previewRoot, { recursive: true });
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify({ ...product, version: '0.2.0' })),
    writeFile(resolve(previewRoot, 'manifest.json'), JSON.stringify({
      ...legacyManifestFields,
      product_version: '0.2.0',
      release_state: 'internal_preview',
      distribution_ready: false,
    })),
    writeFile(resolve(previewRoot, 'itch-listing-preview.json'), JSON.stringify({
      listing_hash: 'f'.repeat(64),
    })),
  ]);
  await rm(versionRoot, { recursive: true, force: true });

  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.manifest_hash, manifestHash);
});

test('published update preserves transitive canonical provenance from its immediate verified base', async () => {
  const packageRoot = 'releases/0.3.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const priorOriginHash = '7'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.3.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  const productRoot = resolve(archiveRoot, context.productSlug);
  const baseManifestPath = resolve(
    productRoot,
    'releases',
    '0.2.0',
    'candidates',
    'fedcba9876543210',
    'manifest.json',
  );
  const updateManifestPath = resolve(productRoot, packageRoot, 'manifest.json');
  const [baseManifest, updateManifest] = await Promise.all([
    readFile(baseManifestPath, 'utf8').then(JSON.parse),
    readFile(updateManifestPath, 'utf8').then(JSON.parse),
  ]);
  const inventory = assets.map((asset, index) => ({
    ...asset,
    asset_key: index === 0 ? 'rail-rifle' : 'arc-launcher',
    kind: 'weapon',
    buyer_path: `assets/individual/${index === 0 ? 'rail-rifle' : 'arc-launcher'}.png`,
    content_origin: 'canonical',
    origin_manifest_hash: priorOriginHash,
    latest_operation: 'canonical',
    content_sha256: index === 0 ? 'b'.repeat(64) : 'd'.repeat(64),
  }));
  await Promise.all([
    writeFile(baseManifestPath, JSON.stringify({ ...baseManifest, asset_inventory: inventory })),
    writeFile(updateManifestPath, JSON.stringify({ ...updateManifest, asset_inventory: inventory })),
  ]);

  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.asset_decisions[0].asset_hash, 'b'.repeat(64));
});

test('published update rejects an inherited asset that differs from the verified base release', async () => {
  const packageRoot = 'releases/0.3.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.3.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.2.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.2.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  const manifestPath = resolve(archiveRoot, context.productSlug, packageRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[1].content_sha256 = '9'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /inherited base-release hash.*does not match/iu,
  );
});

test('approves an explicitly reviewed replacement asset hash in a published update', async () => {
  const packageRoot = 'releases/0.2.0/candidates/0123456789abcdef';
  const currentManifestHash = 'e'.repeat(64);
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.2.0',
    baseManifestHash: currentManifestHash,
    marketplaceReviewMode: 'published_update',
    currentMarketplaceVersion: '0.1.0',
    publishedState: {
      status: 'verified_public',
      product_id: 'asset-product-e7bd21e31c69c03a',
      target_version: '0.1.0',
      manifest_hash: currentManifestHash,
      listing_hash: 'f'.repeat(64),
      public_url: context.itchUrl,
    },
  });
  const productRoot = resolve(archiveRoot, context.productSlug);
  const manifestPath = resolve(productRoot, packageRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const replacementHash = '9'.repeat(64);
  manifest.files[1].content_sha256 = replacementHash;
  manifest.expansion_manifest_hash = '8'.repeat(64);
  manifest.gates = { expansion_review_approved: true };
  manifest.expansion_assets = [{
    asset_id: 'asset-arc-launcher',
    asset_key: 'arc-launcher',
    name: 'Arc Launcher',
    operation: 'replace_existing',
    buyer_path: 'assets/individual/arc-launcher.png',
    content_sha256: replacementHash,
  }];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: packInteraction(),
    archiveRoot,
    config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
    store: { async insert(row) { inserted.push(row); } },
  });
  assert.equal(inserted.length, 1);
  assert.equal(result.row.asset_decisions[1].asset_hash, replacementHash);
});

test('rejects a changed canonical asset hash without approved replacement provenance', async () => {
  const packageRoot = 'releases/0.2.0/candidates/0123456789abcdef';
  const archiveRoot = await createArchiveFixture({
    packageRoot,
    targetVersion: '0.2.0',
  });
  const manifestPath = resolve(archiveRoot, context.productSlug, packageRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[1].content_sha256 = '9'.repeat(64);
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: packInteraction(),
      archiveRoot,
      config: { guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [], env: {} },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /canonical hash.*does not match/iu,
  );
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
