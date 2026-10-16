import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { prepareVersionedPackageExtension } from '../src/release-extension.mjs';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function write(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, value);
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return { size_bytes: buffer.length, content_sha256: sha256(buffer) };
}

async function createFixture({ approved = true } = {}) {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-extension-'));
  const productRoot = resolve(outputRoot, 'neon-plasma-armory');
  const baseRoot = resolve(productRoot, 'exports', 'itch-preview');
  const weapon = Buffer.from('canonical transparent weapon');
  const product = {
    product_id: 'asset-product-test',
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.1.0',
    style: { width: 128, height: 64 },
    assets: [{
      asset_id: 'asset-plasma-pistol',
      asset_key: 'plasma-pistol',
      name: 'Plasma Pistol',
      final_path: 'assets/items/plasma-pistol.png',
    }],
  };
  await write(resolve(productRoot, product.assets[0].final_path), weapon);

  const listing = {
    schema_version: '1.0',
    title: product.title,
    short_description: 'One weapon.',
    description: 'Base package description.',
    suggested_price: { amount: 4.99, currency: 'EUR' },
    tags: ['2D', 'Pixel Art'],
    technical_information: ['128x64'],
    listing_hash: 'c'.repeat(64),
  };
  const baseFiles = [];
  for (const [path, value] of [
    ['download/assets/individual/plasma-pistol.png', weapon],
    ['download/README.md', 'base readme'],
    ['download/LICENSE-DRAFT.md', 'draft license'],
    ['cover.png', Buffer.from('cover')],
    ['marketplace-preview.png', Buffer.from('preview')],
    ['itch-listing-preview.json', `${JSON.stringify(listing)}\n`],
  ]) {
    const details = await write(resolve(baseRoot, path), value);
    baseFiles.push({ path, ...details });
  }
  const baseManifestHash = 'b'.repeat(64);
  await write(resolve(baseRoot, 'manifest.json'), `${JSON.stringify({
    manifest_hash: baseManifestHash,
    listing_hash: listing.listing_hash,
    files: baseFiles,
  })}\n`);
  await write(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
    manifest_hash: baseManifestHash,
    last_decision: { decision: approved ? 'approve' : 'request_changes' },
  }));

  const experimentRoot = resolve(productRoot, 'experiments', 'plasma-pistol-effects-proof-v1');
  const effects = [
    { effect_key: 'plasma-pistol-muzzle-flash', kind: 'muzzle_flash' },
    { effect_key: 'plasma-pistol-projectile', kind: 'projectile' },
    { effect_key: 'plasma-pistol-impact-decay', kind: 'impact_decay' },
  ];
  const experimentFiles = [];
  for (const effect of effects) {
    for (const [path, value] of [
      [`frames/${effect.effect_key}/00.png`, Buffer.from(`${effect.kind}-frame`)],
      [`sheets/${effect.effect_key}.png`, Buffer.from(`${effect.kind}-sheet`)],
      [`metadata/${effect.effect_key}/animation.json`, JSON.stringify({
        effect_key: effect.effect_key,
        kind: effect.kind,
        root_motion: { x: 0, y: 0 },
        sprite_sheet: { path: `../../sheets/${effect.effect_key}.png`, width: 64, height: 64 },
        frames: [{ frame: 0, path: `../../frames/${effect.effect_key}/00.png` }],
        preview_gif: `../../previews/${effect.effect_key}.gif`,
        preview_only: ['preview_gif'],
      })],
    ]) {
      const details = await write(resolve(experimentRoot, path), value);
      experimentFiles.push({ path, size: details.size_bytes, sha256: details.content_sha256 });
    }
  }
  const attackCyclePath = 'previews/plasma-pistol-attack-cycle.gif';
  const attackCycleDetails = await write(resolve(experimentRoot, attackCyclePath), Buffer.from('attack-cycle'));
  experimentFiles.push({
    path: attackCyclePath,
    size: attackCycleDetails.size_bytes,
    sha256: attackCycleDetails.content_sha256,
  });
  await write(resolve(experimentRoot, 'pilot.json'), JSON.stringify({ effects }));
  const proofManifestHash = 'd'.repeat(64);
  await write(resolve(experimentRoot, 'manifest.json'), JSON.stringify({
    manifest_hash: proofManifestHash,
    source_asset_key: 'plasma-pistol',
    source_asset_sha256: sha256(weapon),
    source_weapon_muzzle_anchor: { x: 111, y: 12 },
    source_weapon_muzzle_anchor_detection: { strategy: 'rightmost_opaque' },
    canonical_release_mutated: false,
    marketplace_listing_mutated: false,
    files: experimentFiles,
  }));

  const bundleHash = 'e'.repeat(64);
  const reviewId = 'neon-plasma-armory-effects-v1';
  await write(resolve(productRoot, 'review', 'effects-review-manifest.json'), JSON.stringify({
    review_id: reviewId,
    bundle_hash: bundleHash,
    experiments: [{
      source_asset_key: 'plasma-pistol',
      name: 'Plasma Pistol',
      experiment_path: 'experiments/plasma-pistol-effects-proof-v1',
      manifest_hash: proofManifestHash,
    }],
  }));
  await write(resolve(productRoot, 'review', 'effects-discord.json'), JSON.stringify({
    bundle_hash: bundleHash,
    completed_at: '2026-10-15T10:00:00.000Z',
  }));
  const plan = {
    schema_version: '1.0',
    extension_id: 'neon-plasma-armory-effects-v1',
    product_slug: product.slug,
    title: 'Effects Extension',
    base_version: '0.1.0',
    target_version: '0.2.0',
    base_manifest_hash: baseManifestHash,
    effects_review_id: reviewId,
    effects_bundle_hash: bundleHash,
    release_notes: ['Added independent weapon effects.'],
    quality_holds: [{
      hold_id: 'verify-impact-decays',
      status: 'open',
      affected_asset_keys: [],
      note: 'Identify two suspicious impact sequences.',
    }],
  };
  const marketingBuilder = async ({ candidateRoot }) => {
    const media = {
      cover_path: 'cover.png',
      screenshot_paths: ['weapon-inventory.png', 'effects-breakdown.png', 'firing-cycle-montage.gif'],
    };
    for (const path of [media.cover_path, ...media.screenshot_paths]) {
      await write(resolve(candidateRoot, path), Buffer.from(`marketing-${path}`));
    }
    return media;
  };
  return {
    outputRoot,
    productRoot,
    product,
    plan,
    marketingBuilder,
    store: {
      async loadProduct() { return product; },
      productRoot() { return productRoot; },
    },
  };
}

