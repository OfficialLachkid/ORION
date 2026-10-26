import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildPublishedUpdatePreflightCode,
  buildItchPublicVerificationCode,
  buildItchPublishCode,
  publishApprovedItchRelease,
} from '../src/itch-publisher.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'b'.repeat(64);

function suppliedBrowserCode(args) {
  const filenameIndex = args.indexOf('--filename');
  return filenameIndex >= 0 ? readFileSync(args[filenameIndex + 1], 'utf8') : '';
}

async function createFixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-publish-'));
  const product = {
    product_id: 'asset-product-test',
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
    version: '0.2.0',
  };
  const productRoot = resolve(outputRoot, product.slug);
  const candidatePath = 'releases/0.2.0/candidates/0123456789abcdef';
  const candidateRoot = resolve(productRoot, candidatePath);
  const listing = {
    listing_hash: listingHash,
    title: product.title,
    short_description: '8 side-view sci-fi weapons with 24 matching effect animations.',
    suggested_price: { amount: 4.99, currency: 'USD' },
    cover_path: 'cover.png',
    screenshot_paths: ['screenshots/inventory.png', 'screenshots/effects.png', 'screenshots/cycles.gif'],
  };
  const manifest = {
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
  };
  await Promise.all([
    mkdir(candidateRoot, { recursive: true }),
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify(listing)),
    writeFile(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.2.0',
      candidate_path: candidatePath,
      manifest_hash: manifestHash,
    })),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify({
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      last_decision: { decision: 'approve' },
    })),
    writeFile(resolve(productRoot, 'review', 'itch.json'), JSON.stringify({
      status: 'verified',
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      public_url: 'https://vbjservices.itch.io/asset-pack-test?secret=review',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/asset-pack-test:assets',
    })),
    writeFile(resolve(productRoot, 'review', 'itch-seller.json'), JSON.stringify({
      status: 'ready',
      manifest_hash: manifestHash,
      listing_hash: listingHash,
    })),
    writeFile(resolve(productRoot, 'review', 'distribution.json'), JSON.stringify({
      status: 'distribution_approved',
      manifest_hash: manifestHash,
      listing_hash: listingHash,
      channel_id: 'channel-1',
      discord_message_id: 'message-1',
      last_decision: {
        decision: 'approve_publish',
        discord_interaction_id: 'interaction-1',
      },
    })),
  ]);
  return {
    outputRoot,
    product,
    productRoot,
    store: {
      async loadProduct() { return product; },
      productRoot() { return productRoot; },
    },
  };
}

test('publish code targets only the public visibility radio after exact listing checks', () => {
  const code = buildItchPublishCode({
    listing: {
      title: 'Neon Plasma Armory',
      short_description: 'Eight weapons.',
      suggested_price: { amount: 4.99 },
      screenshot_paths: ['one.png'],
    },
    editUrl: 'https://itch.io/game/edit/5144533',
  });
  assert.match(code, /game\[published\].*value="published"/u);
  assert.match(code, /payment_mode/u);
  assert.match(code, /preflight_failed/u);
  assert.match(code, /already_public/u);
});

test('public verification requires title, price, buy action, and non-draft page', () => {
  const code = buildItchPublicVerificationCode({
    listing: { title: 'Neon Plasma Armory', suggested_price: { amount: 4.99 } },
    url: 'https://vbjservices.itch.io/asset-pack-test',
    screenshotPath: '/tmp/public.png',
  });
  assert.match(code, /buy_action/u);
  assert.ok(code.includes('a[href$="/purchase"]'));
  assert.match(code, /included_file/u);
  assert.match(code, /payment_options/u);
  assert.match(code, /not_draft_error/u);
  assert.match(code, /4\.99/u);
  assert.match(code, /h1\.game_title/u);
  assert.match(code, /documentTitle/u);
  assert.ok(code.includes('/\\.zip\\b/i'));
  assert.doesNotThrow(() => new Function(`return (${code});`));
});

test('published-update preflight requires the expected editor, title, and public visibility', () => {
  const code = buildPublishedUpdatePreflightCode({
    editUrl: 'https://itch.io/game/edit/5144533',
    expectedTitle: 'Neon Plasma Armory',
  });
  assert.match(code, /preflight_failed/u);
  assert.match(code, /game\[published\].*value="published"/u);
  assert.match(code, /title === input\.expectedTitle/u);
  assert.doesNotThrow(() => new Function(`return (${code});`));
});

