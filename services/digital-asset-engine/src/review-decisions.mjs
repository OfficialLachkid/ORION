import { readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import {
  buildDigitalAssetReviewModal,
  buildResolvedDigitalAssetReviewComponents,
  getDigitalAssetReviewModalRequest,
  parseDigitalAssetReviewDecision,
} from './review-components.mjs';

const DECISION_TABLE = 'digital_asset_release_reviews';
const DECISION_COLORS = Object.freeze({
  approve: 0x57f287,
  request_changes: 0xfee75c,
  reject: 0xed4245,
});
const DECISION_LABELS = Object.freeze({
  approve: 'PACK APPROVED',
  request_changes: 'PACK CHANGES REQUESTED',
  reject: 'PACK REJECTED',
});

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isAuthorizedOperator(interaction, config) {
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (userId && (config.operatorUserIds || []).includes(userId)) return true;
  if (config.operatorRoleId && roles.includes(config.operatorRoleId)) return true;
  return false;
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Digital asset decision came from an unexpected Discord guild.');
  }
  if (!isAuthorizedOperator(interaction, config)) {
    throw new Error('Only an approved ORION operator can review digital assets.');
  }
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
      throw new Error(`Supabase digital asset release review insert failed (${response.status}): ${bodyText}`);
    }
    return bodyText ? JSON.parse(bodyText) : [];
  }
}

function resolveArchiveRoot(options, config) {
  const root = String(options.archiveRoot || config?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!root) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for digital asset review decisions.');
  return resolve(root);
}

function exportedAssetHash(manifest, asset) {
  const filename = basename(asset.final_path);
  return manifest.files?.find((file) => (
    file.path === `assets/individual/${filename}`
    || file.path.endsWith(`/assets/individual/${filename}`)
  ))?.content_sha256;
}

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) {
    throw new Error(`${label} must stay inside the canonical product archive.`);
  }
  return target;
}

function resolveReviewedManifestPath(productRoot, reviewState) {
  const packageRoot = String(reviewState.package_root || '').trim();
  const targetVersion = String(reviewState.target_version || '').trim();
  const marketplaceReviewMode = String(reviewState.marketplace_review_mode || 'draft');
  if (marketplaceReviewMode === 'local_generation') {
    const localPreviewRoot = packageRoot || 'exports/itch-preview';
    const normalizedRoot = relative(
      resolve(productRoot),
      resolveInside(productRoot, localPreviewRoot, 'Local generation preview'),
    ).replaceAll('\\', '/');
    if (normalizedRoot !== 'exports/itch-preview') {
      throw new Error('The local generation review must use the canonical packaged preview.');
    }
    return resolveInside(
      productRoot,
      `${normalizedRoot}/manifest.json`,
      'Local generation preview manifest',
    );
  }
  if (!packageRoot) {
    if (targetVersion) throw new Error('The versioned package review is missing its immutable package path.');
    return resolveInside(productRoot, 'exports/itch-preview/manifest.json', 'Preview manifest');
  }
  if (!/^\d+\.\d+\.\d+$/u.test(targetVersion)) {
    throw new Error('The reviewed package target version is invalid.');
  }
  const normalizedRoot = relative(resolve(productRoot), resolveInside(productRoot, packageRoot, 'Reviewed package'))
    .replaceAll('\\', '/');
  const expectedPrefix = `releases/${targetVersion}/candidates/`;
  if (!normalizedRoot.startsWith(expectedPrefix)
    || !/^[a-f0-9]{16}$/u.test(normalizedRoot.slice(expectedPrefix.length))) {
    throw new Error('The reviewed package path is not an immutable release candidate.');
  }
  return resolveInside(productRoot, `${normalizedRoot}/manifest.json`, 'Reviewed manifest');
}

function normalizedItchUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error(`${label} is not a valid itch.io URL.`);
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.itch.io')
    || parsed.username || parsed.password) {
    throw new Error(`${label} is not a valid itch.io URL.`);
  }
  return parsed.toString();
}

