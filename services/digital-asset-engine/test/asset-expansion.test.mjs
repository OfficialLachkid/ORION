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
  return { outputRoot, productRoot, plan, hash };
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
