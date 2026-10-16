import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDigitalAssetDistributionComponents,
  buildDistributionReviewEmbeds,
  DigitalAssetDistributionDecisionStore,
  parseDigitalAssetDistributionCustomId,
} from '../src/distribution-review.mjs';
import { buildItchSellerPreflightCode } from '../src/itch-seller-preflight.mjs';

const context = {
  status: 'awaiting_distribution_approval',
  productSlug: 'neon-plasma-armory',
  manifestHash: 'a'.repeat(64),
  itchUrl: 'https://vbjservices.itch.io/asset-pack-test?secret=review',
  taxInformationUrl: 'https://itch.io/user/settings/seller/tax-information',
  manifestUrl: 'https://discord.com/channels/guild/channel/message',
};

test('ready distribution gate is separate and bound to the exact manifest', () => {
  const components = buildDigitalAssetDistributionComponents(context)[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Approve itch.io Publish',
    'Keep Draft',
    'Open itch.io Draft',
    'Open Manifest',
  ]);
  assert.deepEqual(parseDigitalAssetDistributionCustomId(components[0].custom_id), {
    decision: 'approve_publish',
    productSlug: context.productSlug,
    manifestHashPrefix: 'a'.repeat(16),
  });
});

test('blocked seller setup exposes remediation but no publish action', () => {
  const components = buildDigitalAssetDistributionComponents({
    ...context,
    status: 'blocked_seller_setup',
  })[0].components;
  assert.deepEqual(components.map((component) => component.label), [
    'Open itch.io Draft',
    'Complete Tax Setup',
    'Open Manifest',
  ]);
  assert.ok(components.every((component) => component.style === 5));
});

test('distribution embed communicates creative approval without implying publication', () => {
  const [embed] = buildDistributionReviewEmbeds([{
    title: 'Neon Plasma Armory · Pack Review · PACK APPROVED',
    fields: [{ name: 'Manifest', value: '`hash`' }],
  }], {
    status: 'blocked_seller_setup',
    seller_ready: false,
    blockers: ['tax_interview_incomplete'],
  });
  assert.match(embed.title, /DISTRIBUTION BLOCKED/u);
  assert.match(embed.description, /creatively approved/u);
  assert.match(embed.fields.find((field) => field.name === 'Seller readiness').value, /tax_interview_incomplete/u);
});

test('seller preflight checks payout mode and fails closed on incomplete tax setup', () => {
  const code = buildItchSellerPreflightCode();
  assert.match(code, /user\/settings\/seller/u);
  assert.match(code, /collected by itch/u);
  assert.match(code, /tax_interview_incomplete/u);
  assert.match(code, /begin interview/u);
});

test('distribution store uses the append-only Supabase endpoint', async () => {
  const calls = [];
  const store = new DigitalAssetDistributionDecisionStore({
    supabaseUrl: 'https://project.supabase.co',
    apiKey: 'service-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 201, async text() { return '[]'; } };
    },
  });
  await store.insert({ discord_interaction_id: 'interaction-1' });
  assert.equal(
    calls[0].url,
    'https://project.supabase.co/rest/v1/digital_asset_distribution_reviews?on_conflict=discord_interaction_id',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer service-secret');
});