test('builds an immutable extension candidate with buyer runtime effects and an open quality hold', async () => {
  const fixture = await createFixture();
  const result = await prepareVersionedPackageExtension({
    outputRoot: fixture.outputRoot,
    store: fixture.store,
    plan: fixture.plan,
    marketingBuilder: fixture.marketingBuilder,
    now: '2026-10-15T12:00:00.000Z',
  });
  assert.equal(result.reused, false);
  assert.equal(result.manifest.base_version, '0.1.0');
  assert.equal(result.manifest.target_version, '0.2.0');
  assert.equal(result.manifest.release_state, 'blocked_quality_review');
  assert.equal(result.manifest.distribution_ready, false);
  assert.equal(result.manifest.human_review_required, true);
  assert.equal(result.manifest.extension_packaging_version, '1.2.0');
  assert.equal(result.manifest.effect_animation_count, 3);
  assert.equal(result.manifest.marketing_version, '1.0.1');
  assert.deepEqual(result.manifest.marketing_media.screenshot_paths, [
    'weapon-inventory.png',
    'effects-breakdown.png',
    'firing-cycle-montage.gif',
  ]);
  assert.equal(result.gates.quality_holds_resolved, false);
  assert.equal(result.gates.distribution_ready, false);
  assert.equal(result.gates.license_terms_included, true);
  assert.equal(result.gates.license_approval_required, true);
  assert.equal(result.manifest.license_terms_included, true);
  assert.equal(result.manifest.license_approval_required, true);
  assert.equal(result.manifest.buyer_license.license_id, 'vbjservices-digital-asset-license');
  assert.match(result.candidateRoot, /releases[\\/]0\.2\.0[\\/]candidates/u);
  assert.equal(result.manifest.files.some((file) => file.path.includes('assets/source')), false);
  assert.equal(result.manifest.files.some((file) => file.path.includes('/previews/')), false);
  assert.equal(result.manifest.files.some((file) => (
    file.path === 'download/effects/plasma-pistol/muzzle_flash/frames/00.png'
  )), true);
  assert.equal(result.manifest.files.some((file) => (
    file.path === 'download/effects/plasma-pistol/projectile/animation.json'
  )), true);
  assert.equal(result.manifest.files.some((file) => file.path === 'download/LICENSE-DRAFT.md'), false);
  assert.equal(result.manifest.files.some((file) => file.path === 'download/LICENSE.md'), true);
  assert.equal(result.manifest.files.some((file) => file.path === 'effects-breakdown.png'), true);
  const listing = JSON.parse(await readFile(resolve(result.candidateRoot, 'itch-listing.json'), 'utf8'));
  assert.deepEqual(listing.screenshot_paths, [
    'weapon-inventory.png',
    'effects-breakdown.png',
    'firing-cycle-montage.gif',
  ]);
  const anchors = JSON.parse(await readFile(resolve(
    result.candidateRoot,
    'download',
    'effects',
    'weapon-anchors.json',
  ), 'utf8'));
  assert.deepEqual(anchors.weapons[0].muzzle_anchor, { x: 111, y: 12 });
  const animation = JSON.parse(await readFile(resolve(
    result.candidateRoot,
    'download',
    'effects',
    'plasma-pistol',
    'muzzle_flash',
    'animation.json',
  ), 'utf8'));
  assert.equal(animation.sprite_sheet.path, 'sprite-sheet.png');
  assert.equal(animation.frames[0].path, 'frames/00.png');
  assert.equal('preview_gif' in animation, false);
  assert.equal('preview_only' in animation, false);
  const animationRoot = resolve(
    result.candidateRoot,
    'download',
    'effects',
    'plasma-pistol',
    'muzzle_flash',
  );
  await readFile(resolve(animationRoot, animation.sprite_sheet.path));
  await Promise.all(animation.frames.map((frame) => readFile(resolve(animationRoot, frame.path))));
  assert.equal((await readFile(resolve(fixture.productRoot, 'assets/items/plasma-pistol.png'))).toString(), 'canonical transparent weapon');

  const reused = await prepareVersionedPackageExtension({
    outputRoot: fixture.outputRoot,
    store: fixture.store,
    plan: fixture.plan,
    marketingBuilder: fixture.marketingBuilder,
  });
  assert.equal(reused.reused, true);
  assert.equal(reused.manifest.manifest_hash, result.manifest.manifest_hash);
});

