import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  analyzeResearchHistory,
  createMagicWorkflowSimulation,
  createWorkflowSimulation,
  loadExistingProductCatalog,
  loadWorkflowSimulationFixture,
  runResearchCollection,
} from '../src/pipeline.mjs';
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
  assert.match(result.report.analysis_issue, /No coherent evidence/iu);
  assert.match(result.analysisIssue, /No coherent evidence/iu);
  assert.equal(posted.recommendation, null);
});

test('magic workflow simulation is clearly labelled and uses stored evidence without model inference', async () => {
  const config = JSON.parse(await readFile(resolve(
    process.cwd(),
    'services/digital-asset-research/config.example.json',
  ), 'utf8'));
  const observations = [
    {
      run_id: 'run-2', observation_id: '21111111-1111-4111-8111-111111111111',
      source_id: config.source.id, view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/fantasy-rpg', title: 'Cute Fantasy RPG', creator: 'Maker',
      price_text: '$4.99', summary: '', tags: [], observed_at: '2026-10-19T23:30:00.000Z', rank: 4,
      evidence_hash: 'a'.repeat(64),
    },
    {
      run_id: 'run-1', observation_id: '11111111-1111-4111-8111-111111111111',
      source_id: config.source.id, view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/pixel-effects', title: 'Pixel Effects Pack', creator: 'Maker',
      price_text: '$4.99', summary: '', tags: [], observed_at: '2026-10-18T23:30:00.000Z', rank: 5,
      evidence_hash: 'b'.repeat(64),
    },
  ];
  const inserted = [];
  const updated = [];
  let posted;
  const result = await createMagicWorkflowSimulation({
    config,
    runtimeConfig: {},
    now: '2026-10-20T16:30:00.000Z',
    store: {
      async listRecentObservations() { return observations; },
      async insertRecommendation(row) { inserted.push(row); },
      async updateRecommendation(id, patch) { updated.push({ id, patch }); },
    },
    postReview: async (value) => {
      posted = value;
      return { channelId: 'channel-1', messageId: 'message-1' };
    },
  });
  assert.equal(result.recommendation.simulation, true);
  assert.equal(result.recommendation.opportunity.generation.assets.length, 8);
  assert.equal(result.recommendation.opportunity.title, 'Arcane Relics & Potions');
  assert.equal(inserted[0].status, 'awaiting_review');
  assert.equal(posted.recommendation.simulation, true);
  assert.deepEqual(updated[0].patch, {
    discord_channel_id: 'channel-1',
    discord_message_id: 'message-1',
  });
});

test('fixture-driven workflow simulation preserves the complete pack and enters normal review', async () => {
  const config = JSON.parse(await readFile(resolve(
    process.cwd(),
    'services/digital-asset-research/config.example.json',
  ), 'utf8'));
  const fixture = await loadWorkflowSimulationFixture('space-station');
  const observations = [
    {
      run_id: 'run-2', observation_id: '31111111-1111-4111-8111-111111111111',
      source_id: config.source.id, view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/sci-fi-props', title: 'Sci-Fi Pixel Props', creator: 'Maker',
      price_text: '$6.99', summary: 'Space station objects', tags: ['space'], observed_at: '2026-10-23T23:30:00.000Z', rank: 4,
      evidence_hash: 'c'.repeat(64),
    },
    {
      run_id: 'run-1', observation_id: '41111111-1111-4111-8111-111111111111',
      source_id: config.source.id, view_id: 'top-sellers-pixel-art', signal: 'marketplace_rank_proxy',
      listing_url: 'https://maker.itch.io/pixel-objects', title: 'Pixel Objects', creator: 'Maker',
      price_text: '$4.99', summary: 'Game props', tags: ['prop'], observed_at: '2026-10-22T23:30:00.000Z', rank: 7,
      evidence_hash: 'd'.repeat(64),
    },
  ];
  const inserted = [];
  const updated = [];
  const result = await createWorkflowSimulation({
    config,
    fixture,
    runtimeConfig: {},
    now: '2026-10-24T16:30:00.000Z',
    store: {
      async listRecentObservations() { return observations; },
      async insertRecommendation(row) { inserted.push(row); },
      async updateRecommendation(id, patch) { updated.push({ id, patch }); },
    },
    postReview: async () => ({ channelId: 'channel-space', messageId: 'message-space' }),
  });

  assert.equal(result.recommendation.simulation, true);
  assert.equal(result.recommendation.title, 'Orbital Station Essentials');
  assert.equal(result.recommendation.opportunity.generation.assets.length, 16);
  assert.equal(result.recommendation.opportunity.generation.assets[0].asset_key, 'holographic-navigation-table');
  assert.equal(result.recommendation.opportunity.generation.assets[15].asset_key, 'teleportation-pad');
  assert.equal(inserted[0].status, 'awaiting_review');
  assert.deepEqual(updated[0].patch, {
    discord_channel_id: 'channel-space',
    discord_message_id: 'message-space',
  });
});

test('scheduled collection fails closed when scheduling is disabled', async () => {
  const config = JSON.parse(await readFile(resolve(
    process.cwd(),
    'services/digital-asset-research/config.example.json',
  ), 'utf8'));
  config.scheduling.enabled = false;
  await assert.rejects(
    runResearchCollection({ config, scheduled: true }),
    /scheduling is disabled/iu,
  );
});
