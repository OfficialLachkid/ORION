import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadEngineConfig } from '../src/config.mjs';
import {
  assembleEffectSpriteSheet,
  composeProjectileTravelPreviewFrames,
  detectWeaponMuzzleAnchor,
  generateEffectPilot,
  writeAnimatedGifPreview,
} from '../src/effect-pilot.mjs';
import { inspectAnchorContact, processPixelArtEffectFrame } from '../src/image-processor.mjs';
import { planDigitalAssetProduct } from '../src/pipeline.mjs';
import { EffectPilotSchema } from '../src/schemas.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function readFixture(path) {
  return JSON.parse(await readFile(resolve(projectRoot, path), 'utf8'));
}

async function syntheticEffectSource() {
  const width = 64;
  const height = 64;
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * channels;
      const effectPixel = x >= 8 && x <= 55 && y >= 27 && y <= 36;
      data[offset] = effectPixel ? 53 : 0;
      data[offset + 1] = effectPixel ? 217 : 255;
      data[offset + 2] = effectPixel ? 255 : 0;
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function syntheticSmallAnchorGapSource() {
  const width = 64;
  const height = 64;
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * channels;
      const mainEffect = x >= 20 && x <= 55 && y >= 20 && y <= 34;
      const anchorSpark = x === 8 && y === 10;
      const effectPixel = mainEffect || anchorSpark;
      data[offset] = effectPixel ? 53 : 0;
      data[offset + 1] = effectPixel ? 217 : 255;
      data[offset + 2] = effectPixel ? 255 : 0;
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function prepareCanonicalProduct(outputRoot) {
  const opportunity = await readFixture('services/digital-asset-engine/fixtures/neon-plasma-armory.opportunity.json');
  const config = await loadEngineConfig(
    'services/digital-asset-engine/config.example.json',
    projectRoot,
    { output_root: outputRoot },
  );
  const planned = await planDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot,
    now: '2026-10-15T12:00:00.000Z',
  });
  const weaponPath = resolve(planned.persistence.root, 'assets/items/arc-launcher.png');
  await mkdir(dirname(weaponPath), { recursive: true });
  await sharp({
    create: {
      width: 128,
      height: 64,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{
    input: Buffer.from('<svg width="112" height="24"><rect width="112" height="24" fill="#35d9ff"/></svg>'),
    left: 8,
    top: 20,
  }]).png().toFile(weaponPath);
  const product = {
    ...planned.product,
    status: 'awaiting_asset_review',
    assets: planned.product.assets.map((asset) => asset.asset_key === 'arc-launcher'
      ? { ...asset, status: 'generated', final_path: 'assets/items/arc-launcher.png' }
      : asset),
  };
  await planned.store.saveProduct(product);
  return { config, product, productPath: resolve(planned.persistence.root, 'product.json') };
}

test('effect frame processing preserves a fixed west-center origin on a transparent canvas', async () => {
  const processed = await processPixelArtEffectFrame(await syntheticEffectSource(), {
    width: 64,
    height: 64,
    padding: 4,
    placement: 'west_center',
    maxPaletteColors: 32,
    chromaKey: '#00ff00',
    chromaTolerance: 105,
    origin: { x: 4, y: 32 },
    maximumOriginGap: 16,
  });
  const metadata = await sharp(processed.buffer).metadata();
  const contact = await inspectAnchorContact(processed.buffer, { x: 4, y: 32 }, 8);
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(processed.placed_bounds.left, 4);
  assert.equal(contact.passed, true);
  assert.equal(processed.anchor_correction, null);
});

test('effect frame processing bridges a small model-made muzzle-origin gap', async () => {
  const origin = { x: 4, y: 32 };
  const processed = await processPixelArtEffectFrame(await syntheticSmallAnchorGapSource(), {
    width: 64,
    height: 64,
    padding: 4,
    placement: 'west_center',
    maxPaletteColors: 32,
    chromaKey: '#00ff00',
    chromaTolerance: 105,
    origin,
    maximumOriginGap: 16,
  });
  assert.equal(processed.anchor_correction.applied, true);
  assert.equal((await inspectAnchorContact(processed.buffer, origin, 0)).passed, true);
});

test('sprite-sheet assembly uses transparent gutters and non-overlapping frame rectangles', async () => {
  const frame = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#35d9ff' },
  }).png().toBuffer();
  const effect = { canvas: { width: 16, height: 16 } };
  const sheet = await assembleEffectSpriteSheet([frame, frame, frame], effect, { gutter: 4 });
  const metadata = await sharp(sheet.buffer).metadata();
  assert.equal(metadata.width, 56);
  assert.deepEqual(sheet.frames.map((item) => item.x), [0, 20, 40]);
  const gutterPixel = await sharp(sheet.buffer).ensureAlpha().raw().toBuffer();
  assert.equal(gutterPixel[((0 * 56 + 17) * 4) + 3], 0);
});

