import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { discordRequest } from './discord-review.mjs';
import { postDigitalAssetDistributionReview } from './distribution-review.mjs';
import { stageItchDraft } from './itch-draft-stager.mjs';
import { inspectItchSellerReadiness } from './itch-seller-preflight.mjs';
import { applyApprovedItchTheme, prepareItchThemeCandidate } from './itch-theme.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';
import { markItchThemeApplied, postItchThemeReview } from './theme-review.mjs';

const ACTION_ROW = 1;
const BUTTON = 2;
const BUTTON_SECONDARY = 2;
const BUTTON_SUCCESS = 3;
const BUTTON_LINK = 5;
const COMPONENT_PREFIX = 'dms';

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

async function writeJsonAtomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

function assertAuthorized(interaction, config) {
  if (config.guildId && String(interaction.guild_id || '') !== String(config.guildId)) {
    throw new Error('Marketplace setup request came from an unexpected Discord guild.');
  }
  const userId = String(interaction?.member?.user?.id || interaction?.user?.id || '');
  const roles = Array.isArray(interaction?.member?.roles) ? interaction.member.roles : [];
  if (!(config.operatorUserIds || []).includes(userId)
    && !(config.operatorRoleId && roles.includes(config.operatorRoleId))) {
    throw new Error('Only an approved ORION operator can create marketplace drafts.');
  }
}

function actorFromInteraction(interaction) {
  const user = interaction?.member?.user || interaction?.user || {};
  return {
    id: String(user.id || ''),
    displayName: String(interaction?.member?.nick || user.global_name || user.username || user.id || 'operator'),
  };
}

function customId(context) {
  return [COMPONENT_PREFIX, 'c', context.productSlug, context.manifestHash.slice(0, 16)].join('|');
}

export function parseMarketplaceSetupCustomId(value) {
  const parts = String(value || '').split('|');
  if (parts.length !== 4 || parts[0] !== COMPONENT_PREFIX || parts[1] !== 'c') return null;
  if (!/^[a-z0-9-]+$/u.test(parts[2]) || !/^[a-f0-9]{16}$/u.test(parts[3])) return null;
  return { productSlug: parts[2], manifestHashPrefix: parts[3] };
}

export function isMarketplaceSetupInteraction(interaction) {
  return interaction?.type === 3 && Boolean(parseMarketplaceSetupCustomId(interaction?.data?.custom_id));
}

function link(label, url) {
  return { type: BUTTON, style: BUTTON_LINK, label, url };
}

export function buildMarketplaceSetupComponents(state) {
  const controls = [];
  if (['awaiting_setup', 'failed'].includes(state.status)) {
    const retryingTheme = state.status === 'failed' && state.phase === 'apply_theme';
    controls.push({
      type: BUTTON,
      style: state.status === 'failed' ? BUTTON_SECONDARY : BUTTON_SUCCESS,
      label: retryingTheme ? 'Retry Theme Application'
        : state.status === 'failed' ? 'Retry itch.io Draft' : 'Create itch.io Draft',
      custom_id: customId({ productSlug: state.product_slug, manifestHash: state.manifest_hash }),
    });
  }
  if (state.public_url) controls.push(link('Open itch.io Draft', state.public_url));
  if (state.theme_message_url) controls.push(link('Open Theme Review', state.theme_message_url));
  if (state.distribution_message_url) {
    controls.push(link('Open Publication Gate', state.distribution_message_url));
  }
  controls.push(link('Open Manifest', state.manifest_url));
  return [{ type: ACTION_ROW, components: controls }];
}

