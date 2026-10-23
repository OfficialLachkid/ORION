import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { discordRequest } from '../../digital-asset-engine/src/discord-review.mjs';
import { DigitalAssetResearchStore } from './research-store.mjs';
import { ResearchRecommendationSchema, ResearchReviewDecisionSchema } from './schemas.mjs';
import { enqueueResearchGenerationJob } from './generation-jobs.mjs';

const PREFIX = 'dar';
const CATEGORY = 4;
const TEXT_CHANNEL = 0;

function clean(value, maximum = 1024) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

function customId(action, recommendationId, evidenceHash) {
  return [PREFIX, action, recommendationId, evidenceHash.slice(0, 16)].join('|');
}

function parseCustomId(value) {
  const [prefix, action, recommendationId, hashPrefix, extra] = String(value || '').split('|');
  if (extra !== undefined || prefix !== PREFIX || !['a', 'm', 'r'].includes(action)) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,47}$/u.test(recommendationId) || !/^[a-f0-9]{16}$/u.test(hashPrefix)) return null;
  return { action, recommendationId, hashPrefix };
}

async function findOrCreateChannel(options) {
  const channels = await discordRequest(options.token, `/guilds/${options.guildId}/channels`, {
    fetchImpl: options.fetchImpl,
  });
  const category = channels.find((item) => item.type === CATEGORY
    && String(item.name).toLowerCase() === options.categoryName.toLowerCase());
  if (!category) throw new Error(`Discord category "${options.categoryName}" was not found.`);
  const existing = channels.find((item) => item.type === TEXT_CHANNEL
    && item.parent_id === category.id && item.name === options.channelName);
  if (existing) return existing;
  return discordRequest(options.token, `/guilds/${options.guildId}/channels`, {
    method: 'POST',
    body: {
      type: TEXT_CHANNEL,
      name: options.channelName,
      parent_id: category.id,
      topic: 'Evidence-backed digital asset opportunities. Human approval is required before generation planning.',
    },
    fetchImpl: options.fetchImpl,
  });
}

export function buildResearchEmbed(report, recommendation = null) {
  if (!recommendation) {
    const baseline = report.snapshot_count < report.minimum_snapshots;
    return {
      title: baseline
        ? 'Digital Asset Research · BASELINE MONITORING'
        : 'Digital Asset Research · EVIDENCE MONITORING',
      color: 0x5865f2,
      description: report.reason,
      fields: [
        {
          name: 'Comparable snapshots (rolling window)',
          value: `**${report.snapshot_count}** retained · **${report.minimum_snapshots}** minimum`,
          inline: true,
        },
        {
          name: 'Decision gate',
          value: baseline
            ? 'No approval is available until comparable evidence exists.'
            : 'No approval is available because no recommendation passed the evidence-quality gates.',
          inline: false,
        },
      ],
    };
  }
  return {
    title: recommendation.simulation
      ? `${recommendation.title} · WORKFLOW SIMULATION`
      : `${recommendation.title} · RESEARCH RECOMMENDATION`,
    color: 0x35d9ff,
    description: clean(recommendation.summary, 4000),
    fields: [
      { name: 'Action', value: `**${recommendation.action === 'new_product' ? 'Create a new product' : `Extend ${recommendation.existing_product_slug}`}**`, inline: true },
      { name: 'Confidence', value: `**${recommendation.confidence}%**`, inline: true },
      { name: 'Evidence', value: `**${recommendation.evidence_ids.length}** cited observations across **${report.snapshot_count}** snapshots`, inline: true },
      { name: 'Why', value: recommendation.rationale.map((item) => `- ${clean(item, 350)}`).join('\n'), inline: false },
      ...(recommendation.simulation ? [{
        name: 'Simulation notice',
        value: 'This candidate tests ORION\'s workflow. Its product choice is **not** presented as a market conclusion.',
        inline: false,
      }] : []),
      {
        name: 'Safety boundary',
        value: recommendation.action === 'new_product'
          ? 'Approval queues local generation. It does **not** create an itch.io page or authorize publication.'
          : 'Approval creates an extension handoff only. Versioned extension generation remains blocked until its recipe is supported.',
        inline: false,
      },
    ],
    footer: { text: 'itch.io ranks are demand proxies, not sales counts' },
  };
}

export async function postResearchReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Research Discord posting requires bot token and guild ID.');
  const channel = await findOrCreateChannel({
    token,
    guildId,
    categoryName: options.config.discord.category_name,
    channelName: options.config.discord.channel_name,
    fetchImpl: options.fetchImpl,
  });
  const recommendation = options.recommendation || null;
  const components = recommendation ? [{
    type: 1,
    components: [
      {
        type: 2,
        style: 3,
        label: recommendation.action === 'new_product' ? 'Approve & Queue Generation' : 'Approve Extension Handoff',
        custom_id: customId('a', recommendation.recommendation_id, options.evidenceHash),
      },
      { type: 2, style: 2, label: 'Keep Monitoring', custom_id: customId('m', recommendation.recommendation_id, options.evidenceHash) },
      { type: 2, style: 4, label: 'Reject', custom_id: customId('r', recommendation.recommendation_id, options.evidenceHash) },
    ],
  }] : [];
  const message = await discordRequest(token, `/channels/${channel.id}/messages`, {
    method: 'POST',
    body: { embeds: [buildResearchEmbed(options.report, recommendation)], components },
    fetchImpl: options.fetchImpl,
  });
  return { channelId: channel.id, messageId: message.id };
}

