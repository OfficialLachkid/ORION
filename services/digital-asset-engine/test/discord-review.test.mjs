import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { loadEngineConfig } from '../src/config.mjs';
import {
  buildAssetReviewEmbed,
  buildPackReviewEmbed,
  discordRequest,
  marketplaceReviewMediaPaths,
  partitionReviewAttachments,
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
  const product = { ...planned.product, status: 'awaiting_asset_review', assets: [asset] };
  await planned.store.saveProduct(product);
  const productRoot = planned.store.productRoot(product);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  await mkdir(resolve(exportRoot, 'assets', 'individual'), { recursive: true });
  await mkdir(resolve(productRoot, 'review'), { recursive: true });
  const sprite = await sharp({
    create: { width: 128, height: 64, channels: 4, background: '#35d9ff' },
  }).png().toBuffer();
  const validation = {
    status: 'passed',
    metrics: { width: 128, height: 64, content_sha256: 'b'.repeat(64) },
  };
  const manifest = {
    release_state: 'internal_preview',
    distribution_ready: false,
    asset_count: 1,
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'c'.repeat(64),
  };
  const itchState = {
    status: 'verified',
    manifest_hash: manifest.manifest_hash,
    listing_hash: manifest.listing_hash,
    public_url: 'https://vbjservices.itch.io/asset-pack-test',
    staged_at: '2026-10-14T08:30:00.000Z',
  };
  await Promise.all([
    writeFile(resolve(productRoot, asset.final_path), sprite),
    writeFile(resolve(productRoot, asset.validation_path), `${JSON.stringify(validation)}\n`, 'utf8'),
    writeFile(resolve(exportRoot, 'cover.png'), sprite),
    writeFile(resolve(exportRoot, 'inventory.png'), sprite),
    writeFile(resolve(exportRoot, 'cycles.gif'), sprite),
    writeFile(resolve(exportRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8'),
    writeFile(resolve(exportRoot, 'itch-listing-preview.json'), `${JSON.stringify({
      listing_hash: manifest.listing_hash,
      cover_path: 'cover.png',
      screenshot_paths: ['inventory.png', 'cycles.gif'],
    })}\n`, 'utf8'),
    writeFile(resolve(productRoot, 'review', 'itch.json'), `${JSON.stringify(itchState)}\n`, 'utf8'),
  ]);
  return { outputRoot, product, productRoot, exportRoot, manifest, validation, itchState };
}

async function addReviewReleaseCandidate(fixture) {
  const candidatePath = 'releases/0.2.0/candidates/reviewcandidate1';
  const candidateRoot = resolve(fixture.productRoot, candidatePath);
  const listing = { listing_hash: 'f'.repeat(64) };
  const license = Buffer.from('# Buyer license\n');
  const manifest = {
    manifest_hash: 'e'.repeat(64),
    listing_hash: listing.listing_hash,
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
    asset_count: fixture.product.assets.length,
    buyer_license: {
      license_id: 'vbjservices-digital-asset-license',
      version: '1.0',
      content_sha256: createHash('sha256').update(license).digest('hex'),
    },
  };
  await mkdir(resolve(candidateRoot, 'download'), { recursive: true });
  await Promise.all([
    writeFile(resolve(candidateRoot, 'cover.png'), await readFile(resolve(fixture.exportRoot, 'cover.png'))),
    writeFile(resolve(candidateRoot, 'manifest.json'), `${JSON.stringify(manifest)}\n`, 'utf8'),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), `${JSON.stringify(listing)}\n`, 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'LICENSE.md'), license),
    writeFile(resolve(fixture.productRoot, 'releases', '0.2.0', 'latest-candidate.json'), `${JSON.stringify({
      target_version: '0.2.0',
      candidate_path: candidatePath,
      manifest_hash: manifest.manifest_hash,
    })}\n`, 'utf8'),
  ]);
  return {
    manifest,
    itchState: {
      status: 'verified',
      manifest_hash: manifest.manifest_hash,
      listing_hash: listing.listing_hash,
      public_url: fixture.itchState.public_url,
      staged_at: '2026-10-15T13:00:00.000Z',
    },
  };
}

