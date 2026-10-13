import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadEngineConfig } from '../src/config.mjs';
import { packageDigitalAssetPreview } from '../src/packager.mjs';
import { generateDigitalAssetProduct, planDigitalAssetProduct } from '../src/pipeline.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function loadFixture() {
  return JSON.parse(await readFile(
    resolve(projectRoot, 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
}

async function loadConfig(outputRoot) {
  return loadEngineConfig(
    'services/digital-asset-engine/config.example.json',
    projectRoot,
    { output_root: outputRoot },
  );
}

async function syntheticSourceImage() {
  const width = 64;
  const height = 64;
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = ((y * width) + x) * channels;
      const objectPixel = x >= 10 && x <= 53 && y >= 24 && y <= 39;
      data[offset] = objectPixel ? 53 : 217;
      data[offset + 1] = objectPixel ? 217 : 22;
      data[offset + 2] = objectPixel ? 255 : 145;
      data[offset + 3] = 255;
    }
  }
  return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

test('planning validates an opportunity and writes a canonical product', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-digital-assets-plan-'));
  const config = await loadConfig(outputRoot);
  const opportunity = await loadFixture();
  const result = await planDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot,
    now: '2026-10-12T12:00:00.000Z',
  });

  assert.equal(result.validation.decision, 'approved_for_manual_generation');
  assert.equal(result.product.status, 'planned');
  assert.equal(result.product.generation_provider.estimated_cost, 0);
  assert.equal(result.product.approvals.distribution, 'pending');
  const stored = JSON.parse(await readFile(result.persistence.manifestPath, 'utf8'));
  assert.deepEqual(stored, result.product);
});

test('pipeline produces a transparent, validated candidate while blocking distribution', async () => {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-digital-assets-generate-'));
  const config = await loadConfig(outputRoot);
  const opportunity = await loadFixture();
  const source = await syntheticSourceImage();
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

  const result = await generateDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot: outputRoot,
    adapter,
    now: '2026-10-12T12:00:00.000Z',
    async fetchImpl(url) {
      assert.match(url, /\/api\/ps$/u);
      return { ok: true, async json() { return { models: [] }; } };
    },
  });

  assert.equal(result.product.status, 'awaiting_asset_review');
  assert.equal(result.generation[0].status, 'passed');
  assert.equal(result.generation[0].validation.metrics.width, 128);
  assert.equal(result.generation[0].validation.metrics.height, 64);
  assert.ok(result.generation[0].validation.metrics.transparent_ratio >= 0.1);
  assert.equal(result.generation[0].validation.metrics.chroma_pixels, 0);
  assert.equal(result.gates.all_assets_valid, true);
  assert.equal(result.gates.human_review_required, true);
  assert.equal(result.gates.distribution_ready, false);
  assert.equal(result.cost.incurred, 0);
  assert.equal(generationCalls, 1);

  const resumed = await generateDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot: outputRoot,
    adapter,
    now: '2026-10-12T12:05:00.000Z',
    async fetchImpl() {
      return { ok: true, async json() { return { models: [] }; } };
    },
  });
  assert.equal(generationCalls, 1);
  assert.equal(resumed.generation[0].resumed, true);

  const packaged = await packageDigitalAssetPreview({
    outputRoot,
    slug: result.product.slug,
    now: '2026-10-12T12:10:00.000Z',
  });
  const coverMetadata = await sharp(packaged.coverPath).metadata();
  const storedManifest = JSON.parse(await readFile(packaged.manifestPath, 'utf8'));
  assert.equal(coverMetadata.width, 630);
  assert.equal(coverMetadata.height, 500);
  assert.equal(storedManifest.asset_count, 1);
  assert.equal(storedManifest.release_state, 'internal_preview');
  assert.equal(storedManifest.distribution_ready, false);
  assert.match(storedManifest.manifest_hash, /^[a-f0-9]{64}$/u);
  assert.equal(storedManifest.files.some((file) => file.path.startsWith('assets/source/')), false);
});
