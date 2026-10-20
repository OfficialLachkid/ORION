import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';
import { buildDigitalAssetPackReviewComponents } from './review-components.mjs';

const DISCORD_API_BASE_URL = 'https://discord.com/api/v10';
const DISCORD_CATEGORY_TYPE = 4;
const DISCORD_TEXT_CHANNEL_TYPE = 0;
const REVIEW_COLOR = 0x35d9ff;
const REVIEW_COMPONENT_SCHEMA_VERSION = '2.1';
const DISCORD_ATTACHMENT_LIMIT = 10;

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

export async function sendMessageWithFiles(token, channelId, payload, files, options = {}) {
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

function reviewMediaContentType(path) {
  const normalized = path.toLocaleLowerCase();
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.webp')) return 'image/webp';
  throw new Error(`Unsupported storefront review image: ${path}.`);
}

export function marketplaceReviewMediaPaths(listing, marketingMedia = null) {
  const paths = [
    listing.cover_path || marketingMedia?.cover_path || 'cover.png',
    marketingMedia?.cover_fallback_path,
    ...(listing.screenshot_paths || []),
    ...(marketingMedia?.screenshot_paths || []),
  ]
    .map((path) => String(path || '').replaceAll('\\', '/').trim())
    .filter(Boolean);
  return [...new Set(paths)];
}

function uniqueAttachmentFilenames(paths) {
  const totals = new Map();
  for (const path of paths) {
    const filename = basename(path);
    totals.set(filename, (totals.get(filename) || 0) + 1);
  }
  return paths.map((path, index) => {
    const filename = basename(path);
    return totals.get(filename) === 1
      ? filename
      : `${String(index + 1).padStart(2, '0')}-${filename}`;
  });
}

async function loadMarketplaceReviewMedia(exportRoot, listing, marketingMedia, productTitle) {
  const paths = marketplaceReviewMediaPaths(listing, marketingMedia);
  const filenames = uniqueAttachmentFilenames(paths);
  return Promise.all(paths.map(async (path, index) => {
    const absolutePath = resolve(exportRoot, path);
    const child = relative(exportRoot, absolutePath);
    if (child.startsWith('..') || isAbsolute(child)) {
      throw new Error('Storefront review media path must stay inside the immutable candidate.');
    }
    return {
      path,
      filename: filenames[index],
      contentType: reviewMediaContentType(path),
      description: index === 0
        ? `${productTitle} cover assembled from included assets`
        : `${productTitle} marketplace preview ${index}`,
      buffer: await readFile(absolutePath),
    };
  }));
}

export function partitionReviewAttachments(mediaFiles, receiptFiles, limit = DISCORD_ATTACHMENT_LIMIT) {
  const maximum = Math.max(1, Number(limit) || DISCORD_ATTACHMENT_LIMIT);
  if (receiptFiles.length >= maximum) {
    throw new Error('Discord review receipts leave no attachment slot for the storefront cover.');
  }
  const overviewMediaCount = Math.min(mediaFiles.length, maximum - receiptFiles.length);
  const overviewFiles = [
    ...mediaFiles.slice(0, overviewMediaCount),
    ...receiptFiles,
  ];
  const galleryChunks = [];
  for (let index = overviewMediaCount; index < mediaFiles.length; index += maximum) {
    galleryChunks.push(mediaFiles.slice(index, index + maximum));
  }
  return { overviewFiles, galleryChunks };
}

export async function findOrCreatePackChannel(options) {
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

export function buildPackReviewEmbed({
  product,
  manifest,
  itchUrl,
  revision = 1,
  marketplaceReviewMode = 'draft',
  currentReleaseVersion = null,
  coverFilename = 'cover.png',
  mediaCount = 1,
}) {
  const reviewAssets = [
    ...product.assets,
    ...(manifest.expansion_assets || []),
  ];
  const publishedUpdate = marketplaceReviewMode === 'published_update';
  const localGeneration = marketplaceReviewMode === 'local_generation';
  const licenseField = manifest.buyer_license ? [{
    name: 'Customer license',
    value: `\`${manifest.buyer_license.license_id} ${manifest.buyer_license.version}\`\nSHA-256: \`${manifest.buyer_license.content_sha256}\`\nAttached as \`LICENSE.md\`; approval covers these exact terms.`,
    inline: false,
  }] : [];
  return {
    title: `${product.title} · Pack Review · Revision ${revision}`,
    ...(itchUrl ? { url: itchUrl } : {}),
    description: localGeneration
      ? 'Review the locally generated package and every individual asset. Marketplace staging and publication remain blocked.'
      : publishedUpdate
      ? `Review the exact update package and generated storefront media. The linked itch.io page remains on approved version ${currentReleaseVersion || 'current'}; this candidate has not been applied.`
      : 'Review the exact package and populated itch.io draft. Public distribution remains blocked.',
    color: REVIEW_COLOR,
    fields: [
      { name: 'State', value: '`awaiting_package_review`', inline: true },
      { name: 'Release', value: `\`${manifest.target_version || manifest.product_version || 'preview'}\``, inline: true },
      { name: 'Assets', value: String(manifest.asset_count || manifest.weapon_count), inline: true },
      { name: 'Local generation cost', value: '€0 API cost', inline: true },
      { name: 'Included assets', value: numberedAssetList(reviewAssets), inline: false },
      { name: 'Manifest', value: `\`${manifest.manifest_hash}\``, inline: false },
      { name: 'Listing', value: `\`${manifest.listing_hash}\``, inline: false },
      ...licenseField,
      {
        name: 'Attached manifest.json',
        value: 'Machine-readable review receipt with the exact file list and SHA-256 hashes. It proves which files this decision covers; it is not buyer-facing marketing content.',
        inline: false,
      },
      {
        name: 'Storefront media',
        value: `**${mediaCount}** exact candidate image${mediaCount === 1 ? '' : 's'} attached to this package review.`,
        inline: false,
      },
      localGeneration
        ? { name: 'Marketplace state', value: 'Not staged. Approval accepts the creative package and makes it eligible for a separate marketplace setup step.', inline: false }
        : publishedUpdate
        ? { name: 'Current itch.io release', value: `[Open current approved listing](${itchUrl})\nCandidate storefront media is attached for review and is not live.`, inline: false }
        : { name: 'itch.io draft', value: `[Open populated draft listing](${itchUrl})`, inline: false },
      { name: 'Approval', value: 'Approve the complete pack, request changes for selected numbered assets, or reject this revision.', inline: false },
    ],
    image: { url: `attachment://${coverFilename}` },
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

function buildPackComponents({ guildId, state, product, manifest, itchUrl, marketplaceReviewMode }) {
  return buildDigitalAssetPackReviewComponents({
    productSlug: product.slug,
    manifestHash: manifest.manifest_hash,
    manifestUrl: buildManifestMessageUrl(guildId, state),
    itchUrl,
    itchLabel: marketplaceReviewMode === 'published_update'
      ? 'Open Current itch.io Page'
      : 'Open itch.io Draft',
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

function validateMarketplaceReview(itchState, publishedState, manifest, requestedUrl, allowLocalReview = false) {
  if (itchState?.status === 'verified'
    && itchState.manifest_hash === manifest.manifest_hash
    && itchState.listing_hash === manifest.listing_hash) {
    const stagedUrl = validateItchUrl(itchState.public_url);
    if (requestedUrl && validateItchUrl(requestedUrl) !== stagedUrl) {
      throw new Error('The requested itch.io URL does not match the verified draft.');
    }
    return { url: stagedUrl, mode: 'draft', stagedAt: itchState.staged_at, currentReleaseVersion: null };
  }
  if (publishedState?.status === 'verified_public') {
    const publicUrl = validateItchUrl(publishedState.public_url);
    if (requestedUrl && validateItchUrl(requestedUrl) !== publicUrl) {
      throw new Error('The requested itch.io URL does not match the verified public release.');
    }
    if (publishedState.manifest_hash === manifest.manifest_hash) {
      throw new Error('The requested package is already the verified public itch.io release.');
    }
    return {
      url: publicUrl,
      mode: 'published_update',
      stagedAt: null,
      currentReleaseVersion: publishedState.target_version || null,
    };
  }
  if (itchState?.status === 'verified') {
    throw new Error('The verified itch.io draft belongs to a different package revision.');
  }
  if (allowLocalReview) {
    return { url: null, mode: 'local_generation', stagedAt: null, currentReleaseVersion: null };
  }
  throw new Error('The itch.io draft must be populated and verified before Discord review is created.');
}

export async function postDigitalAssetReview(options) {
  const token = options.runtimeConfig?.env?.DISCORD_BOT_TOKEN;
  const guildId = options.runtimeConfig?.guildId;
  if (!token || !guildId) throw new Error('Discord review posting requires DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.');

  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = options.product || await store.loadProduct(options.slug);
  const productRoot = store.productRoot(product);
  const packaged = await resolvePackagedRelease({
    productRoot,
    releaseVersion: options.releaseVersion,
  });
  const exportRoot = packaged.root;
  const { manifestPath, manifest, listing } = packaged;
  if (!/^[a-f0-9]{64}$/u.test(String(manifest.listing_hash || ''))) {
    throw new Error('Discord review posting requires a packaged listing hash.');
  }
  const itchStatePath = resolve(productRoot, 'review', 'itch.json');
  const itchState = options.itchState || await loadState(itchStatePath);
  const publishedState = options.publishedState
    || await loadState(resolve(productRoot, 'review', 'itch-release.json'));
  const marketplaceReview = validateMarketplaceReview(
    itchState,
    publishedState,
    manifest,
    options.itchUrl,
    options.localReview === true,
  );
  const itchUrl = marketplaceReview.url;
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
  state.target_version = manifest.target_version || product.version || null;
  state.package_root = relative(productRoot, exportRoot).replaceAll('\\', '/');
  state.itch_url = itchUrl;
  state.itch_staged_at = marketplaceReview.stagedAt;
  state.marketplace_review_mode = marketplaceReview.mode;
  state.current_marketplace_version = marketplaceReview.currentReleaseVersion;
  state.storefront_media_message_ids = Array.isArray(state.storefront_media_message_ids)
    ? state.storefront_media_message_ids
    : [];
  state.component_schema_version = null;
  state.completed_at = null;
  if (revisionChanged) state.last_decision = null;
  await saveState(statePath, state);

  const mediaFiles = await loadMarketplaceReviewMedia(
    exportRoot,
    listing,
    manifest.marketing_media,
    product.title,
  );
  const receiptFiles = [{
    filename: 'manifest.json',
    contentType: 'application/json',
    description: `Exact internal preview manifest ${manifest.manifest_hash}`,
    buffer: await readFile(manifestPath),
  }];
  if (manifest.buyer_license) {
    const licenseBuffer = await readFile(resolve(exportRoot, 'download', 'LICENSE.md'));
    const licenseHash = createHash('sha256').update(licenseBuffer).digest('hex');
    if (licenseHash !== manifest.buyer_license.content_sha256) {
      throw new Error('The buyer license no longer matches the immutable package manifest.');
    }
    receiptFiles.push({
      filename: 'LICENSE.md',
      contentType: 'text/markdown',
      description: `${manifest.buyer_license.license_id} ${manifest.buyer_license.version}`,
      buffer: licenseBuffer,
    });
  }
  const { overviewFiles, galleryChunks } = partitionReviewAttachments(mediaFiles, receiptFiles);
  const overviewPayload = {
    embeds: [buildPackReviewEmbed({
      product,
      manifest,
      itchUrl,
      revision: state.review_revision,
      marketplaceReviewMode: marketplaceReview.mode,
      currentReleaseVersion: marketplaceReview.currentReleaseVersion,
      coverFilename: mediaFiles[0].filename,
      mediaCount: mediaFiles.length,
    })],
  };
  let needsComponentPatch = false;
  if (!state.overview_message_id) {
    const overview = await sendMessageWithFiles(token, state.channel_id, overviewPayload, overviewFiles, {
      fetchImpl: options.fetchImpl,
    });
    state.overview_message_id = overview.id;
    await saveState(statePath, state);
    needsComponentPatch = true;
  } else {
    try {
      await sendMessageWithFiles(token, state.channel_id, {
        ...overviewPayload,
        components: buildPackComponents({ guildId, state, product, manifest, itchUrl, marketplaceReviewMode: marketplaceReview.mode }),
      }, overviewFiles, {
        messageId: state.overview_message_id,
        fetchImpl: options.fetchImpl,
      });
    } catch (error) {
      if (!String(error?.message || '').includes('"code": 30046')) throw error;
      state.superseded_overview_message_ids = [
        ...(state.superseded_overview_message_ids || []),
        state.overview_message_id,
      ];
      const overview = await sendMessageWithFiles(token, state.channel_id, overviewPayload, overviewFiles, {
        fetchImpl: options.fetchImpl,
      });
      state.overview_message_id = overview.id;
      await saveState(statePath, state);
      needsComponentPatch = true;
    }
  }
  if (needsComponentPatch) {
    await discordRequest(token, `/channels/${state.channel_id}/messages/${state.overview_message_id}`, {
      method: 'PATCH',
      body: { components: buildPackComponents({ guildId, state, product, manifest, itchUrl, marketplaceReviewMode: marketplaceReview.mode }) },
      fetchImpl: options.fetchImpl,
    });
  }

  const mediaMessageIds = [];
  for (let index = 0; index < galleryChunks.length; index += 1) {
    const chunk = galleryChunks[index];
    const payload = {
      content: `**Storefront media ${index + 2}/${galleryChunks.length + 1}** — exact files from package review Revision ${state.review_revision}.`,
      embeds: [],
      components: [],
    };
    const existingMessageId = state.storefront_media_message_ids[index];
    if (existingMessageId) {
      try {
        await sendMessageWithFiles(token, state.channel_id, payload, chunk, {
          messageId: existingMessageId,
          fetchImpl: options.fetchImpl,
        });
        mediaMessageIds.push(existingMessageId);
        continue;
      } catch (error) {
        if (!String(error?.message || '').includes('"code": 30046')) throw error;
      }
    }
    const message = await sendMessageWithFiles(token, state.channel_id, payload, chunk, {
      fetchImpl: options.fetchImpl,
    });
    mediaMessageIds.push(message.id);
  }
  state.storefront_media_message_ids = mediaMessageIds;
  state.storefront_media_paths = mediaFiles.map((file) => file.path);
  await saveState(statePath, state);

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
