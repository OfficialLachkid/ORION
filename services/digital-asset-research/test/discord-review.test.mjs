import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildResearchEmbed, postResearchReview, recordResearchReviewDecision } from '../src/discord-review.mjs';

// Regression: 2026-11-04 → 2026-11-13 the nightly research pipeline
// crashed with `TypeError: Cannot read properties of undefined
// (reading 'runtimePaths')` because findOrCreateChannel was reaching
// into `options.config.runtimePaths`, but postResearchReview never
// forwarded `config` to it. Guard that the Discord post path only
// needs token + guildId + discord.{category,channel}_name, no more.
test('postResearchReview finds the research channel without needing runtimePaths', async () => {
  const requests = [];
  const fakeChannelsList = [
    { id: 'cat-1', type: 4, name: 'orion-research', parent_id: null },
    { id: 'chan-1', type: 0, name: 'digital-asset-research', parent_id: 'cat-1' },
  ];
  const fakeFetch = async (url, init) => {
    requests.push({ url, method: init?.method || 'GET' });
    if (String(url).endsWith('/guilds/guild-1/channels') && (init?.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => fakeChannelsList, text: async () => '' };
    }
    if (String(url).endsWith('/channels/chan-1/messages') && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ id: 'msg-1' }), text: async () => '' };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  };
  const result = await postResearchReview({
    runtimeConfig: { env: { DISCORD_BOT_TOKEN: 'tok' }, guildId: 'guild-1' },
    config: { discord: { category_name: 'ORION-Research', channel_name: 'digital-asset-research' } },
    report: { snapshot_count: 2, minimum_snapshots: 2, reason: 'ok' },
    recommendation: null,
    evidenceHash: 'a'.repeat(64),
    fetchImpl: fakeFetch,
  });
  assert.equal(result.channelId, 'chan-1');
  assert.equal(result.messageId, 'msg-1');
  assert.equal(requests.length, 2);
});

test('labels a quality-gated result as evidence monitoring without approval', () => {
  const embed = buildResearchEmbed({
    snapshot_count: 2,
    minimum_snapshots: 2,
    reason: 'No recommendation passed.',
    analysis_issue: 'At least two cited listing titles must support one concrete concept.',
  });
  assert.equal(embed.title, 'Digital Asset Research · EVIDENCE MONITORING');
  assert.equal(embed.fields[0].value, '**2** retained · **2** minimum');
  assert.match(embed.fields[1].value, /evidence-quality gates/iu);
  assert.match(embed.fields[2].value, /two cited listing titles/iu);
});

test('research approval writes an exact handoff and durable generation job', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-research-review-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const evidenceHash = 'a'.repeat(64);
  const persisted = [];
  const store = {
    async getRecommendation() {
      return {
        recommendation_id: 'pixel-effects-pack',
        evidence_hash: evidenceHash,
        status: 'awaiting_review',
        discord_channel_id: 'channel-1',
        discord_message_id: 'message-1',
        recommendation: {
          schema_version: '1.0',
          recommendation_id: 'pixel-effects-pack',
          action: 'new_product',
          existing_product_slug: null,
          title: 'Pixel Effects Pack',
          summary: 'Comparable listings remained visible across snapshots.',
          rationale: ['Two ranked snapshots contain the cited observations.'],
          confidence: 74,
          evidence_ids: ['11111111-1111-4111-8111-111111111111'],
          opportunity,
        },
      };
    },
    async insertReview(row) { persisted.push(row); },
    async updateRecommendation(id, patch) { persisted.push({ id, patch }); },
  };
  const result = await recordResearchReviewDecision({
    store,
    config: {
      guildId: 'guild-1',
      operatorUserIds: ['operator-1'],
      operatorRoleId: '',
      env: { DIGITAL_ASSET_RESEARCH_ARCHIVE_ROOT: root },
    },
    interaction: {
      id: 'interaction-1',
      type: 3,
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      member: { user: { id: 'operator-1' }, roles: [] },
      message: { id: 'message-1' },
      data: { custom_id: `dar|a|pixel-effects-pack|${evidenceHash.slice(0, 16)}` },
    },
  });
  const handoff = JSON.parse(await readFile(result.handoffPath, 'utf8'));
  const job = JSON.parse(await readFile(result.generationJobPath, 'utf8'));
  assert.equal(result.review.decision, 'approve_handoff');
  assert.equal(handoff.generation_enqueued, true);
  assert.equal(job.status, 'queued');
  assert.equal(job.evidence_hash, evidenceHash);
  assert.equal(job.opportunity.opportunity_id, opportunity.opportunity_id);
  assert.equal(handoff.opportunity.opportunity_id, opportunity.opportunity_id);
  assert.equal(persisted.length, 2);
});

test('extension approval stays a planning handoff until a versioned recipe is supported', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-research-extension-'));
  const opportunity = JSON.parse(await readFile(
    resolve(process.cwd(), 'services/digital-asset-engine/fixtures/sci-fi-plasma-rifle.opportunity.json'),
    'utf8',
  ));
  const evidenceHash = 'c'.repeat(64);
  const store = {
    async getRecommendation() {
      return {
        recommendation_id: 'extend-armory', evidence_hash: evidenceHash, status: 'awaiting_review',
        discord_channel_id: 'channel-1', discord_message_id: 'message-1',
        recommendation: {
          schema_version: '1.0', recommendation_id: 'extend-armory', simulation: false,
          action: 'extend_existing_product', existing_product_slug: 'neon-plasma-armory',
          title: 'Extend Armory', summary: 'Add evidence-backed items.', rationale: ['Observed demand.'],
          confidence: 74, evidence_ids: ['11111111-1111-4111-8111-111111111111'], opportunity,
        },
      };
    },
    async insertReview() {},
    async updateRecommendation() {},
  };
  const result = await recordResearchReviewDecision({
    store,
    enqueueGenerationJob: async () => { throw new Error('must not enqueue'); },
    config: {
      guildId: 'guild-1', operatorUserIds: ['operator-1'], operatorRoleId: '',
      env: { DIGITAL_ASSET_RESEARCH_ARCHIVE_ROOT: root },
    },
    interaction: {
      id: 'interaction-2', type: 3, guild_id: 'guild-1', channel_id: 'channel-1',
      member: { user: { id: 'operator-1' }, roles: [] }, message: { id: 'message-1' },
      data: { custom_id: `dar|a|extend-armory|${evidenceHash.slice(0, 16)}` },
    },
  });
  const handoff = JSON.parse(await readFile(result.handoffPath, 'utf8'));
  assert.equal(result.generationQueued, false);
  assert.equal(result.generationJobPath, null);
  assert.equal(handoff.generation_enqueued, false);
});