test('Discord embeds use bold numbered assets and explain the manifest receipt', () => {
  const product = { title: 'Neon Plasma Armory', assets: [{ name: 'Rail Rifle' }, { name: 'Arc Launcher' }] };
  const manifest = { asset_count: 2, manifest_hash: 'a'.repeat(64), listing_hash: 'c'.repeat(64) };
  const pack = buildPackReviewEmbed({
    product,
    manifest,
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
    revision: 2,
  });
  const asset = buildAssetReviewEmbed({
    asset: { name: 'Rail Rifle', asset_id: 'asset-1', final_path: 'assets/items/rail-rifle.png' },
    validation: { status: 'passed', metrics: { width: 128, height: 64, content_sha256: 'b'.repeat(64) } },
    index: 0,
    total: 8,
  });
  assert.match(pack.fields.find((field) => field.name === 'Included assets').value, /\*\*01\*\* — Rail Rifle/u);
  assert.match(pack.fields.find((field) => field.name === 'Attached manifest.json').value, /SHA-256/u);
  assert.match(asset.description, /\*\*01\*\* of \*\*08\*\*/u);
  assert.equal(asset.image.url, 'attachment://rail-rifle.png');
});

test('versioned package review exposes the exact attached customer license hash', () => {
  const product = { title: 'Neon Plasma Armory', assets: [{ name: 'Rail Rifle' }] };
  const manifest = {
    asset_count: 1,
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'c'.repeat(64),
    buyer_license: {
      license_id: 'vbjservices-digital-asset-license',
      version: '1.0',
      content_sha256: 'd'.repeat(64),
    },
  };
  const pack = buildPackReviewEmbed({
    product,
    manifest,
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
  });
  const field = pack.fields.find((item) => item.name === 'Customer license');
  assert.match(field.value, /vbjservices-digital-asset-license 1\.0/u);
  assert.match(field.value, new RegExp('d{64}', 'u'));
  assert.match(field.value, /LICENSE\.md/u);
});

test('published update review distinguishes candidate media from the current live release', () => {
  const product = { title: 'Neon Plasma Armory', assets: [{ asset_id: 'weapon-1', name: 'Rail Rifle' }] };
  const manifest = {
    asset_count: 2,
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'c'.repeat(64),
    expansion_assets: [{ asset_id: 'item-1', name: 'Plasma Shield' }],
  };
  const pack = buildPackReviewEmbed({
    product,
    manifest,
    itchUrl: 'https://vbjservices.itch.io/neon-plasma-armory',
    marketplaceReviewMode: 'published_update',
    currentReleaseVersion: '0.2.0',
    coverFilename: 'cover.gif',
  });
  assert.match(pack.description, /has not been applied/iu);
  assert.match(pack.description, /0\.2\.0/u);
  assert.match(pack.fields.find((field) => field.name === 'Included assets').value, /Plasma Shield/u);
  assert.equal(pack.fields.some((field) => field.name === 'itch.io draft'), false);
  assert.equal(pack.image.url, 'attachment://cover.gif');
});

test('Discord review media follows every dynamic listing path and partitions only at the API limit', () => {
  const screenshotPaths = Array.from({ length: 12 }, (unused, index) => `gallery/preview-${index + 1}.png`);
  const paths = marketplaceReviewMediaPaths({
    cover_path: 'cover.gif',
    screenshot_paths: [...screenshotPaths, 'cover.gif'],
  }, {
    cover_fallback_path: 'cover-still.png',
    screenshot_paths: screenshotPaths,
  });
  assert.deepEqual(paths, ['cover.gif', 'cover-still.png', ...screenshotPaths]);

  const media = paths.map((path) => ({ path, filename: path, buffer: Buffer.from(path) }));
  const receipts = [
    { filename: 'manifest.json', buffer: Buffer.from('manifest') },
    { filename: 'LICENSE.md', buffer: Buffer.from('license') },
  ];
  const partitioned = partitionReviewAttachments(media, receipts);
  assert.equal(partitioned.overviewFiles.length, 10);
  assert.deepEqual(
    partitioned.overviewFiles.slice(0, 8).map((file) => file.path),
    paths.slice(0, 8),
  );
  assert.deepEqual(partitioned.overviewFiles.slice(8).map((file) => file.filename), [
    'manifest.json',
    'LICENSE.md',
  ]);
  assert.deepEqual(partitioned.galleryChunks.flat().map((file) => file.path), paths.slice(8));
});