test('approved release publishes once, verifies public page, and writes an idempotent receipt', async () => {
  const fixture = await createFixture();
  let runCodeCalls = 0;
  const cliRunner = (_executable, args) => {
    const command = args[2];
    if (command === 'open' || command === 'close') return { ok: true, stdout: '{}' };
    if (command === 'run-code') {
      runCodeCalls += 1;
      const details = runCodeCalls === 1
        ? { status: 'published' }
        : {
          status: 'verified_public',
          checks: {
            public_url: true,
            title: true,
            buy_action: true,
            price: true,
            included_file: true,
            payment_options: true,
            not_draft_error: true,
          },
        };
      return { ok: true, stdout: JSON.stringify({ result: JSON.stringify(details) }) };
    }
    return { ok: false, stderr: `unexpected ${command}` };
  };
  const result = await publishApprovedItchRelease({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    cliRunner,
    headed: false,
    publicFetchImpl: async () => ({
      ok: true,
      async text() { return '<html><title>Neon Plasma Armory</title></html>'; },
    }),
    now: '2026-10-16T12:00:00.000Z',
  });
  assert.equal(result.status, 'verified_public');
  assert.equal(result.public_url, 'https://vbjservices.itch.io/asset-pack-test');
  assert.equal(runCodeCalls, 2);
  const distribution = JSON.parse(await readFile(
    resolve(fixture.productRoot, 'review', 'distribution.json'),
    'utf8',
  ));
  assert.equal(distribution.status, 'published');

  const reused = await publishApprovedItchRelease({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    cliRunner() { throw new Error('browser must not reopen'); },
  });
  assert.equal(reused.reused, true);
});

test('explicit reconciliation restores and verifies an already-public approved initial release with a missing receipt', async () => {
  const fixture = await createFixture();
  const candidateRoot = resolve(fixture.productRoot, 'releases', '0.2.0', 'candidates', '0123456789abcdef');
  await Promise.all([
    mkdir(resolve(candidateRoot, 'download'), { recursive: true }),
    mkdir(resolve(candidateRoot, 'screenshots'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(candidateRoot, 'cover.png'), 'cover'),
    writeFile(resolve(candidateRoot, 'screenshots', 'inventory.png'), 'inventory'),
    writeFile(resolve(candidateRoot, 'screenshots', 'effects.png'), 'effects'),
    writeFile(resolve(candidateRoot, 'screenshots', 'cycles.gif'), 'cycles'),
    writeFile(resolve(candidateRoot, 'download', 'neon-plasma-armory-assets.zip'), 'buyer package'),
  ]);

  const calls = [];
  let screenshotCount = 0;
  const cliRunner = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === 'push') return { ok: true, stdout: 'Pushed approved build', stderr: '' };
    const command = args[2];
    if (['open', 'close', 'dialog-dismiss', 'dialog-accept', 'upload'].includes(command)) {
      return { ok: true, stdout: '{}', stderr: '' };
    }
    if (command !== 'run-code') return { ok: false, stderr: `unexpected ${command}` };
    const code = suppliedBrowserCode(args);
    let details;
    if (code.includes('expectedTitle')) details = { status: 'ready', checks: { editor: true, title: true, published: true } };
    else if (code.includes("status: 'screenshots_counted'")) details = { status: 'screenshots_counted', count: screenshotCount };
    else if (code.includes("status: 'screenshot_delete_requested'")) details = { status: 'screenshot_delete_requested' };
    else if (code.includes("status: 'chooser_opened'")) details = { status: 'chooser_opened' };
    else if (code.includes("status: 'media_ready'")) details = { status: 'media_ready', coverId: 'approved-cover', screenshotCount: 3 };
    else if (code.includes('"save":true')) details = { status: 'submitted' };
    else if (code.includes('expectedVisibility')) details = { status: 'verified', checks: { visibility: true } };
    else if (code.includes('buy_action')) details = {
      status: 'verified_public',
      checks: {
        public_url: true,
        title: true,
        buy_action: true,
        price: true,
        included_file: true,
        payment_options: true,
        not_draft_error: true,
      },
    };
    else details = { status: 'unknown' };
    return { ok: true, stdout: JSON.stringify({ result: JSON.stringify(details) }), stderr: '' };
  };

  const result = await publishApprovedItchRelease({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    reconcilePublished: true,
    cliRunner,
    headed: false,
    butlerExecutable: 'butler',
    publicFetchImpl: async () => ({
      ok: true,
      async text() { return '<html><title>Neon Plasma Armory</title></html>'; },
    }),
    now: '2026-10-20T13:00:00.000Z',
  });

  assert.equal(result.status, 'verified_public');
  assert.equal(result.publication_mode, 'draft');
  assert.equal(result.publication_action, 'reconciled');
  assert.ok(calls.some((call) => call.args[0] === 'push'));
  assert.equal(calls.filter((call) => call.args[2] === 'upload').length, 4);
  const receipt = JSON.parse(await readFile(
    resolve(fixture.productRoot, 'review', 'itch-release.json'),
    'utf8',
  ));
  assert.equal(receipt.manifest_hash, manifestHash);
  assert.equal(receipt.publication_action, 'reconciled');
});

