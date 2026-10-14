import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import {
  buildResolvedDigitalAssetReviewComponents,
  parseDigitalAssetReviewDecision,
} from './review-components.mjs';

const DECISION_TABLE = 'digital_asset_review_decisions';
const DECISION_COLORS = Object.freeze({
  approve: 0x57f287,
  request_changes: 0xfee75c,
  reject: 0xed4245,
});
const DECISION_LABELS = Object.freeze({
  approve: 'APPROVED',
  request_changes: 'CHANGES REQUESTED',
  reject: 'REJECTED',
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function isAuthorizedOperator(interaction, config) {
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (userId && (config.operatorUserIds || []).includes(userId)) return true;
  if (config.operatorRoleId && roles.includes(config.operatorRoleId)) return true;
  return false;
}

function createHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=representation',
  };
}

export class DigitalAssetReviewDecisionStore {
  constructor(options = {}) {
    this.supabaseUrl = String(options.supabaseUrl || '').replace(/\/+$/u, '');
    this.apiKey = String(options.apiKey || '');
    this.fetchImpl = options.fetchImpl || fetch;
    if (!this.supabaseUrl || !this.apiKey) {
      throw new Error('Digital asset review persistence requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    }
  }

  async insert(decision) {
    const url = new URL(`/rest/v1/${DECISION_TABLE}`, this.supabaseUrl);
    url.searchParams.set('on_conflict', 'discord_interaction_id');
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: createHeaders(this.apiKey),
      body: JSON.stringify(decision),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase digital asset decision insert failed (${response.status}): ${bodyText}`);
    }
    return bodyText ? JSON.parse(bodyText) : [];
  }
}

function resolveArchiveRoot(options, config) {
  const root = String(options.archiveRoot || config?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!root) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for digital asset review decisions.');
  return resolve(root);
}

async function loadReviewContext({ archiveRoot, reference, interaction }) {
  const productRoot = resolve(archiveRoot, reference.productSlug);
  const [product, reviewState, manifest] = await Promise.all([
    readJson(resolve(productRoot, 'product.json')),
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readJson(resolve(productRoot, 'exports', 'itch-preview', 'manifest.json')),
  ]);
  if (product.slug !== reference.productSlug || reviewState.product_slug !== reference.productSlug) {
    throw new Error('The Discord review reference does not match the canonical product.');
  }
  if (manifest.manifest_hash !== reviewState.manifest_hash
    || !manifest.manifest_hash.startsWith(reference.manifestHashPrefix)) {
    throw new Error('This asset button belongs to a stale manifest.');
  }
  if (String(reviewState.thread_id) !== String(interaction.channel_id || '')) {
    throw new Error('This asset decision came from an unexpected Discord thread.');
  }
  const messageId = String(reviewState.asset_messages?.[reference.assetId] || '');
  if (!messageId) throw new Error('The asset is not registered in this Discord review.');
  if (interaction.message?.id && String(interaction.message.id) !== messageId) {
    throw new Error('The Discord message does not match the canonical asset review message.');
  }
  const asset = product.assets.find((candidate) => candidate.asset_id === reference.assetId);
  if (!asset) throw new Error('The asset no longer exists in the canonical product.');
  const validation = await readJson(resolve(productRoot, asset.validation_path));
  const assetHash = String(validation?.metrics?.content_sha256 || '');
  const exportedAsset = manifest.files?.find((file) => (
    file.path === `assets/individual/${basename(asset.final_path)}`
  ));
  if (!/^[a-f0-9]{64}$/u.test(assetHash) || exportedAsset?.content_sha256 !== assetHash) {
    throw new Error('The canonical asset hash does not match the reviewed export.');
  }
  return { product, reviewState, manifest, asset, assetHash, messageId };
}

function actorFromInteraction(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return {
    id: String(user.id || ''),
    displayName: String(interaction?.member?.nick || user.global_name || user.username || user.id || 'operator'),
  };
}

function decisionFieldValue(decision, actor) {
  const reason = decision.reason ? `\n${decision.reason}` : '';
  return `${DECISION_LABELS[decision.decision]} by ${actor.displayName}${reason}`.slice(0, 1024);
}

export function buildResolvedDigitalAssetReviewEmbeds(embeds, decision, actor) {
  const current = Array.isArray(embeds) ? embeds : [];
  return current.map((embed, index) => ({
    ...embed,
    color: DECISION_COLORS[decision.decision],
    ...(index === 0 ? {
      title: `${String(embed.title || 'Asset Review').replace(/ · (APPROVED|CHANGES REQUESTED|REJECTED)$/u, '')} · ${DECISION_LABELS[decision.decision]}`,
      description: 'Decision recorded for this exact asset and manifest.',
      fields: [
        ...(Array.isArray(embed.fields) ? embed.fields.filter((field) => field?.name !== 'Decision') : []),
        { name: 'Decision', value: decisionFieldValue(decision, actor), inline: false },
      ],
    } : {}),
  }));
}

export async function recordDigitalAssetReviewDecision(options) {
  const reference = parseDigitalAssetReviewDecision(options.interaction);
  if (!reference) return null;
  const config = options.config || {};
  if (config.guildId && String(options.interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Digital asset decision came from an unexpected Discord guild.');
  }
  if (!isAuthorizedOperator(options.interaction, config)) {
    throw new Error('Only an approved ORION operator can review digital assets.');
  }
  const archiveRoot = resolveArchiveRoot(options, config);
  const context = await loadReviewContext({ archiveRoot, reference, interaction: options.interaction });
  const actor = actorFromInteraction(options.interaction);
  const decidedAt = options.now || new Date().toISOString();
  const row = {
    product_id: context.product.product_id,
    release_id: `asset-release-${context.manifest.manifest_hash.slice(0, 24)}`,
    manifest_hash: context.manifest.manifest_hash,
    asset_id: context.asset.asset_id,
    asset_hash: context.assetHash,
    decision: reference.decision,
    reviewer_discord_id: actor.id,
    reason: reference.reason,
    decided_at: decidedAt,
    discord_message_id: context.messageId,
    discord_interaction_id: String(options.interaction.id || ''),
  };
  if (!row.discord_interaction_id) throw new Error('Discord interaction ID is required for idempotent persistence.');
  const store = options.store || new DigitalAssetReviewDecisionStore({
    supabaseUrl: config?.env?.SUPABASE_URL,
    apiKey: config?.env?.SUPABASE_SECRET_KEY,
    fetchImpl: options.fetchImpl,
  });
  await store.insert(row);
  const manifestUrl = `https://discord.com/channels/${config.guildId}/${context.reviewState.channel_id}/${context.reviewState.overview_message_id}`;
  return {
    row,
    decision: reference,
    actor,
    channelId: context.reviewState.thread_id,
    messageId: context.messageId,
    messagePatch: {
      components: buildResolvedDigitalAssetReviewComponents(manifestUrl),
    },
  };
}
