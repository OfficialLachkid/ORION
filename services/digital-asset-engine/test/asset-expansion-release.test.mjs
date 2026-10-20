import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { prepareApprovedAssetExpansionRelease } from '../src/asset-expansion-release.mjs';
import {
  coverScene,
  selectCoverLifecyclePreviewPath,
  selectLifecyclePreviewPath,
  weaponEffectPhase,
} from '../src/expansion-release-marketing.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function write(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, value);
}

function product() {
  return {
    schema_version: '1.0', product_id: 'asset-product-test', opportunity_id: 'OPPORTUNITY-TEST',
    slug: 'neon-plasma-armory', title: 'Neon Plasma Armory', version: '0.1.0',
    status: 'awaiting_asset_review', category: 'Pixel Art', product_type: 'Asset Pack',
    theme: 'Original science fiction', target_audience: ['game developers'],
    style: {
      medium: 'pixel_art', perspective: 'side view', width: 128, height: 128,
      max_palette_colors: 32, palette: ['#10131d', '#35d9ff'], outline: 'one pixel',
      lighting: 'cool cyan', background: 'transparent', chroma_key: '#ff00ff',
    },
    assets: [{
      asset_id: 'asset-weapon', asset_key: 'arc-launcher', name: 'Arc Launcher', kind: 'weapon',
      description: 'A launcher.', generation_prompt: 'Create a launcher.', seed: 1, status: 'generated',
      source_path: 'assets/source/arc-launcher.png', final_path: 'assets/individual/arc-launcher.png',
      validation_path: 'validation/arc-launcher.json',
    }],
    pricing: { base_price: { amount: 4.99, currency: 'EUR' }, marketplace_prices: {}, human_approval_required: true },
    distribution: { marketplaces: ['itch.io'], status: 'not_started' },
    license: { status: 'draft', redistribution_of_raw_assets: false },
    generation_provider: { provider: 'ollama', model: 'local-image', estimated_cost: 0, execution: 'local' },
    approvals: { generation: 'approved', distribution: 'pending' },
    created_at: '2026-10-19T00:00:00.000Z', updated_at: '2026-10-19T00:00:00.000Z',
  };
}

