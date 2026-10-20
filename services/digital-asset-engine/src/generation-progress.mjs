import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import {
  discordRequest,
  findOrCreatePackChannel,
  sendMessageWithFiles,
} from './discord-review.mjs';

const PROGRESS_COLOR = 0x9b84ee;

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function elapsedLabel(startedAt, now = new Date()) {
  const started = Date.parse(startedAt);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  const seconds = Number.isFinite(started) && Number.isFinite(current)
    ? Math.max(0, Math.floor((current - started) / 1000))
    : 0;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

export function buildGenerationProgressEmbed(product, progress, now = new Date()) {
  const completed = Array.isArray(progress.completed_asset_ids)
    ? progress.completed_asset_ids.length
    : Number(progress.completed_count || 0);
  const total = Number(progress.total_count || product.assets.length);
  const currentAsset = progress.current_asset_name
    ? `**${Math.min(total, completed + 1)}/${total}** - ${progress.current_asset_name}`
    : progress.state === 'packaging'
      ? 'Packaging previews and review receipts'
      : progress.state === 'failed'
        ? 'Generation stopped safely'
        : completed >= total
          ? 'All assets generated; preparing package'
          : 'Preparing local generation';
  return {
    title: `${product.title} - Generation Progress`,
    description: 'ORION is generating this pack locally. Completed assets appear in the attached thread as soon as they pass validation.',
    color: progress.state === 'failed' ? 0xed4245 : PROGRESS_COLOR,
    fields: [
      { name: 'State', value: `\`${progress.state || 'generating'}\``, inline: true },
      { name: 'Progress', value: `**${completed}/${total}**`, inline: true },
      { name: 'Elapsed', value: `**${elapsedLabel(progress.started_at, now)}**`, inline: true },
      { name: 'Current step', value: currentAsset, inline: false },
      { name: 'Local generation cost', value: '$0 API cost', inline: true },
      { name: 'Marketplace state', value: 'Blocked until generation and human creative review are complete.', inline: false },
    ],
    footer: { text: 'ORION Digital Asset Engine - live local generation' },
  };
}

function buildGeneratedAssetEmbed(asset, validation, index, total) {
  const width = Math.max(2, String(total).length);
  const number = String(index + 1).padStart(width, '0');
  const totalNumber = String(total).padStart(width, '0');
  return {
    title: `${number}/${totalNumber} - ${asset.name} - GENERATED`,
    description: 'Generated locally and passed the automated technical checks. The final package approval gate appears after all assets are complete.',
    color: 0x57f287,
    fields: [
      { name: 'Asset ID', value: `\`${asset.asset_id}\``, inline: false },
      { name: 'Automated checks', value: validation.status === 'passed' ? 'Passed' : 'Failed', inline: true },
      { name: 'Canvas', value: `${validation.metrics.width}x${validation.metrics.height}`, inline: true },
      { name: 'SHA-256', value: `\`${validation.metrics.content_sha256}\``, inline: false },
    ],
    image: { url: `attachment://${basename(asset.final_path)}` },
  };
}

async function saveProgressOverview(options, state, product, now = new Date()) {
  await discordRequest(
    options.token,
    `/channels/${state.channel_id}/messages/${state.overview_message_id}`,
    {
      method: 'PATCH',
      body: {
        embeds: [buildGenerationProgressEmbed(product, state.generation_progress, now)],
        components: [],
      },
      fetchImpl: options.fetchImpl,
    },
  );
}

export async function prepareDigitalAssetGenerationProgress(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Generation progress requires Discord bot and guild configuration.');
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product;
  const productRoot = store.productRoot(product);
  const statePath = resolve(productRoot, 'review', 'discord.json');
  const existing = await readOptionalJson(statePath);
  if (existing && (existing.product_id !== product.product_id || existing.product_slug !== product.slug)) {
    throw new Error('Existing Discord generation state belongs to a different product.');
  }
  const channelResult = await findOrCreatePackChannel({
    token,
    guildId,
    categoryName: options.categoryName || 'DIGITAL ASSETS',
    channelName: product.slug,
    topic: `${product.title} generation and review - ${product.product_id} - publication blocked`,
    fetchImpl: options.fetchImpl,
  });
  const startedAt = existing?.generation_progress?.started_at
    || options.startedAt
    || new Date().toISOString();
  const completedAssetIds = product.assets
    .filter((asset) => asset.status === 'generated')
    .map((asset) => asset.asset_id);
  const state = {
    ...(existing || {}),
    schema_version: '2.0',
    product_id: product.product_id,
    product_slug: product.slug,
    category_name: options.categoryName || 'DIGITAL ASSETS',
    category_id: channelResult.category.id,
    channel_id: channelResult.channel.id,
    channel_created: existing?.channel_created ?? channelResult.created,
    overview_message_id: existing?.overview_message_id || null,
    thread_id: existing?.thread_id || null,
    asset_messages: existing?.asset_messages || {},
    review_revision: Math.max(1, Number(existing?.review_revision) || 1),
    created_at: existing?.created_at || startedAt,
    component_schema_version: null,
    completed_at: null,
    generation_progress: {
      state: 'generating',
      started_at: startedAt,
      updated_at: options.updatedAt || new Date().toISOString(),
      total_count: product.assets.length,
      completed_asset_ids: completedAssetIds,
      current_asset_id: null,
      current_asset_name: '',
      error: null,
    },
  };
  if (!state.overview_message_id) {
    const overview = await discordRequest(token, `/channels/${state.channel_id}/messages`, {
      method: 'POST',
      body: {
        embeds: [buildGenerationProgressEmbed(product, state.generation_progress)],
        components: [],
      },
      fetchImpl: options.fetchImpl,
    });
    state.overview_message_id = overview.id;
  } else {
    await saveProgressOverview({ token, fetchImpl: options.fetchImpl }, state, product);
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
  }
  await writeJson(statePath, state);
  return { state, statePath, productRoot };
}

export async function updateDigitalAssetGenerationProgress(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product;
  const productRoot = store.productRoot(product);
  const statePath = resolve(productRoot, 'review', 'discord.json');
  let state = await readOptionalJson(statePath);
  if (!state?.overview_message_id || !state?.thread_id) {
    state = (await prepareDigitalAssetGenerationProgress(options)).state;
  }
  const event = options.event || {};
  const completed = new Set(state.generation_progress?.completed_asset_ids || []);
  const nextProgress = {
    ...state.generation_progress,
    updated_at: event.at || new Date().toISOString(),
    total_count: product.assets.length,
  };
  if (event.type === 'asset_started') {
    nextProgress.state = 'generating';
    nextProgress.current_asset_id = event.asset.asset_id;
    nextProgress.current_asset_name = event.asset.name;
  } else if (event.type === 'asset_completed') {
    completed.add(event.asset.asset_id);
    nextProgress.state = completed.size >= product.assets.length ? 'packaging' : 'generating';
    nextProgress.completed_asset_ids = [...completed];
    nextProgress.current_asset_id = null;
    nextProgress.current_asset_name = '';
    const asset = product.assets.find((item) => item.asset_id === event.asset.asset_id) || event.asset;
    const index = product.assets.findIndex((item) => item.asset_id === asset.asset_id);
    const validation = event.result.validation;
    const payload = {
      embeds: [buildGeneratedAssetEmbed(asset, validation, index, product.assets.length)],
      components: [],
    };
    const files = [{
      filename: basename(event.result.final_path),
      contentType: 'image/png',
      description: `${String(index + 1).padStart(2, '0')} ${asset.name} generated transparent sprite`,
      buffer: await readFile(resolve(productRoot, event.result.final_path)),
    }];
    const existingMessageId = state.asset_messages[asset.asset_id];
    const message = await sendMessageWithFiles(token, state.thread_id, payload, files, {
      ...(existingMessageId ? { messageId: existingMessageId } : {}),
      fetchImpl: options.fetchImpl,
    });
    state.asset_messages[asset.asset_id] = existingMessageId || message.id;
  } else if (event.type === 'packaging_started' || event.type === 'assets_completed') {
    nextProgress.state = 'packaging';
    nextProgress.current_asset_id = null;
    nextProgress.current_asset_name = '';
  } else if (event.type === 'failed') {
    nextProgress.state = 'failed';
    nextProgress.error = String(event.error || 'Unknown generation error').slice(0, 1000);
    nextProgress.current_asset_id = null;
    nextProgress.current_asset_name = '';
  }
  state.generation_progress = nextProgress;
  await writeJson(statePath, state);
  await saveProgressOverview({ token, fetchImpl: options.fetchImpl }, state, product, event.at || new Date());
  return state;
}
