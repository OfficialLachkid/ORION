import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest, sendMessageWithFiles } from './discord-review.mjs';

const PREFIX = 'dat';
const TABLE = 'digital_asset_theme_reviews';
const ACTION_ROW = 1;
const BUTTON = 2;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_LINK = 5;
const TEXT_INPUT = 4;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function customId(action, state) {
  return [PREFIX, action, state.product_slug, state.theme_hash.slice(0, 16)].join('|');
}

function parseCustomId(value) {
  const [prefix, action, productSlug, themeHashPrefix, extra] = String(value || '').split('|');
  if (extra !== undefined || prefix !== PREFIX || !['a', 'r', 'm'].includes(action)) return null;
  if (!/^[a-z0-9-]+$/u.test(productSlug) || !/^[a-f0-9]{16}$/u.test(themeHashPrefix)) return null;
  return { action, productSlug, themeHashPrefix };
}

function link(label, url) {
  return { type: BUTTON, style: BUTTON_LINK, label, url };
}

function reviewComponents(state) {
  return [{
    type: ACTION_ROW,
    components: [
      { type: BUTTON, style: BUTTON_SUCCESS, label: 'Approve Theme', custom_id: customId('a', state) },
      { type: BUTTON, style: BUTTON_SECONDARY, label: 'Request Theme Changes', custom_id: customId('r', state) },
      link('Open Public Page', state.public_url),
    ],
  }];
}

function paletteText(design) {
  return [
    `Background **${design.colors.background}**`,
    `Panel **${design.colors.panel}**`,
    `Text **${design.colors.text}**`,
    `Link **${design.colors.link}**`,
    `Header **${design.colors.header}**`,
    `Button **${design.colors.button}**`,
  ].join(' / ');
}

export function buildItchThemeReviewEmbeds(state, decision = null, actor = null) {
  const applied = state.status === 'applied';
  const approved = state.status === 'approved' || decision === 'approve';
  const changes = state.status === 'changes_requested' || decision === 'request_changes';
  const status = applied ? 'APPLIED AND VERIFIED' : approved ? 'APPROVED' : changes ? 'CHANGES REQUESTED' : 'APPROVAL REQUIRED';
  const color = applied || approved ? 0x57f287 : changes ? 0xfee75c : 0x5865f2;
  const outcome = applied
    ? `[The live itch.io theme](${state.public_url}) was saved and verified on desktop and mobile.`
    : actor
      ? `${approved ? 'Approved' : 'Changes requested'} by ${actor.displayName}.`
      : 'This is a non-public browser simulation. The live page is unchanged until approval and the explicit apply step.';
  return [
    {
      title: `${state.product_title || 'Storefront Theme'} · THEME ${status}`,
      description: outcome,
      color,
      fields: [
        { name: 'Theme hash', value: `\`${state.theme_hash}\``, inline: false },
        { name: 'Palette', value: paletteText(state.design), inline: false },
        {
          name: 'Typography & layout',
          value: `Body **${state.design.typography.body_font}** / Headers **${state.design.typography.header_font}** / Size **${state.design.typography.size}** / Screenshots **${state.design.screenshots}**`,
          inline: false,
        },
        { name: 'Local model rationale', value: state.design.rationale, inline: false },
      ],
      image: { url: 'attachment://theme-desktop.png' },
    },
    {
      title: 'Mobile preview',
      description: 'Responsive verification candidate at a 390 px viewport.',
      color,
      image: { url: 'attachment://theme-mobile.png' },
    },
  ];
}

export async function postItchThemeReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('Theme review requires the Discord bot token.');
  const candidate = options.candidate;
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug || candidate.product_slug);
  const productRoot = options.productRoot || store.productRoot(product);
  const discordState = await readJson(resolve(productRoot, 'review', 'discord.json'));
  if (!discordState.channel_id) throw new Error('Theme review requires the existing package channel.');
  const statePath = resolve(productRoot, 'review', 'itch-theme.json');
  let previous = null;
  try { previous = await readJson(statePath); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  const state = {
    ...candidate,
    status: 'awaiting_approval',
    channel_id: discordState.channel_id,
    discord_message_id: previous?.discord_message_id || null,
    posted_at: options.now || new Date().toISOString(),
  };
  const candidateRoot = resolve(productRoot, candidate.candidate_path);
  const message = await sendMessageWithFiles(token, state.channel_id, {
    content: 'Storefront theme review. These screenshots are staged locally; the public itch.io page has not been changed.',
    embeds: buildItchThemeReviewEmbeds(state),
    components: reviewComponents(state),
  }, [
    {
      filename: 'theme-desktop.png',
      contentType: 'image/png',
      description: 'Desktop storefront theme preview',
      buffer: await readFile(resolve(candidateRoot, candidate.media.desktop_preview_path)),
    },
    {
      filename: 'theme-mobile.png',
      contentType: 'image/png',
      description: 'Mobile storefront theme preview',
      buffer: await readFile(resolve(candidateRoot, candidate.media.mobile_preview_path)),
    },
  ], {
    messageId: state.discord_message_id,
    fetchImpl: options.fetchImpl,
  });
  state.discord_message_id = message.id;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return { ...state, statePath, reused: Boolean(previous?.discord_message_id) };
}