async function fixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-expansion-release-'));
  const productRoot = resolve(outputRoot, 'neon-plasma-armory');
  const baseRoot = resolve(productRoot, 'releases', '0.2.0', 'candidates', 'base-candidate');
  const reviewRoot = resolve(productRoot, 'extensions', 'static-expansion-v1', 'review');
  const reviewCandidate = resolve(reviewRoot, 'candidates', 'review-candidate');
  const png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: { r: 32, g: 216, b: 244, alpha: 1 } },
  }).png().toBuffer();
  const baseFiles = {
    'download/assets/individual/arc-launcher.png': png,
    'download/LICENSE.md': Buffer.from('Test buyer license\n'),
    'download/README.md': Buffer.from('Old readme\n'),
    'weapon-inventory.png': png,
    'effects-breakdown.png': png,
    'firing-cycle-montage.gif': Buffer.from('GIF89a-base-montage'),
  };
  const listing = {
    schema_version: '1.0', title: 'Neon Plasma Armory', short_description: 'Weapons.',
    description: 'Base description.', price: { amount: 4.99, currency: 'USD' }, visibility: 'draft',
    screenshot_paths: ['weapon-inventory.png', 'effects-breakdown.png', 'firing-cycle-montage.gif'],
    technical_information: ['Transparent PNG'], listing_hash: '',
  };
  delete listing.listing_hash;
  listing.listing_hash = sha256(Buffer.from(JSON.stringify(listing)));
  await write(resolve(productRoot, 'product.json'), JSON.stringify(product()));
  for (const [path, value] of Object.entries(baseFiles)) await write(resolve(baseRoot, path), value);
  await write(resolve(baseRoot, 'itch-listing.json'), `${JSON.stringify(listing)}\n`);
  const baseInventory = [];
  for (const [path, value] of Object.entries({ ...baseFiles, 'itch-listing.json': Buffer.from(`${JSON.stringify(listing)}\n`) })) {
    baseInventory.push({ path, size_bytes: value.length, content_sha256: sha256(value) });
  }
  const baseHash = 'a'.repeat(64);
  const licenseHash = sha256(baseFiles['download/LICENSE.md']);
  await write(resolve(baseRoot, 'manifest.json'), JSON.stringify({
    release_id: 'release-020', manifest_hash: baseHash, target_version: '0.2.0',
    release_state: 'awaiting_extension_review', distribution_ready: false,
    gates: { quality_holds_resolved: true }, quality_holds: [], listing_hash: listing.listing_hash,
    effect_animation_count: 3,
    buyer_license: { license_id: 'test', version: '1.0', content_sha256: licenseHash },
    files: baseInventory,
  }));
  await write(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
    target_version: '0.2.0', candidate_path: 'releases/0.2.0/candidates/base-candidate', manifest_hash: baseHash,
  }));

  const runtime = Buffer.from('{"root_motion":{"x":0,"y":0}}\n');
  const reviewFiles = {
    'assets/plasma-shield.png': png,
    'animations/plasma-shield/base.png': png,
    'animations/plasma-shield/frames/active/00.png': png,
    'animations/plasma-shield/overlays/active/00.png': png,
    'animations/plasma-shield/sheets/active.png': png,
    'animations/plasma-shield/states/full.png': png,
    'animations/plasma-shield/metadata/active/animation.json': runtime,
    'animations/plasma-shield/previews/active.gif': Buffer.from('GIF89a-review-only'),
    'animations/plasma-shield/validation.json': Buffer.from('{"status":"passed"}\n'),
    'overview.png': png,
  };
  for (const [path, value] of Object.entries(reviewFiles)) await write(resolve(reviewCandidate, path), value);
  const reviewInventory = Object.entries(reviewFiles).map(([path, value]) => ({
    path, size_bytes: value.length, content_sha256: sha256(value),
  }));
  const reviewHash = 'b'.repeat(64);
  const animationFiles = reviewInventory.filter((file) => file.path.startsWith('animations/plasma-shield/'));
  await write(resolve(reviewCandidate, 'manifest.json'), JSON.stringify({
    expansion_id: 'static-expansion-v1', product_id: 'asset-product-test', product_slug: 'neon-plasma-armory',
    base_version: '0.2.0', target_version: '0.3.0', base_manifest_hash: baseHash,
    manifest_hash: reviewHash, asset_count: 1, animation_count: 1, state_count: 1,
    assets: [{
      asset_id: 'asset-expansion-shield', asset_key: 'plasma-shield', name: 'Plasma Shield', kind: 'vfx',
      description: 'A protective plasma shield.', buyer_group: 'vfx', path: 'assets/plasma-shield.png',
      content_sha256: sha256(png), review_hash: 'c'.repeat(64),
      animation: {
        bundle_hash: 'c'.repeat(64), files: animationFiles,
        states: [{ state_key: 'full', path: 'animations/plasma-shield/states/full.png' }],
        animations: [{ animation_key: 'active', metadata_path: 'animations/plasma-shield/metadata/active/animation.json' }],
      },
    }],
    files: reviewInventory,
  }));
  await write(resolve(reviewRoot, 'latest-review.json'), JSON.stringify({
    expansion_id: 'static-expansion-v1', target_version: '0.3.0',
    candidate_path: 'extensions/static-expansion-v1/review/candidates/review-candidate', manifest_hash: reviewHash,
  }));
  await write(resolve(reviewRoot, 'discord.json'), JSON.stringify({
    manifest_hash: reviewHash, target_version: '0.3.0',
    last_decision: { decision: 'approve', affected_asset_ids: [], decided_at: '2026-10-19T13:42:10.035Z' },
  }));
  const plan = {
    schema_version: '1.0', expansion_id: 'static-expansion-v1', product_slug: 'neon-plasma-armory',
    title: 'Static Expansion', base_version: '0.2.0', target_version: '0.3.0', base_manifest_hash: baseHash,
    assets: [{
      source_product_slug: 'source-proof', source_asset_key: 'shield-v8', target_asset_key: 'plasma-shield',
      target_name: 'Plasma Shield', buyer_group: 'vfx',
    }],
  };
  async function marketingBuilder({ candidateRoot, inheritedScreenshotPaths }) {
    await Promise.all([
      write(resolve(candidateRoot, 'cover.gif'), Buffer.from('GIF89a-cover')),
      write(resolve(candidateRoot, 'cover-still.png'), png),
      write(resolve(candidateRoot, 'armory-items-and-vfx.png'), png),
      write(resolve(candidateRoot, 'interactive-expansion-montage.gif'), Buffer.from('GIF89a-montage')),
    ]);
    return {
      cover_path: 'cover.gif', cover_fallback_path: 'cover-still.png',
      screenshot_paths: [
        ...inheritedScreenshotPaths,
        'armory-items-and-vfx.png',
        'interactive-expansion-montage.gif',
      ],
      motion: { rapid_flashing: false },
    };
  }
  return { outputRoot, productRoot, reviewRoot, plan, marketingBuilder };
}

