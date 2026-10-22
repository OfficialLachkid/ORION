import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import sharp from 'sharp';
import { CanonicalProductStore } from './canonical-store.mjs';
import {
  buildExpansionReleaseMarketingMedia,
  EXPANSION_RELEASE_MARKETING_VERSION,
} from './expansion-release-marketing.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';
import { AssetExpansionReviewPlanSchema } from './schemas.mjs';

const EXPANSION_RELEASE_VERSION = '1.1.0';
const RUNTIME_PREFIXES = Object.freeze(['frames/', 'overlays/', 'sheets/', 'states/', 'metadata/']);
const BUYER_LICENSE = Object.freeze({
  license_id: 'vbjservices-digital-asset-license',
  version: '1.0',
  source_url: new URL('../templates/vbjservices-digital-asset-license-v1.md', import.meta.url),
});
const SHEET_COLUMNS = 4;
const SHEET_PADDING = 16;

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
  const distribution = await readJson(resolveInside(
    productRoot,
    'review/distribution.json',
    'Published distribution receipt',
  ));
  if (distribution.status !== 'published'
    || distribution.target_version !== plan.base_version
    || distribution.manifest_hash !== base.manifest.manifest_hash
    || distribution.publication_job?.status !== 'completed') {
    throw new Error('The initial packaged release is not the exact verified public expansion base.');
  }
  return base;
}