export function buildMarketplaceSetupEmbeds(state) {
  const labels = {
    awaiting_setup: 'MARKETPLACE SETUP REQUIRED',
    queued: 'MARKETPLACE SETUP QUEUED',
    running: 'CREATING ITCH.IO DRAFT',
    awaiting_theme_approval: 'THEME APPROVAL REQUIRED',
    completed: 'ITCH.IO DRAFT VERIFIED',
    failed: 'MARKETPLACE SETUP NEEDS ATTENTION',
  };
  const colors = {
    awaiting_setup: 0x5865f2,
    queued: 0xfee75c,
    running: 0xfee75c,
    awaiting_theme_approval: 0x5865f2,
    completed: 0x57f287,
    failed: 0xed4245,
  };
  const description = state.status === 'completed'
    ? 'The draft page, buyer download, listing fields, storefront theme, price, and draft visibility were verified. Publication still requires the separate gate.'
    : state.status === 'awaiting_theme_approval'
      ? 'The draft and buyer download are verified. Review the locally proposed storefront theme; publication remains blocked until that theme is approved, applied, and verified.'
    : state.status === 'failed'
      ? `The setup stopped safely and nothing was published. ${String(state.error || '').split('\n')[0].slice(0, 900)}`
      : state.status === 'running'
        ? state.phase === 'apply_theme'
          ? 'ORION is applying the approved storefront theme, verifying desktop and mobile, and preparing the separate publication gate.'
          : 'ORION is creating or reconciling the draft, uploading the buyer package, and reading the result back.'
        : state.status === 'queued'
          ? 'The exact creatively approved package is queued for marketplace setup. Nothing will be published.'
          : 'This exact creatively approved package may now receive its own itch.io draft. Creating the draft does not authorize publication.';
  return [{
    title: `${state.title} · ${labels[state.status] || labels.awaiting_setup}`,
    description,
    color: colors[state.status] || colors.awaiting_setup,
    fields: [
      { name: 'Version', value: `\`${state.target_version || '0.1.0'}\``, inline: true },
      { name: 'Assets', value: `**${state.asset_count || 0}**`, inline: true },
      { name: 'Suggested price', value: `**${state.price_label || 'Not set'}**`, inline: true },
      { name: 'Manifest', value: `\`${state.manifest_hash.slice(0, 16)}…\``, inline: false },
      ...(state.public_url ? [{ name: 'Verified draft', value: state.public_url, inline: false }] : []),
    ],
    footer: { text: 'Creative approval and publication approval remain separate gates.' },
  }];
}

function statePathFor(productRoot) {
  return resolve(productRoot, 'review', 'marketplace-setup.json');
}

function assertCreativeApproval(discordState, manifest) {
  if (discordState.creative_approval?.status !== 'approved'
    || discordState.creative_approval.manifest_hash !== manifest.manifest_hash
    || discordState.creative_approval.listing_hash !== manifest.listing_hash) {
    throw new Error('Marketplace setup requires creative approval for this exact manifest and listing.');
  }
}

export async function postMarketplaceSetupReview(options) {
  const runtimeConfig = options.runtimeConfig || {};
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = runtimeConfig.guildId;
  if (!token || !guildId) throw new Error('Marketplace setup review requires Discord runtime credentials.');
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: options.releaseVersion,
  });
  const discordState = await readJson(resolve(productRoot, 'review', 'discord.json'));
  assertCreativeApproval(discordState, packaged.manifest);
  const path = statePathFor(productRoot);
  const previous = await readOptionalJson(path);
  const exactPrevious = previous?.manifest_hash === packaged.manifest.manifest_hash
    && previous?.listing_hash === packaged.manifest.listing_hash;
  const status = exactPrevious && ['queued', 'running', 'awaiting_theme_approval', 'completed', 'failed'].includes(previous.status)
    ? previous.status
    : 'awaiting_setup';
  const amount = Number(packaged.listing.suggested_price?.amount);
  const currency = String(packaged.listing.suggested_price?.currency || 'USD');
  const state = {
    schema_version: '1.0',
    status,
    product_id: product.product_id,
    product_slug: product.slug,
    title: product.title,
    target_version: packaged.manifest.target_version || product.version || null,
    release_version: options.releaseVersion || null,
    manifest_hash: packaged.manifest.manifest_hash,
    listing_hash: packaged.manifest.listing_hash,
    package_root: relative(productRoot, packaged.root).replaceAll('\\', '/'),
    asset_count: Number(packaged.manifest.asset_count || product.assets?.length || 0),
    price_label: Number.isFinite(amount) ? `${currency} ${amount.toFixed(2)}` : 'Not set',
    channel_id: discordState.channel_id,
    package_review_message_id: discordState.overview_message_id,
    discord_message_id: exactPrevious ? previous.discord_message_id || null : null,
    manifest_url: `https://discord.com/channels/${guildId}/${discordState.channel_id}/${discordState.overview_message_id}`,
    public_url: exactPrevious ? previous.public_url || null : null,
    edit_url: exactPrevious ? previous.edit_url || null : null,
    distribution_message_url: exactPrevious ? previous.distribution_message_url || null : null,
    theme_message_url: exactPrevious ? previous.theme_message_url || null : null,
    theme_hash: exactPrevious ? previous.theme_hash || null : null,
    phase: exactPrevious ? previous.phase || 'stage_draft' : 'stage_draft',
    updated_at: options.now || new Date().toISOString(),
    ...(exactPrevious && previous.request ? { request: previous.request } : {}),
    ...(exactPrevious && previous.error ? { error: previous.error } : {}),
    ...(exactPrevious && previous.worker_pid ? { worker_pid: previous.worker_pid } : {}),
  };
  const payload = {
    embeds: buildMarketplaceSetupEmbeds(state),
    components: buildMarketplaceSetupComponents(state),
  };
  if (state.discord_message_id) {
    await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
      method: 'PATCH',
      body: payload,
      fetchImpl: options.fetchImpl,
    });
  } else {
    const message = await discordRequest(token, `/channels/${state.channel_id}/messages`, {
      method: 'POST',
      body: payload,
      fetchImpl: options.fetchImpl,
    });
    state.discord_message_id = message.id;
  }
  await writeJsonAtomic(path, state);
  return { ...state, statePath: path };
}

