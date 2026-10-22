import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';
import {
  alignEffectCoreToAnchor,
  createEnergyPulseFrame,
  createRadialEnergyPulseFrame,
  detectDynamicEnergyRegion,
  detectOpaqueObjectAnchor,
  generateInteractiveItemAnimationBatch,
  inspectPulseIsolation,
} from '../src/interactive-item-animation.mjs';
import {
  clearDenseShieldInterior,
  compositeItemFrame,
  createShieldIntegrityFrame,
} from '../src/interactive-item-states.mjs';
import { processPixelArtAsset } from '../src/image-processor.mjs';
import { InteractiveItemAnimationBatchSchema } from '../src/schemas.mjs';

async function itemSprite({ energyX, energyY }) {
  return sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    {
      input: Buffer.from('<svg width="52" height="38"><rect width="52" height="38" fill="#20283a"/></svg>'),
      left: 38,
      top: 50,
    },
    {
      input: Buffer.from('<svg width="10" height="8"><rect width="10" height="8" fill="#35d9ff"/></svg>'),
      left: energyX,
      top: energyY,
    },
  ]).png({ palette: true, colours: 32, dither: 0 }).toBuffer();
}

async function detonationSource() {
  const width = 64;
  const height = 64;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * 4;
      const effect = Math.hypot(x - 32, y - 32) < 13;
      data[offset] = effect ? 53 : 255;
      data[offset + 1] = effect ? 217 : 0;
      data[offset + 2] = 255;
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

function plan(items) {
  return {
    schema_version: '1.0',
    batch_id: 'interactive-items-test-v1',
    product_slug: 'target-product',
    title: 'Interactive items test',
    items,
    style: {
      medium: 'pixel_art',
      palette: ['#20283a', '#35d9ff', '#875cff'],
      energy_colors: ['#35d9ff', '#875cff'],
      energy_color_tolerance: 24,
      max_palette_colors: 32,
      chroma_key: '#ff00ff',
      source_width: 1024,
      source_height: 1024,
    },
  };
}

test('shield integrity damage adds distributed glass fractures and structural breaks', async () => {
  const base = await sharp({
    create: {
      width: 96,
      height: 96,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: Buffer.from('<svg width="96" height="96"><circle cx="48" cy="48" r="38" fill="none" stroke="#35d9ff" stroke-width="12"/></svg>'),
  }]).png().toBuffer();
  const half = await createShieldIntegrityFrame(base, 50, { seed: 45 });
  const low = await createShieldIntegrityFrame(base, 20, { seed: 45 });
  const [baseRaw, halfRaw, lowRaw] = await Promise.all([base, half, low].map((buffer) => (
    sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  )));
  const changedByQuadrant = (decoded, predicate) => {
    const counts = [0, 0, 0, 0];
    for (let y = 0; y < decoded.info.height; y += 1) {
      for (let x = 0; x < decoded.info.width; x += 1) {
        const offset = ((y * decoded.info.width) + x) * 4;
        if (!predicate(baseRaw.data[offset + 3], decoded.data[offset + 3])) continue;
        counts[(y >= 48 ? 2 : 0) + (x >= 48 ? 1 : 0)] += 1;
      }
    }
    return counts;
  };
  const addedAtLow = changedByQuadrant(lowRaw, (baseAlpha, resultAlpha) => baseAlpha === 0 && resultAlpha > 0);
  const removedAtLow = changedByQuadrant(lowRaw, (baseAlpha, resultAlpha) => baseAlpha > 0 && resultAlpha === 0);
  assert.equal(addedAtLow.every((count) => count > 0), true);
  assert.equal(removedAtLow.every((count) => count > 0), true);
  let halfRemoved = 0;
  let lowRemoved = 0;
  let halfSurviving = 0;
  let halfUnchanged = 0;
  for (let offset = 0; offset < lowRaw.data.length; offset += 4) {
    if (baseRaw.data[offset + 3] > 0 && halfRaw.data[offset + 3] === 0) halfRemoved += 1;
    if (baseRaw.data[offset + 3] > 0 && lowRaw.data[offset + 3] === 0) lowRemoved += 1;
    if (baseRaw.data[offset + 3] > 0 && halfRaw.data[offset + 3] > 0) {
      halfSurviving += 1;
      if (halfRaw.data[offset + 3] === baseRaw.data[offset + 3]) halfUnchanged += 1;
    }
  }
  assert.equal(halfRemoved > 0, true);
  assert.equal(lowRemoved > halfRemoved, true);
  assert.equal((halfUnchanged / halfSurviving) > 0.8, true);
});

test('shield normalization clears an opaque center without erasing thin lattice lines', async () => {
  const base = await sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: Buffer.from('<svg width="96" height="96"><circle cx="48" cy="48" r="40" fill="none" stroke="#35d9ff" stroke-width="5"/><circle cx="48" cy="48" r="9" fill="#6ab8d5"/><path d="M28 48H68" stroke="#35d9ff" stroke-width="1"/></svg>'),
  }]).png().toBuffer();
  const normalized = await clearDenseShieldInterior(base);
  const { data, info } = await sharp(normalized).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[((y * info.width) + x) * 4 + 3];

  assert.equal(alphaAt(48, 48), 0);
  assert.equal(alphaAt(28, 48) > 0, true);
  assert.equal(alphaAt(48, 8) > 0, true);
});