test('publishing fails before browser mutation when distribution approval is absent', async () => {
  const fixture = await createFixture();
  await writeFile(resolve(fixture.productRoot, 'review', 'distribution.json'), JSON.stringify({
    status: 'awaiting_distribution_approval',
    manifest_hash: manifestHash,
    listing_hash: listingHash,
  }));
  await assert.rejects(publishApprovedItchRelease({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.2.0',
    cliRunner() { throw new Error('browser must not open'); },
  }), /separate distribution approval/u);
});

test('approved published update replaces the package and dynamic listing media before advancing the receipt', async () => {
  const fixture = await createFixture();
  const oldManifestHash = manifestHash;
  const updateManifestHash = 'c'.repeat(64);
  const updateListingHash = 'd'.repeat(64);
  const candidatePath = 'releases/0.3.0/candidates/fedcba9876543210';
  const candidateRoot = resolve(fixture.productRoot, candidatePath);
  const listing = {
    listing_hash: updateListingHash,
    title: fixture.product.title,
    short_description: 'Weapons, effects, props, and interactive shield states.',
    description: 'Complete approved version 0.3.0 listing.',
    suggested_price: { amount: 4.99, currency: 'USD' },
    tags: ['2D', 'Pixel Art'],
    cover_path: 'cover.png',
    screenshot_paths: ['inventory.png', 'effects.png', 'cycles.gif'],
  };
  const manifest = {
    manifest_hash: updateManifestHash,
    listing_hash: updateListingHash,
    base_manifest_hash: oldManifestHash,
    target_version: '0.3.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
  };
  await mkdir(resolve(candidateRoot, 'download'), { recursive: true });
  await Promise.all([
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify(listing)),
    writeFile(resolve(candidateRoot, 'cover.png'), 'cover'),
    writeFile(resolve(candidateRoot, 'inventory.png'), 'inventory'),
    writeFile(resolve(candidateRoot, 'effects.png'), 'effects'),
    writeFile(resolve(candidateRoot, 'cycles.gif'), 'cycles'),
    writeFile(resolve(candidateRoot, 'download', 'neon-plasma-armory-assets.zip'), 'buyer package'),
    writeFile(resolve(fixture.productRoot, 'releases', '0.3.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.3.0',
      candidate_path: candidatePath,
      manifest_hash: updateManifestHash,
    })),
    writeFile(resolve(fixture.productRoot, 'review', 'discord.json'), JSON.stringify({
      manifest_hash: updateManifestHash,
      listing_hash: updateListingHash,
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      last_decision: { decision: 'approve' },
    })),
    writeFile(resolve(fixture.productRoot, 'review', 'itch-seller.json'), JSON.stringify({
      status: 'ready',
      manifest_hash: updateManifestHash,
      listing_hash: updateListingHash,
    })),
    writeFile(resolve(fixture.productRoot, 'review', 'distribution.json'), JSON.stringify({
      status: 'distribution_approved',
      marketplace_review_mode: 'published_update',
      current_marketplace_version: '0.2.0',
      base_manifest_hash: oldManifestHash,
      manifest_hash: updateManifestHash,
      listing_hash: updateListingHash,
      public_url: 'https://vbjservices.itch.io/asset-pack-test',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/asset-pack-test:assets',
      last_decision: { decision: 'approve_publish', discord_interaction_id: 'interaction-update' },
    })),
    writeFile(resolve(fixture.productRoot, 'review', 'itch-release.json'), JSON.stringify({
      status: 'verified_public',
      product_id: fixture.product.product_id,
      product_slug: fixture.product.slug,
      target_version: '0.2.0',
      manifest_hash: oldManifestHash,
      listing_hash: listingHash,
      public_url: 'https://vbjservices.itch.io/asset-pack-test',
      edit_url: 'https://itch.io/game/edit/5144533',
      butler_target: 'vbjservices/asset-pack-test:assets',
      published_at: '2026-10-16T12:00:00.000Z',
    })),
  ]);

  const calls = [];
  let screenshotCount = 2;
  const cliRunner = (executable, args) => {
    calls.push({ executable, args });
    if (args[0] === 'push') return { ok: true, stdout: 'Pushed build 42', stderr: '' };
    const command = args[2];
    if (['open', 'close', 'dialog-dismiss', 'dialog-accept', 'upload'].includes(command)) {
      return { ok: true, stdout: '{}', stderr: '' };
    }
    if (command !== 'run-code') return { ok: false, stderr: `unexpected ${command}` };
    const code = suppliedBrowserCode(args);
    let details;
    if (code.includes('expectedTitle')) details = { status: 'ready', checks: { editor: true, title: true, published: true } };
    else if (code.includes("status: 'screenshots_counted'")) details = { status: 'screenshots_counted', count: screenshotCount };
    else if (code.includes("status: 'screenshot_delete_requested'")) {
      screenshotCount -= 1;
      details = { status: 'screenshot_delete_requested' };
    } else if (code.includes("status: 'chooser_opened'")) details = { status: 'chooser_opened' };
    else if (code.includes("status: 'media_ready'")) details = { status: 'media_ready', coverId: 'cover-v3', screenshotCount: 3 };
    else if (code.includes('"save":true')) details = { status: 'submitted' };
    else if (code.includes('expectedVisibility')) details = { status: 'verified', checks: { visibility: true } };
    else if (code.includes('buy_action')) details = {
      status: 'verified_public',
      checks: {
        public_url: true,
        title: true,
        buy_action: true,
        price: true,
        included_file: true,
        payment_options: true,
        not_draft_error: true,
      },
    };
    else details = { status: 'unknown' };
    return { ok: true, stdout: JSON.stringify({ result: JSON.stringify(details) }), stderr: '' };
  };

  const result = await publishApprovedItchRelease({
    ...fixture,
    slug: fixture.product.slug,
    releaseVersion: '0.3.0',
    cliRunner,
    headed: false,
    butlerExecutable: 'butler',
    publicFetchImpl: async () => ({
      ok: true,
      async text() { return '<html><title>Neon Plasma Armory</title></html>'; },
    }),
    now: '2026-10-20T13:00:00.000Z',
  });

  assert.equal(result.target_version, '0.3.0');
  assert.equal(result.publication_mode, 'published_update');
  assert.equal(result.publication_action, 'updated');
  assert.equal(result.previous_version, '0.2.0');
  assert.equal(result.previous_manifest_hash, oldManifestHash);
  assert.equal(result.butler.target, 'vbjservices/asset-pack-test:assets');
  const butler = calls.find((call) => call.args[0] === 'push');
  assert.ok(butler.args.includes('--if-changed'));
  assert.ok(butler.args.includes(`0.3.0-${updateManifestHash.slice(0, 12)}`));
  assert.equal(calls.filter((call) => call.args[2] === 'upload').length, 4);
  const receipt = JSON.parse(await readFile(
    resolve(fixture.productRoot, 'review', 'itch-release.json'),
    'utf8',
  ));
  assert.equal(receipt.manifest_hash, updateManifestHash);
  assert.equal(receipt.published_at, '2026-10-16T12:00:00.000Z');
  assert.equal(receipt.updated_at, '2026-10-20T13:00:00.000Z');
});
