import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { buildDigitalAssetPackReviewComponents } from './review-components.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CATEGORY_TYPE = 4;
const DISCORD_TEXT_CHANNEL_TYPE = 0;
const REVIEW_COLOR = 0x35d9ff;
const REVIEW_COMPONENT_SCHEMA_VERSION = '2.0';

function cleanText(value, maximum = 1024) {
  const normalized = String(value || '').replace(/\s+/gu, ' ').trim();
  return normalized.length <= maximum
    ? normalized
    : `${normalized.slice(0, Math.max(0, maximum - 3))}...`;
}

function validateItchUrl(value) {
  const parsed = new URL(String(value || ''));
  if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.itch.io')) {
    throw new Error('The itch review URL must be an https://*.itch.io URL.');
  }
  if (parsed.username || parsed.password) throw new Error('The itch review URL cannot contain credentials.');
  return parsed.toString();
}

function wait(milliseconds) {
  return new Promise((resolveWait) => setTimeout(resolveWait, milliseconds));
}

export async function discordRequest(token, path, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const sleepImpl = options.sleepImpl || wait;
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 5);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(`${DISCORD_API_BASE_URL}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        ...(options.body instanceof FormData ? {} : options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(options.body ? { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) } : {}),
    });
    if (response.ok) return response.status === 204 ? null : response.json();

    const errorText = await response.text();
    if (response.status === 429 && attempt < maxAttempts) {
      let retryAfterSeconds = 1;
      try {
        const rateLimit = JSON.parse(errorText);
        const suppliedDelay = Number(rateLimit.retry_after);
        if (Number.isFinite(suppliedDelay) && suppliedDelay >= 0) retryAfterSeconds = suppliedDelay;
      } catch {
        // Discord normally supplies JSON; use the bounded fallback when it does not.
      }
      await sleepImpl(Math.ceil(retryAfterSeconds * 1000) + 100);
      continue;
    }
    throw new Error(`Discord ${options.method || 'GET'} ${path} failed (${response.status}): ${errorText}`);
  }
  throw new Error(`Discord ${options.method || 'GET'} ${path} exhausted its retry budget.`);
}

async function sendMessageWithFiles(token, channelId, payload, files, options = {}) {
  const form = new FormData();
  const attachments = files.map((file, index) => ({
    id: index,
    filename: file.filename,
    description: cleanText(file.description, 1024),
  }));
  form.append('payload_json', JSON.stringify({ ...payload, attachments }));
  for (let index = 0; index < files.length; index += 1) {
    form.append(
      `files[${index}]`,
      new Blob([files[index].buffer], { type: files[index].contentType }),
      files[index].filename,
    );
  }
  return discordRequest(
    token,
    options.messageId
      ? `/channels/${channelId}/messages/${options.messageId}`
      : `/channels/${channelId}/messages`,
    {
      method: options.messageId ? 'PATCH' : 'POST',
      body: form,
      fetchImpl: options.fetchImpl,
    },
  );
}

async function findOrCreatePackChannel(options) {
  const channels = await discordRequest(options.token, `/guilds/${options.guildId}/channels`, {
    fetchImpl: options.fetchImpl,
  });
  const category = channels.find((channel) => (
    channel.type === DISCORD_CATEGORY_TYPE
    && String(channel.name || '').toLocaleLowerCase() === options.categoryName.toLocaleLowerCase()
  ));
  if (!category) throw new Error(`Discord category "${options.categoryName}" was not found.`);
  const existing = channels.find((channel) => (
    channel.type === DISCORD_TEXT_CHANNEL_TYPE
    && channel.parent_id === category.id
    && channel.name === options.channelName
  ));
  if (existing) return { category, channel: existing, created: false };
  const channel = await discordRequest(options.token, `/guilds/${options.guildId}/channels`, {
    method: 'POST',
    body: {
      name: options.channelName,
      type: DISCORD_TEXT_CHANNEL_TYPE,
      parent_id: category.id,
      topic: cleanText(options.topic, 1024),
    },
    fetchImpl: options.fetchImpl,
  });
  return { category, channel, created: true };
}

function numberedAssetList(assets) {
  const width = Math.max(2, String(assets.length).length);
  return assets.map((asset, index) => (
    `**${String(index + 1).padStart(width, '0')}** — ${asset.name}`
  )).join('\n');
}

export function buildPackReviewEmbed({ product, manifest, itchUrl, revision = 1 }) {
  return {
    title: `${product.title} · Pack Review · Revision ${revision}`,
    url: itchUrl,
    description: 'Review the exact package and populated itch.io draft. Public distribution remains blocked.',
    color: REVIEW_COLOR,
    fields: [
      { name: 'State', value: '`awaiting_package_review`', inline: true },
      { name: 'Assets', value: String(manifest.asset_count), inline: true },
      { name: 'Local generation cost', value: '€0 API cost', inline: true },
      { name: 'Included assets', value: numberedAssetList(product.assets), inline: false },
      { name: 'Manifest', value: `\`${manifest.manifest_hash}\``, inline: false },
      { name: 'Listing', value: `\`${manifest.listing_hash}\``, inline: false },
      {
        name: 'Attached manifest.json',
        value: 'Machine-readable review receipt with the exact file list and SHA-256 hashes. It proves which files this decision covers; it is not buyer-facing marketing content.',
        inline: false,
      },
      { name: 'itch.io draft', value: `[Open populated draft listing](${itchUrl})`, inline: false },
      { name: 'Approval', value: 'Approve the complete pack, request changes for selected numbered assets, or reject this revision.', inline: false },
    ],
    image: { url: 'attachment://cover.png' },
    footer: { text: 'ORION Digital Asset Engine · exact included assets and listing' },
  };
}