function canonicalProduct(slug, assets) {
  return {
    schema_version: '1.0',
    product_id: `product-${slug}`,
    opportunity_id: `OPPORTUNITY-${slug}`,
    slug,
    title: slug,
    version: '0.1.0',
    status: 'awaiting_asset_review',
    category: 'Pixel art',
    product_type: 'Test fixture',
    theme: 'Test fixture theme',
    target_audience: ['testers'],
    style: {
      medium: 'pixel_art',
      perspective: 'fixed',
      width: 128,
      height: 128,
      max_palette_colors: 32,
      palette: ['#20283a', '#35d9ff'],
      outline: 'one pixel',
      lighting: 'neutral',
      background: 'transparent',
      chroma_key: '#ff00ff',
    },
    assets,
    pricing: {
      base_price: { amount: 0, currency: 'EUR' },
      marketplace_prices: {},
      human_approval_required: true,
    },
    distribution: { marketplaces: ['itch.io'], status: 'not_started' },
    license: { status: 'draft', redistribution_of_raw_assets: false },
    generation_provider: { provider: 'ollama', model: 'fixture', estimated_cost: 0, execution: 'local' },
    approvals: { generation: 'approved', distribution: 'pending' },
    created_at: '2026-10-18T00:00:00.000Z',
    updated_at: '2026-10-18T00:00:00.000Z',
  };
}

test('dynamic energy detection follows differently positioned item cores', async () => {
  const high = await detectDynamicEnergyRegion(await itemSprite({ energyX: 48, energyY: 54 }), {
    colors: ['#35d9ff'],
    tolerance: 12,
  });
  const low = await detectDynamicEnergyRegion(await itemSprite({ energyX: 70, energyY: 76 }), {
    colors: ['#35d9ff'],
    tolerance: 12,
  });
  assert.deepEqual(high.report.centroid, { x: 53, y: 58 });
  assert.deepEqual(low.report.centroid, { x: 75, y: 80 });
  assert.equal(high.report.strategy, 'palette_connected_components');
  assert.equal(high.report.matched_pixels, 80);
});

test('energy pulse changes only dynamically detected pixels', async () => {
  const base = await itemSprite({ energyX: 60, energyY: 70 });
  const detection = await detectDynamicEnergyRegion(base, { colors: ['#35d9ff'], tolerance: 12 });
  const pulse = await createEnergyPulseFrame(base, detection, 0.7);
  const isolation = await inspectPulseIsolation(base, pulse.compositeBuffer, detection.mask);
  assert.equal(isolation.passed, true);
  assert.equal(isolation.changed_pixels, 80);
  assert.equal(isolation.outside_region_changes, 0);
});