test('GIF preview assembly preserves frame delays and uses a transparency palette', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orion-effect-gif-test-'));
  const framePaths = [join(root, '00.png'), join(root, '01.png')];
  await Promise.all(framePaths.map((path) => writeFile(path, 'fixture')));
  const outputPath = join(root, 'preview.gif');
  let invocation;
  await writeAnimatedGifPreview({
    framePaths,
    delays: [70, 110],
    outputPath,
    ffmpegExecutable: '/fixture/ffmpeg',
    async runProcess(options) {
      invocation = options;
      await writeFile(outputPath, 'gif');
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(invocation.executable, '/fixture/ffmpeg');
  assert.equal(invocation.args.filter((value) => value === '-framerate').length, 2);
  assert.equal(invocation.args.includes('0.070'), true);
  assert.equal(invocation.args.includes('0.110'), true);
  assert.equal(invocation.args.includes('11'), true);
  assert.equal(invocation.args.some((value) => String(value).includes('concat=n=2')), true);
  assert.equal(invocation.args.some((value) => String(value).includes('mpdecimate')), true);
  assert.equal(invocation.args.some((value) => String(value).includes('reserve_transparent=1')), true);
  assert.equal(await readFile(outputPath, 'utf8'), 'gif');
});

test('projectile travel preview keeps the weapon fixed and moves only the preview projectile', async () => {
  const weaponBuffer = await sharp({
    create: { width: 16, height: 8, channels: 4, background: '#204060' },
  }).png().toBuffer();
  const projectileBuffer = await sharp({
    create: { width: 4, height: 2, channels: 4, background: '#ff0000' },
  }).png().toBuffer();
  const pilot = {
    weapon_preview: {
      weapon_position: { x: 2, y: 4 },
      muzzle_anchor: { x: 16, y: 4 },
      projectile_travel_preview: {
        canvas: { width: 48, height: 16 },
        start_gap_px: 0,
        end_margin_right_px: 0,
        frame_count: 3,
        frame_duration_ms: 70,
      },
    },
  };
  const frames = await composeProjectileTravelPreviewFrames({
    weaponBuffer,
    projectileBuffer,
    pilot,
    effect: { origin: { x: 2, y: 1 } },
  });
  assert.equal(frames.length, 3);

  async function redPixelBounds(buffer) {
    const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const xs = [];
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const offset = ((y * info.width) + x) * 4;
        if (data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 0) xs.push(x);
      }
    }
    return { left: Math.min(...xs), right: Math.max(...xs) };
  }

  assert.deepEqual(await redPixelBounds(frames[0]), { left: 18, right: 21 });
  assert.deepEqual(await redPixelBounds(frames[2]), { left: 44, right: 47 });
});

test('muzzle detection follows the terminal barrel pixels at different vertical positions', async () => {
  async function weaponAt(top, height) {
    return sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    }).composite([{
      input: Buffer.from(`<svg width="20" height="${height}"><rect width="20" height="${height}" fill="#35d9ff"/></svg>`),
      left: 4,
      top,
    }]).png().toBuffer();
  }

  const highBarrel = await detectWeaponMuzzleAnchor(await weaponAt(4, 6));
  const lowBarrel = await detectWeaponMuzzleAnchor(await weaponAt(18, 10));
  assert.deepEqual(highBarrel.anchor, { x: 24, y: 7 });
  assert.deepEqual(lowBarrel.anchor, { x: 24, y: 23 });
  assert.equal(highBarrel.detection.strategy, 'rightmost_opaque');
  assert.deepEqual(highBarrel.detection.selected_run, {
    min_y: 4,
    max_y: 9,
    opaque_pixels: 24,
  });
});