export function buildAssetReviewEmbed({ asset, validation, index, total }) {
  const width = Math.max(2, String(total).length);
  const number = String(index + 1).padStart(width, '0');
  const totalNumber = String(total).padStart(width, '0');
  return {
    title: `${number}/${totalNumber} · ${asset.name}`,
    description: `Asset **${number}** of **${totalNumber}**. Select **${number}** in the package feedback form if it needs revision.`,
    color: REVIEW_COLOR,
    fields: [
      { name: 'Asset ID', value: `\`${asset.asset_id}\``, inline: false },
      { name: 'Automated checks', value: validation.status === 'passed' ? 'Passed' : 'Failed', inline: true },
      { name: 'Canvas', value: `${validation.metrics.width}×${validation.metrics.height}`, inline: true },
      { name: 'SHA-256', value: `\`${validation.metrics.content_sha256}\``, inline: false },
    ],
    image: { url: `attachment://${basename(asset.final_path)}` },
  };
}

function buildManifestMessageUrl(guildId, state) {
  return `https://discord.com/channels/${guildId}/${state.channel_id}/${state.overview_message_id}`;
}

function buildPackComponents({ guildId, state, product, manifest, itchUrl }) {
  return buildDigitalAssetPackReviewComponents({
    productSlug: product.slug,
    manifestHash: manifest.manifest_hash,
    manifestUrl: buildManifestMessageUrl(guildId, state),
    itchUrl,
  });
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadState(path) {
  try { return await readJson(path); } catch (error) { if (error?.code === 'ENOENT') return null; throw error; }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function validateItchStaging(itchState, manifest, requestedUrl) {
  if (itchState?.status !== 'verified') {
    throw new Error('The itch.io draft must be populated and verified before Discord review is created.');
  }
  if (itchState.manifest_hash !== manifest.manifest_hash
    || itchState.listing_hash !== manifest.listing_hash) {
    throw new Error('The verified itch.io draft belongs to a different package revision.');
  }
  const stagedUrl = validateItchUrl(itchState.public_url);
  if (requestedUrl && validateItchUrl(requestedUrl) !== stagedUrl) {
    throw new Error('The requested itch.io URL does not match the verified draft.');
  }
  return stagedUrl;
}

export async function postDigitalAssetReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Discord review posting requires DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.');

  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const exportRoot = resolve(productRoot, 'exports', 'itch-preview');
  const manifestPath = resolve(exportRoot, 'manifest.json');
  const manifest = await readJson(manifestPath);
  if (manifest.distribution_ready !== false || manifest.release_state !== 'internal_preview') {
    throw new Error('Discord review posting requires an internal preview manifest with distribution blocked.');
  }
  if (!/^[a-f0-9]{64}$/u.test(String(manifest.listing_hash || ''))) {
    throw new Error('Discord review posting requires a packaged listing hash.');
  }
  const itchStatePath = resolve(productRoot, 'review', 'itch.json');
  const itchState = options.itchState || await loadState(itchStatePath);
  const itchUrl = validateItchStaging(itchState, manifest, options.itchUrl);
  const statePath = resolve(productRoot, 'review', 'discord.json');
  const existingState = await loadState(statePath);
  if (existingState?.manifest_hash === manifest.manifest_hash
    && existingState?.listing_hash === manifest.listing_hash
    && existingState?.completed_at
    && existingState?.component_schema_version === REVIEW_COMPONENT_SCHEMA_VERSION) {
    return { ...existingState, reused: true, statePath };
  }

  const channelResult = await findOrCreatePackChannel({
    token,
    guildId,
    categoryName: options.categoryName,
    channelName: product.slug,
    topic: `${product.title} review · ${product.product_id} · publication blocked`,
    fetchImpl: options.fetchImpl,
  });
  const revisionChanged = Boolean(
    existingState?.manifest_hash && existingState.manifest_hash !== manifest.manifest_hash,
  );
  const state = existingState || {
    schema_version: '2.0',
    product_id: product.product_id,
    product_slug: product.slug,
    category_name: options.categoryName,
    category_id: channelResult.category.id,
    channel_id: channelResult.channel.id,
    channel_created: channelResult.created,
    overview_message_id: null,
    thread_id: null,
    asset_messages: {},
    review_revision: 1,
    created_at: options.now || new Date().toISOString(),
  };
  state.schema_version = '2.0';
  state.review_revision = Math.max(1, Number(state.review_revision) || 1) + (revisionChanged ? 1 : 0);
  state.manifest_hash = manifest.manifest_hash;
  state.listing_hash = manifest.listing_hash;
  state.itch_url = itchUrl;
  state.itch_staged_at = itchState.staged_at;
  state.component_schema_version = null;
  state.completed_at = null;
  if (revisionChanged) state.last_decision = null;
  await saveState(statePath, state);

  const overviewPayload = {
    embeds: [buildPackReviewEmbed({
      product,
      manifest,
      itchUrl,
      revision: state.review_revision,
    })],
  };
  const overviewFiles = [
    {
      filename: 'cover.png',
      contentType: 'image/png',
      description: `${product.title} cover assembled from included assets`,
      buffer: await readFile(resolve(exportRoot, 'cover.png')),
    },
    {
      filename: 'manifest.json',
      contentType: 'application/json',
      description: `Exact internal preview manifest ${manifest.manifest_hash}`,
      buffer: await readFile(manifestPath),
    },
  ];
  if (!state.overview_message_id) {
    const overview = await sendMessageWithFiles(token, state.channel_id, overviewPayload, overviewFiles, {
      fetchImpl: options.fetchImpl,
    });
    state.overview_message_id = overview.id;
    await saveState(statePath, state);
    await discordRequest(token, `/channels/${state.channel_id}/messages/${state.overview_message_id}`, {
      method: 'PATCH',
      body: { components: buildPackComponents({ guildId, state, product, manifest, itchUrl }) },
      fetchImpl: options.fetchImpl,
    });
  } else {
    await sendMessageWithFiles(token, state.channel_id, {
      ...overviewPayload,
      components: buildPackComponents({ guildId, state, product, manifest, itchUrl }),
    }, overviewFiles, {
      messageId: state.overview_message_id,
      fetchImpl: options.fetchImpl,
    });
  }

  if (!state.thread_id) {
    const thread = await discordRequest(
      token,
      `/channels/${state.channel_id}/messages/${state.overview_message_id}/threads`,
      {
        method: 'POST',
        body: { name: 'asset-review', auto_archive_duration: 1440 },
        fetchImpl: options.fetchImpl,
      },
    );
    state.thread_id = thread.id;
    await saveState(statePath, state);
  }

  for (let index = 0; index < product.assets.length; index += 1) {
    const asset = product.assets[index];
    const validation = await readJson(resolve(productRoot, asset.validation_path));
    const filename = basename(asset.final_path);
    const payload = {
      embeds: [buildAssetReviewEmbed({ asset, validation, index, total: product.assets.length })],
      components: [],
    };
    const files = [{
      filename,
      contentType: 'image/png',
      description: `${String(index + 1).padStart(2, '0')} ${asset.name} transparent sprite candidate`,
      buffer: await readFile(resolve(productRoot, asset.final_path)),
    }];
    const existingMessageId = state.asset_messages[asset.asset_id];
    if (existingMessageId) {
      await sendMessageWithFiles(token, state.thread_id, payload, files, {
        messageId: existingMessageId,
        fetchImpl: options.fetchImpl,
      });
      continue;
    }
    const message = await sendMessageWithFiles(token, state.thread_id, payload, files, {
      fetchImpl: options.fetchImpl,
    });
    state.asset_messages[asset.asset_id] = message.id;
    await saveState(statePath, state);
  }

  state.component_schema_version = REVIEW_COMPONENT_SCHEMA_VERSION;
  state.completed_at = options.now || new Date().toISOString();
  await saveState(statePath, state);
  return { ...state, reused: false, statePath };
}
