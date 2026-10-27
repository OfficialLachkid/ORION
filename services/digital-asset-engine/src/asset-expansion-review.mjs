import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { createSupabaseApiHeaders } from '../../lib/supabase-api-headers.mjs';
import {
  buildDigitalAssetReviewModal,
} from './review-components.mjs';
import { discordRequest, sendMessageWithFiles } from './discord-review.mjs';

const BUTTON_PREFIX = 'daer';
const MODAL_PREFIX = 'daerm';
const ACTIONS = Object.freeze({ approve: 'a', request_changes: 'c', reject: 'r' });
const DECISIONS = Object.freeze(Object.fromEntries(Object.entries(ACTIONS).map(([key, value]) => [value, key])));
const MESSAGE_COMPONENT = 3;
const MODAL_SUBMIT = 5;
const TABLE = 'digital_asset_expansion_reviews';
const COLOR = 0x35d9ff;

function clean(value, maximum = 1024) {
  const text = String(value || '').replace(/\s+/gu, ' ').trim();
  return text.length <= maximum ? text : `${text.slice(0, maximum - 3)}...`;
}

function resolveInside(rootPath, candidatePath, label) {
  const root = resolve(rootPath);
  const target = resolve(root, candidatePath);
  const child = relative(root, target);
  if (child.startsWith('..') || isAbsolute(child)) throw new Error(`${label} must stay inside ${root}.`);
  return target;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function buildReference(prefix, action, context) {
  const code = ACTIONS[action];
  const parts = [prefix, code, context.productSlug, context.expansionId, String(context.manifestHash).slice(0, 16)];
  if (!code || parts.slice(2).some((part) => !/^[a-z0-9-]+$/u.test(String(part)))) {
    throw new Error('Expansion review reference contains invalid identifiers.');
  }
  const value = parts.join('|');
  if (value.length > 100) throw new Error('Expansion review custom ID exceeds Discord limits.');
  return value;
}

function parseReference(value, expectedPrefix) {
  const parts = String(value || '').split('|');
  if (parts.length !== 5 || parts[0] !== expectedPrefix || !DECISIONS[parts[1]]) return null;
  if (!/^[a-z0-9-]+$/u.test(parts[2]) || !/^[a-z0-9-]+$/u.test(parts[3])) return null;
  if (!/^[a-f0-9]{16}$/u.test(parts[4])) return null;
  return {
    decision: DECISIONS[parts[1]],
    productSlug: parts[2],
    expansionId: parts[3],
    manifestHashPrefix: parts[4],
  };
}

export function buildAssetExpansionReviewComponents(context, resolved = false) {
  const enhancementOnly = ['enhancement', 'upgrade'].includes(context.reviewMode);
  const buttons = resolved ? [] : [
    { type: 2, style: 3, label: context.reviewMode === 'upgrade' ? 'Approve Asset Upgrade' : enhancementOnly ? 'Approve Animation Upgrade' : 'Approve Expansion', custom_id: buildReference(BUTTON_PREFIX, 'approve', context) },
    { type: 2, style: 2, label: 'Request Changes', custom_id: buildReference(BUTTON_PREFIX, 'request_changes', context) },
    { type: 2, style: 4, label: 'Reject Expansion', custom_id: buildReference(BUTTON_PREFIX, 'reject', context) },
  ];
  return [{
    type: 1,
    components: [
      ...buttons,
      { type: 2, style: 5, label: 'Open Manifest', url: context.manifestUrl },
    ],
  }];
}

function manifestUrl(guildId, state) {
  return `https://discord.com/channels/${guildId}/${state.channel_id}/${state.overview_message_id}`;
}

function manifestReviewMode(manifest) {
  if (manifest.new_asset_count === 0 && (manifest.replaced_asset_count || 0) > 0) return 'upgrade';
  if (manifest.enhanced_asset_count > 0 && manifest.new_asset_count === 0) return 'enhancement';
  return 'expansion';
}

function assertReleasePlanMatchesManifest(plan, manifest) {
  if (!plan
    || plan.product_slug !== manifest.product_slug
    || plan.expansion_id !== manifest.expansion_id
    || plan.base_version !== manifest.base_version
    || plan.target_version !== manifest.target_version
    || plan.base_manifest_hash !== manifest.base_manifest_hash
    || plan.title !== manifest.title) {
    throw new Error('Expansion release plan does not match its immutable review manifest.');
  }
}

function overviewEmbed(manifest, revision) {
  const upgradeOnly = (manifest.enhanced_asset_count + (manifest.replaced_asset_count || 0)) > 0
    && manifest.new_asset_count === 0;
  const hasReplacement = (manifest.replaced_asset_count || 0) > 0;
  const assets = manifest.assets.map((asset, index) => (
    `**${String(index + 1).padStart(2, '0')}** — ${asset.name} · ${asset.buyer_group}${asset.animation ? ` · ${(asset.animation.states || []).length} states · ${asset.animation.animations.length} animations` : ''}`
  )).join('\n');
  return {
    title: `${manifest.title} · ${upgradeOnly ? 'Asset Upgrade' : 'Expansion'} Review · Revision ${revision}`,
    description: upgradeOnly
      ? hasReplacement
        ? 'Review these animations, states, and the explicitly replaced Spell Tome base before ORION builds a new product version. Existing asset IDs remain stable; the reviewed tome artwork replaces its prior base only in the future candidate. Runtime files and review GIFs are bound to this manifest. The current public release remains unchanged.'
        : 'Review these animations and states for the existing assets before ORION builds a new product version. The asset identities and approved base sprites remain unchanged. Runtime frames, overlays, sheets, metadata, and review GIFs are bound to this manifest. The current public release remains unchanged.'
      : 'Review these complete additions before ORION builds a new version of the existing product. Animated items include their exact runtime frames, overlays, sheets, metadata, and review GIFs. The current public release remains unchanged.',
    color: COLOR,
    fields: [
      { name: 'Target release', value: `\`${manifest.base_version}\` → \`${manifest.target_version}\``, inline: true },
      { name: upgradeOnly ? 'Upgraded assets' : 'Assets', value: String(manifest.asset_count), inline: true },
      ...(hasReplacement ? [{ name: 'Replaced bases', value: String(manifest.replaced_asset_count), inline: true }] : []),
      { name: 'Animations', value: String(manifest.animation_count || 0), inline: true },
      { name: 'States', value: String(manifest.state_count || 0), inline: true },
      { name: 'Generation cost', value: '€0 API cost', inline: true },
      { name: upgradeOnly ? 'Upgrade scope' : 'Proposed additions', value: assets, inline: false },
      { name: upgradeOnly ? 'Upgrade manifest' : 'Expansion manifest', value: `\`${manifest.manifest_hash}\``, inline: false },
      { name: 'Safety', value: 'Approval authorizes a versioned candidate build only. It does not update itch.io or publish anything.', inline: false },
    ],
    image: { url: 'attachment://expansion-overview.png' },
    footer: { text: `ORION Digital Asset Engine · immutable ${upgradeOnly ? 'asset upgrade' : 'expansion'} proposal` },
  };
}

function assetEmbed(asset, index, total) {
  const enhancement = asset.operation === 'enhance_existing';
  const replacement = asset.operation === 'replace_existing';
  const interactiveSummary = asset.animation
    ? [
      ...(asset.animation.states || []).map((state) => `- State: ${state.state_key}`),
      ...asset.animation.animations.map((animation) => `- Animation: ${animation.animation_key}`),
    ].join('\n')
    : 'Static base asset only';
  return {
    title: `${String(index + 1).padStart(2, '0')}/${String(total).padStart(2, '0')} · ${asset.name}`,
    description: `Buyer group: **${asset.buyer_group}**. Select **${String(index + 1).padStart(2, '0')}** in the feedback form if this ${replacement ? 'replacement base and animation upgrade' : enhancement ? 'animation upgrade' : 'addition'} needs revision.`,
    color: COLOR,
    fields: [
      { name: 'Asset ID', value: `\`${asset.asset_id}\``, inline: false },
      { name: 'Kind', value: `\`${asset.kind}\``, inline: true },
      { name: 'Canvas', value: `${asset.validation_metrics.width}×${asset.validation_metrics.height}`, inline: true },
      { name: 'Included states', value: interactiveSummary, inline: false },
      { name: 'SHA-256', value: `\`${asset.content_sha256}\``, inline: false },
      ...(asset.animation ? [{ name: 'Animation bundle', value: `\`${asset.animation.bundle_hash}\``, inline: false }] : []),
    ],
    image: { url: `attachment://${basename(asset.path)}` },
  };
}

export async function postAssetExpansionReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Expansion review posting requires Discord runtime credentials.');
  const productRoot = resolve(options.outputRoot, options.productSlug);
  const pointer = await readJson(resolveInside(
    productRoot,
    `extensions/${options.expansionId}/review/latest-review.json`,
    'Expansion review pointer',
  ));
  const candidateRoot = resolveInside(productRoot, pointer.candidate_path, 'Expansion review candidate');
  const manifestPath = resolveInside(candidateRoot, 'manifest.json', 'Expansion review manifest');
  const manifest = await readJson(manifestPath);
  if (manifest.manifest_hash !== pointer.manifest_hash
    || manifest.product_slug !== options.productSlug
    || manifest.expansion_id !== options.expansionId) {
    throw new Error('Expansion review pointer does not match its immutable manifest.');
  }
  assertReleasePlanMatchesManifest(pointer.release_plan, manifest);
  const packState = await readJson(resolve(productRoot, 'review', 'discord.json'));
  if (!packState.channel_id) throw new Error('The existing product review channel is unavailable.');
  const statePath = resolveInside(
    productRoot,
    `extensions/${options.expansionId}/review/discord.json`,
    'Expansion Discord state',
  );
  let state;
  try { state = await readJson(statePath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  if (state?.manifest_hash === manifest.manifest_hash && state?.completed_at) {
    if (!state.release_plan) {
      state.release_plan = pointer.release_plan;
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    }
    return { ...state, reused: true, statePath };
  }
  const revisionChanged = Boolean(state?.manifest_hash && state.manifest_hash !== manifest.manifest_hash);
  state = state || {
    schema_version: '1.0',
    product_id: manifest.product_id,
    product_slug: manifest.product_slug,
    expansion_id: manifest.expansion_id,
    category_name: packState.category_name || 'DIGITAL ASSETS',
    channel_id: packState.channel_id,
    overview_message_id: null,
    thread_id: null,
    asset_messages: {},
    review_revision: 1,
    created_at: options.now || new Date().toISOString(),
  };
  state.review_revision += revisionChanged ? 1 : 0;
  state.category_name = state.category_name || packState.category_name || 'DIGITAL ASSETS';
  state.manifest_hash = manifest.manifest_hash;
  state.target_version = manifest.target_version;
  state.release_plan = pointer.release_plan;
  state.package_root = relative(productRoot, candidateRoot).replaceAll('\\', '/');
  state.completed_at = null;
  if (revisionChanged) state.last_decision = null;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');

  const context = {
    productSlug: manifest.product_slug,
    expansionId: manifest.expansion_id,
    manifestHash: manifest.manifest_hash,
    reviewMode: manifestReviewMode(manifest),
    manifestUrl: state.overview_message_id ? manifestUrl(guildId, state) : 'https://discord.com',
  };
  const payload = { embeds: [overviewEmbed(manifest, state.review_revision)] };
  const files = [
    {
      filename: 'expansion-overview.png',
      contentType: 'image/png',
      description: `${manifest.title} protected overview`,
      buffer: await readFile(resolve(candidateRoot, 'overview.png')),
    },
    {
      filename: 'expansion-manifest.json',
      contentType: 'application/json',
      description: `Immutable expansion manifest ${manifest.manifest_hash}`,
      buffer: await readFile(manifestPath),
    },
  ];
  if (!state.overview_message_id) {
    const message = await sendMessageWithFiles(token, state.channel_id, payload, files, { fetchImpl: options.fetchImpl });
    state.overview_message_id = message.id;
    context.manifestUrl = manifestUrl(guildId, state);
    await discordRequest(token, `/channels/${state.channel_id}/messages/${state.overview_message_id}`, {
      method: 'PATCH', body: { components: buildAssetExpansionReviewComponents(context) }, fetchImpl: options.fetchImpl,
    });
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } else {
    context.manifestUrl = manifestUrl(guildId, state);
    await sendMessageWithFiles(token, state.channel_id, { ...payload, components: buildAssetExpansionReviewComponents(context) }, files, {
      messageId: state.overview_message_id,
      fetchImpl: options.fetchImpl,
    });
  }
  if (!state.thread_id) {
    const thread = await discordRequest(
      token,
      `/channels/${state.channel_id}/messages/${state.overview_message_id}/threads`,
      { method: 'POST', body: { name: `${context.reviewMode === 'upgrade' ? 'asset-upgrade' : context.reviewMode === 'enhancement' ? 'animation-upgrade' : 'expansion'}-${manifest.target_version}-review`, auto_archive_duration: 1440 }, fetchImpl: options.fetchImpl },
    );
    state.thread_id = thread.id;
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  }
  for (let index = 0; index < manifest.assets.length; index += 1) {
    const asset = manifest.assets[index];
    const assetFiles = [{
      filename: basename(asset.path),
      contentType: 'image/png',
      description: clean(`${String(index + 1).padStart(2, '0')} ${asset.name} expansion candidate`),
      buffer: await readFile(resolveInside(candidateRoot, asset.path, 'Expansion asset')),
    }];
    if (asset.animation?.states?.length) {
      assetFiles.push({
        filename: `${asset.asset_key}-states.png`,
        contentType: 'image/png',
        description: clean(`${asset.name}: deterministic state overview`),
        buffer: await readFile(resolveInside(
          candidateRoot,
          `animations/${asset.asset_key}/previews/states.png`,
          'Expansion state preview',
        )),
      });
    }
    for (const animation of asset.animation?.animations || []) {
      assetFiles.push({
        filename: `${asset.asset_key}-${animation.animation_key}.gif`,
        contentType: 'image/gif',
        description: clean(`${asset.name}: ${animation.animation_key} review preview`),
        buffer: await readFile(resolveInside(candidateRoot, animation.preview_gif_path, 'Expansion animation preview')),
      });
    }
    const replacedAssetId = asset.replaces_review_asset_key
      ? `asset-expansion-${createHash('sha256').update(`${manifest.expansion_id}:${asset.replaces_review_asset_key}`).digest('hex').slice(0, 16)}`
      : null;
    const messageId = state.asset_messages[asset.asset_id]
      || (replacedAssetId ? state.asset_messages[replacedAssetId] : null);
    const message = await sendMessageWithFiles(token, state.thread_id, {
      embeds: [assetEmbed(asset, index, manifest.assets.length)], components: [],
    }, assetFiles, { messageId, fetchImpl: options.fetchImpl });
    if (!state.asset_messages[asset.asset_id]) {
      state.asset_messages[asset.asset_id] = message.id;
      if (replacedAssetId && replacedAssetId !== asset.asset_id) delete state.asset_messages[replacedAssetId];
      await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    }
  }
  state.completed_at = options.now || new Date().toISOString();
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { ...state, reused: false, statePath };
}

export function getAssetExpansionModalRequest(interaction) {
  if (interaction?.type !== MESSAGE_COMPONENT) return null;
  const parsed = parseReference(interaction?.data?.custom_id, BUTTON_PREFIX);
  return parsed && ['request_changes', 'reject'].includes(parsed.decision) ? parsed : null;
}

export function isAssetExpansionReviewInteraction(interaction) {
  return Boolean(
    parseReference(interaction?.data?.custom_id, BUTTON_PREFIX)
    || parseReference(interaction?.data?.custom_id, MODAL_PREFIX),
  );
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Expansion decision came from an unexpected Discord guild.');
  }
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (!(config.operatorUserIds || []).includes(userId)
    && !(config.operatorRoleId && roles.includes(config.operatorRoleId))) {
    throw new Error('Only an approved ORION operator can review asset expansions.');
  }
}

async function loadContext(reference, interaction, config) {
  const archiveRoot = String(config?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for expansion decisions.');
  const productRoot = resolve(archiveRoot, reference.productSlug);
  const statePath = resolveInside(
    productRoot,
    `extensions/${reference.expansionId}/review/discord.json`,
    'Expansion Discord state',
  );
  const state = await readJson(statePath);
  const candidateRoot = resolveInside(productRoot, state.package_root, 'Expansion review candidate');
  const manifest = await readJson(resolveInside(candidateRoot, 'manifest.json', 'Expansion manifest'));
  if (manifest.manifest_hash !== state.manifest_hash
    || !manifest.manifest_hash.startsWith(reference.manifestHashPrefix)
    || manifest.expansion_id !== reference.expansionId) {
    throw new Error('This expansion action belongs to a stale manifest.');
  }
  if (String(state.channel_id) !== String(interaction.channel_id || '')
    || (interaction.message?.id && String(state.overview_message_id) !== String(interaction.message.id))) {
    throw new Error('This expansion action came from an unexpected Discord message.');
  }
  for (const file of manifest.files || []) {
    const buffer = await readFile(resolveInside(candidateRoot, file.path, 'Expansion review file'));
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== file.content_sha256 || buffer.length !== file.size_bytes) {
      throw new Error(`Expansion review file changed: ${file.path}.`);
    }
  }
  return { productRoot, statePath, state, candidateRoot, manifest };
}

export async function prepareAssetExpansionReviewModal(options) {
  const request = getAssetExpansionModalRequest(options.interaction);
  if (!request) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const context = await loadContext(request, options.interaction, config);
  return buildDigitalAssetReviewModal(request, context.manifest.assets, {
    modalPrefix: MODAL_PREFIX,
    referenceBuilder: buildReference,
  });
}

function modalValues(components) {
  let reason = '';
  let affectedAssetIds = [];
  const visit = (items) => {
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.custom_id === 'reason') reason = clean(item.value, 1000);
      if (item?.custom_id === 'affected_assets') affectedAssetIds = [...new Set(item.values || [])];
      if (item?.component) visit([item.component]);
      if (item?.components) visit(item.components);
    }
  };
  visit(components);
  return { reason, affectedAssetIds };
}

