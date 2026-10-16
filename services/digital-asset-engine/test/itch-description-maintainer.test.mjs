import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildDescriptionMaintenanceCode,
  updatePublishedItchDescription,
} from '../src/itch-description-maintainer.mjs';

test('published description browser code changes only description and verifies public structure', () => {
  const code = buildDescriptionMaintenanceCode({
    editUrl: 'https://itch.io/game/edit/123',
    publicUrl: 'https://vbjservices.itch.io/neon-plasma-armory',
    descriptionHtml: '<h2>Included:</h2><ul><li>Weapons</li></ul>',
    expectedHeadings: 1,
    expectedLists: 1,
  });
  assert.match(code, /game\[description\]/u);
  assert.match(code, /formatted_description/u);
  assert.match(code, /headingCount/u);
  assert.doesNotMatch(code, /game\[title\]|min_price|cover_image/u);
  assert.doesNotThrow(() => new Function(`return (${code})`));
});

test('updates and receipts only the exact verified public release description', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-itch-description-'));
  const product = { product_id: 'product-1', slug: 'neon-plasma-armory', version: '0.2.0' };
  const productRoot = resolve(root, product.slug);
  const candidatePath = 'releases/0.2.0/candidates/aaaaaaaaaaaaaaaa';
  const candidateRoot = resolve(productRoot, candidatePath);
  const manifest = {
    manifest_hash: 'a'.repeat(64),
    listing_hash: 'b'.repeat(64),
    target_version: '0.2.0',
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    gates: { quality_holds_resolved: true },
    quality_holds: [],
  };
  const listing = {
    listing_hash: manifest.listing_hash,
    description: 'Included:\n\n- Eight weapons\n- Matching effects',
  };
  await mkdir(resolve(productRoot, 'review'), { recursive: true });
  await mkdir(candidateRoot, { recursive: true });
  await Promise.all([
    writeFile(resolve(productRoot, 'releases/0.2.0/latest-candidate.json'), JSON.stringify({
      target_version: '0.2.0', candidate_path: candidatePath, manifest_hash: manifest.manifest_hash,
    })),
    writeFile(resolve(candidateRoot, 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), JSON.stringify(listing)),
    writeFile(resolve(productRoot, 'review/itch-release.json'), JSON.stringify({
      status: 'verified_public',
      manifest_hash: manifest.manifest_hash,
      listing_hash: manifest.listing_hash,
      edit_url: 'https://itch.io/game/edit/123',
      public_url: 'https://vbjservices.itch.io/neon-plasma-armory',
    })),
  ]);
  let suppliedCode = '';
  const cliRunner = (executable, args) => {
    if (args.includes('run-code')) {
      suppliedCode = readFileSync(args[args.indexOf('--filename') + 1], 'utf8');
      return { ok: true, stdout: JSON.stringify({ result: JSON.stringify({
        status: 'verified', checks: { public_url: true, text: true, headings: true, lists: true },
      }) }) };
    }
    return { ok: true, stdout: '{}' };
  };
  const result = await updatePublishedItchDescription({
    outputRoot: root,
    slug: product.slug,
    releaseVersion: '0.2.0',
    store: { async loadProduct() { return product; }, productRoot() { return productRoot; } },
    cliRunner,
    headed: false,
    now: '2026-10-16T15:00:00.000Z',
  });
  assert.equal(result.status, 'verified');
  assert.match(result.presentation_hash, /^[a-f0-9]{64}$/u);
  assert.match(suppliedCode, /<h2>Included:<\/h2>/u);
  assert.match(suppliedCode, /<ul><li>Eight weapons<\/li><li>Matching effects<\/li><\/ul>/u);
});
