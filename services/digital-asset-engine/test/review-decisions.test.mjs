import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  buildDigitalAssetReviewComponents,
  buildDigitalAssetReviewModal,
  getDigitalAssetReviewModalRequest,
  parseDigitalAssetReviewDecision,
} from '../src/review-components.mjs';
import {
  buildResolvedDigitalAssetReviewEmbeds,
  DigitalAssetReviewDecisionStore,
  recordDigitalAssetReviewDecision,
} from '../src/review-decisions.mjs';

const manifestHash = 'a'.repeat(64);
const assetHash = 'b'.repeat(64);
const context = {
  productSlug: 'neon-plasma-armory',
  assetId: 'asset-c219278675fe5836',
  manifestHash,
  manifestUrl: 'https://discord.com/channels/guild-1/channel-1/message-1',
};

function approveInteraction(overrides = {}) {
  return {
    id: 'interaction-1',
    type: 3,
    guild_id: 'guild-1',
    channel_id: 'thread-1',
    data: { custom_id: buildDigitalAssetReviewComponents(context)[0].components[0].custom_id },
    message: {
      id: 'asset-message-1',
      embeds: [{ title: '1/1 · Rail Rifle', fields: [{ name: 'Asset ID', value: '`asset-c219278675fe5836`' }] }],
    },
    member: {
      nick: 'Valen',
      roles: ['operator-role'],
      user: { id: 'reviewer-1', username: 'vbjservices' },
    },
    ...overrides,
  };
}

async function createArchiveFixture() {
  const archiveRoot = await mkdtemp(resolve(tmpdir(), 'orion-review-decision-'));
  const productRoot = resolve(archiveRoot, context.productSlug);
  await Promise.all([
    mkdir(resolve(productRoot, 'review'), { recursive: true }),
    mkdir(resolve(productRoot, 'exports', 'itch-preview'), { recursive: true }),
    mkdir(resolve(productRoot, 'validation'), { recursive: true }),
  ]);
  const product = {
    product_id: 'asset-product-e7bd21e31c69c03a',
    slug: context.productSlug,
    assets: [{
      asset_id: context.assetId,
      final_path: 'assets/items/rail-rifle.png',
      validation_path: 'validation/rail-rifle.json',
    }],
  };
  const state = {
    product_slug: context.productSlug,
    manifest_hash: manifestHash,
    channel_id: 'channel-1',
    thread_id: 'thread-1',
    overview_message_id: 'overview-1',
    asset_messages: { [context.assetId]: 'asset-message-1' },
  };
  const manifest = {
    manifest_hash: manifestHash,
    files: [{ path: 'assets/individual/rail-rifle.png', content_sha256: assetHash }],
  };
  await Promise.all([
    writeFile(resolve(productRoot, 'product.json'), JSON.stringify(product)),
    writeFile(resolve(productRoot, 'review', 'discord.json'), JSON.stringify(state)),
    writeFile(resolve(productRoot, 'exports', 'itch-preview', 'manifest.json'), JSON.stringify(manifest)),
    writeFile(resolve(productRoot, 'validation', 'rail-rifle.json'), JSON.stringify({
      metrics: { content_sha256: assetHash },
    })),
  ]);
  return archiveRoot;
}

test('asset review components provide three decisions and an overview link', () => {
  const rows = buildDigitalAssetReviewComponents(context);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].components.map((button) => button.label), [
    'Approve',
    'Request Changes',
    'Reject',
    'Open Manifest',
  ]);
  assert.ok(rows[0].components.slice(0, 3).every((button) => button.custom_id.length <= 100));
  assert.equal(rows[0].components[3].url, context.manifestUrl);
});

test('request changes opens a reason modal and parses its submission', () => {
  const customId = buildDigitalAssetReviewComponents(context)[0].components[1].custom_id;
  const request = getDigitalAssetReviewModalRequest({ type: 3, data: { custom_id: customId } });
  const modal = buildDigitalAssetReviewModal(request);
  assert.equal(modal.title, 'Request Asset Changes');
  const decision = parseDigitalAssetReviewDecision({
    type: 5,
    data: {
      custom_id: modal.custom_id,
      components: [{ components: [{ custom_id: 'reason', value: 'Increase silhouette separation.' }] }],
    },
  });
  assert.equal(decision.decision, 'request_changes');
  assert.equal(decision.reason, 'Increase silhouette separation.');
});

test('records an authorized decision only after matching T7 hashes and Discord IDs', async () => {
  const archiveRoot = await createArchiveFixture();
  const inserted = [];
  const result = await recordDigitalAssetReviewDecision({
    interaction: approveInteraction(),
    archiveRoot,
    config: {
      guildId: 'guild-1',
      operatorRoleId: 'operator-role',
      operatorUserIds: [],
      env: {},
    },
    store: { async insert(row) { inserted.push(row); } },
    now: '2026-10-14T10:00:00.000Z',
  });

  assert.equal(inserted.length, 1);
  assert.equal(result.row.product_id, 'asset-product-e7bd21e31c69c03a');
  assert.equal(result.row.release_id, `asset-release-${manifestHash.slice(0, 24)}`);
  assert.equal(result.row.asset_hash, assetHash);
  assert.equal(result.row.decision, 'approve');
  assert.equal(result.row.reviewer_discord_id, 'reviewer-1');
  assert.equal(result.messagePatch.components[0].components[0].label, 'Open Manifest');
  const resolvedEmbeds = buildResolvedDigitalAssetReviewEmbeds(
    approveInteraction().message.embeds,
    result.decision,
    result.actor,
  );
  assert.match(resolvedEmbeds[0].title, /APPROVED/u);
});

test('rejects asset decisions from users outside the operator allowlist', async () => {
  const archiveRoot = await createArchiveFixture();
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction: approveInteraction({
        member: { roles: [], user: { id: 'unknown-user', username: 'unknown' } },
      }),
      archiveRoot,
      config: {
        guildId: 'guild-1',
        operatorRoleId: 'operator-role',
        operatorUserIds: [],
        env: {},
      },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /approved ORION operator/u,
  );
});

test('rejects a button when its Discord message does not match canonical review state', async () => {
  const archiveRoot = await createArchiveFixture();
  const interaction = approveInteraction();
  interaction.message.id = 'wrong-message';
  await assert.rejects(
    recordDigitalAssetReviewDecision({
      interaction,
      archiveRoot,
      config: {
        guildId: 'guild-1',
        operatorRoleId: 'operator-role',
        operatorUserIds: [],
        env: {},
      },
      store: { async insert() { throw new Error('must not be called'); } },
    }),
    /does not match the canonical asset review message/u,
  );
});

test('Supabase decision store uses service credentials and interaction-id conflict safety', async () => {
  const calls = [];
  const store = new DigitalAssetReviewDecisionStore({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return {
        ok: true,
        status: 201,
        async text() { return '[]'; },
      };
    },
  });
  await store.insert({ discord_interaction_id: 'interaction-1' });

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://project.supabase.co/rest/v1/digital_asset_review_decisions?on_conflict=discord_interaction_id',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer service-secret');
  assert.match(calls[0].options.headers.Prefer, /ignore-duplicates/u);
});
