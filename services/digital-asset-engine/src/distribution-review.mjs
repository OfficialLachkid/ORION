import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest } from './discord-review.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';

const ACTION_ROW = 1;
const BUTTON = 2;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_LINK = 5;
const COMPONENT_PREFIX = 'dad';
const ACTION_CODES = Object.freeze({ approve_publish: 'p', keep_draft: 'k' });
const CODE_ACTIONS = Object.freeze({ p: 'approve_publish', k: 'keep_draft' });
const DECISION_TABLE = 'digital_asset_distribution_reviews';

function cleanSlug(value) {
  const result = String(value || '').trim();
  if (!/^[a-z0-9-]+$/u.test(result)) throw new Error('Product slug is invalid.');
  return result;
}

function customId(action, context) {
  const code = ACTION_CODES[action];
  if (!code) throw new Error(`Unsupported distribution action: ${action}`);
  return [COMPONENT_PREFIX, code, cleanSlug(context.productSlug), context.manifestHash.slice(0, 16)].join('|');
}

export function parseDigitalAssetDistributionCustomId(value) {
  const parts = String(value || '').split('|');
  if (parts.length !== 4 || parts[0] !== COMPONENT_PREFIX || !CODE_ACTIONS[parts[1]]) return null;
  if (!/^[a-z0-9-]+$/u.test(parts[2]) || !/^[a-f0-9]{16}$/u.test(parts[3])) return null;
  return {
    decision: CODE_ACTIONS[parts[1]],
    productSlug: parts[2],
    manifestHashPrefix: parts[3],
  };
}

export function isDigitalAssetDistributionInteraction(interaction) {
  return interaction?.type === 3 && Boolean(parseDigitalAssetDistributionCustomId(interaction?.data?.custom_id));
}

function link(label, url) {
  return { type: BUTTON, style: BUTTON_LINK, label, url };
}

export function buildDigitalAssetDistributionComponents(context) {
  const controls = [];
  if (context.status === 'awaiting_distribution_approval') {
    controls.push(
      {
        type: BUTTON,
        style: BUTTON_SUCCESS,
        label: 'Approve itch.io Publish',
        custom_id: customId('approve_publish', context),
      },
      {
        type: BUTTON,
        style: BUTTON_SECONDARY,
        label: 'Keep Draft',
        custom_id: customId('keep_draft', context),
      },
    );
  }
  controls.push(link('Open itch.io Draft', context.itchUrl));
  if (context.status === 'blocked_seller_setup') {
    controls.push(link('Complete Tax Setup', context.taxInformationUrl));
  }
  controls.push(link('Open Manifest', context.manifestUrl));
  return [{ type: ACTION_ROW, components: controls }];
}

export function buildDistributionReviewEmbeds(embeds, state, actor = null) {
  const current = Array.isArray(embeds) ? embeds : [];
  const ready = state.status === 'awaiting_distribution_approval';
  const approved = state.status === 'distribution_approved';
  const held = state.status === 'held';
  const statusLabel = approved
    ? 'DISTRIBUTION APPROVED'
    : held ? 'KEPT IN DRAFT' : ready ? 'DISTRIBUTION APPROVAL REQUIRED' : 'DISTRIBUTION BLOCKED';
  const color = approved ? 0x57f287 : held ? 0xfee75c : ready ? 0x5865f2 : 0xed4245;
  const sellerValue = state.seller_ready
    ? 'Ready — payout mode and tax interview verified.'
    : `Blocked — ${(state.blockers || []).join(', ') || 'seller readiness was not verified'}.`;
  const decisionValue = actor
    ? `${approved ? 'Approved for itch.io publication' : 'Kept as an itch.io draft'} by ${actor.displayName}.`
    : ready
      ? 'Use the publish approval only after reviewing the exact draft linked below.'
      : 'Complete the listed seller setup, then rerun the distribution preflight.';
  return current.map((embed, index) => ({
    ...embed,
    color,
    ...(index === 0 ? {
      title: `${String(embed.title || 'Pack Review').replace(/ · (PACK APPROVED|DISTRIBUTION APPROVAL REQUIRED|DISTRIBUTION BLOCKED|DISTRIBUTION APPROVED|KEPT IN DRAFT)$/u, '')} · ${statusLabel}`,
      description: approved
        ? 'Creative approval and a separate distribution authorization are recorded for this exact manifest.'
        : 'The pack is creatively approved. Public visibility still requires this separate distribution gate.',
      fields: [
        ...(Array.isArray(embed.fields)
          ? embed.fields.filter((field) => !['Distribution', 'Seller readiness'].includes(field?.name))
          : []),
        { name: 'Seller readiness', value: sellerValue, inline: false },
        { name: 'Distribution', value: decisionValue, inline: false },
      ],
    } : {}),
  }));
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Distribution decision came from an unexpected Discord guild.');
  }
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (!(config.operatorUserIds || []).includes(userId)
    && !(config.operatorRoleId && roles.includes(config.operatorRoleId))) {
    throw new Error('Only an approved ORION operator can approve distribution.');
  }
}

