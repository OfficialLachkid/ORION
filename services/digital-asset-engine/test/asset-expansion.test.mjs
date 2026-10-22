import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { prepareAssetExpansionReview } from '../src/asset-expansion.mjs';
import {
  buildAssetExpansionReviewComponents,
  postAssetExpansionReview,
  prepareAssetExpansionReviewModal,
  recordAssetExpansionReviewDecision,
} from '../src/asset-expansion-review.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function write(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, value);
}

function product(overrides = {}) {
  return {
    schema_version: '1.0',
    product_id: overrides.product_id || 'asset-product-test',
    opportunity_id: overrides.opportunity_id || 'OPPORTUNITY-TEST',
    slug: overrides.slug || 'neon-plasma-armory',
    title: overrides.title || 'Neon Plasma Armory',
    version: '0.1.0',
    status: 'awaiting_asset_review',
    category: 'Pixel Art',
    product_type: 'Asset Pack',
    theme: 'Original science fiction',
    target_audience: ['game developers'],
    style: {
      medium: 'pixel_art', perspective: 'three-quarter view', width: 128, height: 128,
      max_palette_colors: 32, palette: ['#10131d', '#35d9ff'], outline: 'one pixel',
      lighting: 'cool cyan', background: 'transparent', chroma_key: '#ff00ff',
    },
    assets: overrides.assets || [{
      asset_id: 'asset-base-weapon', asset_key: 'base-weapon', name: 'Base Weapon', kind: 'weapon',
      description: 'Base weapon.', generation_prompt: 'Create one base weapon.', seed: 1,
      status: 'generated', source_path: 'assets/source/base-weapon.png',
      final_path: 'assets/items/base-weapon.png', validation_path: 'validation/base-weapon.json',
    }],
    pricing: { base_price: { amount: 4.99, currency: 'EUR' }, marketplace_prices: {}, human_approval_required: true },
    distribution: { marketplaces: ['itch.io'], status: 'not_started' },
    license: { status: 'draft', redistribution_of_raw_assets: false },
    generation_provider: { provider: 'ollama', model: 'local-image', estimated_cost: 0, execution: 'local' },
    approvals: { generation: 'approved', distribution: 'pending' },
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };
}

async function fixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-asset-expansion-'));
  const productRoot = resolve(outputRoot, 'neon-plasma-armory');
  const sourceSlug = 'armory-expansion-proof';
  const sourceRoot = resolve(productRoot, 'experiments', sourceSlug);
  const baseHash = 'a'.repeat(64);
  const listingHash = 'b'.repeat(64);
  const baseRoot = resolve(productRoot, 'releases', '0.2.0', 'candidates', '0123456789abcdef');
  await write(resolve(productRoot, 'product.json'), JSON.stringify(product()));
  await write(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
    target_version: '0.2.0', candidate_path: 'releases/0.2.0/candidates/0123456789abcdef', manifest_hash: baseHash,
  }));
  await write(resolve(baseRoot, 'manifest.json'), JSON.stringify({
    release_id: 'asset-release-v0-2-0', manifest_hash: baseHash, target_version: '0.2.0',
    release_state: 'awaiting_extension_review', distribution_ready: false,
    gates: { quality_holds_resolved: true }, quality_holds: [], listing_hash: listingHash,
  }));
  await write(resolve(baseRoot, 'itch-listing.json'), JSON.stringify({ listing_hash: listingHash }));
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 53, g: 217, b: 255, alpha: 1 } },
  }).png().toBuffer();
  const hash = sha256(png);
  const sourceAsset = {
    asset_id: 'asset-source-cell', asset_key: 'power-cell-v2', name: 'Power Cell V2', kind: 'consumable',
    description: 'A compact energy cell.', generation_prompt: 'Create one energy cell.', seed: 2,
    status: 'generated', source_path: 'assets/source/power-cell-v2.png',
    final_path: 'assets/items/power-cell-v2.png', validation_path: 'validation/power-cell-v2.json',
  };
  await write(resolve(sourceRoot, 'product.json'), JSON.stringify(product({
    product_id: 'asset-product-source', opportunity_id: 'OPPORTUNITY-SOURCE', slug: sourceSlug,
    title: 'Armory Expansion Proof', assets: [sourceAsset],
  })));
  await write(resolve(sourceRoot, sourceAsset.final_path), png);
  await write(resolve(sourceRoot, sourceAsset.validation_path), JSON.stringify({
    status: 'passed', metrics: { width: 128, height: 128, content_sha256: hash },
  }));
  const plan = {
    schema_version: '1.0', expansion_id: 'static-expansion-v1', product_slug: 'neon-plasma-armory',
    title: 'Static Expansion', base_version: '0.2.0', target_version: '0.3.0', base_manifest_hash: baseHash,
    assets: [{
      source_product_slug: sourceSlug, source_asset_key: 'power-cell-v2', target_asset_key: 'power-cell',
      target_name: 'Power Cell', buyer_group: 'items',
    }],
  };
  return { outputRoot, productRoot, plan, hash, png };
}