test('radial shield pulse travels from inner lattice to outer rim', async () => {
  const base = await sharp({
    create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{
    input: Buffer.from('<svg width="96" height="96"><g fill="none" stroke="#35d9ff" stroke-width="3"><circle cx="48" cy="48" r="12"/><circle cx="48" cy="48" r="24"/><circle cx="48" cy="48" r="38"/></g></svg>'),
  }]).png().toBuffer();
  const detection = await detectDynamicEnergyRegion(base, {
    colors: ['#35d9ff'], tolerance: 72, alphaThreshold: 1,
  });
  const inner = await createRadialEnergyPulseFrame(base, detection, 0.3);
  const outer = await createRadialEnergyPulseFrame(base, detection, 0.92);
  const changedRadius = async (buffer) => {
    const [source, result] = await Promise.all([base, buffer].map((value) => (
      sharp(value).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    )));
    const radii = [];
    for (let y = 0; y < result.info.height; y += 1) {
      for (let x = 0; x < result.info.width; x += 1) {
        const offset = ((y * result.info.width) + x) * 4;
        if (source.data[offset] === result.data[offset]
          && source.data[offset + 1] === result.data[offset + 1]
          && source.data[offset + 2] === result.data[offset + 2]) continue;
        radii.push(Math.hypot(x - 48, y - 48));
      }
    }
    return radii.reduce((total, value) => total + value, 0) / radii.length;
  };
  assert.equal(await changedRadius(outer.compositeBuffer) > await changedRadius(inner.compositeBuffer), true);
  assert.equal((await inspectPulseIsolation(base, inner.compositeBuffer, detection.mask)).passed, true);
  assert.equal((await inspectPulseIsolation(base, outer.compositeBuffer, detection.mask)).passed, true);
});

test('explosive object anchor follows the opaque sprite bounds rather than an off-center energy window', async () => {
  const base = await itemSprite({ energyX: 70, energyY: 76 });
  const origin = await detectOpaqueObjectAnchor(base);
  assert.deepEqual(origin.bounds, { x: 38, y: 50, width: 52, height: 38 });
  assert.deepEqual(origin.anchor, { x: 64, y: 69 });
  assert.equal(origin.strategy, 'opaque_bounds_center');
});