function validateMarketplaceReviewState({ product, reviewState, manifest, itchState, publishedState }) {
  const mode = String(reviewState.marketplace_review_mode || 'draft');
  if (mode === 'local_generation') {
    if (manifest.listing_hash !== reviewState.listing_hash) {
      throw new Error('The local package listing no longer matches this creative review.');
    }
    return { mode, url: null };
  }
  if (mode === 'draft') {
    if (manifest.listing_hash !== reviewState.listing_hash
      || itchState?.status !== 'verified'
      || itchState.manifest_hash !== manifest.manifest_hash
      || itchState.listing_hash !== manifest.listing_hash) {
      throw new Error('The populated itch.io draft no longer matches this package review.');
    }
    return {
      mode,
      url: normalizedItchUrl(itchState.public_url, 'The verified itch.io draft URL'),
    };
  }

  if (mode !== 'published_update') {
    throw new Error(`Unsupported marketplace review mode: ${mode}.`);
  }
  if (manifest.listing_hash !== reviewState.listing_hash) {
    throw new Error('The immutable update listing no longer matches this package review.');
  }
  if (publishedState?.status !== 'verified_public'
    || publishedState.product_id !== product.product_id
    || publishedState.target_version !== reviewState.current_marketplace_version
    || publishedState.manifest_hash === manifest.manifest_hash
    || (manifest.base_manifest_hash
      && publishedState.manifest_hash !== manifest.base_manifest_hash)) {
    throw new Error('The verified current itch.io release no longer matches this package update review.');
  }
  if (manifest.target_version === publishedState.target_version) {
    throw new Error('The package update must target a version newer than the verified public release.');
  }
  const publicUrl = normalizedItchUrl(publishedState.public_url, 'The verified public itch.io URL');
  if (reviewState.itch_url
    && normalizedItchUrl(reviewState.itch_url, 'The package review itch.io URL') !== publicUrl) {
    throw new Error('The verified public itch.io URL no longer matches this package update review.');
  }
  return { mode, url: publicUrl };
}

async function loadReviewContext({ archiveRoot, reference, interaction }) {
  const productRoot = resolve(archiveRoot, reference.productSlug);
  const [product, reviewState, itchState, publishedState] = await Promise.all([
    readJson(resolve(productRoot, 'product.json')),
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readOptionalJson(resolve(productRoot, 'review', 'itch.json')),
    readOptionalJson(resolve(productRoot, 'review', 'itch-release.json')),
  ]);
  if (product.slug !== reference.productSlug || reviewState.product_slug !== reference.productSlug) {
    throw new Error('The Discord review reference does not match the canonical product.');
  }
  const manifest = await readJson(resolveReviewedManifestPath(productRoot, reviewState));
  const reviewedManifestVersion = reviewState.marketplace_review_mode === 'local_generation'
    ? manifest.product_version
    : manifest.target_version;
  if (reviewState.target_version && reviewedManifestVersion !== reviewState.target_version) {
    throw new Error('The reviewed release candidate does not match its target version.');
  }
  if (manifest.manifest_hash !== reviewState.manifest_hash
    || !manifest.manifest_hash.startsWith(reference.manifestHashPrefix)) {
    throw new Error('This package action belongs to a stale manifest.');
  }
  const marketplaceReview = validateMarketplaceReviewState({
    product,
    reviewState,
    manifest,
    itchState,
    publishedState,
  });
  if (String(reviewState.channel_id) !== String(interaction.channel_id || '')) {
    throw new Error('This package decision came from an unexpected Discord channel.');
  }
  if (interaction.message?.id
    && String(interaction.message.id) !== String(reviewState.overview_message_id)) {
    throw new Error('The Discord message does not match the canonical package review message.');
  }
  const assets = [];
  for (const asset of product.assets) {
    const validation = await readJson(resolve(productRoot, asset.validation_path));
    const assetHash = String(validation?.metrics?.content_sha256 || '');
    if (!/^[a-f0-9]{64}$/u.test(assetHash) || exportedAssetHash(manifest, asset) !== assetHash) {
      throw new Error(`The canonical hash for ${asset.asset_id} does not match the reviewed export.`);
    }
    assets.push({ ...asset, asset_hash: assetHash });
  }
  return {
    productRoot,
    product,
    reviewState,
    manifest,
    itchState,
    publishedState,
    marketplaceReview,
    assets,
  };
}