async function filesBelow(root) {
  const output = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

async function hashedFile(path, root) {
  const buffer = await readFile(path);
  return {
    path: normalizePath(relative(root, path)),
    size_bytes: buffer.length,
    content_sha256: sha256(buffer),
  };
}

async function verifyFiles(root, manifest, label) {
  for (const file of manifest.files || []) {
    const path = resolveInside(root, file.path, label);
    const buffer = await readFile(path);
    if (buffer.length !== file.size_bytes || sha256(buffer) !== file.content_sha256) {
      throw new Error(`${label} changed: ${file.path}.`);
    }
  }
}

function runtimeRelativePath(path, assetKey) {
  const prefix = `animations/${assetKey}/`;
  if (!path.startsWith(prefix)) return null;
  const relativePath = path.slice(prefix.length);
  return RUNTIME_PREFIXES.some((runtimePrefix) => relativePath.startsWith(runtimePrefix))
    ? relativePath
    : null;
}

async function copyApprovedExpansionAssets({ candidateRoot, reviewRoot, reviewManifest, product }) {
  const packaged = [];
  for (const asset of reviewManifest.assets) {
    const sourceEntry = reviewManifest.files.find((file) => file.path === asset.path);
    if (!sourceEntry) throw new Error(`Expansion manifest does not cover ${asset.asset_key}.`);
    const source = resolveInside(reviewRoot, asset.path, 'Approved expansion asset');
    const sourceBuffer = await readFile(source);
    if (sourceBuffer.length !== sourceEntry.size_bytes || sha256(sourceBuffer) !== sourceEntry.content_sha256) {
      throw new Error(`Approved expansion asset changed: ${asset.asset_key}.`);
    }
    const existingAsset = product.assets.find((candidate) => candidate.asset_id === asset.asset_id);
    const existingOperation = ['enhance_existing', 'replace_existing'].includes(asset.operation);
    if (existingOperation && !existingAsset) {
      throw new Error(`Expansion operation lost its existing asset identity: ${asset.asset_key}.`);
    }
    const buyerPath = existingOperation
      ? `assets/individual/${basename(existingAsset.final_path)}`
      : `assets/expansion/${asset.buyer_group}/${asset.asset_key}.png`;
    const destination = resolveInside(candidateRoot, `download/${buyerPath}`, 'Expansion buyer asset');
    await mkdir(resolve(destination, '..'), { recursive: true });
    await writeFile(destination, sourceBuffer);

    const runtimePaths = [];
    for (const file of asset.animation?.files || []) {
      const relativePath = runtimeRelativePath(file.path, asset.asset_key);
      if (!relativePath) continue;
      const reviewEntry = reviewManifest.files.find((candidate) => candidate.path === file.path);
      if (!reviewEntry
        || reviewEntry.size_bytes !== file.size_bytes
        || reviewEntry.content_sha256 !== file.content_sha256) {
        throw new Error(`Expansion runtime manifest mismatch: ${file.path}.`);
      }
      const runtimeBuffer = await readFile(resolveInside(reviewRoot, file.path, 'Approved expansion runtime'));
      if (runtimeBuffer.length !== file.size_bytes || sha256(runtimeBuffer) !== file.content_sha256) {
        throw new Error(`Approved expansion runtime changed: ${file.path}.`);
      }
      const runtimeBuyerPath = `animations/${asset.asset_key}/${relativePath}`;
      const runtimeDestination = resolveInside(
        candidateRoot,
        `download/${runtimeBuyerPath}`,
        'Expansion buyer runtime',
      );
      await mkdir(resolve(runtimeDestination, '..'), { recursive: true });
      await writeFile(runtimeDestination, runtimeBuffer);
      runtimePaths.push(runtimeBuyerPath);
    }
    packaged.push({
      asset_id: asset.asset_id,
      asset_key: asset.asset_key,
      operation: asset.operation || 'add_asset',
      name: asset.name,
      kind: asset.kind,
      description: asset.description,
      buyer_group: asset.buyer_group,
      content_sha256: asset.content_sha256,
      review_hash: asset.review_hash,
      buyer_path: buyerPath,
      runtime_paths: runtimePaths.sort(),
      states: asset.animation?.states || [],
      animations: asset.animation?.animations || [],
      animation_bundle_hash: asset.animation?.bundle_hash || null,
    });
  }
  return packaged;
}

async function rebuildBaseSpriteSheet({ candidateRoot, product }) {
  const columns = Math.min(SHEET_COLUMNS, product.assets.length);
  const rows = Math.ceil(product.assets.length / SHEET_COLUMNS);
  const cellWidth = product.style.width + (SHEET_PADDING * 2);
  const cellHeight = product.style.height + (SHEET_PADDING * 2);
  const buffers = await Promise.all(product.assets.map((asset) => readFile(resolveInside(
    candidateRoot,
    `download/assets/individual/${basename(asset.final_path)}`,
    'Buyer base asset',
  ))));
  const sheet = await sharp({
    create: {
      width: cellWidth * columns,
      height: cellHeight * rows,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite(buffers.map((buffer, index) => ({
    input: buffer,
    left: ((index % SHEET_COLUMNS) * cellWidth) + SHEET_PADDING,
    top: (Math.floor(index / SHEET_COLUMNS) * cellHeight) + SHEET_PADDING,
  }))).png({ compressionLevel: 9 }).toBuffer();
  const path = resolveInside(
    candidateRoot,
    `download/assets/${product.slug}-sprite-sheet.png`,
    'Buyer sprite sheet',
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, sheet);
}

function unique(values) {
  return [...new Set(values)];
}

export function inheritedMarketplaceScreenshotPath(path) {
  let normalized = normalizePath(String(path || '')).replace(/^\/+/, '');
  while (normalized.startsWith('previous-release-media/')) {
    normalized = normalized.slice('previous-release-media/'.length);
  }
  if (!normalized) throw new Error('Inherited marketplace screenshot path cannot be empty.');
  return `previous-release-media/${normalized}`;
}

async function copyInheritedMarketplaceScreenshots({ baseRoot, candidateRoot, listing }) {
  const inherited = [];
  const destinations = new Set();
  for (const path of unique(listing.screenshot_paths || [])) {
    const normalized = normalizePath(path);
    const source = resolveInside(baseRoot, normalized, 'Inherited marketplace screenshot');
    const destinationPath = inheritedMarketplaceScreenshotPath(normalized);
    if (destinations.has(destinationPath)) {
      throw new Error(`Inherited marketplace screenshots collide at ${destinationPath}.`);
    }
    destinations.add(destinationPath);
    const destination = resolveInside(
      candidateRoot,
      destinationPath,
      'Inherited marketplace screenshot destination',
    );
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source));
    inherited.push(destinationPath);
  }
  return inherited;
}

function releaseListing(baseListing, product, plan, expansionAssets, marketingMedia) {
  const animated = expansionAssets.filter((asset) => asset.runtime_paths.length);
  const additions = expansionAssets.filter((asset) => asset.operation === 'add_asset');
  const upgrades = expansionAssets.filter((asset) => asset.operation !== 'add_asset');
  const scope = [
    upgrades.length ? `upgrades ${upgrades.length} existing asset${upgrades.length === 1 ? '' : 's'}` : '',
    additions.length ? `adds ${additions.length} new asset${additions.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' and ');
  const addition = [
    '',
    `## Version ${plan.target_version} — Asset Pack Update`,
    '',
    `This update ${scope}:`,
    '',
    ...expansionAssets.map((asset) => `- ${asset.name}`),
    '',
    `${animated.length} assets include fixed-anchor states or animation sequences. Buyer runtime files use transparent PNG frames, sprite sheets, overlays, and JSON metadata with zero baked root motion.`,
    '',
    'The animated storefront media is a protected preview. Clean transparent source-sized assets are included in the paid download.',
  ].join('\n');
  const listing = {
    ...baseListing,
    schema_version: '1.0',
    title: product.title,
    short_description: baseListing.short_description,
    description: `${String(baseListing.description || '').trim()}${addition}`,
    visibility: 'draft',
    cover_path: marketingMedia.cover_path,
    screenshot_paths: marketingMedia.screenshot_paths,
    technical_information: unique([
      ...(baseListing.technical_information || []),
      `${expansionAssets.length} assets with reviewed states or animation upgrades`,
      'Transparent PNG states and fixed-anchor animation frames',
      'Sprite sheets, overlays, and JSON animation metadata',
      'Zero baked root motion',
    ]),
  };
  delete listing.listing_hash;
  return { ...listing, listing_hash: sha256(Buffer.from(JSON.stringify(listing))) };
}

function buyerReadme(product, plan, expansionAssets) {
  const animatedCount = expansionAssets.filter((asset) => asset.runtime_paths.length).length;
  const additions = expansionAssets.filter((asset) => asset.operation === 'add_asset').length;
  const upgrades = expansionAssets.length - additions;
  const scope = [
    upgrades ? `upgrades ${upgrades} existing asset${upgrades === 1 ? '' : 's'}` : '',
    additions ? `adds ${additions} new asset${additions === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' and ');
  return [
    `# ${product.title}`,
    '',
    `Version ${plan.target_version}`,
    '',
    `${product.assets.length + additions} transparent pixel-art assets are included. Version ${plan.target_version} ${scope}.`,
    '',
    '## Package contents',
    '',
    '- `assets/individual/`: clean transparent base PNG files.',
    `- \`assets/${product.slug}-sprite-sheet.png\`: all primary assets on one transparent sprite sheet.`,
    ...(additions ? ['- `assets/expansion/`: newly added assets grouped by buyer use.'] : []),
    `- \`animations/<asset>/\`: transparent states, frames, overlays, sheets, and metadata for ${animatedCount} animated assets.`,
    '- `asset-index.json`: paths, hashes, states, and animation identifiers for this update.',
    '- `LICENSE.md`: permitted use and redistribution restrictions.',
    '- `CHANGELOG.md`: buyer-relevant changes.',
    '',
    '## Runtime behavior',
    '',
    '- All canonical sprites and animation frames retain a fixed canvas and zero root motion.',
    '- Move gameplay objects in the game engine rather than relying on preview motion.',
    '- Storefront and Discord GIFs are previews; use the transparent PNG frames and metadata in a project.',
    '',
  ].join('\n');
}

function buyerChangelog(plan, expansionAssets) {
  const stateCount = expansionAssets.reduce((total, asset) => total + asset.states.length, 0);
  const animationCount = expansionAssets.reduce((total, asset) => total + asset.animations.length, 0);
  return [
    '# Changelog',
    '',
    `## ${plan.target_version}`,
    '',
    `- Added or upgraded ${expansionAssets.length} reviewed assets.`,
    `- Added ${stateCount} named states and ${animationCount} fixed-anchor animation sequences.`,
    '- Added transparent runtime frames, overlays, sprite sheets, and JSON metadata where applicable.',
    '- Refreshed the package index and buyer documentation.',
    '',
    `## ${plan.base_version}`,
    '',
    '- Initial published asset pack.',
    '',
  ].join('\n');
}

function expansionRuntimeReadme() {
  return [
    '# Expansion Runtime Files',
    '',
    'Folders are keyed by asset. Depending on the asset recipe, a folder can contain:',
    '',
    '- `states/`: named static gameplay states.',
    '- `frames/`: ordered transparent animation frames.',
    '- `overlays/`: fixed-anchor regions that can be composited over a base sprite.',
    '- `sheets/`: assembled sprite sheets.',
    '- `metadata/`: state and animation timing/rectangle data.',
    '',
    'All sequences use zero root motion. Gameplay movement belongs in the game engine.',
    '',
  ].join('\n');
}

async function loadApprovedExpansion({ productRoot, plan }) {
  const reviewRoot = resolveInside(
    productRoot,
    `extensions/${plan.expansion_id}/review`,
    'Expansion review root',
  );
  const [pointer, discordState] = await Promise.all([
    readJson(resolveInside(reviewRoot, 'latest-review.json', 'Expansion review pointer')),
    readJson(resolveInside(reviewRoot, 'discord.json', 'Expansion review decision')),
  ]);
  if (pointer.expansion_id !== plan.expansion_id || pointer.target_version !== plan.target_version) {
    throw new Error('Expansion review pointer targets a different plan or release version.');
  }
  const candidateRoot = resolveInside(productRoot, pointer.candidate_path, 'Expansion review candidate');
  const manifest = await readJson(resolveInside(candidateRoot, 'manifest.json', 'Expansion review manifest'));
  if (manifest.manifest_hash !== pointer.manifest_hash
    || manifest.expansion_id !== plan.expansion_id
    || manifest.base_manifest_hash !== plan.base_manifest_hash
    || manifest.target_version !== plan.target_version) {
    throw new Error('Expansion review pointer no longer matches the immutable manifest.');
  }
  await verifyFiles(candidateRoot, manifest, 'Approved expansion review file');
  if (discordState.manifest_hash !== manifest.manifest_hash
    || discordState.target_version !== plan.target_version
    || discordState.last_decision?.decision !== 'approve'
    || discordState.last_decision?.affected_asset_ids?.length) {
    throw new Error('The exact expansion manifest must have a complete persisted approval before packaging.');
  }
  return { reviewRoot: candidateRoot, manifest, decision: discordState.last_decision };
}

export async function prepareApprovedAssetExpansionRelease(options) {
  const plan = AssetExpansionReviewPlanSchema.parse(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  const [base, approved] = await Promise.all([
    resolveExpansionBase(productRoot, product, plan),
    loadApprovedExpansion({ productRoot, plan }),
  ]);
  if (base.manifest.manifest_hash !== plan.base_manifest_hash) {
    throw new Error('Expansion release targets a different immutable base release.');
  }
  await verifyFiles(base.root, base.manifest, 'Approved base release file');

  const inputHash = sha256(Buffer.from(JSON.stringify({
    plan,
    product_id: product.product_id,
    base_manifest_hash: base.manifest.manifest_hash,
    expansion_manifest_hash: approved.manifest.manifest_hash,
    expansion_release_version: EXPANSION_RELEASE_VERSION,
    marketing_version: EXPANSION_RELEASE_MARKETING_VERSION,
  })));
  const versionRoot = resolveInside(productRoot, `releases/${plan.target_version}`, 'Release version root');
  const candidateRoot = resolveInside(versionRoot, `candidates/${inputHash.slice(0, 16)}`, 'Release candidate');
  const manifestPath = resolve(candidateRoot, 'manifest.json');
  if (await exists(candidateRoot)) {
    if (!await exists(manifestPath)) throw new Error(`Immutable expansion release is incomplete: ${candidateRoot}.`);
    const manifest = await readJson(manifestPath);
    if (manifest.input_hash !== inputHash) throw new Error('Immutable expansion release input changed.');
    await verifyFiles(candidateRoot, manifest, 'Immutable expansion release file');
    return { plan, product, candidateRoot, manifestPath, manifest, reused: true, gates: manifest.gates };
  }

  await mkdir(resolve(candidateRoot, 'download'), { recursive: true });
  await cp(resolve(base.root, 'download'), resolve(candidateRoot, 'download'), { recursive: true });
  const expansionAssets = await copyApprovedExpansionAssets({
    candidateRoot,
    reviewRoot: approved.reviewRoot,
    reviewManifest: approved.manifest,
    product,
  });
  await rebuildBaseSpriteSheet({ candidateRoot, product });
  const inheritedScreenshotPaths = await copyInheritedMarketplaceScreenshots({
    baseRoot: base.root,
    candidateRoot,
    listing: base.listing,
  });
  const marketingMedia = await (options.marketingBuilder || buildExpansionReleaseMarketingMedia)({
    candidateRoot,
    product,
    version: plan.target_version,
    expansionAssets,
    inheritedScreenshotPaths,
  });
  const listing = releaseListing(base.listing, product, plan, expansionAssets, marketingMedia);
  const assetIndex = {
    schema_version: '1.0',
    product_id: product.product_id,
    product_version: plan.target_version,
    expansion_id: plan.expansion_id,
    expansion_manifest_hash: approved.manifest.manifest_hash,
    assets: expansionAssets,
  };
  await Promise.all([
    writeFile(resolve(candidateRoot, 'download', 'README.md'), buyerReadme(product, plan, expansionAssets), 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'CHANGELOG.md'), buyerChangelog(plan, expansionAssets), 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'asset-index.json'), `${JSON.stringify(assetIndex, null, 2)}\n`, 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'animations', 'README.md'), expansionRuntimeReadme(), 'utf8'),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), `${JSON.stringify(listing, null, 2)}\n`, 'utf8'),
  ]);

  const licensePath = resolve(candidateRoot, 'download', 'LICENSE.md');
  let licenseBuffer;
  let buyerLicense;
  if (base.manifest.buyer_license?.content_sha256) {
    licenseBuffer = await readFile(licensePath);
    if (sha256(licenseBuffer) !== base.manifest.buyer_license.content_sha256) {
      throw new Error('Inherited buyer license no longer matches the approved base release.');
    }
    buyerLicense = base.manifest.buyer_license;
  } else {
    licenseBuffer = await readFile(BUYER_LICENSE.source_url);
    await writeFile(licensePath, licenseBuffer);
    await rm(resolve(candidateRoot, 'download', 'LICENSE-DRAFT.md'), { force: true });
    buyerLicense = {
      license_id: BUYER_LICENSE.license_id,
      version: BUYER_LICENSE.version,
      content_sha256: sha256(licenseBuffer),
    };
  }
  const files = await Promise.all((await filesBelow(candidateRoot)).map((path) => hashedFile(path, candidateRoot)));
  const expansionAnimationCount = expansionAssets.reduce((total, asset) => total + asset.animations.length, 0);
  const expansionStateCount = expansionAssets.reduce((total, asset) => total + asset.states.length, 0);
  const addedAssetCount = expansionAssets.filter((asset) => asset.operation === 'add_asset').length;
  const enhancedAssetCount = expansionAssets.filter((asset) => asset.operation === 'enhance_existing').length;
  const replacedAssetCount = expansionAssets.filter((asset) => asset.operation === 'replace_existing').length;
  const gates = {
    base_release_verified: true,
    expansion_review_approved: true,
    expansion_files_verified: true,
    runtime_files_verified: true,
    license_terms_included: true,
    license_approval_required: true,
    quality_holds_resolved: true,
    human_review_required: true,
    distribution_ready: false,
  };
  const identity = {
    schema_version: '1.0',
    release_id: `${product.product_id}-v${plan.target_version.replaceAll('.', '-')}-${inputHash.slice(0, 12)}`,
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    human_review_required: true,
    product_id: product.product_id,
    product_slug: product.slug,
    base_version: plan.base_version,
    target_version: plan.target_version,
    expansion_id: plan.expansion_id,
    base_manifest_hash: base.manifest.manifest_hash,
    base_listing_hash: base.listing.listing_hash,
    expansion_manifest_hash: approved.manifest.manifest_hash,
    expansion_approved_at: approved.decision.decided_at,
    input_hash: inputHash,
    base_asset_count: product.assets.length,
    weapon_count: product.assets.filter((asset) => asset.kind === 'weapon').length,
    asset_count: product.assets.length + addedAssetCount,
    expansion_asset_count: expansionAssets.length,
    added_asset_count: addedAssetCount,
    enhanced_asset_count: enhancedAssetCount,
    replaced_asset_count: replacedAssetCount,
    expansion_assets: expansionAssets.map((asset) => ({
      asset_id: asset.asset_id,
      asset_key: asset.asset_key,
      name: asset.name,
      operation: asset.operation,
      description: asset.description,
      buyer_group: asset.buyer_group,
      buyer_path: asset.buyer_path,
      content_sha256: asset.content_sha256,
      review_hash: asset.review_hash,
      states: asset.states,
      animations: asset.animations,
    })),
    effect_animation_count: base.manifest.effect_animation_count || 0,
    expansion_animation_count: expansionAnimationCount,
    expansion_state_count: expansionStateCount,
    buyer_license: buyerLicense,
    marketing_media: marketingMedia,
    marketing_version: EXPANSION_RELEASE_MARKETING_VERSION,
    expansion_release_version: EXPANSION_RELEASE_VERSION,
    listing_hash: listing.listing_hash,
    quality_holds: [],
    license_terms_included: true,
    license_approval_required: true,
    gates,
    created_at: options.now || new Date().toISOString(),
    files,
  };
  const manifest = {
    ...identity,
    manifest_hash: sha256(Buffer.from(JSON.stringify({ ...identity, created_at: undefined }))),
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await mkdir(versionRoot, { recursive: true });
  await writeFile(resolve(versionRoot, 'latest-candidate.json'), `${JSON.stringify({
    schema_version: '1.0',
    target_version: plan.target_version,
    candidate_path: normalizePath(relative(productRoot, candidateRoot)),
    manifest_hash: manifest.manifest_hash,
    release_state: manifest.release_state,
    updated_at: options.now || new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return {
    plan,
    product,
    candidateRoot,
    manifestPath,
    manifest,
    listing,
    expansionAssets,
    reused: false,
    gates,
  };
}
