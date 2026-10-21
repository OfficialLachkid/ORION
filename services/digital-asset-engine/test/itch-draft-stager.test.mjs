import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildItchDraftRunCode,
  buildItchProjectDiscoveryRunCode,
  buildVerifyRunCode,
  renderItchDescriptionHtml,
  renderItchDescriptionText,
  stageItchDraft,
} from '../src/itch-draft-stager.mjs';

function suppliedBrowserCode(args) {
  const filenameIndex = args.indexOf('--filename');
  return filenameIndex >= 0 ? readFileSync(args[filenameIndex + 1], 'utf8') : '';
}

function browserStatus(code) {
  return code.includes("status: 'existing_project'") && code.includes("status: 'new_project_form'")
    ? 'discovery'
    : code.includes("status: 'ready'")
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
  assert.doesNotThrow(() => new Function(`return (${code})`));
});

test('Playwright new-project preparation pins assets, AI disclosure, draft visibility, and slug', () => {
  const discovery = buildItchProjectDiscoveryRunCode({ slug: 'arcane-relics-potions' });
  const code = buildItchDraftRunCode({
    listing: {
      title: 'Arcane Relics & Potions',
      short_description: 'Fantasy inventory assets.',
      description: 'Full description',
      suggested_price: { amount: 3.99 },
      tags: ['2D', 'Pixel Art'],
    },
    publicUrl: 'https://vbjservices.itch.io/arcane-relics-potions',
    editUrl: 'https://itch.io/game/new',
    slug: 'arcane-relics-potions',
    create: true,
    save: true,
  });
  assert.match(discovery, /new_project_form/u);
  assert.match(discovery, /existing_project/u);
  assert.doesNotMatch(discovery, /\bnew URL\b/u);
  assert.doesNotMatch(code, /\bnew URL\b/u);
  assert.match(code, /game\[user_classification\]/u);
  assert.match(code, /game\[classification\]/u);
  assert.match(code, /page\.locator\('input, select'\)/u);
  assert.match(code, /Game assets/u);
  assert.match(code, /Downloadable .*only have files/u);
  assert.match(code, /Released .*Project is complete/u);
  assert.match(code, /Generative AI/u);
  assert.match(code, /Save & view page/u);
  assert.ok(code.includes('input[name="game[slug]"]'));
  assert.match(code, /normalizedFormAction/u);
  assert.match(code, /response\.url\(\)\.replace/u);
  assert.match(code, /ownerEditHref/u);
  assert.match(code, /previewHref/u);
  const verify = buildVerifyRunCode({
    listing: {
      title: 'Arcane Relics & Potions',
      short_description: 'Fantasy inventory assets.',
      description: 'Full description',
      suggested_price: { amount: 3.99 },
      tags: ['2D', 'Pixel Art'],
    },
    screenshotCount: 2,
    screenshotPath: '/tmp/verified.png',
    editUrl: 'https://itch.io/game/edit/12345',
    slug: 'arcane-relics-potions',
  });
  assert.ok(verify.includes('input[name="game[slug]"]'));
  assert.ok(verify.includes('select[name="game[user_classification]"]'));
  assert.match(verify, /classificationValue === 'assets'/u);
  assert.match(verify, /ai_disclosure: aiDisclosure/u);
  assert.match(verify, /slugValue === input\.slug/u);
  assert.doesNotThrow(() => new Function(`return (${discovery})`));
  assert.doesNotThrow(() => new Function(`return (${code})`));
  assert.doesNotThrow(() => new Function(`return (${verify})`));
});

test('project discovery works when the Playwright sandbox does not expose URL', async () => {
  const discovery = buildItchProjectDiscoveryRunCode({ slug: 'arcane-relics-potions' });
  const discover = new Function('URL', `return (${discovery})`)(undefined);
  let currentUrl = 'about:blank';
  const editLink = {
    async count() { return 0; },
  };
  const projectRow = {
    locator() { return { first() { return editLink; } }; },
  };
  const page = {
    async goto(url) { currentUrl = url; },
    async waitForTimeout() {},
    url() { return currentUrl; },
    locator(selector) {
      if (selector.startsWith('a[href^="https://"]')) {
        return {
          async evaluateAll(callback) { return callback([{ href: 'https://vbjservices.itch.io/' }]); },
        };
      }
      if (selector === '.game_row') {
        return { filter() { return { first() { return projectRow; } }; } };
      }
      return { first() { return {}; } };
    },
  };
  const result = await discover(page);
  assert.deepEqual(result, {
    status: 'new_project_form',
    publicUrl: 'https://vbjservices.itch.io/arcane-relics-potions',
    editUrl: 'https://itch.io/game/new',
  });
});

