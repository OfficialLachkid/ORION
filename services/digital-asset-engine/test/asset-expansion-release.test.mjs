import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import {
  inheritedMarketplaceScreenshotPath,
  prepareApprovedAssetExpansionRelease,
} from '../src/asset-expansion-release.mjs';
import {
  continuousLifecyclePreviewPaths,
  coverScene,
  cropVisibleAlpha,
  selectCoverLifecyclePreviewPath,
  selectLifecyclePreviewPath,
  visibleAlphaBounds,
  weaponEffectPhase,
  weaponEffectSubtitle,
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

test('builds a generic animated update from an initial public release without duplicating existing assets', async () => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-generic-upgrade-'));
  const productRoot = resolve(outputRoot, 'arcane-relics-potions');
  const baseRoot = resolve(productRoot, 'exports', 'itch-preview');
  const reviewRoot = resolve(productRoot, 'extensions', 'arcane-animation-v1', 'review');
  const reviewCandidate = resolve(reviewRoot, 'candidates', 'review-candidate');
  const basePng = await sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 128, g: 80, b: 180, alpha: 1 } },
  }).png().toBuffer();
  const replacementPng = await sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 68, g: 198, b: 191, alpha: 1 } },
  }).png().toBuffer();
  const arcane = product();
  arcane.slug = 'arcane-relics-potions';
  arcane.title = 'Arcane Relics & Potions';
  arcane.theme = 'Arcane fantasy and alchemy';
  arcane.style = { ...arcane.style, width: 96, height: 96, perspective: 'centered inventory icon' };
  arcane.assets = [{
    ...arcane.assets[0],
    asset_id: 'asset-spell-tome',
    asset_key: 'spell-tome',
    name: 'Spell Tome',
    kind: 'book',
    final_path: 'assets/items/spell-tome.png',
  }];
  await write(resolve(productRoot, 'product.json'), JSON.stringify(arcane));
  const baseListing = {
    schema_version: '1.0',
    title: arcane.title,
    short_description: 'Arcane pixel-art assets.',
    description: 'Original arcane relics.',
    price: { amount: 4.99, currency: 'USD' },
    visibility: 'draft',
    cover_path: 'cover.png',
    screenshot_paths: ['cover.png', 'marketplace-preview.png'],
    technical_information: ['Transparent PNG'],
  };
  baseListing.listing_hash = sha256(Buffer.from(JSON.stringify(baseListing)));
  const baseFiles = {
    'download/assets/individual/spell-tome.png': basePng,
    'download/assets/arcane-relics-potions-sprite-sheet.png': basePng,
    'download/LICENSE-DRAFT.md': Buffer.from('Draft only\n'),
    'download/README.md': Buffer.from('Old readme\n'),
    'cover.png': basePng,
    'marketplace-preview.png': basePng,
  };
  for (const [path, value] of Object.entries(baseFiles)) await write(resolve(baseRoot, path), value);
  await write(resolve(baseRoot, 'itch-listing-preview.json'), `${JSON.stringify(baseListing)}\n`);
  const baseManifestHash = 'd'.repeat(64);
  await write(resolve(baseRoot, 'manifest.json'), JSON.stringify({
    release_state: 'internal_preview',
    distribution_ready: false,
    product_version: '0.1.0',
    manifest_hash: baseManifestHash,
    listing_hash: baseListing.listing_hash,
    files: Object.entries(baseFiles).map(([path, value]) => ({
      path, size_bytes: value.length, content_sha256: sha256(value),
    })),
  }));
  await write(resolve(productRoot, 'review', 'distribution.json'), JSON.stringify({
    status: 'published',
    target_version: '0.1.0',
    manifest_hash: baseManifestHash,
    publication_job: { status: 'completed' },
  }));
  const animationJson = Buffer.from('{"root_motion":{"x":0,"y":0}}\n');
  const reviewFiles = {
    'assets/spell-tome.png': replacementPng,
    'animations/spell-tome/frames/awakening/00.png': replacementPng,
    'animations/spell-tome/overlays/awakening/00.png': replacementPng,
    'animations/spell-tome/sheets/awakening.png': replacementPng,
    'animations/spell-tome/states/awakened.png': replacementPng,
    'animations/spell-tome/metadata/awakening/animation.json': animationJson,
    'overview.png': replacementPng,
  };
  for (const [path, value] of Object.entries(reviewFiles)) await write(resolve(reviewCandidate, path), value);
  const reviewInventory = Object.entries(reviewFiles).map(([path, value]) => ({
    path, size_bytes: value.length, content_sha256: sha256(value),
  }));
  const reviewHash = 'e'.repeat(64);
  await write(resolve(reviewCandidate, 'manifest.json'), JSON.stringify({
    expansion_id: 'arcane-animation-v1',
    product_id: arcane.product_id,
    product_slug: arcane.slug,
    base_version: '0.1.0',
    target_version: '0.2.0',
    base_manifest_hash: baseManifestHash,
    manifest_hash: reviewHash,
    asset_count: 1,
    animation_count: 1,
    state_count: 1,
    assets: [{
      asset_id: 'asset-spell-tome',
      asset_key: 'spell-tome',
      operation: 'replace_existing',
      name: 'Spell Tome',
      kind: 'book',
      description: 'An awakened spell tome.',
      buyer_group: 'items',
      path: 'assets/spell-tome.png',
      content_sha256: sha256(replacementPng),
      review_hash: 'f'.repeat(64),
      animation: {
        bundle_hash: 'f'.repeat(64),
        files: reviewInventory.filter((file) => file.path.startsWith('animations/spell-tome/')),
        states: [{ state_key: 'awakened', path: 'animations/spell-tome/states/awakened.png' }],
        animations: [{ animation_key: 'awakening', metadata_path: 'animations/spell-tome/metadata/awakening/animation.json' }],
      },
    }],
    files: reviewInventory,
  }));
  await write(resolve(reviewRoot, 'latest-review.json'), JSON.stringify({
    expansion_id: 'arcane-animation-v1',
    target_version: '0.2.0',
    candidate_path: 'extensions/arcane-animation-v1/review/candidates/review-candidate',
    manifest_hash: reviewHash,
  }));
  await write(resolve(reviewRoot, 'discord.json'), JSON.stringify({
    manifest_hash: reviewHash,
    target_version: '0.2.0',
    last_decision: { decision: 'approve', affected_asset_ids: [], decided_at: '2026-10-22T14:42:36.728Z' },
  }));
  const plan = {
    schema_version: '1.0',
    expansion_id: 'arcane-animation-v1',
    product_slug: arcane.slug,
    title: 'Arcane Animation Upgrade',
    base_version: '0.1.0',
    target_version: '0.2.0',
    base_manifest_hash: baseManifestHash,
    assets: [{
      operation: 'replace_existing',
      source_product_slug: arcane.slug,
      source_asset_key: 'spell-tome',
      target_asset_key: 'spell-tome',
      target_name: 'Spell Tome',
      buyer_group: 'items',
      interactive_proof: { batch_id: 'arcane-animation-batch-v1', asset_key: 'spell-tome' },
    }],
  };
  const result = await prepareApprovedAssetExpansionRelease({
    outputRoot,
    plan,
    marketingBuilder: async ({ candidateRoot, inheritedScreenshotPaths }) => {
      await write(resolve(candidateRoot, 'cover.gif'), Buffer.from('GIF89a-cover'));
      await write(resolve(candidateRoot, 'cover-still.png'), replacementPng);
      await write(resolve(candidateRoot, 'asset-upgrade-overview.png'), replacementPng);
      await write(resolve(candidateRoot, 'animated-asset-montage.gif'), Buffer.from('GIF89a-montage'));
      return {
        cover_path: 'cover.gif',
        cover_fallback_path: 'cover-still.png',
        screenshot_paths: [
          ...inheritedScreenshotPaths,
          'asset-upgrade-overview.png',
          'animated-asset-montage.gif',
        ],
        motion: { rapid_flashing: false },
      };
    },
  });
  assert.equal(result.manifest.asset_count, 1);
  assert.equal(result.manifest.replaced_asset_count, 1);
  assert.equal(result.manifest.added_asset_count, 0);
  assert.equal(result.manifest.expansion_assets[0].buyer_path, 'assets/individual/spell-tome.png');
  assert.deepEqual(
    await readFile(resolve(result.candidateRoot, 'download/assets/individual/spell-tome.png')),
    replacementPng,
  );
  await assert.rejects(readFile(resolve(result.candidateRoot, 'download/assets/expansion/items/spell-tome.png')));
  await assert.rejects(readFile(resolve(result.candidateRoot, 'download/LICENSE-DRAFT.md')));
  assert.match(await readFile(resolve(result.candidateRoot, 'download/LICENSE.md'), 'utf8'), /VBJServices Digital Asset License 1\.0/u);
  assert.equal(result.manifest.buyer_license.license_id, 'vbjservices-digital-asset-license');
  assert.deepEqual(result.listing.screenshot_paths, [
    'previous-release-media/cover.png',
    'previous-release-media/marketplace-preview.png',
    'asset-upgrade-overview.png',
    'animated-asset-montage.gif',
  ]);
});