test('Discord requests honor the supplied retry interval for old-message edit limits', async () => {
  let attempts = 0;
  const waits = [];
  const result = await discordRequest('test-token', '/channels/channel-1/messages/message-1', {
    method: 'PATCH',
    body: { content: 'updated' },
    async fetchImpl() {
      attempts += 1;
      return attempts === 1
        ? jsonResponse({ message: 'edit limit', retry_after: 0.25, code: 30046 }, 429)
        : jsonResponse({ id: 'message-1' });
    },
    async sleepImpl(milliseconds) { waits.push(milliseconds); },
  });

  assert.equal(result.id, 'message-1');
  assert.equal(attempts, 2);
  assert.deepEqual(waits, [350]);
});

test('Discord review requires a verified itch.io draft for the exact hashes', async () => {
  const fixture = await createReviewFixture();
  fixture.itchState.listing_hash = 'd'.repeat(64);
  await assert.rejects(postDigitalAssetReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'test-token' }, guildId: 'guild-1' },
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    categoryName: 'DIGITAL ASSETS',
    itchUrl: fixture.itchState.public_url,
    itchState: fixture.itchState,
  }), /different package revision/u);
});

test('local generation review posts a creative approval gate without an itch.io link', async () => {
  const fixture = await createReviewFixture();
  let messageNumber = 0;
  let overviewComponents;
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'GET' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse([{ id: 'category-1', name: 'DIGITAL ASSETS', type: 4 }]);
    }
    if (options.method === 'POST' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse({ id: 'channel-local', name: fixture.product.slug, type: 0, parent_id: 'category-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages/overview-local/threads')) {
      return jsonResponse({ id: 'thread-local' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages')) {
      messageNumber += 1;
      return jsonResponse({ id: messageNumber === 1 ? 'overview-local' : 'asset-local' });
    }
    if (options.method === 'PATCH') {
      if (!(options.body instanceof FormData)) {
        const payload = JSON.parse(options.body);
        if (payload.components) overviewComponents = payload.components;
      }
      return jsonResponse({ id: 'overview-local' });
    }
    return jsonResponse({ message: 'unexpected request' }, 500);
  };
  const review = await postDigitalAssetReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'test-token' }, guildId: 'guild-1' },
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    categoryName: 'DIGITAL ASSETS',
    itchState: { status: 'not_staged' },
    publishedState: { status: 'not_published' },
    localReview: true,
    fetchImpl,
  });
  assert.equal(review.marketplace_review_mode, 'local_generation');
  assert.equal(review.itch_url, null);
  assert.deepEqual(overviewComponents[0].components.map((component) => component.label), [
    'Approve Pack',
    'Request Changes',
    'Reject Pack',
    'Open Manifest',
  ]);
});

