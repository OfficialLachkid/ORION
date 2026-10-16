import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildItchPublicVerificationCode,
  buildItchPublishCode,
  publishApprovedItchRelease,
} from '../src/itch-publisher.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'b'.repeat(64);

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
  assert.match(code, /included_file/u);
  assert.match(code, /payment_options/u);
  assert.match(code, /not_draft_error/u);
  assert.match(code, /4\.99/u);
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