test('requires exact approval of the base package before preparing an extension', async () => {
  const fixture = await createFixture({ approved: false });
  await assert.rejects(prepareVersionedPackageExtension({
    outputRoot: fixture.outputRoot,
    store: fixture.store,
    plan: fixture.plan,
    marketingBuilder: fixture.marketingBuilder,
  }), /exact base package must have a persisted approval/u);
});

test('inherits the base approval from a verified immutable candidate during a package-only rebuild', async () => {
  const fixture = await createFixture();
  const first = await prepareVersionedPackageExtension({
    outputRoot: fixture.outputRoot,
    store: fixture.store,
    plan: fixture.plan,
    marketingBuilder: fixture.marketingBuilder,
    now: '2026-10-15T12:00:00.000Z',
  });
  await write(resolve(fixture.productRoot, 'review', 'discord.json'), JSON.stringify({
    manifest_hash: first.manifest.manifest_hash,
    last_decision: null,
  }));

  const rebuilt = await prepareVersionedPackageExtension({
    outputRoot: fixture.outputRoot,
    store: fixture.store,
    plan: fixture.plan,
    marketingBuilder: fixture.marketingBuilder,
    buyerLicenseText: '# Updated review-ready license\n',
    now: '2026-10-15T13:00:00.000Z',
  });
  assert.equal(rebuilt.reused, false);
  assert.notEqual(rebuilt.candidateRoot, first.candidateRoot);
  assert.equal(rebuilt.manifest.gates.base_package_approved, true);
});