async function addAnimationProof(setup, options = {}) {
  const batchId = options.batchId || 'interactive-items-v1';
  const assetKey = options.assetKey || 'power-cell';
  const proofBase = options.baseBuffer || setup.png;
  const itemRoot = resolve(setup.productRoot, 'experiments', batchId, assetKey);
  const runtime = {
    'base.png': proofBase,
    'states/full.png': proofBase,
    'states/empty.png': proofBase,
    'metadata/states.json': Buffer.from('{"states":["empty","full"]}\n'),
    'previews/states.png': proofBase,
    'frames/active-loop/00.png': proofBase,
    'overlays/active-loop/00.png': proofBase,
    'sheets/active-loop.png': proofBase,
    'metadata/active-loop/animation.json': Buffer.from('{"root_motion":{"x":0,"y":0}}\n'),
    'previews/active-loop.gif': Buffer.from('GIF89a-active'),
    'frames/detonation/00.png': proofBase,
    'overlays/detonation/00.png': proofBase,
    'sheets/detonation.png': proofBase,
    'metadata/detonation/animation.json': Buffer.from('{"root_motion":{"x":0,"y":0}}\n'),
    'previews/detonation.gif': Buffer.from('GIF89a-detonation'),
    'validation.json': Buffer.from('{"status":"passed"}\n'),
    'source/detonation-peak.png': Buffer.from('private-model-source'),
  };
  const files = [];
  for (const [path, buffer] of Object.entries(runtime)) {
    await write(resolve(itemRoot, path), buffer);
    files.push({ path, size: buffer.length, sha256: sha256(buffer) });
  }
  const itemManifestHash = 'c'.repeat(64);
  await write(resolve(itemRoot, 'manifest.json'), JSON.stringify({
    schema_version: '1.0',
    item: { target_asset_key: assetKey },
    status: 'awaiting_animation_review',
    base_regenerated: options.baseRegenerated || false,
    generation_calls: 1,
    incurred_cost: 0,
    buyer_runtime_formats: ['transparent_png_frames', 'animation_json'],
    preview_only_formats: ['animated_gif'],
    states: ['empty', 'full'],
    animations: ['active-loop', 'detonation'],
    files,
    manifest_hash: itemManifestHash,
  }));
  await write(resolve(setup.productRoot, 'experiments', batchId, 'manifest.json'), JSON.stringify({
    schema_version: '1.0',
    batch_id: batchId,
    product_slug: setup.plan.product_slug,
    status: 'awaiting_animation_review',
    manifest_hash: 'd'.repeat(64),
    item_manifests: [{ asset_key: assetKey, manifest_hash: itemManifestHash }],
    gates: { all_items_valid: true, package_modified: false },
  }));
  setup.plan.title = 'Interactive Expansion';
  setup.plan.assets[0].interactive_proof = { batch_id: batchId, asset_key: assetKey };
}

test('builds an immutable static expansion review without changing the base release', async () => {
  const setup = await fixture();
  const result = await prepareAssetExpansionReview({
    outputRoot: setup.outputRoot, plan: setup.plan, now: '2026-10-18T13:00:00.000Z',
  });
  assert.equal(result.manifest.asset_count, 1);
  assert.equal(result.manifest.assets[0].asset_key, 'power-cell');
  assert.equal(result.manifest.assets[0].content_sha256, setup.hash);
  assert.equal(result.manifest.gates.approved_for_extension, false);
  assert.equal(result.manifest.gates.public_release_mutated, false);
  assert.match(result.candidateRoot, /extensions[\\/]static-expansion-v1[\\/]review[\\/]candidates/u);
  const overview = await sharp(resolve(result.candidateRoot, 'overview.png')).metadata();
  assert.equal(overview.width, 960);
  assert.equal(overview.height, 540);
  const reused = await prepareAssetExpansionReview({ outputRoot: setup.outputRoot, plan: setup.plan });
  assert.equal(reused.reused, true);
  assert.equal(reused.manifest.manifest_hash, result.manifest.manifest_hash);
});

