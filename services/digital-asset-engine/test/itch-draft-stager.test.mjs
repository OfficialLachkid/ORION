import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildItchDraftRunCode, stageItchDraft } from '../src/itch-draft-stager.mjs';

async function createFixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-itch-stage-'));
  const product = {
    product_id: 'asset-product-1',
    slug: 'neon-plasma-armory',
    title: 'Neon Plasma Armory',
  };
  const productRoot = resolve(outputRoot, product.slug);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  await mkdir(resolve(exportRoot, 'download', 'assets'), { recursive: true });
  const listing = {
    title: product.title,
    short_description: 'Eight original side-view sci-fi weapon sprites.',
    description: 'Complete deterministic listing description.',
    suggested_price: { amount: 4.99, currency: 'EUR' },
    tags: ['2D', 'Pixel Art'],
    cover_path: 'cover.png',
    screenshot_paths: ['download/assets/neon-plasma-armory-sprite-sheet.png'],
    listing_hash: 'c'.repeat(64),
  };
  const manifest = { manifest_hash: 'a'.repeat(64), listing_hash: listing.listing_hash };
  await Promise.all([
    writeFile(resolve(exportRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(exportRoot, 'itch-listing-preview.json'), JSON.stringify(listing)),
    writeFile(resolve(exportRoot, 'cover.png'), 'cover'),
    writeFile(resolve(exportRoot, 'download', 'assets', 'neon-plasma-armory-sprite-sheet.png'), 'sheet'),
  ]);
  return {
    outputRoot,
    product,
    store: {
      async loadProduct() { return product; },
      productRoot() { return productRoot; },
    },
  };
}

test('Playwright draft preparation includes listing fields and exact price controls', () => {
  const code = buildItchDraftRunCode({
    listing: {
      title: 'Neon Plasma Armory',
      short_description: 'Eight sprites',
      description: 'Full description',
      suggested_price: { amount: 4.99 },
      tags: ['2D'],
    },
    publicUrl: 'https://vbjservices.itch.io/asset-pack-test',
    editUrl: '',
    coverPath: '/tmp/cover.png',
    screenshotPaths: ['/tmp/sheet.png'],
    screenshotPath: '/tmp/verified.png',
  });
  assert.match(code, /short_description/u);
  assert.match(code, /widget\.updateOriginalInput/u);
  assert.match(code, /button\.payment_mode_paid/u);
  assert.match(code, /form\.game_edit_form button\.save_btn/u);
  assert.match(code, /status: 'prepared'/u);
  assert.match(code, /page\.url\(\)\.includes\('\/login'\)/u);
  assert.match(code, /\.game_row/u);
  assert.match(code, /projectUrl/u);
  assert.doesNotMatch(code, /new URL/u);
  assert.doesNotThrow(() => new Function(`return (${code})`));
});

test('stages package with Butler, populates itch.io, verifies it, and reuses exact revision', async () => {
  const fixture = await createFixture();
  const calls = [];
  const cliRunner = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('run-code')) {
      const code = args.at(-2);
      const status = code.includes('Object.values(checks)')
        ? 'verified'
        : code.includes("status: 'media_ready'") ? 'media_ready'
        : code.includes('"save":true') ? 'submitted'
          : code.includes("status: 'prepared'") ? 'prepared' : 'submitted';
      const media = status === 'media_ready' ? { coverId: 'cover-1', screenshotCount: 1 } : {};
      return {
        ok: true,
        stdout: JSON.stringify({ result: JSON.stringify({
          status,
          ...media,
          url: 'https://itch.io/game/edit/12345',
          isDraft: true,
        }) }),
        stderr: '',
      };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  const options = {
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    store: fixture.store,
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test?secret=test',
    profileDir: fixture.outputRoot,
    cliRunner,
    now: '2026-10-14T11:00:00.000Z',
  };
  const staged = await stageItchDraft(options);
  assert.equal(staged.status, 'verified');
  assert.equal(staged.butler_target, 'vbjservices/asset-pack-test:assets');
  const butler = calls.find((call) => call.args[0] === 'push');
  assert.ok(butler);
  assert.ok(butler.args.includes('--if-changed'));
  const browserRun = calls.find((call) => call.args.includes('run-code'));
  assert.match(browserRun.args.at(-2), /Neon Plasma Armory/u);
  assert.equal(calls.filter((call) => call.args.includes('upload')).length, 2);

  const beforeReuse = calls.length;
  const reused = await stageItchDraft(options);
  assert.equal(reused.reused, true);
  assert.equal(calls.length, beforeReuse);
});

test('fails closed when browser verification does not confirm draft state', async () => {
  const fixture = await createFixture();
  const cliRunner = (executable, args) => {
    const code = args.includes('run-code') ? args.at(-2) : '';
    const status = code.includes('Object.values(checks)')
      ? 'verification_failed'
      : code.includes("status: 'media_ready'") ? 'media_ready'
      : code.includes('"save":true') ? 'submitted'
        : code.includes("status: 'prepared'") ? 'prepared' : 'submitted';
    const media = status === 'media_ready' ? { coverId: 'cover-1', screenshotCount: 1 } : {};
    return {
      ok: true,
      stdout: args.includes('run-code')
        ? JSON.stringify({ result: JSON.stringify({ status, ...media }) })
        : '',
      stderr: '',
    };
  };
  await assert.rejects(stageItchDraft({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    store: fixture.store,
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test',
    profileDir: fixture.outputRoot,
    cliRunner,
  }), /was not verified/u);
});
