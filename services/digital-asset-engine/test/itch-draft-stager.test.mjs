import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildItchDraftRunCode,
  renderItchDescriptionHtml,
  stageItchDraft,
} from '../src/itch-draft-stager.mjs';

function suppliedBrowserCode(args) {
  const filenameIndex = args.indexOf('--filename');
  return filenameIndex >= 0 ? readFileSync(args[filenameIndex + 1], 'utf8') : '';
}

function browserStatus(code) {
  return code.includes("status: 'ready'")
    ? 'ready'
    : code.includes('Object.values(checks)')
      ? 'verified'
      : code.includes("status: 'media_ready'")
        ? 'media_ready'
        : code.includes('"save":true')
          ? 'submitted'
          : code.includes("status: 'prepared'") ? 'prepared' : 'submitted';
}

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
    screenshot_paths: ['cover.png', 'marketplace-preview.png'],
    listing_hash: 'c'.repeat(64),
  };
  const manifest = {
    manifest_hash: 'a'.repeat(64),
    listing_hash: listing.listing_hash,
    release_state: 'internal_preview',
    distribution_ready: false,
  };
  await Promise.all([
    writeFile(resolve(exportRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(exportRoot, 'itch-listing-preview.json'), JSON.stringify(listing)),
    writeFile(resolve(exportRoot, 'cover.png'), 'cover'),
    writeFile(resolve(exportRoot, 'marketplace-preview.png'), 'preview'),
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

async function addReleaseCandidate(fixture) {
  const productRoot = fixture.store.productRoot(fixture.product);
  const candidatePath = 'releases/0.2.0/candidates/candidate12345678';
  const candidateRoot = resolve(productRoot, candidatePath);
  await mkdir(resolve(candidateRoot, 'download', 'assets'), { recursive: true });
  const listing = {
    title: fixture.product.title,
    short_description: 'Eight weapons with matching effects.',
    description: 'Verified versioned candidate listing.',
    suggested_price: { amount: 7.99, currency: 'EUR' },
    tags: ['2D', 'Pixel Art'],
    cover_path: 'cover.png',
    screenshot_paths: ['weapon-inventory.png', 'effects-breakdown.png', 'firing-cycle-montage.gif'],
    listing_hash: 'e'.repeat(64),
  };
  const manifest = {
    manifest_hash: 'd'.repeat(64),
    listing_hash: listing.listing_hash,
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    quality_holds: [],
    gates: { quality_holds_resolved: true },
  };
  await Promise.all([
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify(listing)),
    writeFile(resolve(candidateRoot, 'cover.png'), 'cover-v2'),
    writeFile(resolve(candidateRoot, 'weapon-inventory.png'), 'inventory'),
    writeFile(resolve(candidateRoot, 'effects-breakdown.png'), 'effects'),
    writeFile(resolve(candidateRoot, 'firing-cycle-montage.gif'), 'montage'),
    writeFile(resolve(productRoot, 'releases', '0.2.0', 'latest-candidate.json'), JSON.stringify({
      target_version: '0.2.0',
      candidate_path: candidatePath,
      manifest_hash: manifest.manifest_hash,
    })),
  ]);
  return { candidateRoot, manifest, listing };
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
  assert.match(code, /waitForResponse/u);
  assert.match(code, /status: 'prepared'/u);
  assert.match(code, /page\.url\(\)\.includes\('\/login'\)/u);
  assert.match(code, /\.game_row/u);
  assert.match(code, /projectUrl/u);
  assert.match(code, /currentUrl !== requestedEditUrl/u);
  assert.doesNotMatch(code, /new URL/u);
  assert.doesNotThrow(() => new Function(`return (${code})`));
});

test('renders itch descriptions as safe headings, paragraphs, and lists', () => {
  const html = renderItchDescriptionHtml([
    'What is included:',
    '',
    '- Eight weapons',
    '- Matching muzzle flashes',
    '',
    'Use <only> the files in the download.',
  ].join('\n'));

  assert.equal(html, [
    '<h2>What is included:</h2>',
    '<ul><li>Eight weapons</li><li>Matching muzzle flashes</li></ul>',
    '<p>Use &lt;only&gt; the files in the download.</p>',
  ].join('\n'));
});

test('stages package with Butler, populates itch.io, verifies it, and reuses exact revision', async () => {
  const fixture = await createFixture();
  const calls = [];
  let readinessAttempts = 0;
  let preparationAttempts = 0;
  const cliRunner = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('run-code')) {
      const code = suppliedBrowserCode(args);
      const status = browserStatus(code);
      if (status === 'ready' && ++readinessAttempts === 1) {
        return { ok: true, stdout: '{}', stderr: '' };
      }
      if (status === 'prepared' && ++preparationAttempts === 1) {
        return { ok: true, stdout: '{}', stderr: '' };
      }
      const media = status === 'media_ready' ? { coverId: 'cover-1', screenshotCount: 2 } : {};
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
  assert.ok(browserRun.args.includes('--filename'));
  assert.ok(calls.findIndex((call) => call.args.includes('dialog-dismiss'))
    < calls.findIndex((call) => call.args.includes('run-code')));
  assert.equal(readinessAttempts, 2);
  assert.equal(preparationAttempts, 2);
  const uploads = calls.filter((call) => call.args.includes('upload'));
  assert.equal(uploads.length, 3);
  assert.ok(uploads.every((call) => call.args.indexOf('--json') - call.args.indexOf('upload') === 2));

  const beforeReuse = calls.length;
  const reused = await stageItchDraft(options);
  assert.equal(reused.reused, true);
  assert.equal(calls.length, beforeReuse);
});

test('fails closed when browser verification does not confirm draft state', async () => {
  const fixture = await createFixture();
  const cliRunner = (executable, args) => {
    const code = args.includes('run-code') ? suppliedBrowserCode(args) : '';
    const status = code.includes('Object.values(checks)') ? 'verification_failed' : browserStatus(code);
    const media = status === 'media_ready' ? { coverId: 'cover-1', screenshotCount: 2 } : {};
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

test('stages a quality-cleared immutable release candidate instead of the base preview', async () => {
  const fixture = await createFixture();
  const candidate = await addReleaseCandidate(fixture);
  const calls = [];
  const cliRunner = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('run-code')) {
      const code = suppliedBrowserCode(args);
      const status = browserStatus(code);
      return {
        ok: true,
        stdout: JSON.stringify({ result: JSON.stringify({
          status,
          coverId: status === 'media_ready' ? 'cover-v2' : undefined,
          screenshotCount: status === 'media_ready' ? 3 : undefined,
          url: 'https://itch.io/game/edit/12345',
        }) }),
        stderr: '',
      };
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  const staged = await stageItchDraft({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    store: fixture.store,
    releaseVersion: '0.2.0',
    itchUrl: 'https://vbjservices.itch.io/asset-pack-test?secret=test',
    profileDir: fixture.outputRoot,
    cliRunner,
  });
  const butler = calls.find((call) => call.args[0] === 'push');
  assert.equal(butler.args[1], resolve(candidate.candidateRoot, 'download'));
  assert.ok(butler.args.includes(`0.2.0-${candidate.manifest.manifest_hash.slice(0, 12)}`));
  assert.equal(staged.target_version, '0.2.0');
  assert.equal(staged.manifest_hash, candidate.manifest.manifest_hash);
  assert.equal(staged.package_root, 'releases/0.2.0/candidates/candidate12345678');
  assert.equal(calls.filter((call) => call.args.includes('upload')).length, 4);
});