test('shield marketing preview depletes monotonically before its terminal scatter and empty frames', () => {
  const asset = {
    asset_key: 'plasma-shield',
    buyer_path: 'assets/expansion/vfx/plasma-shield.png',
    animations: [
      'power-up', 'active-loop', 'shield-hit', 'integrity-decay', 'shield-break', 'power-down',
    ].map((animationKey) => ({ animation_key: animationKey })),
  };
  asset.runtime_paths = asset.animations.flatMap(({ animation_key: animationKey }) => {
    const frameCount = animationKey === 'integrity-decay'
      ? 10
      : animationKey === 'shield-break' ? 6 : 2;
    return Array.from(
      { length: frameCount },
      (unused, index) => `animations/plasma-shield/frames/${animationKey}/${String(index).padStart(2, '0')}.png`,
    );
  });
  const animationPaths = asset.animations.map((animation) => ({
    animation,
    paths: asset.runtime_paths.filter((path) => path.includes(`/frames/${animation.animation_key}/`)),
  }));
  const expected = [
    ...Array.from(
      { length: 10 },
      (unused, index) => `animations/plasma-shield/frames/integrity-decay/${String(index).padStart(2, '0')}.png`,
    ),
    'animations/plasma-shield/frames/shield-break/04.png',
    'animations/plasma-shield/frames/shield-break/05.png',
  ];
  assert.deepEqual(continuousLifecyclePreviewPaths(animationPaths), expected);
  const selected = Array.from(
    { length: 12 },
    (unused, index) => selectLifecyclePreviewPath(asset, index, 12),
  );
  assert.deepEqual(selected, expected);
  const coverSelected = Array.from(
    { length: 12 },
    (unused, index) => selectCoverLifecyclePreviewPath(asset, index, 12),
  );
  assert.equal(coverSelected[0], asset.buyer_path);
  assert.ok(coverSelected.slice(1, -2).every((path) => path.includes('/frames/integrity-decay/')));
  assert.deepEqual(coverSelected.slice(-2), expected.slice(-2));
});