function actorFromInteraction(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return {
    id: String(user.id || ''),
    displayName: String(interaction?.member?.nick || user.global_name || user.username || user.id || 'operator'),
  };
}

function supabaseHeaders(apiKey) {
  return {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=representation',
  };
}

export class DigitalAssetDistributionDecisionStore {
  constructor(options = {}) {
    this.supabaseUrl = String(options.supabaseUrl || '').replace(/\/+$/u, '');
    this.apiKey = String(options.apiKey || '');
    this.fetchImpl = options.fetchImpl || fetch;
    if (!this.supabaseUrl || !this.apiKey) {
      throw new Error('Distribution persistence requires SUPABASE_URL and SUPABASE_SECRET_KEY.');
    }
  }

  async insert(row) {
    const url = new URL(`/rest/v1/${DECISION_TABLE}`, this.supabaseUrl);
    url.searchParams.set('on_conflict', 'discord_interaction_id');
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: supabaseHeaders(this.apiKey),
      body: JSON.stringify(row),
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Supabase distribution decision insert failed (${response.status}): ${body}`);
    }
    return body ? JSON.parse(body) : [];
  }
}

export async function postDigitalAssetDistributionReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Distribution review requires Discord runtime credentials.');
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({ productRoot, releaseVersion: options.releaseVersion });
  const [discordState, itchState, sellerState] = await Promise.all([
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readJson(resolve(productRoot, 'review', 'itch.json')),
    readJson(resolve(productRoot, 'review', 'itch-seller.json')),
  ]);
  const manifestHash = packaged.manifest.manifest_hash;
  const listingHash = packaged.manifest.listing_hash;
  if (discordState.last_decision?.decision !== 'approve'
    || discordState.manifest_hash !== manifestHash
    || discordState.listing_hash !== listingHash) {
    throw new Error('Distribution review requires creative approval for this exact manifest and listing.');
  }
  if (itchState.status !== 'verified'
    || itchState.manifest_hash !== manifestHash
    || itchState.listing_hash !== listingHash) {
    throw new Error('Distribution review requires the exact verified itch.io draft.');
  }
  if (sellerState.manifest_hash !== manifestHash || sellerState.listing_hash !== listingHash) {
    throw new Error('Seller readiness belongs to a different release candidate.');
  }
  const sellerReady = sellerState.status === 'ready'
    && sellerState.tax_interview_complete === true
    && ['collected_by_itch', 'direct_to_seller'].includes(sellerState.payout_mode);
  const state = {
    schema_version: '1.0',
    status: sellerReady ? 'awaiting_distribution_approval' : 'blocked_seller_setup',
    product_id: product.product_id,
    product_slug: product.slug,
    target_version: packaged.manifest.target_version || product.version || null,
    manifest_hash: manifestHash,
    listing_hash: listingHash,
    marketplace: 'itch.io',
    channel_id: discordState.channel_id,
    discord_message_id: discordState.overview_message_id,
    public_url: itchState.public_url,
    edit_url: itchState.edit_url,
    seller_ready: sellerReady,
    payout_mode: sellerState.payout_mode,
    tax_interview_complete: sellerState.tax_interview_complete,
    blockers: sellerState.blockers || [],
    checked_at: sellerState.checked_at,
    updated_at: options.now || new Date().toISOString(),
  };
  const manifestUrl = `https://discord.com/channels/${guildId}/${state.channel_id}/${state.discord_message_id}`;
  const componentContext = {
    status: state.status,
    productSlug: product.slug,
    manifestHash,
    itchUrl: itchState.public_url,
    taxInformationUrl: sellerState.tax_information_url,
    manifestUrl,
  };
  const current = await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    fetchImpl: options.fetchImpl,
  });
  await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    method: 'PATCH',
    body: {
      embeds: buildDistributionReviewEmbeds(current?.embeds, state),
      components: buildDigitalAssetDistributionComponents(componentContext),
    },
    fetchImpl: options.fetchImpl,
  });
  const statePath = resolve(productRoot, 'review', 'distribution.json');
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { ...state, statePath };
}