function parseDecision(interaction) {
  const direct = interaction?.type === MESSAGE_COMPONENT
    ? parseReference(interaction?.data?.custom_id, BUTTON_PREFIX)
    : null;
  if (direct?.decision === 'approve') return { ...direct, reason: '', affectedAssetIds: [] };
  const modal = interaction?.type === MODAL_SUBMIT
    ? parseReference(interaction?.data?.custom_id, MODAL_PREFIX)
    : null;
  if (!modal) return null;
  const values = modalValues(interaction?.data?.components);
  if (!values.reason) throw new Error('A reason is required for this expansion decision.');
  if (modal.decision === 'request_changes' && !values.affectedAssetIds.length) {
    throw new Error('Select at least one expansion asset that needs changes.');
  }
  return { ...modal, ...values };
}

function headers(apiKey) {
  return createSupabaseApiHeaders(apiKey, {
    'Content-Type': 'application/json',
    Prefer: 'resolution=ignore-duplicates,return=representation',
  });
}

export async function recordAssetExpansionReviewDecision(options) {
  const decision = parseDecision(options.interaction);
  if (!decision) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const context = await loadContext(decision, options.interaction, config);
  const validIds = new Set(context.manifest.assets.map((asset) => asset.asset_id));
  const unknown = decision.affectedAssetIds.filter((id) => !validIds.has(id));
  if (unknown.length) throw new Error(`Unknown expansion assets selected: ${unknown.join(', ')}.`);
  const affected = new Set(decision.affectedAssetIds);
  const reviewer = options.interaction?.member?.user || options.interaction?.user || {};
  const baseReleaseId = String(context.manifest.base_release_id || '').trim();
  if (!baseReleaseId) {
    throw new Error('The immutable expansion manifest has no base release ID. Regenerate the review candidate before deciding.');
  }
  const row = {
    product_id: context.manifest.product_id,
    expansion_id: context.manifest.expansion_id,
    base_release_id: baseReleaseId,
    target_version: context.manifest.target_version,
    manifest_hash: context.manifest.manifest_hash,
    decision: decision.decision,
    affected_asset_ids: decision.decision === 'reject'
      ? context.manifest.assets.map((asset) => asset.asset_id)
      : decision.affectedAssetIds,
    asset_decisions: context.manifest.assets.map((asset) => ({
      asset_id: asset.asset_id,
      asset_hash: asset.review_hash || asset.content_sha256,
      decision: decision.decision === 'approve'
        ? 'approve'
        : decision.decision === 'reject'
          ? 'reject'
          : affected.has(asset.asset_id) ? 'request_changes' : 'approve',
    })),
    reviewer_discord_id: String(reviewer.id || ''),
    reason: decision.reason,
    decided_at: options.now || new Date().toISOString(),
    discord_message_id: String(context.state.overview_message_id),
    discord_interaction_id: String(options.interaction.id || ''),
  };
  if (!row.reviewer_discord_id || !row.discord_interaction_id) {
    throw new Error('Expansion review requires reviewer and interaction IDs.');
  }
  const url = new URL(`/rest/v1/${TABLE}`, config.env.SUPABASE_URL);
  url.searchParams.set('on_conflict', 'discord_interaction_id');
  const response = await (options.fetchImpl || fetch)(url, {
    method: 'POST',
    headers: headers(config.env.SUPABASE_SECRET_KEY),
    body: JSON.stringify(row),
  });
  const responseText = await response.text();
  if (!response.ok) throw new Error(`Supabase expansion review insert failed (${response.status}): ${responseText}`);
  context.state.last_decision = {
    decision: row.decision,
    affected_asset_ids: row.affected_asset_ids,
    reviewer_discord_id: row.reviewer_discord_id,
    reason: row.reason,
    decided_at: row.decided_at,
    discord_interaction_id: row.discord_interaction_id,
  };
  await writeFile(context.statePath, `${JSON.stringify(context.state, null, 2)}\n`, 'utf8');
  const actor = {
    id: row.reviewer_discord_id,
    displayName: String(options.interaction?.member?.nick || reviewer.global_name || reviewer.username || reviewer.id),
  };
  const linkContext = {
    productSlug: context.manifest.product_slug,
    expansionId: context.manifest.expansion_id,
    manifestHash: context.manifest.manifest_hash,
    reviewMode: manifestReviewMode(context.manifest),
    manifestUrl: manifestUrl(config.guildId, context.state),
  };
  return {
    row,
    decision,
    actor,
    channelId: context.state.channel_id,
    messageId: context.state.overview_message_id,
    threadId: context.state.thread_id,
    statePath: context.statePath,
    messagePatch: { components: buildAssetExpansionReviewComponents(linkContext, true) },
    assetMessagePatches: row.asset_decisions.map((assetDecision) => ({
      ...assetDecision,
      messageId: context.state.asset_messages[assetDecision.asset_id],
    })),
  };
}