test('reviews animations as enhancements of existing asset identities on an initial public release', async () => {
  const setup = await fixture();
  const canonical = product();
  await write(resolve(setup.productRoot, 'product.json'), JSON.stringify(canonical));
  await write(resolve(setup.productRoot, canonical.assets[0].final_path), setup.png);
  await write(resolve(setup.productRoot, canonical.assets[0].validation_path), JSON.stringify({
    status: 'passed', metrics: { width: 128, height: 128, content_sha256: setup.hash },
  }));
  await write(resolve(setup.productRoot, 'exports/itch-preview/manifest.json'), JSON.stringify({
    release_state: 'internal_preview', distribution_ready: false, product_version: '0.1.0',
    manifest_hash: setup.plan.base_manifest_hash,
    listing_hash: 'e'.repeat(64), files: [],
  }));
  await write(resolve(setup.productRoot, 'exports/itch-preview/itch-listing-preview.json'), JSON.stringify({
    listing_hash: 'e'.repeat(64),
  }));
  await write(resolve(setup.productRoot, 'review/distribution.json'), JSON.stringify({
    status: 'published', target_version: '0.1.0', manifest_hash: setup.plan.base_manifest_hash,
    publication_job: { status: 'completed' },
  }));
  setup.plan.expansion_id = 'animation-upgrade-v1';
  setup.plan.title = 'Animation Upgrade';
  setup.plan.base_version = '0.1.0';
  setup.plan.target_version = '0.2.0';
  setup.plan.assets = [{
    operation: 'enhance_existing',
    source_product_slug: canonical.slug,
    source_asset_key: canonical.assets[0].asset_key,
    target_asset_key: canonical.assets[0].asset_key,
    target_name: canonical.assets[0].name,
    buyer_group: 'items',
  }];
  await addAnimationProof(setup, {
    batchId: 'canonical-animation-v1',
    assetKey: canonical.assets[0].asset_key,
  });

  const prepared = await prepareAssetExpansionReview({
    outputRoot: setup.outputRoot,
    plan: setup.plan,
    now: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(prepared.manifest.base_release_id, `asset-release-${setup.plan.base_manifest_hash.slice(0, 24)}`);
  assert.equal(prepared.manifest.new_asset_count, 0);
  assert.equal(prepared.manifest.enhanced_asset_count, 1);
  assert.equal(prepared.manifest.assets[0].operation, 'enhance_existing');
  assert.equal(prepared.manifest.assets[0].asset_id, canonical.assets[0].asset_id);
  assert.equal(prepared.manifest.assets[0].animation.animations.length, 2);
  const components = buildAssetExpansionReviewComponents({
    productSlug: canonical.slug,
    expansionId: setup.plan.expansion_id,
    manifestHash: prepared.manifest.manifest_hash,
    manifestUrl: 'https://discord.com/channels/guild/channel/message',
    reviewMode: 'enhancement',
  });
  assert.equal(components[0].components[0].label, 'Approve Animation Upgrade');
  const statePath = resolve(
    setup.productRoot, 'extensions', setup.plan.expansion_id, 'review', 'discord.json',
  );
  await write(statePath, JSON.stringify({
    product_slug: canonical.slug,
    expansion_id: setup.plan.expansion_id,
    manifest_hash: prepared.manifest.manifest_hash,
    package_root: prepared.candidateRoot.slice(setup.productRoot.length + 1).replaceAll('\\', '/'),
    channel_id: 'channel-1',
    overview_message_id: 'overview-1',
    thread_id: 'thread-1',
    asset_messages: {},
  }));
  const decision = await recordAssetExpansionReviewDecision({
    interaction: {
      id: 'initial-release-upgrade-approval',
      type: 3,
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      data: { custom_id: components[0].components[0].custom_id },
      message: { id: 'overview-1' },
      member: { roles: ['operator-role'], user: { id: 'reviewer-1' } },
    },
    config: {
      guildId: 'guild-1',
      operatorRoleId: 'operator-role',
      operatorUserIds: [],
      env: {
        DIGITAL_ASSET_ARCHIVE_ROOT: setup.outputRoot,
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: 'secret',
      },
    },
    async fetchImpl(_url, options) {
      assert.equal(
        JSON.parse(options.body).base_release_id,
        `asset-release-${setup.plan.base_manifest_hash.slice(0, 24)}`,
      );
      return { ok: true, status: 201, async text() { return '[]'; } };
    },
  });
  assert.equal(
    decision.row.base_release_id,
    `asset-release-${setup.plan.base_manifest_hash.slice(0, 24)}`,
  );
});

test('reviews a replacement base without mutating the existing asset identity or public release', async () => {
  const setup = await fixture();
  const canonical = product();
  await write(resolve(setup.productRoot, 'product.json'), JSON.stringify(canonical));
  await write(resolve(setup.productRoot, canonical.assets[0].final_path), setup.png);
  await write(resolve(setup.productRoot, canonical.assets[0].validation_path), JSON.stringify({
    status: 'passed', metrics: { width: 128, height: 128, content_sha256: setup.hash },
  }));
  await write(resolve(setup.productRoot, 'exports/itch-preview/manifest.json'), JSON.stringify({
    release_state: 'internal_preview', distribution_ready: false, product_version: '0.1.0',
    release_id: 'asset-release-initial', manifest_hash: setup.plan.base_manifest_hash,
    listing_hash: 'e'.repeat(64), files: [],
  }));
  await write(resolve(setup.productRoot, 'exports/itch-preview/itch-listing-preview.json'), JSON.stringify({
    listing_hash: 'e'.repeat(64),
  }));
  await write(resolve(setup.productRoot, 'review/distribution.json'), JSON.stringify({
    status: 'published', target_version: '0.1.0', manifest_hash: setup.plan.base_manifest_hash,
    publication_job: { status: 'completed' },
  }));
  const replacement = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 44, g: 198, b: 191, alpha: 255 } },
  }).png().toBuffer();
  setup.plan.expansion_id = 'replacement-upgrade-v1';
  setup.plan.title = 'Replacement Upgrade';
  setup.plan.base_version = '0.1.0';
  setup.plan.target_version = '0.2.0';
  setup.plan.assets = [{
    operation: 'replace_existing',
    source_product_slug: canonical.slug,
    source_asset_key: canonical.assets[0].asset_key,
    target_asset_key: canonical.assets[0].asset_key,
    target_name: canonical.assets[0].name,
    buyer_group: 'items',
  }];
  await addAnimationProof(setup, {
    batchId: 'canonical-replacement-v1',
    assetKey: canonical.assets[0].asset_key,
    baseBuffer: replacement,
    baseRegenerated: true,
  });

  const prepared = await prepareAssetExpansionReview({ outputRoot: setup.outputRoot, plan: setup.plan });
  assert.equal(prepared.manifest.replaced_asset_count, 1);
  assert.equal(prepared.manifest.assets[0].operation, 'replace_existing');
  assert.equal(prepared.manifest.assets[0].asset_id, canonical.assets[0].asset_id);
  assert.equal(prepared.manifest.assets[0].content_sha256, sha256(replacement));
  assert.notEqual(prepared.manifest.assets[0].content_sha256, setup.hash);
  assert.equal(sha256(await readFile(resolve(setup.productRoot, canonical.assets[0].final_path))), setup.hash);
  const components = buildAssetExpansionReviewComponents({
    productSlug: canonical.slug,
    expansionId: setup.plan.expansion_id,
    manifestHash: prepared.manifest.manifest_hash,
    manifestUrl: 'https://discord.com/channels/guild/channel/message',
    reviewMode: 'upgrade',
  });
  assert.equal(components[0].components[0].label, 'Approve Asset Upgrade');
});