export function getItchThemeModalRequest(interaction) {
  if (interaction?.type !== 3) return null;
  const parsed = parseCustomId(interaction?.data?.custom_id);
  return parsed?.action === 'r' ? parsed : null;
}

export function buildItchThemeFeedbackModal(request) {
  return {
    custom_id: [PREFIX, 'm', request.productSlug, request.themeHashPrefix].join('|'),
    title: 'Request Theme Changes',
    components: [{
      type: ACTION_ROW,
      components: [{
        type: TEXT_INPUT,
        custom_id: 'theme_feedback',
        style: 2,
        label: 'What should change?',
        placeholder: 'Describe palette, typography, layout, banner, or background changes.',
        required: true,
        min_length: 3,
        max_length: 1000,
      }],
    }],
  };
}

export function isItchThemeReviewInteraction(interaction) {
  const parsed = parseCustomId(interaction?.data?.custom_id);
  return (interaction?.type === 3 && parsed?.action === 'a')
    || (interaction?.type === 5 && parsed?.action === 'm');
}

function feedbackFromInteraction(interaction) {
  for (const row of interaction?.data?.components || []) {
    for (const component of row.components || []) {
      if (component.custom_id === 'theme_feedback') return String(component.value || '').trim();
    }
  }
  return '';
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Theme decision came from an unexpected Discord guild.');
  }
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (!(config.operatorUserIds || []).includes(userId)
    && !(config.operatorRoleId && roles.includes(config.operatorRoleId))) {
    throw new Error('Only an approved ORION operator can review storefront themes.');
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

export async function recordItchThemeDecision(options) {
  const { interaction, config } = options;
  const parsed = parseCustomId(interaction?.data?.custom_id);
  if (!parsed || !isItchThemeReviewInteraction(interaction)) return null;
  assertAuthorized(interaction, config);
  const archiveRoot = config.env.DIGITAL_ASSET_ARCHIVE_ROOT;
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for theme decisions.');
  const store = new CanonicalProductStore(archiveRoot);
  const product = await store.loadProduct(parsed.productSlug);
  const productRoot = store.productRoot(product);
  const statePath = resolve(productRoot, 'review', 'itch-theme.json');
  const state = await readJson(statePath);
  if (state.status !== 'awaiting_approval') throw new Error('This theme review is no longer awaiting a decision.');
  if (!state.theme_hash.startsWith(parsed.themeHashPrefix)) throw new Error('This theme action belongs to a stale candidate.');
  if (String(interaction.channel_id || '') !== String(state.channel_id)
    || String(interaction.message?.id || interaction.message_id || '') !== String(state.discord_message_id)) {
    throw new Error('This theme action belongs to a different Discord message.');
  }
  const decision = parsed.action === 'a' ? 'approve' : 'request_changes';
  const reason = decision === 'request_changes' ? feedbackFromInteraction(interaction) : '';
  if (decision === 'request_changes' && !reason) throw new Error('Theme feedback is required.');
  const actor = actorFromInteraction(interaction);
  const decidedAt = new Date().toISOString();
  const row = {
    product_id: product.product_id,
    release_id: state.target_version,
    manifest_hash: state.manifest_hash,
    listing_hash: state.listing_hash,
    theme_hash: state.theme_hash,
    decision,
    reviewer_discord_id: actor.id,
    reason,
    decided_at: decidedAt,
    discord_message_id: state.discord_message_id,
    discord_interaction_id: String(interaction.id || ''),
  };
  const supabaseUrl = String(config.env.SUPABASE_URL || '').replace(/\/+$/u, '');
  const apiKey = config.env.SUPABASE_SECRET_KEY || config.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !apiKey) throw new Error('Supabase service credentials are required for theme decisions.');
  const url = new URL(`/rest/v1/${TABLE}`, supabaseUrl);
  url.searchParams.set('on_conflict', 'discord_interaction_id');
  const response = await (options.fetchImpl || fetch)(url, {
    method: 'POST',
    headers: supabaseHeaders(apiKey),
    body: JSON.stringify(row),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Supabase theme review insert failed (${response.status}): ${body}`);
  state.status = decision === 'approve' ? 'approved' : 'changes_requested';
  state.last_decision = { decision, reviewer_discord_id: actor.id, reason, decided_at: decidedAt, discord_interaction_id: row.discord_interaction_id };
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  return {
    row,
    state,
    actor,
    channelId: state.channel_id,
    messageId: state.discord_message_id,
    messagePatch: {
      components: [{ type: ACTION_ROW, components: [link('Open Public Page', state.public_url)] }],
    },
  };
}

export async function markItchThemeApplied(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token) return null;
  const state = await readJson(options.statePath);
  if (!state.channel_id || !state.discord_message_id) return null;
  const current = await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    fetchImpl: options.fetchImpl,
  });
  return discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    method: 'PATCH',
    body: {
      content: 'Storefront theme applied and verified on the public itch.io page.',
      embeds: buildItchThemeReviewEmbeds(state),
      components: [{ type: ACTION_ROW, components: [link('Open Public Page', state.public_url)] }],
      attachments: current.attachments,
    },
    fetchImpl: options.fetchImpl,
  });
}