test('builds an immutable 0.3.0 package from the exact approved expansion review', async () => {
  const setup = await fixture();
  const result = await prepareApprovedAssetExpansionRelease({
    outputRoot: setup.outputRoot, plan: setup.plan, marketingBuilder: setup.marketingBuilder,
    now: '2026-10-19T14:00:00.000Z',
  });
  assert.equal(result.manifest.target_version, '0.3.0');
  assert.equal(result.manifest.asset_count, 2);
  assert.equal(result.manifest.expansion_assets[0].name, 'Plasma Shield');
  assert.equal(result.manifest.expansion_review_approved, undefined);
  assert.equal(result.manifest.gates.expansion_review_approved, true);
  assert.equal(result.listing.cover_path, 'cover.gif');
  assert.equal(result.manifest.marketing_media.motion.rapid_flashing, false);
  assert.deepEqual(result.listing.screenshot_paths, [
    'previous-release-media/weapon-inventory.png',
    'previous-release-media/effects-breakdown.png',
    'previous-release-media/firing-cycle-montage.gif',
    'armory-items-and-vfx.png',
    'interactive-expansion-montage.gif',
  ]);
  assert.equal(
    await readFile(resolve(result.candidateRoot, 'previous-release-media/firing-cycle-montage.gif'), 'utf8'),
    'GIF89a-base-montage',
  );
  await assert.rejects(readFile(resolve(result.candidateRoot, 'complete-inventory.png')));
  assert.equal((await readFile(resolve(result.candidateRoot, 'download/assets/expansion/vfx/plasma-shield.png'))).length > 0, true);
  assert.equal((await readFile(resolve(result.candidateRoot, 'download/animations/plasma-shield/frames/active/00.png'))).length > 0, true);
  await assert.rejects(readFile(resolve(result.candidateRoot, 'download/animations/plasma-shield/previews/active.gif')));
  await assert.rejects(readFile(resolve(result.candidateRoot, 'download/animations/plasma-shield/validation.json')));
  await assert.rejects(readFile(resolve(result.candidateRoot, 'download/animations/plasma-shield/base.png')));
  assert.match(await readFile(resolve(result.candidateRoot, 'download/README.md'), 'utf8'), /zero root motion/iu);
  const reused = await prepareApprovedAssetExpansionRelease({
    outputRoot: setup.outputRoot, plan: setup.plan, marketingBuilder: setup.marketingBuilder,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.manifest.manifest_hash, result.manifest.manifest_hash);
});

test('marketing previews sample every declared shield animation instead of early sorted frames only', () => {
  const asset = {
    asset_key: 'plasma-shield',
    buyer_path: 'assets/expansion/vfx/plasma-shield.png',
    animations: [
      'power-up', 'active-loop', 'shield-hit', 'integrity-decay', 'shield-break', 'power-down',
    ].map((animationKey) => ({ animation_key: animationKey })),
  };
  asset.runtime_paths = asset.animations.flatMap(({ animation_key: animationKey }) => [
    `animations/plasma-shield/frames/${animationKey}/00.png`,
    `animations/plasma-shield/frames/${animationKey}/01.png`,
  ]);
  const selected = Array.from(
    { length: 12 },
    (unused, index) => selectLifecyclePreviewPath(asset, index, 12),
  );
  for (const { animation_key: animationKey } of asset.animations) {
    assert.ok(selected.some((path) => path.includes(`/frames/${animationKey}/`)), animationKey);
  }
  const coverSelected = Array.from(
    { length: 12 },
    (unused, index) => selectCoverLifecyclePreviewPath(asset, index, 12),
  );
  assert.equal(coverSelected[0], asset.buyer_path);
  for (const { animation_key: animationKey } of asset.animations) {
    assert.ok(coverSelected.some((path) => path.includes(`/frames/${animationKey}/`)), animationKey);
  }
  assert.deepEqual(
    Array.from({ length: 8 }, (unused, index) => weaponEffectPhase(index)),
    [
      'weapon', 'muzzle_flash', 'projectile', 'impact_decay',
      'weapon', 'muzzle_flash', 'projectile', 'impact_decay',
    ],
  );
  assert.deepEqual(
    Array.from({ length: 16 }, (unused, index) => coverScene(index).kind),
    [
      'weapons', 'weapons', 'weapons', 'weapons',
      'expansion', 'expansion', 'expansion', 'expansion',
      'expansion', 'expansion', 'expansion', 'expansion',
      'expansion', 'expansion', 'expansion', 'expansion',
    ],
  );
  assert.equal(coverScene(0).frame_index, 0);
  assert.equal(coverScene(4).frame_index, 0);
  assert.equal(coverScene(15).frame_index, 11);
});

test('fails closed when the approval does not cover the exact expansion manifest', async () => {
  const setup = await fixture();
  await write(resolve(setup.reviewRoot, 'discord.json'), JSON.stringify({
    manifest_hash: 'f'.repeat(64), target_version: '0.3.0',
    last_decision: { decision: 'approve', affected_asset_ids: [], decided_at: '2026-10-19T13:42:10.035Z' },
  }));
  await assert.rejects(
    prepareApprovedAssetExpansionRelease({
      outputRoot: setup.outputRoot, plan: setup.plan, marketingBuilder: setup.marketingBuilder,
    }),
    /exact expansion manifest/iu,
  );
});
