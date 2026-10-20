import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildResearchEmbed, recordResearchReviewDecision } from '../src/discord-review.mjs';

test('labels a quality-gated result as evidence monitoring without approval', () => {
  const embed = buildResearchEmbed({
    snapshot_count: 2,
    minimum_snapshots: 2,
    reason: 'No recommendation passed.',
  });
  assert.equal(embed.title, 'Digital Asset Research · EVIDENCE MONITORING');
  assert.match(embed.fields[1].value, /evidence-quality gates/iu);
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