export async function recordDigitalAssetDistributionDecision(options) {
  const reference = parseDigitalAssetDistributionCustomId(options.interaction?.data?.custom_id);
  if (!reference) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const archiveRoot = String(options.archiveRoot || config?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for distribution decisions.');
  const productRoot = resolve(archiveRoot, reference.productSlug);
  const [product, state] = await Promise.all([
    readJson(resolve(productRoot, 'product.json')),
    readJson(resolve(productRoot, 'review', 'distribution.json')),
  ]);
  if (state.status !== 'awaiting_distribution_approval' || state.seller_ready !== true) {
    throw new Error('This release is not ready for distribution approval.');
  }
  if (state.product_slug !== reference.productSlug
    || !state.manifest_hash.startsWith(reference.manifestHashPrefix)) {
    throw new Error('This distribution action belongs to a stale manifest.');
  }
  if (String(state.channel_id) !== String(options.interaction.channel_id || '')
    || String(state.discord_message_id) !== String(options.interaction.message?.id || '')) {
    throw new Error('This distribution action came from an unexpected Discord message.');
  }
  const actor = actorFromInteraction(options.interaction);
  const decidedAt = options.now || new Date().toISOString();
  const row = {
    product_id: product.product_id,
    release_id: `asset-release-${state.manifest_hash.slice(0, 24)}`,
    manifest_hash: state.manifest_hash,
    listing_hash: state.listing_hash,
    marketplace: state.marketplace,
    decision: reference.decision,
    reviewer_discord_id: actor.id,
    reason: '',
    decided_at: decidedAt,
    discord_message_id: state.discord_message_id,
    discord_interaction_id: String(options.interaction.id || ''),
  };
  if (!row.discord_interaction_id) throw new Error('Discord interaction ID is required.');
  const decisionStore = options.store || new DigitalAssetDistributionDecisionStore({
    supabaseUrl: config?.env?.SUPABASE_URL,
    apiKey: config?.env?.SUPABASE_SECRET_KEY,
    fetchImpl: options.fetchImpl,
  });
  await decisionStore.insert(row);
  state.status = reference.decision === 'approve_publish' ? 'distribution_approved' : 'held';
  state.last_decision = {
    decision: reference.decision,
    reviewer_discord_id: actor.id,
    decided_at: decidedAt,
    discord_interaction_id: row.discord_interaction_id,
  };
  await writeFile(resolve(productRoot, 'review', 'distribution.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return {
    row,
    actor,
    state,
    channelId: state.channel_id,
    messageId: state.discord_message_id,
    messagePatch: {
      components: [{
        type: ACTION_ROW,
        components: [
          link('Open itch.io Draft', state.public_url),
          link('Open Manifest', `https://discord.com/channels/${config.guildId}/${state.channel_id}/${state.discord_message_id}`),
        ],
      }],
    },
  };
}