test('boundary weapon effect specifications validate independently', async () => {
  const fixtures = [
    'services/digital-asset-engine/fixtures/plasma-pistol-effects.pilot.json',
    'services/digital-asset-engine/fixtures/ion-cannon-effects.pilot.json',
  ];
  const pilots = await Promise.all(fixtures.map(async (path) => (
    EffectPilotSchema.parse(await readFixture(path))
  )));
  assert.deepEqual(pilots.map((pilot) => pilot.source_asset_key), [
    'plasma-pistol',
    'ion-cannon',
  ]);
  assert.equal(new Set(pilots.flatMap((pilot) => pilot.effects.map((effect) => (
    effect.effect_key
  )))).size, 6);
});

test('effects pilot creates review-only proofs and leaves the canonical product unchanged', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-effect-pilot-'));
  const { config, productPath } = await prepareCanonicalProduct(outputRoot);
  const pilot = EffectPilotSchema.parse(await readFixture(
    'services/digital-asset-engine/fixtures/arc-launcher-effects-v2.pilot.json',
  ));
  const productBefore = await readFile(productPath, 'utf8');
  const source = await syntheticEffectSource();
  let generationCalls = 0;
  const adapter = {
    async checkReadiness() { return { status: 'ready', detail: 'fixture ready' }; },
    async generateAsset({ asset }) {
      generationCalls += 1;
      return {
        buffer: source,
        format: 'png',
        provider: 'ollama',
        model: config.generation.model,
        seed: asset.seed,
        estimated_cost: 0,
      };
    },
  };
  const gifWriter = async ({ outputPath }) => {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#35d9ff' },
    }).gif().toBuffer());
    return outputPath;
  };
  const generationOptions = {
    config,
    pilot,
    outputRoot,
    projectRoot: outputRoot,
    adapter,
    gifWriter,
    now: '2026-10-15T12:05:00.000Z',
    async fetchImpl(url) {
      assert.match(url, /\/api\/ps$/u);
      return { ok: true, async json() { return { models: [] }; } };
    },
  };

  const result = await generateEffectPilot(generationOptions);
  assert.equal(generationCalls, 3);
  assert.equal(result.effects.length, 3);
  assert.equal(result.manifest.status, 'awaiting_effects_review');
  assert.equal(result.manifest.canonical_release_mutated, false);
  assert.equal(result.manifest.marketplace_listing_mutated, false);
  assert.equal(result.manifest.gif_role, 'preview_only');
  assert.deepEqual(result.manifest.source_weapon_muzzle_anchor, { x: 120, y: 32 });
  assert.equal(result.manifest.source_weapon_muzzle_anchor_detection.strategy, 'rightmost_opaque');
  assert.deepEqual(result.manifest.buyer_runtime_formats, [
    'transparent_png_frames',
    'transparent_png_sprite_sheet',
    'animation_json',
  ]);
  assert.equal(result.composite_preview_path, 'previews/arc-launcher-composite.gif');
  assert.equal(
    result.projectile_travel_preview_path,
    'previews/arc-launcher-projectile-travel.gif',
  );
  assert.equal(result.manifest.projectile_travel_role, 'preview_only');
  assert.equal(result.timing.derived_frames, 6);
  assert.equal(await readFile(productPath, 'utf8'), productBefore);

  const muzzleSheet = await sharp(resolve(result.experimentRoot, 'sheets/arc-muzzle-flash.png')).metadata();
  assert.equal(muzzleSheet.width, 268);
  assert.equal(muzzleSheet.height, 64);
  const animation = JSON.parse(await readFile(
    resolve(result.experimentRoot, 'metadata/arc-muzzle-flash/animation.json'),
    'utf8',
  ));
  assert.deepEqual(animation.root_motion, { x: 0, y: 0 });
  assert.equal(animation.playback, 'once');
  assert.equal(animation.frames.length, 4);
  assert.deepEqual(animation.preview_only, ['preview_gif']);
  assert.match(result.manifest.manifest_hash, /^[a-f0-9]{64}$/u);

  const resumed = await generateEffectPilot(generationOptions);
  assert.equal(generationCalls, 3);
  assert.equal(resumed.timing.generation_calls, 0);
  assert.equal(resumed.timing.resumed_frames, 9);
  assert.equal(resumed.timing.runs.length, 2);
  assert.equal(resumed.timing.runs[0].generation_calls, 3);
});