test('renders itch descriptions as safe headings, paragraphs, and lists', () => {
  const html = renderItchDescriptionHtml([
    '## Version 0.3.0',
    '',
    'What is included:',
    '',
    '- Eight weapons',
    '- Matching muzzle flashes',
    '',
    'Use <only> the files in the download.',
  ].join('\n'));

  assert.equal(html, [
    '<h2>Version 0.3.0</h2>',
    '<h2>What is included:</h2>',
    '<ul><li>Eight weapons</li><li>Matching muzzle flashes</li></ul>',
    '<p>Use &lt;only&gt; the files in the download.</p>',
  ].join('\n'));
  assert.equal(renderItchDescriptionText([
    '## Version 0.3.0', '', 'What is included:', '- Eight weapons', '- Matching muzzle flashes',
  ].join('\n')), 'Version 0.3.0 What is included: Eight weapons Matching muzzle flashes');
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

test('creates a missing itch.io project before Butler upload and verifies the draft', async () => {
  const fixture = await createFixture();
  const calls = [];
  const publicUrl = 'https://vbjservices.itch.io/neon-plasma-armory';
  const editUrl = 'https://itch.io/game/edit/12345';
  const cliRunner = (executable, args) => {
    const code = args.includes('run-code') ? suppliedBrowserCode(args) : '';
    calls.push({ executable, args, code });
    if (!code) return { ok: true, stdout: '', stderr: '' };
    const status = browserStatus(code);
    const details = status === 'discovery'
      ? { status: 'new_project_form', publicUrl, editUrl: 'https://itch.io/game/new' }
      : status === 'media_ready'
        ? { status, coverId: 'cover-1', screenshotCount: 2, url: 'https://itch.io/game/new' }
        : status === 'submitted'
          ? { status, publicUrl: `${publicUrl}?secret=review`, editUrl, url: `${publicUrl}?secret=review` }
          : { status, url: status === 'verified' ? editUrl : 'https://itch.io/game/new' };
    return {
      ok: true,
      stdout: JSON.stringify({ result: JSON.stringify(details) }),
      stderr: '',
    };
  };
  const staged = await stageItchDraft({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    store: fixture.store,
    profileDir: fixture.outputRoot,
    cliRunner,
  });
  assert.equal(staged.public_url, `${publicUrl}?secret=review`);
  assert.equal(staged.edit_url, editUrl);
  assert.equal(staged.butler_target, 'vbjservices/neon-plasma-armory:assets');
  const discoveryIndex = calls.findIndex((call) => browserStatus(call.code) === 'discovery');
  const butlerIndex = calls.findIndex((call) => call.args[0] === 'push');
  assert.ok(discoveryIndex >= 0);
  assert.ok(butlerIndex > discoveryIndex);
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

test('published projects reject update draft staging before Butler or browser mutation', async () => {
  const fixture = await createFixture();
  const calls = [];
  await mkdir(resolve(fixture.store.productRoot(fixture.product), 'review'), { recursive: true });
  await writeFile(resolve(fixture.store.productRoot(fixture.product), 'review', 'itch-release.json'), JSON.stringify({
    status: 'verified_public',
    manifest_hash: 'f'.repeat(64),
    listing_hash: 'e'.repeat(64),
    target_version: '0.2.0',
    public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
  }));
  await assert.rejects(stageItchDraft({
    outputRoot: fixture.outputRoot,
    slug: fixture.product.slug,
    store: fixture.store,
    itchUrl: 'https://vbjservices.itch.io/neon-plasma-armory',
    profileDir: fixture.outputRoot,
    cliRunner(executable, args) {
      calls.push({ executable, args });
      return { ok: true, stdout: '', stderr: '' };
    },
  }), /marketplace-update publisher/iu);
  assert.equal(calls.length, 0);
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