test('renamed expansion assets reuse their existing Discord review message', async () => {
  const setup = await fixture();
  setup.plan.assets[0].replaces_review_asset_key = 'legacy-power-cell';
  const prepared = await prepareAssetExpansionReview({ outputRoot: setup.outputRoot, plan: setup.plan });
  const legacyAssetId = `asset-expansion-${sha256(`${setup.plan.expansion_id}:legacy-power-cell`).slice(0, 16)}`;
  const statePath = resolve(
    setup.productRoot, 'extensions', setup.plan.expansion_id, 'review', 'discord.json',
  );
  await write(resolve(setup.productRoot, 'review', 'discord.json'), JSON.stringify({ channel_id: 'channel-1' }));
  await write(statePath, JSON.stringify({
    schema_version: '1.0',
    product_id: prepared.manifest.product_id,
    product_slug: setup.plan.product_slug,
    expansion_id: setup.plan.expansion_id,
    channel_id: 'channel-1',
    overview_message_id: 'overview-1',
    thread_id: 'thread-1',
    asset_messages: { [legacyAssetId]: 'legacy-message-1' },
    review_revision: 1,
    manifest_hash: 'f'.repeat(64),
  }));
  const requests = [];
  await postAssetExpansionReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' }, guildId: 'guild-1' },
    outputRoot: setup.outputRoot,
    productSlug: setup.plan.product_slug,
    expansionId: setup.plan.expansion_id,
    async fetchImpl(url, options = {}) {
      const path = new URL(url).pathname;
      requests.push({ path, method: options.method || 'GET' });
      return { ok: true, status: 200, async json() { return { id: 'legacy-message-1' }; } };
    },
  });
  assert.equal(requests.some((request) => (
    request.method === 'PATCH' && request.path.endsWith('/messages/legacy-message-1')
  )), true);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.asset_messages[prepared.manifest.assets[0].asset_id], 'legacy-message-1');
  assert.equal(state.asset_messages[legacyAssetId], undefined);
});