export function buildResolvedAssetExpansionReviewEmbeds(embeds, decision, actor) {
  const labels = { approve: 'EXPANSION APPROVED', request_changes: 'EXPANSION CHANGES REQUESTED', reject: 'EXPANSION REJECTED' };
  return (Array.isArray(embeds) ? embeds : []).map((embed, index) => ({
    ...embed,
    color: decision.decision === 'approve' ? 0x57f287 : decision.decision === 'reject' ? 0xed4245 : 0xfee75c,
    ...(index === 0 ? {
      title: `${String(embed.title || 'Expansion Review').replace(/ · (EXPANSION APPROVED|EXPANSION CHANGES REQUESTED|EXPANSION REJECTED)$/u, '')} · ${labels[decision.decision]}`,
      fields: [
        ...(embed.fields || []).filter((field) => field.name !== 'Decision'),
        { name: 'Decision', value: `${labels[decision.decision]} by ${actor.displayName}${decision.reason ? `\n${decision.reason}` : ''}`.slice(0, 1024), inline: false },
      ],
    } : {}),
  }));
}

export function buildResolvedExpansionAssetEmbeds(embeds, assetDecision, actor) {
  const labels = {
    approve: 'ACCEPTED FOR EXTENSION',
    request_changes: 'CHANGES REQUESTED',
    reject: 'EXPANSION REJECTED',
  };
  return (Array.isArray(embeds) ? embeds : []).map((embed, index) => ({
    ...embed,
    color: assetDecision.decision === 'approve' ? 0x57f287 : assetDecision.decision === 'reject' ? 0xed4245 : 0xfee75c,
    ...(index === 0 ? {
      title: `${String(embed.title || 'Expansion Asset').replace(/ · (ACCEPTED FOR EXTENSION|CHANGES REQUESTED|EXPANSION REJECTED)$/u, '')} · ${labels[assetDecision.decision]}`,
      fields: [
        ...(embed.fields || []).filter((field) => field.name !== 'Expansion review'),
        { name: 'Expansion review', value: `${labels[assetDecision.decision]} by ${actor.displayName}`, inline: false },
      ],
    } : {}),
  }));
}