export function isResearchReviewInteraction(interaction) {
  return interaction?.type === 3 && Boolean(parseCustomId(interaction?.data?.custom_id));
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Research decision came from an unexpected Discord guild.');
  }
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = interaction?.member?.roles || [];
  if (!(config.operatorUserIds || []).includes(userId)
    && !(config.operatorRoleId && roles.includes(config.operatorRoleId))) {
    throw new Error('Only an approved ORION operator can review research recommendations.');
  }
}

function archiveRoot(config) {
  const explicit = String(config.env.DIGITAL_ASSET_RESEARCH_ARCHIVE_ROOT || '').trim();
  if (explicit) return resolve(explicit);
  const products = String(config.env.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!products) throw new Error('DIGITAL_ASSET_RESEARCH_ARCHIVE_ROOT or DIGITAL_ASSET_ARCHIVE_ROOT is required.');
  return resolve(products, '..', 'research');
}

export async function recordResearchReviewDecision(options) {
  const reference = parseCustomId(options.interaction?.data?.custom_id);
  if (!reference || !isResearchReviewInteraction(options.interaction)) return null;
  assertAuthorized(options.interaction, options.config);
  const store = options.store || new DigitalAssetResearchStore({
    supabaseUrl: options.config.env.SUPABASE_URL,
    apiKey: options.config.env.SUPABASE_SECRET_KEY || options.config.env.SUPABASE_SERVICE_ROLE_KEY,
    fetchImpl: options.fetchImpl,
  });
  const row = await store.getRecommendation(reference.recommendationId);
  if (!row || row.status !== 'awaiting_review') throw new Error('This recommendation is no longer awaiting review.');
  if (!row.evidence_hash.startsWith(reference.hashPrefix)) throw new Error('This action belongs to stale research evidence.');
  if (String(row.discord_channel_id) !== String(options.interaction.channel_id)
    || String(row.discord_message_id) !== String(options.interaction.message?.id || '')) {
    throw new Error('This action belongs to a different Discord research message.');
  }
  const decisions = { a: 'approve_handoff', m: 'monitor', r: 'reject' };
  const decision = decisions[reference.action];
  const actorId = String(options.interaction?.member?.user?.id || options.interaction?.user?.id || '');
  const decidedAt = new Date().toISOString();
  const review = ResearchReviewDecisionSchema.parse({
    recommendation_id: reference.recommendationId,
    evidence_hash: row.evidence_hash,
    decision,
    reviewer_discord_id: actorId,
    reason: '',
    decided_at: decidedAt,
    discord_message_id: row.discord_message_id,
    discord_interaction_id: String(options.interaction.id || ''),
  });
  await store.insertReview(review);
  let handoffPath = null;
  let generationJob = null;
  if (decision === 'approve_handoff') {
    const recommendation = ResearchRecommendationSchema.parse(row.recommendation);
    handoffPath = resolve(archiveRoot(options.config), 'approved', recommendation.recommendation_id, 'product-opportunity.json');
    if (recommendation.action === 'new_product') {
      generationJob = await (options.enqueueGenerationJob || enqueueResearchGenerationJob)({
        archiveRoot: archiveRoot(options.config),
        recommendation,
        evidenceHash: row.evidence_hash,
        queuedAt: decidedAt,
        queuedByDiscordId: actorId,
        researchChannelId: row.discord_channel_id,
        researchMessageId: row.discord_message_id,
      });
    }
    await mkdir(dirname(handoffPath), { recursive: true });
    await writeFile(handoffPath, `${JSON.stringify({
      approved_at: decidedAt,
      approved_by_discord_id: actorId,
      evidence_hash: row.evidence_hash,
      recommendation_id: recommendation.recommendation_id,
      action: recommendation.action,
      existing_product_slug: recommendation.existing_product_slug,
      simulation: recommendation.simulation,
      generation_enqueued: Boolean(generationJob),
      generation_job_path: generationJob?.path || null,
      generation_job_hash: generationJob?.jobHash || null,
      opportunity: recommendation.opportunity,
    }, null, 2)}\n`, 'utf8');
  }
  await store.updateRecommendation(reference.recommendationId, {
    status: decision === 'approve_handoff' ? 'approved_handoff' : decision,
    decided_at: decidedAt,
  });
  return {
    review,
    handoffPath,
    generationJobPath: generationJob?.path || null,
    generationQueued: Boolean(generationJob),
    channelId: row.discord_channel_id,
    messageId: row.discord_message_id,
    messagePatch: {
      components: [],
      content: decision === 'approve_handoff'
        ? generationJob
          ? 'Research handoff approved. A durable local generation job was queued; marketplace staging remains blocked.'
          : 'Extension handoff approved. No generation job was started because versioned extension recipes require a separate guarded workflow.'
        : decision === 'monitor' ? 'Recommendation kept in monitoring.' : 'Recommendation rejected.',
    },
  };
}

export function researchEvidenceHash(report, recommendation) {
  return createHash('sha256').update(JSON.stringify({ report, recommendation })).digest('hex');
}
