import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  queueItchThemeRevision,
  recoverItchThemeRevisionJobs,
  runItchThemeRevisionJob,
} from '../src/theme-revision.mjs';

const manifestHash = 'a'.repeat(64);
const listingHash = 'b'.repeat(64);
const parentThemeHash = 'c'.repeat(64);
const nextThemeHash = 'd'.repeat(64);
const design = {
  colors: {
    background: '#171329', panel: '#2c204f', text: '#fff0b8',
    link: '#ead7ff', header: '#9789af', button: '#8157a6',
  },
  panel_alpha: 0.9,
  typography: { body_font: 'Lato', header_font: 'Pixel', size: 'Medium' },
  screenshots: 'Sidebar',
  rationale: 'Arcane storefront.',
};

async function createFixture() {
  const outputRoot = await mkdtemp(resolve(tmpdir(), 'orion-theme-revision-'));
  const product = { product_id: 'product-1', slug: 'arcane-relics-potions' };
  const productRoot = resolve(outputRoot, product.slug);
  await mkdir(resolve(productRoot, 'review'), { recursive: true });
  await writeFile(resolve(productRoot, 'review', 'itch-theme.json'), JSON.stringify({
    status: 'changes_requested',
    product_slug: product.slug,
    target_version: '0.1.0',
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    theme_hash: parentThemeHash,
    candidate_path: 'review/theme/candidates/parent',
    design,
    channel_id: 'channel-1',
    discord_message_id: 'message-1',
    public_url: 'https://vbjservices.itch.io/arcane-relics-potions',
    storefront_stage: 'public',
    last_decision: {
      decision: 'request_changes',
      reviewer_discord_id: 'operator-1',
      reason: 'Remove the white lower background section.',
      discord_interaction_id: 'interaction-1',
    },
  }));
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

test('theme feedback queues and completes an immutable in-place revision', async () => {
  const fixture = await createFixture();
  const queued = await queueItchThemeRevision({
    archiveRoot: fixture.outputRoot,
    productSlug: fixture.product.slug,
    product: fixture.product,
    store: fixture.store,
    now: '2026-10-22T10:00:00.000Z',
  });
  assert.equal(queued.state.status, 'queued');
  assert.equal(queued.state.revision_number, 2);
  assert.equal(queued.state.parent_theme_hash, parentThemeHash);
  assert.equal(queued.state.release_version, null);

  let prepared;
  const completed = await runItchThemeRevisionJob({
    statePath: queued.statePath,
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'token' } },
    now: '2026-10-22T10:01:00.000Z',
    async prepareTheme(options) {
      prepared = options;
      return { theme_hash: nextThemeHash, candidate_path: 'review/theme/candidates/next' };
    },
    async postTheme({ candidate }) {
      return { ...candidate, discord_message_id: 'message-1' };
    },
  });
  assert.equal(prepared.releaseVersion, undefined);
  assert.deepEqual(prepared.revision, {
    number: 2,
    parent_theme_hash: parentThemeHash,
    feedback: 'Remove the white lower background section.',
    previous_design: design,
  });
  assert.equal(completed.status, 'completed');
  assert.equal(completed.candidate_theme_hash, nextThemeHash);
  assert.equal(completed.discord_message_id, 'message-1');
  const stored = JSON.parse(await readFile(queued.statePath, 'utf8'));
  assert.equal(stored.worker_pid, null);
});

test('theme revision queue is idempotent for a Discord interaction', async () => {
  const fixture = await createFixture();
  const options = {
    archiveRoot: fixture.outputRoot,
    productSlug: fixture.product.slug,
    product: fixture.product,
    store: fixture.store,
  };
  const first = await queueItchThemeRevision(options);
  const second = await queueItchThemeRevision(options);
  assert.equal(first.reused, false);
  assert.equal(second.reused, true);
  assert.equal(second.state.created_at, first.state.created_at);
});

test('theme revision recovery requeues an interrupted worker once', async () => {
  const fixture = await createFixture();
  const queued = await queueItchThemeRevision({
    archiveRoot: fixture.outputRoot,
    productSlug: fixture.product.slug,
    product: fixture.product,
    store: fixture.store,
  });
  await writeFile(queued.statePath, JSON.stringify({ ...queued.state, status: 'running', worker_pid: 999999 }));
  const scheduled = [];
  const report = await recoverItchThemeRevisionJobs({
    archiveRoot: fixture.outputRoot,
    processAlive: () => false,
    scheduleJob(path) { scheduled.push(path); return true; },
    now: '2026-10-22T10:02:00.000Z',
  });
  assert.equal(report.recovered.length, 1);
  assert.deepEqual(scheduled, [queued.statePath]);
  const stored = JSON.parse(await readFile(queued.statePath, 'utf8'));
  assert.equal(stored.status, 'queued');
  assert.equal(stored.recovery_count, 1);
});