export async function recordMarketplaceSetupRequest(options) {
  const reference = parseMarketplaceSetupCustomId(options.interaction?.data?.custom_id);
  if (!reference) return null;
  const config = options.config || {};
  assertAuthorized(options.interaction, config);
  const archiveRoot = String(options.archiveRoot || config?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for marketplace setup.');
  const productRoot = resolve(archiveRoot, reference.productSlug);
  const path = statePathFor(productRoot);
  const [state, discordState] = await Promise.all([
    readJson(path),
    readJson(resolve(productRoot, 'review', 'discord.json')),
  ]);
  if (!['awaiting_setup', 'failed'].includes(state.status)) {
    throw new Error(`Marketplace setup is already ${state.status}.`);
  }
  if (state.product_slug !== reference.productSlug
    || !state.manifest_hash.startsWith(reference.manifestHashPrefix)) {
    throw new Error('This marketplace setup action belongs to a stale manifest.');
  }
  if (String(state.channel_id) !== String(options.interaction.channel_id || '')
    || String(state.discord_message_id) !== String(options.interaction.message?.id || '')) {
    throw new Error('This marketplace setup action came from an unexpected Discord message.');
  }
  if (discordState.creative_approval?.manifest_hash !== state.manifest_hash
    || discordState.creative_approval?.listing_hash !== state.listing_hash) {
    throw new Error('Creative approval no longer matches this marketplace setup request.');
  }
  const actor = actorFromInteraction(options.interaction);
  const requestedAt = options.now || new Date().toISOString();
  state.status = 'queued';
  state.phase = state.phase === 'apply_theme' ? 'apply_theme' : 'stage_draft';
  state.worker_pid = null;
  state.error = null;
  state.request = {
    requested_at: requestedAt,
    requested_by_discord_id: actor.id,
    discord_interaction_id: String(options.interaction.id || ''),
  };
  state.updated_at = requestedAt;
  await writeJsonAtomic(path, state);
  return {
    state,
    actor,
    statePath: path,
    channelId: state.channel_id,
    messageId: state.discord_message_id,
    messagePatch: {
      embeds: buildMarketplaceSetupEmbeds(state),
      components: buildMarketplaceSetupComponents(state),
    },
  };
}

async function updateSetupMessage(runtimeConfig, state, fetchImpl) {
  const token = runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  if (!token || !state.channel_id || !state.discord_message_id) return;
  await discordRequest(token, `/channels/${state.channel_id}/messages/${state.discord_message_id}`, {
    method: 'PATCH',
    body: {
      embeds: buildMarketplaceSetupEmbeds(state),
      components: buildMarketplaceSetupComponents(state),
    },
    fetchImpl,
  });
}

export async function runMarketplaceSetupJob(options) {
  const path = resolve(options.statePath);
  let state = await readJson(path);
  if (state.status === 'completed') return { ...state, reused: true };
  if (!['queued', 'failed'].includes(state.status)) {
    throw new Error(`Marketplace setup is not runnable from status ${state.status}.`);
  }
  const runtimeConfig = options.runtimeConfig || {};
  const archiveRoot = String(options.outputRoot || runtimeConfig?.env?.DIGITAL_ASSET_ARCHIVE_ROOT || '').trim();
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required for marketplace setup.');
  const store = options.store || new CanonicalProductStore(archiveRoot);
  const product = await store.loadProduct(state.product_slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: state.release_version,
  });
  const discordPath = resolve(productRoot, 'review', 'discord.json');
  let discordState = await readJson(discordPath);
  assertCreativeApproval(discordState, packaged.manifest);
  if (packaged.manifest.manifest_hash !== state.manifest_hash
    || packaged.manifest.listing_hash !== state.listing_hash) {
    throw new Error('The packaged release changed after marketplace setup approval.');
  }

  state = {
    ...state,
    status: 'running',
    attempt: Number(state.attempt || 0) + 1,
    worker_pid: process.pid,
    started_at: options.now || new Date().toISOString(),
    error: null,
  };
  await writeJsonAtomic(path, state);
  await updateSetupMessage(runtimeConfig, state, options.fetchImpl).catch(() => {});
  try {
    if (state.phase === 'apply_theme') {
      const applied = await (options.applyTheme || applyApprovedItchTheme)({
        outputRoot: archiveRoot,
        slug: product.slug,
        releaseVersion: state.release_version,
        profileDir: options.profileDir,
        headed: options.headed,
        env: options.env,
        now: options.now,
      });
      await (options.markThemeApplied || markItchThemeApplied)({
        statePath: applied.themeStatePath,
        runtimeConfig,
        fetchImpl: options.fetchImpl,
      });
      await (options.inspectSeller || inspectItchSellerReadiness)({
        outputRoot: archiveRoot,
        slug: product.slug,
        releaseVersion: state.release_version,
        profileDir: options.profileDir,
        headed: options.headed,
        env: options.env,
        now: options.now,
      });
      const distribution = await (options.postDistribution || postDigitalAssetDistributionReview)({
        runtimeConfig,
        outputRoot: archiveRoot,
        slug: product.slug,
        releaseVersion: state.release_version,
        fetchImpl: options.fetchImpl,
        now: options.now,
      });
      const completedAt = options.now || new Date().toISOString();
      state = {
        ...state,
        status: 'completed',
        phase: 'completed',
        worker_pid: null,
        completed_at: completedAt,
        updated_at: completedAt,
        theme_hash: applied.theme_hash,
        theme_receipt_path: relative(productRoot, applied.statePath).replaceAll('\\', '/'),
        distribution_message_id: distribution.discord_message_id,
        distribution_message_url: `https://discord.com/channels/${runtimeConfig.guildId}/${distribution.channel_id}/${distribution.discord_message_id}`,
        seller_status: distribution.seller_ready ? 'ready' : 'blocked',
      };
      await writeJsonAtomic(path, state);
      await updateSetupMessage(runtimeConfig, state, options.fetchImpl);
      return { ...state, reused: false };
    }

    const staged = await (options.stageDraft || stageItchDraft)({
      outputRoot: archiveRoot,
      slug: product.slug,
      releaseVersion: state.release_version,
      itchUrl: state.public_url || undefined,
      itchEditUrl: state.edit_url || undefined,
      profileDir: options.profileDir,
      headed: options.headed,
      env: options.env,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    discordState = await readJson(discordPath);
    assertCreativeApproval(discordState, packaged.manifest);
    discordState.marketplace_review_mode = 'draft';
    discordState.itch_url = staged.public_url;
    discordState.itch_staged_at = staged.staged_at;
    discordState.updated_at = options.now || new Date().toISOString();
    await writeJsonAtomic(discordPath, discordState);

    state = {
      ...state,
      public_url: staged.public_url,
      edit_url: staged.edit_url,
      butler_target: staged.butler_target,
    };
    await writeJsonAtomic(path, state);
    const candidate = await (options.prepareTheme || prepareItchThemeCandidate)({
      outputRoot: archiveRoot,
      slug: product.slug,
      releaseVersion: state.release_version,
      profileDir: options.profileDir,
      headed: options.headed,
      env: options.env,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    const waitingAt = options.now || new Date().toISOString();
    state = {
      ...state,
      status: 'awaiting_theme_approval',
      phase: 'theme_review',
      worker_pid: null,
      theme_hash: candidate.theme_hash,
      awaiting_theme_approval_at: waitingAt,
      updated_at: waitingAt,
    };
    await writeJsonAtomic(path, state);
    await updateSetupMessage(runtimeConfig, state, options.fetchImpl);
    const theme = await (options.postTheme || postItchThemeReview)({
      runtimeConfig,
      outputRoot: archiveRoot,
      slug: product.slug,
      candidate,
      fetchImpl: options.fetchImpl,
      now: options.now,
    });
    state = {
      ...state,
      theme_hash: theme.theme_hash,
      theme_message_id: theme.discord_message_id,
      theme_message_url: `https://discord.com/channels/${runtimeConfig.guildId}/${theme.channel_id}/${theme.discord_message_id}`,
      updated_at: options.now || new Date().toISOString(),
    };
    await writeJsonAtomic(path, state);
    await updateSetupMessage(runtimeConfig, state, options.fetchImpl);
    return { ...state, reused: false };
  } catch (error) {
    const failedAt = new Date().toISOString();
    state = {
      ...state,
      status: 'failed',
      worker_pid: null,
      failed_at: failedAt,
      updated_at: failedAt,
      error: String(error?.stack || error?.message || error).slice(0, 8000),
    };
    await writeJsonAtomic(path, state);
    await updateSetupMessage(runtimeConfig, state, options.fetchImpl).catch(() => {});
    throw error;
  }
}

export async function queueMarketplaceSetupAfterThemeApproval(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) throw new Error('DIGITAL_ASSET_ARCHIVE_ROOT is required to continue marketplace setup.');
  const themeDecision = options.themeDecision;
  if (themeDecision?.row?.decision !== 'approve' || themeDecision?.state?.status !== 'approved') {
    return null;
  }
  const productRoot = resolve(archiveRoot, themeDecision.state.product_slug);
  const path = statePathFor(productRoot);
  const state = await readOptionalJson(path);
  if (!state || state.status === 'completed') return null;
  if (state.status !== 'awaiting_theme_approval'
    || state.phase !== 'theme_review'
    || state.manifest_hash !== themeDecision.state.manifest_hash
    || state.listing_hash !== themeDecision.state.listing_hash
    || state.theme_hash !== themeDecision.state.theme_hash) {
    throw new Error('The approved theme no longer matches the pending marketplace workflow.');
  }
  const queuedAt = options.now || new Date().toISOString();
  const queued = {
    ...state,
    status: 'queued',
    phase: 'apply_theme',
    worker_pid: null,
    updated_at: queuedAt,
    theme_approved_at: themeDecision.row.decided_at,
  };
  await writeJsonAtomic(path, queued);
  return {
    state: queued,
    statePath: path,
    channelId: queued.channel_id,
    messageId: queued.discord_message_id,
    messagePatch: {
      embeds: buildMarketplaceSetupEmbeds(queued),
      components: buildMarketplaceSetupComponents(queued),
    },
    reused: false,
  };
}

function defaultProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function recoverMarketplaceSetupJobs(options) {
  const archiveRoot = String(options.archiveRoot || '').trim();
  if (!archiveRoot) return { scanned: 0, recovered: [], active: [] };
  let entries;
  try {
    entries = await readdir(archiveRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { scanned: 0, recovered: [], active: [] };
    throw error;
  }
  const processAlive = options.processAlive || defaultProcessAlive;
  const report = { scanned: 0, recovered: [], active: [] };
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const statePath = resolve(archiveRoot, entry.name, 'review', 'marketplace-setup.json');
    const state = await readOptionalJson(statePath);
    if (!state) continue;
    report.scanned += 1;
    if (state.status === 'awaiting_theme_approval' && state.phase === 'theme_review') {
      const theme = await readOptionalJson(resolve(dirname(statePath), 'itch-theme.json'));
      if (theme?.status === 'approved'
        && theme.manifest_hash === state.manifest_hash
        && theme.listing_hash === state.listing_hash
        && theme.theme_hash === state.theme_hash) {
        const recoveredAt = options.now || new Date().toISOString();
        const recovered = {
          ...state,
          status: 'queued',
          phase: 'apply_theme',
          worker_pid: null,
          recovery_count: Number(state.recovery_count || 0) + 1,
          recovered_at: recoveredAt,
        };
        await writeJsonAtomic(statePath, recovered);
        report.recovered.push({
          product_slug: recovered.product_slug || basename(dirname(dirname(statePath))),
          path: statePath,
          scheduled: options.scheduleJob?.(statePath) === true,
        });
      }
      continue;
    }
    if (state.status === 'running' && processAlive(Number(state.worker_pid))) {
      report.active.push({ product_slug: state.product_slug, worker_pid: Number(state.worker_pid) });
      continue;
    }
    if (!['queued', 'running'].includes(state.status)) continue;
    const recoveredAt = options.now || new Date().toISOString();
    const recovered = {
      ...state,
      status: 'queued',
      worker_pid: null,
      recovery_count: Number(state.recovery_count || 0) + 1,
      recovered_at: recoveredAt,
      ...(state.status === 'running' ? { interrupted_at: recoveredAt } : {}),
    };
    await writeJsonAtomic(statePath, recovered);
    report.recovered.push({
      product_slug: recovered.product_slug || basename(dirname(dirname(statePath))),
      path: statePath,
      scheduled: options.scheduleJob?.(statePath) === true,
    });
  }
  return report;
}
