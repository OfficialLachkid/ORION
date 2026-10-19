import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { validateGeneratedAsset } from '../src/asset-validator.mjs';
import { loadEngineConfig } from '../src/config.mjs';
import { validateOpportunity } from '../src/opportunity-validator.mjs';
import { OllamaImageAdapter } from '../src/ollama-image-adapter.mjs';
import { createProductSpecification } from '../src/product-planner.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

async function fixtures() {
  const [opportunity, config] = await Promise.all([
    readFile(resolve(projectRoot, 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'), 'utf8').then(JSON.parse),
    loadEngineConfig('services/digital-asset-engine/config.example.json', projectRoot),
  ]);
  return { opportunity, config };
}

test('final opportunity validation rejects stale and high-risk work', async () => {
  const { opportunity, config } = await fixtures();
  const result = validateOpportunity({
    ...opportunity,
    expires_at: '2026-09-01T00:00:00.000Z',
    risk: { ...opportunity.risk, ip_risk: 'high' },
  }, config, { now: '2026-10-12T12:00:00.000Z' });

  assert.equal(result.generation_eligible, false);
  assert.deepEqual(result.failures.sort(), ['freshness', 'ip_risk']);
});

test('an opportunity may pin a reproducible generation seed', async () => {
  const { opportunity, config } = await fixtures();
  const validation = validateOpportunity({
    ...opportunity,
    generation: { ...opportunity.generation, seed: 814 },
  }, config, { now: '2026-10-12T12:00:00.000Z' });
  const product = createProductSpecification(validation, config);

  assert.equal(product.assets[0].seed, 814);
});

test('Ollama adapter refuses non-local endpoints by default', async () => {
  const { config } = await fixtures();
  assert.throws(
    () => new OllamaImageAdapter({ ...config.generation, endpoint: 'https://example.com' }),
    /local endpoint/u,
  );
});

test('Ollama adapter accepts the image field from a non-streaming response', async () => {
  const { config } = await fixtures();
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: '#ff00ff' },
  }).png().toBuffer();
  const requests = [];
  const adapter = new OllamaImageAdapter(config.generation, {
    async fetchImpl(url, options = {}) {
      requests.push({ url, options });
      if (url.endsWith('/api/tags')) {
        return { ok: true, async json() { return { models: [{ name: config.generation.model }] }; } };
      }
      return {
        ok: true,
        async text() {
          return JSON.stringify({ image: png.toString('base64'), done: true });
        },
      };
    },
  });

  assert.equal((await adapter.checkReadiness()).status, 'ready');
  const generated = await adapter.generateAsset({
    asset: { generation_prompt: 'original asset', seed: 146 },
    sourceWidth: 1024,
    sourceHeight: 1024,
  });
  const body = JSON.parse(requests[1].options.body);
  assert.equal(generated.format, 'png');
  assert.equal(generated.estimated_cost, 0);
  assert.equal(body.model, 'x/flux2-klein:4b');
  assert.equal(body.width, 1024);
  assert.equal(body.keep_alive, 0);
});

test('asset validation rejects an opaque chroma background even when alpha exists', async () => {
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: '#d91691' },
  }).png().toBuffer();
  const report = await validateGeneratedAsset(png, {
    width: 16,
    height: 16,
    maxPaletteColors: 32,
    minimumTransparentRatio: 0,
    forbiddenChroma: '#d91691',
    chromaTolerance: 45,
    maximumChromaRatio: 0.05,
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.checks.find((item) => item.name === 'chroma_spill').passed, false);
});