test('review revision updates the existing pack and asset messages instead of reposting', async () => {
  const fixture = await createReviewFixture();
  const calls = [];
  let messageNumber = 0;
  let channelCreated = false;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (options.method === 'GET' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse([
        { id: 'category-1', name: 'DIGITAL ASSETS', type: 4 },
        ...(channelCreated ? [{ id: 'channel-1', name: fixture.product.slug, type: 0, parent_id: 'category-1' }] : []),
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
      if (messageNumber === 1) {
        const payload = JSON.parse(options.body.get('payload_json'));
        assert.deepEqual(payload.attachments.map((attachment) => attachment.filename), [
          'cover.png',
          'inventory.png',
          'cycles.gif',
          'manifest.json',
        ]);
        assert.equal(payload.embeds[0].fields.find((field) => field.name === 'Storefront media').value, '**3** exact candidate images attached to this package review.');
      }
      return jsonResponse({ id: messageNumber === 1 ? 'overview-1' : 'asset-message-1' });
    }
    if (options.method === 'PATCH') {
      if (options.body instanceof FormData) {
        const payload = JSON.parse(options.body.get('payload_json'));
        if (String(url).includes('/channels/channel-1/messages/overview-1')) {
          assert.deepEqual(payload.components[0].components.map((component) => component.label), [
            'Approve Pack',
            'Request Changes',
            'Reject Pack',
            'Open itch.io Draft',
            'Open Manifest',
          ]);
        }
        if (String(url).includes('/channels/thread-1/messages/asset-message-1')) {
          assert.deepEqual(payload.components, []);
        }
      }
      return jsonResponse({ id: String(url).includes('overview') ? 'overview-1' : 'asset-message-1' });
    }
    return jsonResponse({ message: 'unexpected request' }, 500);
  };
  const options = {
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'test-token' }, guildId: 'guild-1' },
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    categoryName: 'DIGITAL ASSETS',
    itchUrl: fixture.itchState.public_url,
    fetchImpl,
    now: '2026-10-14T09:00:00.000Z',
  };

  const posted = await postDigitalAssetReview(options);
  assert.equal(posted.overview_message_id, 'overview-1');
  assert.equal(posted.asset_messages[fixture.product.assets[0].asset_id], 'asset-message-1');
  assert.equal(posted.review_revision, 1);
  assert.equal(calls.filter((call) => call.options.method === 'POST').length, 4);

  const revisedManifest = { ...fixture.manifest, manifest_hash: 'e'.repeat(64), listing_hash: 'f'.repeat(64) };
  const revisedItch = {
    ...fixture.itchState,
    manifest_hash: revisedManifest.manifest_hash,
    listing_hash: revisedManifest.listing_hash,
    staged_at: '2026-10-14T10:00:00.000Z',
  };
  await Promise.all([
    writeFile(resolve(fixture.exportRoot, 'manifest.json'), `${JSON.stringify(revisedManifest)}\n`, 'utf8'),
    writeFile(resolve(fixture.exportRoot, 'itch-listing-preview.json'), `${JSON.stringify({
      listing_hash: revisedManifest.listing_hash,
    })}\n`, 'utf8'),
    writeFile(resolve(fixture.productRoot, 'review', 'itch.json'), `${JSON.stringify(revisedItch)}\n`, 'utf8'),
  ]);
  const beforeRevision = calls.length;
  const revised = await postDigitalAssetReview({ ...options, itchState: revisedItch });
  const revisionCalls = calls.slice(beforeRevision);
  assert.equal(revised.review_revision, 2);
  assert.equal(revised.overview_message_id, 'overview-1');
  assert.equal(revised.asset_messages[fixture.product.assets[0].asset_id], 'asset-message-1');
  assert.equal(revisionCalls.filter((call) => call.options.method === 'POST').length, 0);
  assert.equal(revisionCalls.filter((call) => call.options.method === 'PATCH').length, 2);

  const beforeResume = calls.length;
  const resumed = await postDigitalAssetReview({ ...options, itchState: revisedItch });
  assert.equal(resumed.reused, true);
  assert.equal(calls.length, beforeResume);
});

test('package review resolves a verified versioned candidate and keeps the same approval gate', async () => {
  const fixture = await createReviewFixture();
  const release = await addReviewReleaseCandidate(fixture);
  let messageNumber = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method === 'GET' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse([{ id: 'category-1', name: 'DIGITAL ASSETS', type: 4 }]);
    }
    if (options.method === 'POST' && String(url).endsWith('/guilds/guild-1/channels')) {
      return jsonResponse({ id: 'channel-1', name: fixture.product.slug, type: 0, parent_id: 'category-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages/overview-1/threads')) {
      return jsonResponse({ id: 'thread-1' });
    }
    if (options.method === 'POST' && String(url).endsWith('/messages')) {
      messageNumber += 1;
      return jsonResponse({ id: messageNumber === 1 ? 'overview-1' : 'asset-message-1' });
    }
    if (options.method === 'PATCH') return jsonResponse({ id: 'overview-1' });
    return jsonResponse({ message: 'unexpected request' }, 500);
  };
  const review = await postDigitalAssetReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'test-token' }, guildId: 'guild-1' },
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    categoryName: 'DIGITAL ASSETS',
    itchUrl: release.itchState.public_url,
    itchState: release.itchState,
    releaseVersion: '0.2.0',
    fetchImpl,
  });
  assert.equal(review.manifest_hash, release.manifest.manifest_hash);
  assert.equal(review.target_version, '0.2.0');
  assert.equal(review.package_root, 'releases/0.2.0/candidates/reviewcandidate1');
});
