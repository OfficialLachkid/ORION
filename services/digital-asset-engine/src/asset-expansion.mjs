import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CanonicalProductStore } from './canonical-store.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';
import { AssetExpansionReviewPlanSchema, ProductSpecificationSchema } from './schemas.mjs';

const EXPANSION_REVIEW_VERSION = '1.0.0';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizePath(value) {
  return value.replaceAll('\\', '/');
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

async function exists(path) {
  try { await stat(path); return true; } catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
}

async function resolveExpansionBase(productRoot, product, plan) {
  try {
    return await resolvePackagedRelease({ productRoot, releaseVersion: plan.base_version });
  } catch (error) {
    if (error?.code !== 'ENOENT' || product.version !== plan.base_version) throw error;
  }
  const base = await resolvePackagedRelease({ productRoot });
  if (base.manifest.product_version !== plan.base_version) {
    throw new Error('Canonical preview does not match the requested expansion base version.');
  }
  const distribution = await readJson(resolveInside(productRoot, 'review/distribution.json', 'Published distribution receipt'));
  if (distribution.status !== 'published'
    || distribution.target_version !== plan.base_version
    || distribution.manifest_hash !== base.manifest.manifest_hash
    || distribution.publication_job?.status !== 'completed') {
    throw new Error('The initial packaged release is not the exact verified public expansion base.');
  }
  return base;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function labelSize(value) {
  return Math.max(10, Math.min(15, Math.floor(190 / Math.max(1, String(value).length))));
}

async function buildOverview(title, assets) {
  const width = 960;
  const height = 540;
  const columns = 4;
  const rows = Math.ceil(assets.length / columns);
  const gridLeft = 36;
  const gridTop = 118;
  const gridWidth = 888;
  const gridHeight = 350;
  const cellWidth = Math.floor(gridWidth / columns);
  const cellHeight = Math.floor(gridHeight / rows);
  const cells = [];
  const watermarks = [];
  const images = [];
  for (let index = 0; index < assets.length; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = gridLeft + (column * cellWidth);
    const top = gridTop + (row * cellHeight);
    const assetWidth = Math.min(128, cellWidth - 40);
    const assetHeight = Math.min(112, cellHeight - 46);
    const resized = await sharp(assets[index].buffer).resize(assetWidth, assetHeight, {
      fit: 'contain',
      kernel: sharp.kernel.nearest,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    }).png().toBuffer();
    images.push({
      input: resized,
      left: left + Math.floor((cellWidth - assetWidth) / 2),
      top: top + 12,
    });
    const centerX = left + (cellWidth / 2);
    cells.push(
      `<rect x="${left + 5}" y="${top + 5}" width="${cellWidth - 10}" height="${cellHeight - 10}" rx="12" fill="#151c2a" stroke="#2f4160"/>`,
      `<text x="${centerX}" y="${top + cellHeight - 17}" text-anchor="middle" fill="#d8e2f7" font-family="Arial, sans-serif" font-size="${labelSize(assets[index].name)}">${escapeXml(assets[index].name)}</text>`,
    );
    watermarks.push(
      `<text x="${centerX}" y="${top + Math.floor(cellHeight * 0.47)}" text-anchor="middle" fill="#ffffff" fill-opacity="0.34" stroke="#0c1019" stroke-opacity="0.5" stroke-width="1" font-family="Arial, sans-serif" font-size="23" font-weight="700" transform="rotate(-17 ${centerX} ${top + Math.floor(cellHeight * 0.47)})">PREVIEW</text>`,
    );
  }
  const titleSize = Math.max(24, Math.min(36, Math.floor(820 / Math.max(1, title.length * 0.62))));
  const overlay = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    '<rect width="100%" height="100%" fill="#0c1019"/>',
    '<rect x="20" y="20" width="920" height="500" rx="22" fill="#111827" stroke="#35d9ff" stroke-width="2"/>',
    `<text x="480" y="66" text-anchor="middle" fill="#f4f7ff" font-family="Arial, sans-serif" font-size="${titleSize}" font-weight="700">${escapeXml(title.toUpperCase())}</text>`,
    `<text x="480" y="99" text-anchor="middle" fill="#35d9ff" font-family="Arial, sans-serif" font-size="18">${assets.length} REVIEW ITEMS · ${assets.reduce((total, asset) => total + (asset.animation?.animations.length || 0), 0)} ANIMATIONS</text>`,
    ...cells,
    '<text x="480" y="501" text-anchor="middle" fill="#8998b8" font-family="Arial, sans-serif" font-size="14">Internal expansion review · public package unchanged</text>',
    '</svg>',
  ].join(''));
  const watermarkOverlay = Buffer.from([
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`,
    ...watermarks,
    '</svg>',
  ].join(''));
  return sharp({ create: { width, height, channels: 3, background: '#0c1019' } })
    .composite([{ input: overlay }, ...images, { input: watermarkOverlay }])
    .flatten({ background: '#0c1019' })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function verifyBundle(candidateRoot, manifest) {
  for (const file of manifest.files || []) {
    const buffer = await readFile(resolveInside(candidateRoot, file.path, 'Expansion review file'));
    if (buffer.length !== file.size_bytes || sha256(buffer) !== file.content_sha256) {
      throw new Error(`Immutable expansion review file changed: ${file.path}.`);
    }
  }
}

function animationReviewFile(path) {
  return path === 'base.png'
    || path === 'validation.json'
    || path.startsWith('frames/')
    || path.startsWith('overlays/')
    || path.startsWith('sheets/')
    || path.startsWith('states/')
    || path.startsWith('metadata/')
    || (path.startsWith('previews/') && (path.endsWith('.gif') || path.endsWith('.png')));
}

async function loadAnimationProof(productRoot, request, expectedBaseHash) {
  const proof = request.interactive_proof || request.animation_proof;
  if (!proof) return null;
  const batchRoot = resolveInside(
    productRoot,
    `experiments/${proof.batch_id}`,
    'Interactive animation batch',
  );
  const batchManifest = await readJson(resolveInside(batchRoot, 'manifest.json', 'Animation batch manifest'));
  if (batchManifest.batch_id !== proof.batch_id
    || batchManifest.status !== 'awaiting_animation_review'
    || batchManifest.gates?.all_items_valid !== true
    || batchManifest.gates?.package_modified !== false) {
    throw new Error(`Animation batch is not a valid isolated proof: ${proof.batch_id}.`);
  }
  const itemReference = batchManifest.item_manifests?.find((item) => (
    item.asset_key === proof.asset_key
  ));
  if (!itemReference) throw new Error(`Animation proof item is missing: ${proof.asset_key}.`);
  const itemRoot = resolveInside(batchRoot, proof.asset_key, 'Interactive animation item');
  const itemManifest = await readJson(resolveInside(itemRoot, 'manifest.json', 'Animation item manifest'));
  if (itemManifest.manifest_hash !== itemReference.manifest_hash
    || itemManifest.item?.target_asset_key !== request.target_asset_key
    || itemManifest.status !== 'awaiting_animation_review'
    || itemManifest.base_regenerated !== false) {
    throw new Error(`Animation proof no longer matches ${request.target_asset_key}.`);
  }
  const baseFile = itemManifest.files?.find((file) => file.path === 'base.png');
  if (!baseFile || baseFile.sha256 !== expectedBaseHash) {
    throw new Error(`Animation proof base changed for ${request.target_asset_key}.`);
  }
  const files = [];
  for (const file of itemManifest.files || []) {
    const buffer = await readFile(resolveInside(itemRoot, file.path, 'Animation proof file'));
    if (buffer.length !== file.size || sha256(buffer) !== file.sha256) {
      throw new Error(`Animation proof file changed: ${request.target_asset_key}/${file.path}.`);
    }
    if (animationReviewFile(file.path)) files.push({ ...file, buffer });
  }
  const animations = (itemManifest.animations || []).map((animationKey) => ({
    animation_key: animationKey,
    metadata_path: `animations/${request.target_asset_key}/metadata/${animationKey}/animation.json`,
    sprite_sheet_path: `animations/${request.target_asset_key}/sheets/${animationKey}.png`,
    preview_gif_path: `animations/${request.target_asset_key}/previews/${animationKey}.gif`,
  }));
  const states = (itemManifest.states || []).map((stateKey) => ({
    state_key: stateKey,
    path: `animations/${request.target_asset_key}/states/${stateKey}.png`,
  }));
  if (!animations.length && !states.length) {
    throw new Error(`Interactive proof contains no states or animations: ${request.target_asset_key}.`);
  }
  const identity = {
    batch_id: batchManifest.batch_id,
    batch_manifest_hash: batchManifest.manifest_hash,
    item_manifest_hash: itemManifest.manifest_hash,
    base_sha256: baseFile.sha256,
    generation_calls: itemManifest.generation_calls,
    incurred_cost: itemManifest.incurred_cost,
    buyer_runtime_formats: itemManifest.buyer_runtime_formats,
    preview_only_formats: itemManifest.preview_only_formats,
    quality_holds: itemManifest.quality_holds || [],
    states,
    animations,
    files: files.map(({ buffer, path, size, sha256: fileHash }) => ({
      path: `animations/${request.target_asset_key}/${path}`,
      size_bytes: size,
      content_sha256: fileHash,
    })),
  };
  return {
    ...identity,
    bundle_hash: sha256(JSON.stringify(identity)),
    runtime_files: files,
  };
}

export async function prepareAssetExpansionReview(options) {
  const plan = AssetExpansionReviewPlanSchema.parse(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  const base = await resolveExpansionBase(productRoot, product, plan);
  if (base.manifest.manifest_hash !== plan.base_manifest_hash) {
    throw new Error('Expansion plan targets a different immutable base release.');
  }
  const selected = [];
  for (const request of plan.assets) {
    const existingAsset = product.assets.find((asset) => asset.asset_key === request.target_asset_key);
    if (request.operation === 'add_asset' && existingAsset) {
      throw new Error(`Expansion asset key already exists in the base product: ${request.target_asset_key}.`);
    }
    if (request.operation === 'enhance_existing' && !existingAsset) {
      throw new Error(`Enhancement target does not exist in the base product: ${request.target_asset_key}.`);
    }
    const canonicalSource = request.source_product_slug === product.slug;
    const sourceRoot = canonicalSource
      ? productRoot
      : resolveInside(productRoot, `experiments/${request.source_product_slug}`, 'Expansion source product');
    const sourceProduct = canonicalSource
      ? product
      : ProductSpecificationSchema.parse(await readJson(resolve(sourceRoot, 'product.json')));
    if (sourceProduct.slug !== request.source_product_slug) {
      throw new Error(`Expansion source slug changed: ${request.source_product_slug}.`);
    }
    const sourceAsset = sourceProduct.assets.find((asset) => asset.asset_key === request.source_asset_key);
    if (!sourceAsset?.final_path || !sourceAsset.validation_path) {
      throw new Error(`Expansion source asset is unavailable: ${request.source_asset_key}.`);
    }
    const [buffer, validation] = await Promise.all([
      readFile(resolveInside(sourceRoot, sourceAsset.final_path, 'Expansion source PNG')),
      readJson(resolveInside(sourceRoot, sourceAsset.validation_path, 'Expansion validation')),
    ]);
    const contentHash = sha256(buffer);
    if (validation.status !== 'passed' || validation.metrics?.content_sha256 !== contentHash) {
      throw new Error(`Expansion source asset is not a verified candidate: ${request.source_asset_key}.`);
    }
    if (request.operation === 'enhance_existing'
      && (sourceAsset.asset_key !== existingAsset.asset_key || sourceAsset.asset_id !== existingAsset.asset_id)) {
      throw new Error(`Enhancement proof must preserve the existing asset identity: ${request.target_asset_key}.`);
    }
    const animation = await loadAnimationProof(productRoot, request, contentHash);
    selected.push({
      asset_id: request.operation === 'enhance_existing'
        ? existingAsset.asset_id
        : `asset-expansion-${sha256(`${plan.expansion_id}:${request.target_asset_key}`).slice(0, 16)}`,
      asset_key: request.target_asset_key,
      operation: request.operation,
      name: request.target_name,
      kind: sourceAsset.kind,
      description: sourceAsset.description,
      buyer_group: request.buyer_group,
      replaces_review_asset_key: request.replaces_review_asset_key,
      source_product_slug: request.source_product_slug,
      source_asset_key: request.source_asset_key,
      source_asset_id: sourceAsset.asset_id,
      content_sha256: contentHash,
      size_bytes: buffer.length,
      validation_metrics: validation.metrics,
      animation,
      buffer,
    });
  }

  const inputHash = sha256(Buffer.from(JSON.stringify({
    plan,
    product_id: product.product_id,
    base_release_id: base.manifest.release_id,
    assets: selected.map(({ buffer, animation, ...asset }) => ({
      ...asset,
      animation: animation ? {
        ...animation,
        runtime_files: animation.runtime_files.map(({ buffer: runtimeBuffer, ...file }) => file),
      } : null,
    })),
    expansion_review_version: EXPANSION_REVIEW_VERSION,
  })));
  const reviewRoot = resolveInside(productRoot, `extensions/${plan.expansion_id}/review`, 'Expansion review root');
  const candidateRoot = resolveInside(reviewRoot, `candidates/${inputHash.slice(0, 16)}`, 'Expansion review candidate');
  const manifestPath = resolve(candidateRoot, 'manifest.json');
  if (await exists(candidateRoot)) {
    const manifest = await readJson(manifestPath);
    if (manifest.input_hash !== inputHash) throw new Error('Immutable expansion review input changed.');
    await verifyBundle(candidateRoot, manifest);
    return { plan, product, candidateRoot, manifestPath, manifest, reused: true };
  }

  await mkdir(resolve(candidateRoot, 'assets'), { recursive: true });
  for (const asset of selected) {
    await writeFile(resolve(candidateRoot, 'assets', `${asset.asset_key}.png`), asset.buffer);
    for (const file of asset.animation?.runtime_files || []) {
      const target = resolveInside(
        candidateRoot,
        `animations/${asset.asset_key}/${file.path}`,
        'Expansion animation file',
      );
      await mkdir(resolve(target, '..'), { recursive: true });
      await writeFile(target, file.buffer);
    }
  }
  const overview = await buildOverview(plan.title, selected);
  await writeFile(resolve(candidateRoot, 'overview.png'), overview);
  const files = [];
  for (const asset of selected) {
    files.push({
      path: `assets/${asset.asset_key}.png`,
      size_bytes: asset.size_bytes,
      content_sha256: asset.content_sha256,
    });
    files.push(...(asset.animation?.files || []));
  }
  files.push({ path: 'overview.png', size_bytes: overview.length, content_sha256: sha256(overview) });
  const identity = {
    schema_version: '1.0',
    expansion_id: plan.expansion_id,
    product_id: product.product_id,
    product_slug: product.slug,
    title: plan.title,
    base_version: plan.base_version,
    target_version: plan.target_version,
    base_release_id: base.manifest.release_id,
    base_manifest_hash: base.manifest.manifest_hash,
    input_hash: inputHash,
    expansion_review_version: EXPANSION_REVIEW_VERSION,
    asset_count: selected.length,
    new_asset_count: selected.filter((asset) => asset.operation === 'add_asset').length,
    enhanced_asset_count: selected.filter((asset) => asset.operation === 'enhance_existing').length,
    animation_count: selected.reduce((total, asset) => total + (asset.animation?.animations.length || 0), 0),
    state_count: selected.reduce((total, asset) => total + (asset.animation?.states.length || 0), 0),
    assets: selected.map(({ buffer, animation, ...asset }) => ({
      ...asset,
      path: `assets/${asset.asset_key}.png`,
      review_hash: animation?.bundle_hash || asset.content_sha256,
      animation: animation ? {
        ...animation,
        runtime_files: undefined,
      } : null,
    })),
    gates: {
      base_release_verified: true,
      source_assets_verified: true,
      human_review_required: true,
      approved_for_extension: false,
      public_release_mutated: false,
    },
    files,
    created_at: options.now || new Date().toISOString(),
  };
  const manifest = {
    ...identity,
    manifest_hash: sha256(Buffer.from(JSON.stringify({ ...identity, created_at: undefined }))),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await mkdir(reviewRoot, { recursive: true });
  await writeFile(resolve(reviewRoot, 'latest-review.json'), `${JSON.stringify({
    schema_version: '1.0',
    expansion_id: plan.expansion_id,
    candidate_path: normalizePath(relative(productRoot, candidateRoot)),
    manifest_hash: manifest.manifest_hash,
    target_version: plan.target_version,
    updated_at: options.now || new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return { plan, product, candidateRoot, manifestPath, manifest, reused: false };
}