function actorFromInteraction(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return {
    id: String(user.id || ''),
    displayName: String(interaction?.member?.nick || user.global_name || user.username || user.id || 'operator'),
  };
}

function decisionFieldValue(decision, actor) {
  const selected = decision.affectedAssetIds?.length
    ? `\nSelected assets: ${decision.affectedAssetIds.join(', ')}`
    : '';
  const reason = decision.reason ? `\n${decision.reason}` : '';
  return `${DECISION_LABELS[decision.decision]} by ${actor.displayName}${selected}${reason}`.slice(0, 1024);
}

export function buildResolvedDigitalAssetReviewEmbeds(embeds, decision, actor) {
  const current = Array.isArray(embeds) ? embeds : [];
  return current.map((embed, index) => ({
    ...embed,
    color: DECISION_COLORS[decision.decision],
    ...(index === 0 ? {
      title: `${String(embed.title || 'Pack Review').replace(/ · (PACK APPROVED|PACK CHANGES REQUESTED|PACK REJECTED)$/u, '')} · ${DECISION_LABELS[decision.decision]}`,
      description: 'Decision recorded for this exact package manifest and listing candidate.',
      fields: [
        ...(Array.isArray(embed.fields) ? embed.fields.filter((field) => field?.name !== 'Decision') : []),
        { name: 'Decision', value: decisionFieldValue(decision, actor), inline: false },
      ],
    } : {}),
  }));
}

export function buildResolvedAssetReviewEmbeds(embeds, assetDecision, actor) {
  const labels = {
    approve: 'ACCEPTED IN PACK REVIEW',
    request_changes: 'CHANGES REQUESTED',
    reject: 'PACK REJECTED',
  };
  return (Array.isArray(embeds) ? embeds : []).map((embed, index) => ({
    ...embed,
    color: DECISION_COLORS[assetDecision.decision],
    ...(index === 0 ? {
      title: `${String(embed.title || 'Asset').replace(/ · (ACCEPTED IN PACK REVIEW|CHANGES REQUESTED|PACK REJECTED)$/u, '')} · ${labels[assetDecision.decision]}`,
      fields: [
        ...(Array.isArray(embed.fields) ? embed.fields.filter((field) => field?.name !== 'Package review') : []),
        {
          name: 'Package review',
          value: `${labels[assetDecision.decision]} by ${actor.displayName}`,
          inline: false,
        },
      ],
    } : {}),
  }));
}

export async function prepareDigitalAssetReviewModal(options) {
  const request = getDigitalAssetReviewModalRequest(options.interaction);
  if (!request) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const archiveRoot = resolveArchiveRoot(options, config);
  const context = await loadReviewContext({ archiveRoot, reference: request, interaction: options.interaction });
  return buildDigitalAssetReviewModal(request, context.assets);
}

function decisionsForAssets(decision, assets) {
  const affected = new Set(decision.affectedAssetIds || []);
  const unknown = [...affected].filter((assetId) => !assets.some((asset) => asset.asset_id === assetId));
  if (unknown.length) throw new Error(`Unknown assets were selected: ${unknown.join(', ')}`);
  return assets.map((asset) => ({
    asset_id: asset.asset_id,
    asset_hash: asset.asset_hash,
    decision: decision.decision === 'approve'
      ? 'approve'
      : decision.decision === 'reject'
        ? 'reject'
        : affected.has(asset.asset_id) ? 'request_changes' : 'approve',
  }));
}

