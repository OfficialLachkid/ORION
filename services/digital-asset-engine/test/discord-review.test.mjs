import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadEngineConfig } from '../src/config.mjs';
import {
  buildAssetReviewEmbed,
  buildPackReviewEmbed,
  postDigitalAssetReview,
} from '../src/discord-review.mjs';
import { planDigitalAssetProduct } from '../src/pipeline.mjs';

const testDirectory = resolve(fileURLToPath(new URL('.', import.meta.url)));
const projectRoot = resolve(testDirectory, '../../..');

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
    async text() { return JSON.stringify(payload); },
  };
}

async function createReviewFixture() {
  const outputRoot = await mkdtemp(join(tmpdir(), 'orion-digital-assets-discord-'));
  const config = await loadEngineConfig(
    'services/digital-asset-engine/config.example.json',
    projectRoot,
    { output_root: outputRoot },
  );
  const opportunity = JSON.parse(await readFile(
    resolve(projectRoot, 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const planned = await planDigitalAssetProduct({
    config,
    opportunity,
    outputRoot,
    projectRoot,
    now: '2026-10-14T08:00:00.000Z',
  });
  const asset = {
    ...planned.product.assets[0],
    status: 'generated',
    source_path: 'assets/source/plasma-rifle.png',
    final_path: 'assets/items/plasma-rifle.png',
    validation_path: 'validation/plasma-rifle.json',
  };
  const product = {
    ...planned.product,
    status: 'awaiting_asset_review',
    assets: [asset],
  };
  await planned.store.saveProduct(product);
  const productRoot = planned.store.productRoot(product);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  await mkdir(resolve(exportRoot, 'assets', 'individual'), { recursive: true });
  const sprite = await sharp({
    create: { width: 128, height: 64, channels: 4, background: '#35d9ff' },
  }).png().toBuffer();
  const validation = {
    status: 'passed',
    metrics: {
      width: 128,
      height: 64,
      content_sha256: 'b'.repeat(64),
    },
  };
  const manifest = {
    release_state: 'internal_preview',
    distribution_ready: false,
    asset_count: 1,
    manifest_hash: 'a'.repeat(64),
  };
  await Promise.all([
    writeFile(resolve(productRoot, asset.final_path), sprite),
    writeFile(resolve(productRoot, asset.validation_path), `${JSON.stringify(validation)}\n`, 'utf8'),
    writeFile(resolve(exportRoot, 'cover.png'), sprite),
    writeFile(resolve(exportRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8'),
  ]);
  return { outputRoot, product, manifest, validation };
}

test('Discord review embeds show exact hashes and avoid mirror marketing copy', () => {
  const product = { title: 'Neon Plasma Armory' };
  const manifest = { asset_count: 8, manifest_hash: 'a'.repeat(64) };
  const pack = buildPackReviewEmbed({
    product,
    manifest,
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
  });
  const asset = buildAssetReviewEmbed({
    asset: { name: 'Rail Rifle', asset_id: 'asset-1', final_path: 'assets/items/rail-rifle.png' },
    validation: { status: 'passed', metrics: { width: 128, height: 64, content_sha256: 'b'.repeat(64) } },
    index: 0,
    total: 8,
  });

  assert.match(pack.fields.find((field) => field.name === 'Manifest').value, /a{64}/u);
  assert.doesNotMatch(JSON.stringify(pack), /mirrorable/iu);
  assert.equal(asset.image.url, 'attachment://rail-rifle.png');
});

test('Discord review creates one pack channel and thread, posts assets, and resumes by manifest hash', async () => {
  const fixture = await createReviewFixture();
  const calls = [];
  let messageNumber = 0;
  let channelCreated = false;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === 'GET' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse([
        { id: 'category-1', name: 'DIGITAL ASSETS', type: 4 },
        ...(channelCreated
          ? [{ id: 'channel-1', name: fixture.product.slug, type: 0, parent_id: 'category-1' }]
          : []),
      ]);
    }
    if (options.method === 'POST' && String(url).endsWith('/guilds/guild-1/channels')) {
      channelCreated = true;
      return jsonResponse({ id: 'channel-1', name: fixture.product.slug, type: 0, parent_id: 'category-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages/overview-1/threads')) {
      return jsonResponse({ id: 'thread-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages')) {
      messageNumber += 1;
      const payload = JSON.parse(options.body.get('payload_json'));
      assert.ok(payload.attachments.length >= 1);
      if (messageNumber === 2) {
        assert.deepEqual(payload.components[0].components.map((button) => button.label), [
          'Approve',
          'Request Changes',
          'Reject',
          'Open Manifest',
        ]);
      }
      return jsonResponse({ id: messageNumber === 1 ? 'overview-1' : `asset-message-${messageNumber}` });
    }
    if (options.method === 'PATCH' && String(url).endsWith('/channels/thread-1/messages/asset-message-2')) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.components[0].components.length, 4);
      return jsonResponse({ id: 'asset-message-2' });
    }
    return jsonResponse({ message: 'unexpected request' }, 500);
  };
  const options = {
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'test-token' }, guildId: 'guild-1' },
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    categoryName: 'DIGITAL ASSETS',
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
    fetchImpl,
    now: '2026-10-14T09:00:00.000Z',
  };

  const posted = await postDigitalAssetReview(options);
  assert.equal(posted.channel_id, 'channel-1');
  assert.equal(posted.thread_id, 'thread-1');
  assert.equal(Object.keys(posted.asset_messages).length, 1);
  assert.equal(posted.category_id, 'category-1');
  assert.equal(posted.reused, false);
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 4);

  const statePath = resolve(
    fixture.outputRoot,
    fixture.product.slug,
    'review',
    'discord.json',
  );
  const legacyState = JSON.parse(await readFile(statePath, 'utf8'));
  delete legacyState.component_schema_version;
  await writeFile(statePath, `${JSON.stringify(legacyState)}\n`, 'utf8');

  const beforeReconcile = calls.length;
  const reconciled = await postDigitalAssetReview(options);
  assert.equal(reconciled.reused, false);
  assert.equal(calls.length, beforeReconcile + 2);
  assert.equal(calls.at(-1).options.method, 'PATCH');

  const beforeResume = calls.length;
  const resumed = await postDigitalAssetReview(options);
  assert.equal(resumed.reused, true);
  assert.equal(calls.length, beforeResume);
});
