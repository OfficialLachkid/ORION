import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { createCover, createMarketplacePreview } from './packager.mjs';
import { resolvePackagedRelease } from './packaged-release.mjs';
import { resolveReviewedReleaseAssets } from './release-asset-inventory.mjs';

const STOREFRONT_REVISION_VERSION = '1.0.0';
const MAX_ASSETS_PER_MARKETING_IMAGE = 8;
const SEMVER = /^\d+\.\d+\.\d+$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

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

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
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
    const buffer = await readFile(resolveInside(root, file.path, label));
    if (buffer.length !== file.size_bytes || sha256(buffer) !== file.content_sha256) {
      throw new Error(`${label} changed: ${file.path}.`);
    }
  }
}

function compareSemver(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function validateOptions(options) {
  const plan = {
    revision_id: String(options.revisionId || `${options.slug}-storefront-${String(options.targetVersion || '').replaceAll('.', '-')}`).trim(),
    product_slug: String(options.slug || '').trim(),
    base_version: String(options.baseVersion || '').trim(),
    target_version: String(options.targetVersion || '').trim(),
    base_manifest_hash: String(options.baseManifestHash || '').trim(),
    suggested_price: {
      amount: Number(options.suggestedPrice),
      currency: String(options.currency || 'USD').trim().toUpperCase(),
    },
  };
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(plan.product_slug)) throw new Error('Storefront revision requires a valid product slug.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(plan.revision_id)) throw new Error('Storefront revision requires a valid revision id.');
  if (!SEMVER.test(plan.base_version) || !SEMVER.test(plan.target_version)) throw new Error('Storefront versions must use semantic version format.');
  if (compareSemver(plan.target_version, plan.base_version) <= 0) throw new Error('Storefront target version must be newer than its base version.');
  if (!SHA256.test(plan.base_manifest_hash)) throw new Error('Storefront base manifest hash must be a SHA-256 hash.');
  if (!Number.isFinite(plan.suggested_price.amount) || plan.suggested_price.amount <= 0) throw new Error('Storefront suggested price must be positive.');
  if (!/^[A-Z]{3}$/u.test(plan.suggested_price.currency)) throw new Error('Storefront price currency must use a three-letter code.');
  return plan;
}

async function resolveRevisionBase(productRoot, product, plan) {
  let base;
  try {
    base = await resolvePackagedRelease({ productRoot, releaseVersion: plan.base_version });
  } catch (error) {
    if (error?.code !== 'ENOENT' || product.version !== plan.base_version) throw error;
    base = await resolvePackagedRelease({ productRoot });
    if (base.manifest.product_version !== plan.base_version) {
      throw new Error('Canonical preview does not match the storefront base version.');
    }
  }
  if (base.manifest.manifest_hash !== plan.base_manifest_hash) {
    throw new Error('Storefront revision targets a different immutable base manifest.');
  }
  const publicReceipt = await readOptionalJson(resolve(productRoot, 'review', 'itch-release.json'));
  const draftReceipt = await readOptionalJson(resolve(productRoot, 'review', 'itch.json'));
  const isVerifiedPublic = publicReceipt?.status === 'verified_public'
    && publicReceipt.target_version === plan.base_version
    && publicReceipt.manifest_hash === plan.base_manifest_hash;
  const isVerifiedDraft = draftReceipt?.status === 'verified'
    && draftReceipt.target_version === plan.base_version
    && draftReceipt.manifest_hash === plan.base_manifest_hash;
  if (!isVerifiedPublic && !isVerifiedDraft) {
    throw new Error('Storefront revision requires an exact verified public release or draft base.');
  }
  return { ...base, marketplaceMode: isVerifiedPublic ? 'published_update' : 'draft' };
}

function isGenericInventoryMedia(path) {
  const name = basename(String(path || '')).toLowerCase();
  return name === 'cover.png'
    || name === 'cover.gif'
    || name === 'cover-still.png'
    || /^marketplace-preview(?:-\d+)?\.png$/u.test(name);
}

function preservedSpecialtyMedia(listing) {
  return [...new Set(listing.screenshot_paths || [])].filter((path) => (
    !normalizePath(path).startsWith('previous-release-media/')
    && !isGenericInventoryMedia(path)
  ));
}

async function loadReleaseCandidates({ base, product }) {
  const assets = resolveReviewedReleaseAssets(product, base.manifest);
  return Promise.all(assets.map(async (asset) => ({
    asset,
    buffer: await readFile(resolveInside(base.root, asset.manifest_path, 'Storefront source asset')),
  })));
}

async function buildMarketingMedia({ candidateRoot, product, candidates, specialtyMedia }) {
  const selected = candidates.length <= MAX_ASSETS_PER_MARKETING_IMAGE
    ? candidates
    : Array.from({ length: MAX_ASSETS_PER_MARKETING_IMAGE }, (_, index) => (
      candidates[Math.round((index * (candidates.length - 1)) / (MAX_ASSETS_PER_MARKETING_IMAGE - 1))]
    ));
  const pages = [];
  for (let offset = 0; offset < candidates.length; offset += MAX_ASSETS_PER_MARKETING_IMAGE) {
    pages.push(candidates.slice(offset, offset + MAX_ASSETS_PER_MARKETING_IMAGE));
  }
  const pageNames = pages.length === 1
    ? ['marketplace-preview.png']
    : pages.map((_, index) => `marketplace-preview-${index + 1}.png`);
  const [cover, previews] = await Promise.all([
    createCover(candidates, product),
    Promise.all(pages.map((page, index) => createMarketplacePreview(page, product, {
      allCandidates: candidates,
      pageIndex: index,
      pageCount: pages.length,
    }))),
  ]);
  await Promise.all([
    writeFile(resolve(candidateRoot, 'cover.png'), cover),
    ...pageNames.map((name, index) => writeFile(resolve(candidateRoot, name), previews[index])),
  ]);
  return {
    cover_path: 'cover.png',
    screenshot_paths: ['cover.png', ...pageNames, ...specialtyMedia],
    inventory_page_paths: pageNames,
    preserved_specialty_media_paths: specialtyMedia,
    asset_count: candidates.length,
    featured_asset_count: selected.length,
    background_style: 'light-category-adaptive',
  };
}

function revisedListing(baseListing, product, plan, media) {
  const listing = {
    ...baseListing,
    schema_version: '1.0',
    title: product.title,
    suggested_price: plan.suggested_price,
    visibility: 'draft',
    cover_path: media.cover_path,
    screenshot_paths: media.screenshot_paths,
  };
  delete listing.listing_hash;
  return { ...listing, listing_hash: sha256(Buffer.from(JSON.stringify(listing))) };
}

export async function prepareStorefrontRevision(options) {
  const plan = validateOptions(options);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  const base = await resolveRevisionBase(productRoot, product, plan);
  await verifyFiles(base.root, base.manifest, 'Verified storefront base file');

  const inputHash = sha256(Buffer.from(JSON.stringify({
    plan,
    product_id: product.product_id,
    storefront_revision_version: STOREFRONT_REVISION_VERSION,
  })));
  const versionRoot = resolveInside(productRoot, `releases/${plan.target_version}`, 'Storefront version root');
  const candidateRoot = resolveInside(versionRoot, `candidates/${inputHash.slice(0, 16)}`, 'Storefront candidate root');
  const manifestPath = resolve(candidateRoot, 'manifest.json');
  if (await exists(candidateRoot)) {
    if (!await exists(manifestPath)) throw new Error(`Immutable storefront revision is incomplete: ${candidateRoot}.`);
    const manifest = await readJson(manifestPath);
    if (manifest.input_hash !== inputHash) throw new Error('Immutable storefront revision input changed.');
    await verifyFiles(candidateRoot, manifest, 'Immutable storefront revision file');
    return { plan, product, candidateRoot, manifestPath, manifest, reused: true, gates: manifest.gates };
  }

  await mkdir(candidateRoot, { recursive: true });
  await cp(base.root, candidateRoot, { recursive: true });
  await Promise.all([
    rm(resolve(candidateRoot, 'manifest.json'), { force: true }),
    rm(resolve(candidateRoot, 'itch-listing.json'), { force: true }),
    rm(resolve(candidateRoot, 'itch-listing-preview.json'), { force: true }),
  ]);
  const candidates = await loadReleaseCandidates({ base, product });
  const specialtyMedia = preservedSpecialtyMedia(base.listing);
  const media = await buildMarketingMedia({ candidateRoot, product, candidates, specialtyMedia });
  const listing = revisedListing(base.listing, product, plan, media);
  await writeFile(resolve(candidateRoot, 'itch-listing.json'), `${JSON.stringify(listing, null, 2)}\n`, 'utf8');
  const files = await Promise.all((await filesBelow(candidateRoot)).map((path) => hashedFile(path, candidateRoot)));
  const gates = {
    ...(base.manifest.gates || {}),
    base_release_verified: true,
    storefront_revision_generated: true,
    buyer_payload_inherited: true,
    quality_holds_resolved: true,
    human_review_required: true,
    distribution_ready: false,
  };
  const identity = {
    ...base.manifest,
    schema_version: '1.0',
    release_id: `${product.product_id}-v${plan.target_version.replaceAll('.', '-')}-${inputHash.slice(0, 12)}`,
    release_state: 'awaiting_extension_review',
    distribution_ready: false,
    human_review_required: true,
    product_id: product.product_id,
    product_slug: product.slug,
    base_version: plan.base_version,
    target_version: plan.target_version,
    base_manifest_hash: base.manifest.manifest_hash,
    base_listing_hash: base.listing.listing_hash,
    listing_hash: listing.listing_hash,
    input_hash: inputHash,
    storefront_revision: {
      revision_id: plan.revision_id,
      revision_version: STOREFRONT_REVISION_VERSION,
      marketplace_mode: base.marketplaceMode,
      suggested_price: plan.suggested_price,
      buyer_payload_changed: false,
      media,
    },
    marketing_media: media,
    quality_holds: [],
    gates,
    created_at: options.now || new Date().toISOString(),
    files,
  };
  delete identity.manifest_hash;
  delete identity.product_version;
  delete identity.generated_at;
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
  return { plan, product, candidateRoot, manifestPath, manifest, listing, reused: false, gates };
}