test('effect alignment moves an asymmetric energy core onto the detected item anchor', async () => {
  const effect = await sharp({
    create: {
      width: 128,
      height: 128,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([
    {
      input: Buffer.from('<svg width="18" height="12"><rect x="0" y="3" width="18" height="6" fill="#875cff"/><rect x="2" y="1" width="8" height="10" fill="#35d9ff"/></svg>'),
      left: 72,
      top: 42,
    },
  ]).png({ palette: true, colours: 32, dither: 0 }).toBuffer();
  const aligned = await alignEffectCoreToAnchor(effect, {
    colors: ['#35d9ff'],
    tolerance: 12,
    target: { x: 55, y: 61 },
    maxPaletteColors: 32,
  });
  assert.equal(aligned.report.passed, true);
  assert.deepEqual(aligned.report.aligned_origin, { x: 55, y: 61 });
  assert.deepEqual(aligned.report.translation, { x: -23, y: 13 });
  assert.equal(aligned.report.clipped_pixels, 0);
});

test('composited item frames retain the configured pixel-art palette cap', async () => {
  const width = 16;
  const height = 16;
  const layer = (offset) => {
    const data = Buffer.alloc(width * height * 4);
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const channel = pixel * 4;
      data[channel] = (pixel * 17 + offset) % 256;
      data[channel + 1] = (pixel * 31 + offset) % 256;
      data[channel + 2] = (pixel * 47 + offset) % 256;
      data[channel + 3] = pixel % 3 === 0 ? 0 : 255;
    }
    return sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  };
  const composite = await compositeItemFrame(await layer(0), [await layer(29)], {
    maxPaletteColors: 32,
  });
  const { data, info } = await sharp(composite).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colors = new Set();
  for (let pixel = 0; pixel < info.width * info.height; pixel += 1) {
    const channel = pixel * info.channels;
    colors.add(`${data[channel]},${data[channel + 1]},${data[channel + 2]},${data[channel + 3]}`);
  }
  assert.equal(colors.size <= 32, true);
});

test('palette-only alpha extraction removes opaque shield interiors', async () => {
  const source = await sharp({
    create: { width: 64, height: 64, channels: 4, background: '#ff00ff' },
  }).composite([{
    input: Buffer.from('<svg width="48" height="48"><circle cx="24" cy="24" r="23" fill="#44506b" stroke="#35d9ff" stroke-width="3"/><path d="M8 24h32" stroke="#c8d4ec" stroke-width="2"/></svg>'),
    left: 8,
    top: 8,
  }]).png().toBuffer();
  const processed = await processPixelArtAsset(source, {
    width: 128,
    height: 128,
    maxPaletteColors: 32,
    chromaKey: '#ff00ff',
    chromaTolerance: 20,
    alphaMode: 'palette_only',
    alphaPalette: ['#35d9ff', '#c8d4ec'],
    alphaTolerance: 24,
  });
  const decoded = await sharp(processed.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const centerAlpha = decoded.data[(((64 * decoded.info.width) + 64) * 4) + 3];
  assert.equal(centerAlpha, 255);
  const interiorAlpha = decoded.data[(((48 * decoded.info.width) + 64) * 4) + 3];
  assert.equal(interiorAlpha, 0);
  assert.equal(processed.alpha_mode, 'palette_only');
  assert.equal(processed.removed_non_palette_pixels > 0, true);
});

test('interactive item batch schema rejects duplicate target assets', () => {
  const item = {
    source_product_slug: 'source-product',
    source_asset_key: 'grenade-source',
    target_asset_key: 'plasma-grenade',
    name: 'Plasma Grenade',
    recipe: 'grenade',
    seed: 42,
    detonation_description: 'Compact cyan plasma detonation.',
  };
  assert.throws(() => InteractiveItemAnimationBatchSchema.parse(plan([item, item])), /Duplicate interactive item target/u);
});

test('batch emits complete fixed-anchor buyer runtime files without regenerating bases', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-interactive-items-'));
  const targetRoot = resolve(outputRoot, 'target-product');
  const sourceRoots = {
    'source-grenade': resolve(targetRoot, 'experiments/source-grenade'),
    'source-mine': resolve(targetRoot, 'experiments/source-mine'),
    'source-cell': resolve(targetRoot, 'experiments/source-cell'),
    'source-shield': resolve(targetRoot, 'experiments/source-shield'),
    'source-wand': resolve(targetRoot, 'experiments/source-wand'),
    'source-potion': resolve(targetRoot, 'experiments/source-potion'),
    'target-product': targetRoot,
  };
  const products = {
    'target-product': { slug: 'target-product', assets: [] },
  };
  const sourceProducts = {
    'source-grenade': canonicalProduct('source-grenade', [{
      asset_id: 'asset-grenade-source',
      asset_key: 'grenade-source',
      name: 'Grenade',
      kind: 'grenade',
      description: 'A grenade.',
      generation_prompt: 'Generate a grenade.',
      seed: 1,
      status: 'generated',
      source_path: 'assets/source/grenade-source.png',
      final_path: 'assets/items/grenade-source.png',
      validation_path: 'validation/grenade-source.json',
    }]),
    'source-mine': canonicalProduct('source-mine', [{
      asset_id: 'asset-mine-source',
      asset_key: 'mine-source',
      name: 'Mine',
      kind: 'deployable',
      description: 'A mine.',
      generation_prompt: 'Generate a mine.',
      seed: 2,
      status: 'generated',
      source_path: 'assets/source/mine-source.png',
      final_path: 'assets/items/mine-source.png',
      validation_path: 'validation/mine-source.json',
    }]),
    'source-cell': canonicalProduct('source-cell', [{
      asset_id: 'asset-cell-source',
      asset_key: 'cell-source',
      name: 'Power Cell',
      kind: 'consumable',
      description: 'A power cell.',
      generation_prompt: 'Generate a power cell.',
      seed: 3,
      status: 'generated',
      source_path: 'assets/source/cell-source.png',
      final_path: 'assets/items/cell-source.png',
      validation_path: 'validation/cell-source.json',
    }]),
    'source-shield': canonicalProduct('source-shield', [{
      asset_id: 'asset-shield-source',
      asset_key: 'shield-source',
      name: 'Shield Emitter',
      kind: 'deployable',
      description: 'A shield emitter.',
      generation_prompt: 'Generate a shield emitter.',
      seed: 4,
      status: 'generated',
      source_path: 'assets/source/shield-source.png',
      final_path: 'assets/items/shield-source.png',
      validation_path: 'validation/shield-source.json',
    }]),
    'source-wand': canonicalProduct('source-wand', [{
      asset_id: 'asset-wand-source',
      asset_key: 'wand-source',
      name: 'Wand',
      kind: 'focus',
      description: 'An enchanted wand.',
      generation_prompt: 'Generate an enchanted wand.',
      seed: 5,
      status: 'generated',
      source_path: 'assets/source/wand-source.png',
      final_path: 'assets/items/wand-source.png',
      validation_path: 'validation/wand-source.json',
    }]),
    'source-potion': canonicalProduct('source-potion', [{
      asset_id: 'asset-potion-source',
      asset_key: 'potion-source',
      name: 'Potion',
      kind: 'potion',
      description: 'A magic potion.',
      generation_prompt: 'Generate a magic potion.',
      seed: 6,
      status: 'generated',
      source_path: 'assets/source/potion-source.png',
      final_path: 'assets/items/potion-source.png',
      validation_path: 'validation/potion-source.json',
    }]),
  };
  const grenade = await itemSprite({ energyX: 54, energyY: 58 });
  const mine = await itemSprite({ energyX: 70, energyY: 74 });
  const cell = await itemSprite({ energyX: 62, energyY: 58 });
  const shield = await itemSprite({ energyX: 58, energyY: 54 });
  const wand = await itemSprite({ energyX: 74, energyY: 54 });
  const potion = await itemSprite({ energyX: 58, energyY: 66 });
  const sourcePaths = [
    [resolve(sourceRoots['source-grenade'], 'assets/items/grenade-source.png'), grenade],
    [resolve(sourceRoots['source-mine'], 'assets/items/mine-source.png'), mine],
    [resolve(sourceRoots['source-cell'], 'assets/items/cell-source.png'), cell],
    [resolve(sourceRoots['source-shield'], 'assets/items/shield-source.png'), shield],
    [resolve(sourceRoots['source-wand'], 'assets/items/wand-source.png'), wand],
    [resolve(sourceRoots['source-potion'], 'assets/items/potion-source.png'), potion],
  ];
  for (const [path, buffer] of sourcePaths) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buffer);
  }
  for (const [slug, product] of Object.entries(sourceProducts)) {
    await writeFile(resolve(sourceRoots[slug], 'product.json'), `${JSON.stringify(product, null, 2)}\n`);
  }
  const batchPlan = plan([
    {
      source_product_slug: 'source-grenade',
      source_asset_key: 'grenade-source',
      target_asset_key: 'plasma-grenade',
      name: 'Plasma Grenade',
      recipe: 'grenade',
      seed: 42,
      detonation_description: 'Compact cyan plasma detonation.',
    },
    {
      source_product_slug: 'source-mine',
      source_asset_key: 'mine-source',
      target_asset_key: 'plasma-mine',
      name: 'Plasma Mine',
      recipe: 'proximity_mine',
      seed: 43,
      detonation_description: 'Broad cyan plasma detonation.',
    },
    {
      source_product_slug: 'source-cell',
      source_asset_key: 'cell-source',
      target_asset_key: 'plasma-cell',
      name: 'Plasma Cell',
      recipe: 'power_cell',
      seed: 44,
    },
    {
      source_product_slug: 'source-shield',
      source_asset_key: 'shield-source',
      target_asset_key: 'plasma-shield',
      name: 'Plasma Shield',
      recipe: 'plasma_shield',
      seed: 45,
      impact_description: 'Cracked shield surface.',
      break_description: 'Scattering shield fragments.',
    },
    {
      source_product_slug: 'source-wand',
      source_asset_key: 'wand-source',
      target_asset_key: 'enchanted-wand',
      name: 'Enchanted Wand',
      recipe: 'wand',
      seed: 46,
      release_description: 'Compact cyan and violet spark burst from the wand tip.',
    },
    {
      source_product_slug: 'source-potion',
      source_asset_key: 'potion-source',
      target_asset_key: 'mana-potion',
      name: 'Mana Potion',
      recipe: 'potion',
      seed: 47,
      break_description: 'Compact magical glass and liquid release.',
    },
  ]);
  let generationCalls = 0;
  const result = await generateInteractiveItemAnimationBatch({
    config: {
      validation: { minimum_transparent_ratio: 0.1 },
      generation: { endpoint: 'http://127.0.0.1:11434', model: 'fixture', chroma_tolerance: 20 },
    },
    plan: batchPlan,
    outputRoot,
    projectRoot: outputRoot,
    store: {
      async loadProduct(slug) {
        if (products[slug]) return products[slug];
        const error = new Error('missing canonical product');
        error.code = 'ENOENT';
        throw error;
      },
      productRoot(product) { return sourceRoots[product.slug]; },
    },
    adapter: {
      async checkReadiness() { return { status: 'ready' }; },
      async generateAsset({ asset }) {
        generationCalls += 1;
        return {
          buffer: await detonationSource(),
          format: 'png',
          provider: 'fixture',
          model: 'fixture',
          seed: asset.seed,
          estimated_cost: 0,
        };
      },
    },
    async fetchImpl() {
      return { ok: true, async json() { return { models: [] }; } };
    },
    async gifWriter({ outputPath }) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, 'GIF89a');
      return outputPath;
    },
  });

  assert.equal(generationCalls, 6);
  assert.equal(result.manifest.generation_calls, 6);
  assert.equal(result.manifest.gates.all_items_valid, true);
  assert.equal(result.manifest.gates.package_modified, false);
  assert.equal(result.results.every((item) => item.manifest.base_regenerated === false), true);
  assert.equal(result.results.every((item) => item.manifest.item.source_layout === 'product_experiment'), true);
  assert.equal(result.results.every((item) => item.validation.root_motion.passed), true);
  const animation = JSON.parse(await readFile(
    resolve(result.batchRoot, 'plasma-grenade/metadata/armed-loop/animation.json'),
    'utf8',
  ));
  assert.deepEqual(animation.root_motion, { x: 0, y: 0 });
  assert.equal(animation.frames.length, 4);
  assert.equal(animation.frames.every((frame) => frame.overlay_path.endsWith('.png')), true);
  assert.equal((await readFile(resolve(result.batchRoot, 'plasma-grenade/base.png'))).equals(grenade), true);
  const cellManifest = JSON.parse(await readFile(resolve(result.batchRoot, 'plasma-cell/manifest.json'), 'utf8'));
  assert.deepEqual(cellManifest.states, ['empty', 'low', 'full', 'overcharged']);
  assert.deepEqual(cellManifest.animations, ['charging-loop']);
  assert.equal(cellManifest.generation_calls, 0);
  assert.equal((await readFile(resolve(result.batchRoot, 'plasma-cell/states/full.png'))).equals(cell), true);
  assert.equal((await readFile(resolve(result.batchRoot, 'plasma-cell/previews/states.png'))).length > 0, true);
  const shieldManifest = JSON.parse(await readFile(resolve(result.batchRoot, 'plasma-shield/manifest.json'), 'utf8'));
  assert.deepEqual(shieldManifest.states, [
    'integrity-100', 'integrity-90', 'integrity-80', 'integrity-70', 'integrity-60',
    'integrity-50', 'integrity-40', 'integrity-30', 'integrity-20', 'integrity-10', 'broken',
  ]);
  assert.deepEqual(shieldManifest.animations, [
    'power-up', 'active-loop', 'shield-hit', 'integrity-decay', 'shield-break', 'power-down',
  ]);
  assert.equal(shieldManifest.generation_calls, 2);
  const wandManifest = JSON.parse(await readFile(resolve(result.batchRoot, 'enchanted-wand/manifest.json'), 'utf8'));
  assert.deepEqual(wandManifest.animations, ['charge-release']);
  assert.equal(wandManifest.generation_calls, 1);
  assert.equal(wandManifest.base_regenerated, false);
  const potionManifest = JSON.parse(await readFile(resolve(result.batchRoot, 'mana-potion/manifest.json'), 'utf8'));
  assert.deepEqual(potionManifest.states, ['sealed', 'broken', 'consumed']);
  assert.deepEqual(potionManifest.animations, ['idle-loop', 'consume-break']);
  assert.equal(potionManifest.generation_calls, 1);
});
