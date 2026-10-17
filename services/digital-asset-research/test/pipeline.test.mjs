import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { analyzeResearchHistory, loadExistingProductCatalog } from '../src/pipeline.mjs';
import { ResearchRecommendationQualityError } from '../src/ollama-recommendation-adapter.mjs';

test('loads a compact existing-product catalog so research can recommend extensions', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-research-products-'));
  await mkdir(resolve(root, 'neon-plasma-armory'), { recursive: true });
  await writeFile(resolve(root, 'neon-plasma-armory', 'product.json'), JSON.stringify({
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
    category: '2D assets',
    product_type: 'weapon pack',
    theme: 'science fiction',
    assets: [{ name: 'Arc Launcher', kind: 'weapon' }],
  }));
  await mkdir(resolve(root, 'research'), { recursive: true });

  const catalog = await loadExistingProductCatalog(root);
  assert.deepEqual(catalog, [{
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
    category: '2D assets',
    product_type: 'weapon pack',
    theme: 'science fiction',
    assets: [{ name: 'Arc Launcher', kind: 'weapon' }],
  }]);
});

test('resumes analysis from stored observations without collecting another snapshot', async () => {
  const config = JSON.parse(await readFile(resolve(
    process.cwd(),
    'services/digital-asset-research/config.example.json',
  ), 'utf8'));
  const observations = [
    {
      run_id: 'run-2', observation_id: '21111111-1111-4111-8111-111111111111',
      view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/effects', title: 'Effects', creator: 'Maker',
      price_text: '$4.99', observed_at: '2026-10-17T15:00:00.000Z', rank: 2,
    },
    {
      run_id: 'run-1', observation_id: '11111111-1111-4111-8111-111111111111',
      view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/effects', title: 'Effects', creator: 'Maker',
      price_text: '$4.99', observed_at: '2026-10-16T15:00:00.000Z', rank: 5,
    },
  ];
  const inserted = [];
  const store = {
    async listRecentObservations() { return observations; },
    async insertRecommendation(row) { inserted.push(row); },
  };
  const recommendation = {
    recommendation_id: 'effects-opportunity',
    evidence_ids: ['21111111-1111-4111-8111-111111111111'],
  };

  const result = await analyzeResearchHistory({
    config,
    store,
    existingProducts: [],
    now: '2026-10-17T15:01:00.000Z',
    generateRecommendation: async () => recommendation,
  });

  assert.equal(result.report.snapshot_count, 2);
  assert.equal(result.recommendation, recommendation);
  assert.equal(inserted.length, 1);
});

test('keeps mature evidence in monitoring when the local model fails quality gates', async () => {
  const config = JSON.parse(await readFile(resolve(
    process.cwd(),
    'services/digital-asset-research/config.example.json',
  ), 'utf8'));
  const observations = [
    {
      run_id: 'run-2', observation_id: '21111111-1111-4111-8111-111111111111',
      view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/effects', title: 'Effects', creator: 'Maker',
      price_text: '$4.99', observed_at: '2026-10-17T15:00:00.000Z', rank: 2,
    },
    {
      run_id: 'run-1', observation_id: '11111111-1111-4111-8111-111111111111',
      view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/effects', title: 'Effects', creator: 'Maker',
      price_text: '$4.99', observed_at: '2026-10-16T15:00:00.000Z', rank: 5,
    },
  ];
  let posted;
  const result = await analyzeResearchHistory({
    config,
    store: { async listRecentObservations() { return observations; } },
    existingProducts: [],
    postToDiscord: true,
    generateRecommendation: async () => {
      throw new ResearchRecommendationQualityError('No coherent evidence.');
    },
    postReview: async (value) => {
      posted = value;
      return { channelId: 'channel-1', messageId: 'message-1' };
    },
  });

  assert.equal(result.recommendation, null);
  assert.equal(result.report.status, 'monitoring');
  assert.match(result.analysisIssue, /No coherent evidence/iu);
  assert.equal(posted.recommendation, null);
});