test('expansion review binds interactive runtime files and Discord GIF previews to the same manifest', async () => {
  const setup = await fixture();
  await addAnimationProof(setup);
  const prepared = await prepareAssetExpansionReview({
    outputRoot: setup.outputRoot,
    plan: setup.plan,
    now: '2026-10-18T14:00:00.000Z',
  });
  const asset = prepared.manifest.assets[0];
  assert.equal(prepared.manifest.animation_count, 2);
  assert.equal(prepared.manifest.state_count, 2);
  assert.equal(asset.animation.states.length, 2);
  assert.equal(asset.animation.animations.length, 2);
  assert.equal(asset.animation.base_sha256, setup.hash);
  assert.equal(asset.review_hash, asset.animation.bundle_hash);
  assert.equal(prepared.manifest.files.some((file) => file.path.endsWith('previews/active-loop.gif')), true);
  assert.equal(prepared.manifest.files.some((file) => file.path.includes('/source/')), false);
  assert.equal(
    await readFile(resolve(prepared.candidateRoot, asset.animation.animations[0].preview_gif_path), 'utf8'),
    'GIF89a-active',
  );
  assert.equal(
    (await readFile(resolve(prepared.candidateRoot, 'animations/power-cell/base.png'))).equals(setup.png),
    true,
  );

  await write(resolve(setup.productRoot, 'review', 'discord.json'), JSON.stringify({ channel_id: 'channel-1' }));
  const requests = [];
  let messageIndex = 0;
  const review = await postAssetExpansionReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' }, guildId: 'guild-1' },
    outputRoot: setup.outputRoot,
    productSlug: setup.plan.product_slug,
    expansionId: setup.plan.expansion_id,
    now: '2026-10-18T14:05:00.000Z',
    async fetchImpl(url, options = {}) {
      const path = new URL(url).pathname;
      const payload = options.body instanceof FormData
        ? JSON.parse(options.body.get('payload_json'))
        : options.body ? JSON.parse(options.body) : null;
      requests.push({ path, method: options.method || 'GET', payload });
      if (path.endsWith('/threads')) return { ok: true, status: 200, async json() { return { id: 'thread-1' }; } };
      if (options.method === 'POST' && path.endsWith('/messages')) {
        messageIndex += 1;
        return { ok: true, status: 200, async json() { return { id: `message-${messageIndex}` }; } };
      }
      return { ok: true, status: 200, async json() { return {}; } };
    },
  });
  assert.equal(review.thread_id, 'thread-1');
  const assetRequest = requests.find((request) => (
    request.path === '/api/v10/channels/thread-1/messages'
  ));
  assert.deepEqual(assetRequest.payload.attachments.map((attachment) => attachment.filename), [
    'power-cell.png',
    'power-cell-states.png',
    'power-cell-active-loop.gif',
    'power-cell-detonation.gif',
  ]);
  assert.match(assetRequest.payload.embeds[0].fields.find((field) => field.name === 'Included states').value, /detonation/u);

  const decisionContext = {
    productSlug: setup.plan.product_slug,
    expansionId: setup.plan.expansion_id,
    manifestHash: prepared.manifest.manifest_hash,
    manifestUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
  };
  const decision = await recordAssetExpansionReviewDecision({
    interaction: {
      id: 'animation-review-interaction',
      type: 3,
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      data: { custom_id: buildAssetExpansionReviewComponents(decisionContext)[0].components[0].custom_id },
      message: { id: 'message-1' },
      member: { roles: ['operator-role'], user: { id: 'reviewer-1', username: 'reviewer' } },
    },
    config: {
      guildId: 'guild-1',
      operatorRoleId: 'operator-role',
      operatorUserIds: [],
      env: {
        DIGITAL_ASSET_ARCHIVE_ROOT: setup.outputRoot,
        SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: 'secret',
      },
    },
    async fetchImpl() {
      return { ok: true, status: 201, async text() { return '[]'; } };
    },
  });
  assert.equal(decision.row.asset_decisions[0].asset_hash, asset.animation.bundle_hash);
});

