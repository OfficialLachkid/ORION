import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CATEGORY_TYPE = 4;
const DISCORD_TEXT_CHANNEL_TYPE = 0;
const REVIEW_COLOR = 0x35d9ff;

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

async function discordRequest(token, path, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${DISCORD_API_BASE_URL}${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bot ${token}`,
      ...(options.body instanceof FormData ? {} : options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: options.body instanceof FormData ? options.body : JSON.stringify(options.body) } : {}),
  });
  if (!response.ok) {
    throw new Error(`Discord ${options.method || 'GET'} ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
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
  return discordRequest(token, `/channels/${channelId}/messages`, {
    method: 'POST',
    body: form,
    fetchImpl: options.fetchImpl,
  });
}

async function findOrCreatePackChannel(options) {
  const channels = await discordRequest(options.token, `/guilds/${options.guildId}/channels`, {
    fetchImpl: options.fetchImpl,
  });
  const category = channels.find((channel) => (
    channel.type === DISCORD_CATEGORY_TYPE
    && String(channel.name || '').toLocaleLowerCase() === options.categoryName.toLocaleLowerCase()
  ));
  if (!category) {
    throw new Error(`Discord category "${options.categoryName}" was not found.`);
  }
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

export function buildPackReviewEmbed({ product, manifest, itchUrl }) {
  return {
    title: `${product.title} · Pack Review`,
    url: itchUrl,
    description: 'Review the exact packaged assets below. This draft is not approved for public distribution.',
    color: REVIEW_COLOR,
    fields: [
      { name: 'State', value: '`awaiting_asset_review`', inline: true },
      { name: 'Assets', value: String(manifest.asset_count), inline: true },
      { name: 'Local generation cost', value: '€0 API cost', inline: true },
      { name: 'Manifest', value: `\`${manifest.manifest_hash}\``, inline: false },
      { name: 'itch.io draft', value: `[Open draft listing](${itchUrl})`, inline: false },
      { name: 'Approval', value: 'Buttons and Supabase decision persistence are the next implementation slice.', inline: false },
    ],
    image: { url: 'attachment://cover.png' },
    footer: { text: 'ORION Digital Asset Engine · exact included assets' },
  };
}

export function buildAssetReviewEmbed({ asset, validation, index, total }) {
  return {
    title: `${index + 1}/${total} · ${asset.name}`,
    description: 'Individual transparent PNG candidate. Human decision is still pending.',
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

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function loadState(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function saveState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
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
  const itchUrl = validateItchUrl(options.itchUrl);
  const statePath = resolve(productRoot, 'review', 'discord.json');
  const existingState = await loadState(statePath);
  if (existingState?.manifest_hash === manifest.manifest_hash && existingState?.completed_at) {
    return { ...existingState, reused: true, statePath };
  }
  if (existingState?.manifest_hash && existingState.manifest_hash !== manifest.manifest_hash) {
    throw new Error('A Discord review already exists for a different manifest; create a new review revision before posting again.');
  }

  const channelResult = await findOrCreatePackChannel({
    token,
    guildId,
    categoryName: options.categoryName,
    channelName: product.slug,
    topic: `${product.title} review · ${product.product_id} · publication blocked`,
    fetchImpl: options.fetchImpl,
  });
  const state = existingState || {
    schema_version: '1.0',
    product_id: product.product_id,
    product_slug: product.slug,
    manifest_hash: manifest.manifest_hash,
    category_name: options.categoryName,
    category_id: channelResult.category.id,
    channel_id: channelResult.channel.id,
    channel_created: channelResult.created,
    itch_url: itchUrl,
    overview_message_id: null,
    thread_id: null,
    asset_messages: {},
    created_at: options.now || new Date().toISOString(),
    completed_at: null,
  };
  await saveState(statePath, state);

  if (!state.overview_message_id) {
    const overview = await sendMessageWithFiles(token, state.channel_id, {
      embeds: [buildPackReviewEmbed({ product, manifest, itchUrl })],
    }, [
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
    ], { fetchImpl: options.fetchImpl });
    state.overview_message_id = overview.id;
    await saveState(statePath, state);
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
    if (state.asset_messages[asset.asset_id]) continue;
    const validation = await readJson(resolve(productRoot, asset.validation_path));
    const filename = basename(asset.final_path);
    const message = await sendMessageWithFiles(token, state.thread_id, {
      embeds: [buildAssetReviewEmbed({ asset, validation, index, total: product.assets.length })],
    }, [{
      filename,
      contentType: 'image/png',
      description: `${asset.name} transparent sprite candidate`,
      buffer: await readFile(resolve(productRoot, asset.final_path)),
    }], { fetchImpl: options.fetchImpl });
    state.asset_messages[asset.asset_id] = message.id;
    await saveState(statePath, state);
  }

  state.completed_at = options.now || new Date().toISOString();
  await saveState(statePath, state);
  return { ...state, reused: false, statePath };
}