export async function recordDigitalAssetReviewDecision(options) {
  const reference = parseDigitalAssetReviewDecision(options.interaction);
  if (!reference) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const archiveRoot = resolveArchiveRoot(options, config);
  const context = await loadReviewContext({ archiveRoot, reference, interaction: options.interaction });
  const actor = actorFromInteraction(options.interaction);
  const decidedAt = options.now || new Date().toISOString();
  const assetDecisions = decisionsForAssets(reference, context.assets);
  const row = {
    product_id: context.product.product_id,
    release_id: `asset-release-${context.manifest.manifest_hash.slice(0, 24)}`,
    review_revision: Number(context.reviewState.review_revision) || 1,
    manifest_hash: context.manifest.manifest_hash,
    listing_hash: context.manifest.listing_hash,
    decision: reference.decision,
    affected_asset_ids: reference.decision === 'reject'
      ? context.assets.map((asset) => asset.asset_id)
      : reference.affectedAssetIds,
    asset_decisions: assetDecisions,
    reviewer_discord_id: actor.id,
    reason: reference.reason,
    decided_at: decidedAt,
    discord_message_id: String(context.reviewState.overview_message_id),
    discord_interaction_id: String(options.interaction.id || ''),
  };
  if (!row.discord_interaction_id) throw new Error('Discord interaction ID is required for idempotent persistence.');
  const store = options.store || new DigitalAssetReviewDecisionStore({
    supabaseUrl: config?.env?.SUPABASE_URL,
    apiKey: config?.env?.SUPABASE_SECRET_KEY,
    fetchImpl: options.fetchImpl,
  });
  await store.insert(row);
  context.reviewState.last_decision = {
    decision: row.decision,
    affected_asset_ids: row.affected_asset_ids,
    reviewer_discord_id: row.reviewer_discord_id,
    reason: row.reason,
    decided_at: row.decided_at,
    discord_interaction_id: row.discord_interaction_id,
  };
  if (context.marketplaceReview.mode === 'local_generation' && row.decision === 'approve') {
    context.reviewState.creative_approval = {
      status: 'approved',
      manifest_hash: row.manifest_hash,
      listing_hash: row.listing_hash,
      approved_at: row.decided_at,
      approved_by_discord_id: row.reviewer_discord_id,
      next_step: 'marketplace_setup',
    };
    context.product.status = 'approved';
    context.product.approvals = {
      ...(context.product.approvals || {}),
      generation: 'approved',
      distribution: 'pending',
    };
    context.product.updated_at = decidedAt;
    await writeFile(
      resolve(context.productRoot, 'product.json'),
      `${JSON.stringify(context.product, null, 2)}\n`,
      'utf8',
    );
  }
  await writeFile(
    resolve(context.productRoot, 'review', 'discord.json'),
    `${JSON.stringify(context.reviewState, null, 2)}\n`,
    'utf8',
  );
  const manifestUrl = `https://discord.com/channels/${config.guildId}/${context.reviewState.channel_id}/${context.reviewState.overview_message_id}`;
  const linkContext = {
    manifestUrl,
    itchUrl: context.marketplaceReview.url,
    itchLabel: context.marketplaceReview.mode === 'published_update'
      ? 'Open Current itch.io Page'
      : 'Open itch.io Draft',
  };
  const nextAction = row.decision !== 'approve'
    ? null
    : context.marketplaceReview.mode === 'local_generation'
      ? 'marketplace_setup'
      : context.marketplaceReview.mode === 'published_update'
        ? 'distribution_review'
        : null;
  return {
    row,
    productSlug: context.product.slug,
    decision: reference,
    actor,
    channelId: context.reviewState.channel_id,
    messageId: context.reviewState.overview_message_id,
    threadId: context.reviewState.thread_id,
    nextAction,
    releaseVersion: context.reviewState.target_version || null,
    messagePatch: { components: buildResolvedDigitalAssetReviewComponents(linkContext) },
    assetMessagePatches: assetDecisions.map((assetDecision) => ({
      ...assetDecision,
      messageId: context.reviewState.asset_messages[assetDecision.asset_id],
    })),
  };
}
