import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildGenerationProgressEmbed,
  prepareDigitalAssetGenerationProgress,
  updateDigitalAssetGenerationProgress,
} from '../src/generation-progress.mjs';

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

test('generation progress creates one channel and thread then posts each completed asset in place', async () => {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-generation-progress-'));
  const product = {
    product_id: 'product-magic',
    slug: 'arcane-relics-potions',
    title: 'Arcane Relics & Potions',
    assets: [
      { asset_id: 'asset-potion', asset_key: 'potion', name: 'Potion', status: 'planned', final_path: 'assets/items/potion.png' },
      { asset_id: 'asset-wand', asset_key: 'wand', name: 'Wand', status: 'planned', final_path: null },
    ],
  };
  const productRoot = resolve(outputRoot, product.slug);
  await mkdir(resolve(productRoot, 'assets/items'), { recursive: true });
  await writeFile(resolve(productRoot, 'assets/items/potion.png'), Buffer.from('png'));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname;
    calls.push([options.method || 'GET', path]);
    if (path === '/api/v10/guilds/guild-1/channels') {
      return response([
        { id: 'category-1', type: 4, name: 'DIGITAL ASSETS' },
        { id: 'channel-1', type: 0, name: product.slug, parent_id: 'category-1' },
      ]);
    }
    if (path === '/api/v10/channels/channel-1/messages' && options.method === 'POST') {
      return response({ id: 'overview-1' });
    }
    if (path === '/api/v10/channels/channel-1/messages/overview-1/threads') {
      return response({ id: 'thread-1' });
    }
    if (path === '/api/v10/channels/thread-1/messages') {
      return response({ id: 'asset-message-1' });
    }
    if (path === '/api/v10/channels/channel-1/messages/overview-1' && options.method === 'PATCH') {
      return response({ id: 'overview-1' });
    }
    throw new Error(`Unexpected Discord request: ${options.method || 'GET'} ${path}`);
  };
  const runtimeConfig = {
    guildId: 'guild-1',
    env: { DISCORD_BOT_TOKEN: 'token' },
  };
  const prepared = await prepareDigitalAssetGenerationProgress({
    runtimeConfig,
    outputRoot,
    product,
    fetchImpl,
    startedAt: '2026-10-20T18:00:00.000Z',
  });
  assert.equal(prepared.state.channel_id, 'channel-1');
  assert.equal(prepared.state.thread_id, 'thread-1');
  await updateDigitalAssetGenerationProgress({
    runtimeConfig,
    outputRoot,
    product: {
      ...product,
      assets: product.assets.map((asset) => asset.asset_id === 'asset-potion'
        ? { ...asset, status: 'generated', final_path: 'assets/items/potion.png' }
        : asset),
    },
    fetchImpl,
    event: {
      type: 'asset_completed',
      asset: { ...product.assets[0], final_path: 'assets/items/potion.png' },
      result: {
        final_path: 'assets/items/potion.png',
        validation: {
          status: 'passed',
          metrics: { width: 96, height: 96, content_sha256: 'a'.repeat(64) },
        },
      },
      at: '2026-10-20T18:01:00.000Z',
    },
  });
  const state = JSON.parse(await readFile(resolve(productRoot, 'review/discord.json'), 'utf8'));
  assert.deepEqual(state.generation_progress.completed_asset_ids, ['asset-potion']);
  assert.equal(state.asset_messages['asset-potion'], 'asset-message-1');
  assert.ok(calls.some(([method, path]) => method === 'POST' && path === '/api/v10/channels/thread-1/messages'));
  assert.ok(calls.some(([method, path]) => method === 'PATCH' && path.endsWith('/overview-1')));
});

test('generation progress displays a dynamic completed over total count', () => {
  const embed = buildGenerationProgressEmbed(
    { title: 'Variable Pack', assets: Array.from({ length: 13 }, (_, index) => ({ asset_id: `asset-${index}` })) },
    {
      state: 'generating',
      started_at: '2026-10-20T18:00:00.000Z',
      total_count: 13,
      completed_asset_ids: ['asset-0', 'asset-1', 'asset-2'],
      current_asset_name: 'Fourth Asset',
    },
    new Date('2026-10-20T18:02:05.000Z'),
  );
  assert.equal(embed.fields.find((field) => field.name === 'Progress').value, '**3/13**');
  assert.equal(embed.fields.find((field) => field.name === 'Elapsed').value, '**2m 5s**');
  assert.match(embed.fields.find((field) => field.name === 'Current step').value, /4\/13/u);
});