test('expansion approval is bound to the exact manifest and persists per-asset hashes', async () => {
  const setup = await fixture();
  const prepared = await prepareAssetExpansionReview({ outputRoot: setup.outputRoot, plan: setup.plan });
  const statePath = resolve(
    setup.productRoot, 'extensions', setup.plan.expansion_id, 'review', 'discord.json',
  );
  const state = {
    product_slug: setup.plan.product_slug,
    expansion_id: setup.plan.expansion_id,
    manifest_hash: prepared.manifest.manifest_hash,
    package_root: prepared.candidateRoot.slice(setup.productRoot.length + 1).replaceAll('\\', '/'),
    channel_id: 'channel-1', overview_message_id: 'overview-1', thread_id: 'thread-1',
    asset_messages: { [prepared.manifest.assets[0].asset_id]: 'asset-message-1' },
  };
  await write(statePath, JSON.stringify(state));
  const context = {
    productSlug: setup.plan.product_slug,
    expansionId: setup.plan.expansion_id,
    manifestHash: prepared.manifest.manifest_hash,
    manifestUrl: 'https://discord.com/channels/guild-1/channel-1/overview-1',
  };
  const customId = buildAssetExpansionReviewComponents(context)[0].components[0].custom_id;
  const interaction = {
    id: 'interaction-1', type: 3, guild_id: 'guild-1', channel_id: 'channel-1',
    data: { custom_id: customId }, message: { id: 'overview-1' },
    member: { nick: 'Valen', roles: ['operator-role'], user: { id: 'reviewer-1', username: 'vbjservices' } },
  };
  const calls = [];
  const config = {
    guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [],
    env: { DIGITAL_ASSET_ARCHIVE_ROOT: setup.outputRoot, SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'secret' },
  };
  const result = await recordAssetExpansionReviewDecision({
    interaction, config,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(options.body) });
      return { ok: true, status: 201, async text() { return '[]'; } };
    },
  });
  assert.equal(result.row.decision, 'approve');
  assert.equal(result.row.asset_decisions[0].asset_hash, setup.hash);
  assert.match(calls[0].url, /digital_asset_expansion_reviews/u);
  assert.equal(result.messagePatch.components[0].components.length, 1);
});

test('expansion feedback modal lists the exact proposed assets', async () => {
  const setup = await fixture();
  const prepared = await prepareAssetExpansionReview({ outputRoot: setup.outputRoot, plan: setup.plan });
  const statePath = resolve(setup.productRoot, 'extensions', setup.plan.expansion_id, 'review', 'discord.json');
  await write(statePath, JSON.stringify({
    product_slug: setup.plan.product_slug, expansion_id: setup.plan.expansion_id,
    manifest_hash: prepared.manifest.manifest_hash,
    package_root: prepared.candidateRoot.slice(setup.productRoot.length + 1).replaceAll('\\', '/'),
    channel_id: 'channel-1', overview_message_id: 'overview-1', thread_id: 'thread-1', asset_messages: {},
  }));
  const context = {
    productSlug: setup.plan.product_slug, expansionId: setup.plan.expansion_id,
    manifestHash: prepared.manifest.manifest_hash, manifestUrl: 'https://discord.com',
  };
  const interaction = {
    id: 'interaction-1', type: 3, guild_id: 'guild-1', channel_id: 'channel-1',
    data: { custom_id: buildAssetExpansionReviewComponents(context)[0].components[1].custom_id },
    message: { id: 'overview-1' }, member: { roles: ['operator-role'], user: { id: 'reviewer-1' } },
  };
  const modal = await prepareAssetExpansionReviewModal({
    interaction,
    config: {
      guildId: 'guild-1', operatorRoleId: 'operator-role', operatorUserIds: [],
      env: { DIGITAL_ASSET_ARCHIVE_ROOT: setup.outputRoot },
    },
  });
  assert.equal(modal.components[1].component.options[0].label, '01 · Power Cell');
  assert.match(modal.custom_id, /^daerm\|c\|/u);
});
