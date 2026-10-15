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
  });
  const metadata = await sharp(processed.buffer).metadata();
  const contact = await inspectAnchorContact(processed.buffer, { x: 4, y: 32 }, 8);
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);
  assert.equal(metadata.hasAlpha, true);
  assert.equal(processed.placed_bounds.left, 4);
  assert.equal(contact.passed, true);
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
      invocation = {
        ...options,
        concat: await readFile(options.args[options.args.indexOf('-i') + 1], 'utf8'),
      };
      await writeFile(outputPath, 'gif');
      return { code: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(invocation.executable, '/fixture/ffmpeg');
  assert.match(invocation.concat, /duration 0\.070/u);
  assert.match(invocation.concat, /duration 0\.110/u);
  assert.equal(invocation.args.some((value) => String(value).includes('reserve_transparent=1')), true);
  assert.equal(await readFile(outputPath, 'utf8'), 'gif');
});

test('effects pilot creates review-only proofs and leaves the canonical product unchanged', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-effect-pilot-'));
  const { config, productPath } = await prepareCanonicalProduct(outputRoot);
  const pilot = EffectPilotSchema.parse(await readFixture(
    'services/digital-asset-engine/fixtures/arc-launcher-effects.pilot.json',
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
  assert.equal(generationCalls, 9);
  assert.equal(result.effects.length, 3);
  assert.equal(result.manifest.status, 'awaiting_effects_review');
  assert.equal(result.manifest.canonical_release_mutated, false);
  assert.equal(result.manifest.marketplace_listing_mutated, false);
  assert.equal(result.manifest.gif_role, 'preview_only');
  assert.deepEqual(result.manifest.source_weapon_muzzle_anchor, { x: 120, y: 31 });
  assert.deepEqual(result.manifest.buyer_runtime_formats, [
    'transparent_png_frames',
    'transparent_png_sprite_sheet',
    'animation_json',
  ]);
  assert.equal(result.composite_preview_path, 'previews/arc-launcher-composite.gif');
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
  assert.equal(generationCalls, 9);
  assert.equal(resumed.timing.generation_calls, 0);
  assert.equal(resumed.timing.resumed_frames, 9);
});