test('generic marketing previews still sample every declared animation', () => {
  const asset = {
    asset_key: 'pickup',
    animations: ['idle-loop', 'collection-burst'].map((animationKey) => ({ animation_key: animationKey })),
    runtime_paths: [
      'animations/pickup/frames/idle-loop/00.png',
      'animations/pickup/frames/idle-loop/01.png',
      'animations/pickup/frames/collection-burst/00.png',
      'animations/pickup/frames/collection-burst/01.png',
    ],
  };
  const selected = Array.from(
    { length: 4 },
    (unused, index) => selectLifecyclePreviewPath(asset, index, 4),
  );
  assert.ok(selected.some((path) => path.includes('/frames/idle-loop/')));
  assert.ok(selected.some((path) => path.includes('/frames/collection-burst/')));
});

test('cover scenes hold labelled weapon effects before showing expansion assets', () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (unused, index) => weaponEffectPhase(index)),
    [
      'weapon', 'weapon', 'muzzle_flash', 'muzzle_flash',
      'projectile', 'projectile', 'impact_decay', 'impact_decay',
    ],
  );
  assert.deepEqual(
    Array.from({ length: 8 }, (unused, index) => weaponEffectSubtitle(index)),
    [
      '8 transparent weapon sprites',
      '8 transparent weapon sprites',
      'Independent muzzle-flash overlays',
      'Independent muzzle-flash overlays',
      'Independent projectile sprites',
      'Independent projectile sprites',
      'Independent impact & decay frames',
      'Independent impact & decay frames',
    ],
  );
  assert.deepEqual(
    Array.from({ length: 20 }, (unused, index) => coverScene(index).kind),
    [
      'weapons', 'weapons', 'weapons', 'weapons',
      'weapons', 'weapons', 'weapons', 'weapons',
      'expansion', 'expansion', 'expansion', 'expansion',
      'expansion', 'expansion', 'expansion', 'expansion',
      'expansion', 'expansion', 'expansion', 'expansion',
    ],
  );
  assert.equal(coverScene(0).frame_index, 0);
  assert.equal(coverScene(8).frame_index, 0);
  assert.equal(coverScene(19).frame_index, 11);
});

test('marketing media crops transparent padding to visible alpha before fitting grid entries', async () => {
  const padded = await sharp({
    create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: await sharp({
      create: { width: 20, height: 8, channels: 4, background: { r: 32, g: 216, b: 244, alpha: 1 } },
    }).png().toBuffer(),
    left: 31,
    top: 19,
  }]).png().toBuffer();
  const { data, info } = await sharp(padded).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual(visibleAlphaBounds(data, info), { left: 31, top: 19, width: 20, height: 8 });
  const croppedMetadata = await sharp(await cropVisibleAlpha(padded)).metadata();
  assert.equal(croppedMetadata.width, 20);
  assert.equal(croppedMetadata.height, 8);
});

test('inherited marketplace media stays flat across any number of future release updates', () => {
  const paths = [
    'weapon-inventory.png',
    'previous-release-media/effects-breakdown.png',
    'previous-release-media/previous-release-media/firing-cycle-montage.gif',
    'screenshots/expansion-inventory.png',
    'previous-release-media/screenshots/second-expansion.gif',
  ];
  assert.deepEqual(paths.map(inheritedMarketplaceScreenshotPath), [
    'previous-release-media/weapon-inventory.png',
    'previous-release-media/effects-breakdown.png',
    'previous-release-media/firing-cycle-montage.gif',
    'previous-release-media/screenshots/expansion-inventory.png',
    'previous-release-media/screenshots/second-expansion.gif',
  ]);
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
