import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { CanonicalProductStore } from './canonical-store.mjs';
import { buildReleaseMarketingMedia, RELEASE_MARKETING_VERSION } from './release-marketing.mjs';
import { ProductExtensionPlanSchema } from './schemas.mjs';

const REQUIRED_EFFECT_KINDS = Object.freeze(['muzzle_flash', 'projectile', 'impact_decay']);

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

async function verifyCandidateFiles(candidateRoot, manifest) {
  for (const file of manifest.files || []) {
    const path = resolveInside(candidateRoot, file.path, 'Candidate file');
    const buffer = await readFile(path);
    if (buffer.length !== file.size_bytes || sha256(buffer) !== file.content_sha256) {
      throw new Error(`Immutable extension candidate file changed: ${file.path}.`);
    }
  }
}

async function verifyBasePackageFiles(baseRoot, manifest) {
  for (const file of manifest.files || []) {
    const path = resolveInside(baseRoot, file.path, 'Base package file');
    const buffer = await readFile(path);
    if (buffer.length !== file.size_bytes || sha256(buffer) !== file.content_sha256) {
      throw new Error(`Approved base package file changed: ${file.path}.`);
    }
  }
}

function buyerReadme(product, plan, effectSets) {
  return [
    `# ${product.title}`,
    '',
    `Release candidate ${plan.target_version}.`,
    '',
    `${product.assets.length} transparent side-view weapon sprites and ${effectSets.length * 3} matching effect animations are included.`,
    '',
    '## Runtime files',
    '',
    '- `assets/individual/`: stationary weapon PNG files.',
    '- `effects/<weapon>/muzzle_flash/`: transparent frames, sprite sheet, and animation metadata.',
    '- `effects/<weapon>/projectile/`: a stationary projectile sprite; move it in the game engine.',
    '- `effects/<weapon>/impact_decay/`: transparent endpoint impact and decay frames.',
    '- `effects/weapon-anchors.json`: weapon-local muzzle anchors for preview and runtime attachment.',
    '',
    'Every animation declares zero root motion. Projectile travel and combined firing GIFs are review previews, not runtime files.',
    '',
    'This candidate remains blocked from public distribution until its package review and license gate are complete.',
    '',
  ].join('\n');
}

function effectsReadme() {
  return [
    '# Weapon Effects',
    '',
    'Each weapon keeps three independent runtime effects so a game can mix, replace, or omit them:',
    '',
    '1. `muzzle_flash` is placed at the stored weapon-local muzzle anchor.',
    '2. `projectile` contains no baked travel; the game engine controls position and velocity.',
    '3. `impact_decay` is placed at the collision point and played once.',
    '',
    'Use the transparent PNG frames directly or read `animation.json` with `sprite-sheet.png`.',
    '',
  ].join('\n');
}

function extensionListing(baseListing, product, plan, effectSets, marketingMedia) {
  const effectCount = effectSets.length * 3;
  const addition = [
    '',
    `Version ${plan.target_version} extension:`,
    `- ${effectSets.length} weapon-specific muzzle flashes`,
    `- ${effectSets.length} stationary projectile sprites`,
    `- ${effectSets.length} impact and decay animations`,
    '- Transparent PNG frames, sprite sheets, animation metadata, and muzzle anchors',
    '- Zero baked root motion; projectile movement remains under game-engine control',
  ].join('\n');
  const listing = {
    ...baseListing,
    schema_version: '1.0',
    title: product.title,
    short_description: `${product.assets.length} side-view sci-fi weapons with ${effectCount} matching effect animations.`,
    description: `${String(baseListing.description || '').trim()}${addition}`,
    visibility: 'draft',
    cover_path: marketingMedia.cover_path,
    screenshot_paths: marketingMedia.screenshot_paths,
    technical_information: [
      ...(baseListing.technical_information || []),
      `${effectCount} independent effect animations`,
      'Transparent PNG frames and sprite sheets',
      'Animation JSON and weapon-local muzzle anchors',
      'Zero baked root motion',
    ],
  };
  delete listing.listing_hash;
  return { ...listing, listing_hash: sha256(Buffer.from(JSON.stringify(listing))) };
}

async function verifiedExperimentFile(experimentRoot, manifest, path) {
  const entry = manifest.files?.find((file) => file.path === normalizePath(path));
  if (!entry) throw new Error(`Effects manifest does not cover ${path}.`);
  const source = resolveInside(experimentRoot, path, 'Effects runtime file');
  const buffer = await readFile(source);
  if (buffer.length !== entry.size || sha256(buffer) !== entry.sha256) {
    throw new Error(`Effects runtime file does not match its proof manifest: ${path}.`);
  }
  return { source, buffer };
}

async function copyEffectSet({ productRoot, candidateRoot, bundleItem, product }) {
  const experimentRoot = resolveInside(productRoot, bundleItem.experiment_path, 'Experiment path');
  const [manifest, pilot] = await Promise.all([
    readJson(resolveInside(experimentRoot, 'manifest.json', 'Experiment manifest')),
    readJson(resolveInside(experimentRoot, 'pilot.json', 'Experiment plan')),
  ]);
  if (
    manifest.manifest_hash !== bundleItem.manifest_hash
    || manifest.source_asset_key !== bundleItem.source_asset_key
    || manifest.canonical_release_mutated !== false
    || manifest.marketplace_listing_mutated !== false
  ) throw new Error(`${bundleItem.source_asset_key} proof no longer matches the effects review bundle.`);

  const asset = product.assets.find((item) => item.asset_key === bundleItem.source_asset_key);
  if (!asset?.final_path) throw new Error(`Canonical source weapon is missing: ${bundleItem.source_asset_key}.`);
  const weapon = await readFile(resolveInside(productRoot, asset.final_path, 'Canonical weapon'));
  if (sha256(weapon) !== manifest.source_asset_sha256) {
    throw new Error(`${bundleItem.source_asset_key} effects were generated for a different weapon revision.`);
  }

  const effects = {};
  for (const kind of REQUIRED_EFFECT_KINDS) {
    const effect = pilot.effects?.find((item) => item.kind === kind);
    if (!effect) throw new Error(`${bundleItem.source_asset_key} is missing ${kind}.`);
    const framePrefix = `frames/${effect.effect_key}/`;
    const framePaths = manifest.files
      .map((file) => file.path)
      .filter((path) => path.startsWith(framePrefix) && path.endsWith('.png'))
      .sort();
    if (!framePaths.length) throw new Error(`${effect.effect_key} has no runtime frames.`);
    const destinationRoot = resolveInside(
      candidateRoot,
      `download/effects/${bundleItem.source_asset_key}/${kind}`,
      'Effect destination',
    );
    for (const framePath of framePaths) {
      const verified = await verifiedExperimentFile(experimentRoot, manifest, framePath);
      const destination = resolve(destinationRoot, 'frames', framePath.split('/').at(-1));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, verified.buffer);
    }
    for (const [sourcePath, destinationName] of [
      [`sheets/${effect.effect_key}.png`, 'sprite-sheet.png'],
      [`metadata/${effect.effect_key}/animation.json`, 'animation.json'],
    ]) {
      const verified = await verifiedExperimentFile(experimentRoot, manifest, sourcePath);
      await mkdir(destinationRoot, { recursive: true });
      await writeFile(resolve(destinationRoot, destinationName), verified.buffer);
    }
    effects[kind] = {
      effect_key: effect.effect_key,
      frame_count: framePaths.length,
      path: `effects/${bundleItem.source_asset_key}/${kind}`,
    };
  }
  const attackCyclePath = `previews/${bundleItem.source_asset_key}-attack-cycle.gif`;
  const attackCycle = await verifiedExperimentFile(experimentRoot, manifest, attackCyclePath);
  return {
    source_asset_key: bundleItem.source_asset_key,
    name: bundleItem.name,
    source_asset_sha256: manifest.source_asset_sha256,
    muzzle_anchor: manifest.source_weapon_muzzle_anchor,
    muzzle_anchor_detection: manifest.source_weapon_muzzle_anchor_detection,
    proof_manifest_hash: manifest.manifest_hash,
    effects,
    attack_cycle_preview_source: attackCycle.source,
  };
}

export async function prepareVersionedPackageExtension(options) {
  const plan = ProductExtensionPlanSchema.parse(options.plan);
  const store = options.store || new CanonicalProductStore(options.outputRoot);
  const product = await store.loadProduct(plan.product_slug);
  const productRoot = store.productRoot(product);
  if (product.version !== plan.base_version) {
    throw new Error(`Product version ${product.version} does not match extension base ${plan.base_version}.`);
  }
  const productAssetKeys = new Set(product.assets.map((asset) => asset.asset_key));
  const unknownHeldAssets = plan.quality_holds
    .flatMap((hold) => hold.affected_asset_keys)
    .filter((assetKey) => !productAssetKeys.has(assetKey));
  if (unknownHeldAssets.length) {
    throw new Error(`Extension quality hold references unknown assets: ${unknownHeldAssets.join(', ')}.`);
  }

  const baseRoot = resolve(productRoot, 'exports', 'itch-preview');
  const [baseManifest, baseListing, packageReview, effectsBundle, effectsReview] = await Promise.all([
    readJson(resolve(baseRoot, 'manifest.json')),
    readJson(resolve(baseRoot, 'itch-listing-preview.json')),
    readJson(resolve(productRoot, 'review', 'discord.json')),
    readJson(resolve(productRoot, 'review', 'effects-review-manifest.json')),
    readJson(resolve(productRoot, 'review', 'effects-discord.json')),
  ]);
  if (baseManifest.manifest_hash !== plan.base_manifest_hash) {
    throw new Error('Extension plan targets a different base package manifest.');
  }
  if (baseManifest.listing_hash !== baseListing.listing_hash) {
    throw new Error('Approved base package listing no longer matches its manifest.');
  }
  await verifyBasePackageFiles(baseRoot, baseManifest);
  if (packageReview.manifest_hash !== baseManifest.manifest_hash
    || packageReview.last_decision?.decision !== 'approve') {
    throw new Error('The exact base package must have a persisted approval before it can be extended.');
  }
  if (
    effectsBundle.review_id !== plan.effects_review_id
    || effectsBundle.bundle_hash !== plan.effects_bundle_hash
    || effectsReview.bundle_hash !== effectsBundle.bundle_hash
    || !effectsReview.completed_at
  ) throw new Error('The effects review presentation no longer matches this extension plan.');

  const inputHash = sha256(Buffer.from(JSON.stringify({
    plan,
    product_id: product.product_id,
    base_listing_hash: baseListing.listing_hash,
    effect_manifests: effectsBundle.experiments.map((item) => item.manifest_hash),
    marketing_version: RELEASE_MARKETING_VERSION,
  })));
  const versionRoot = resolveInside(productRoot, `releases/${plan.target_version}`, 'Release version path');
  const candidateRoot = resolveInside(versionRoot, `candidates/${inputHash.slice(0, 16)}`, 'Candidate path');
  const manifestPath = resolve(candidateRoot, 'manifest.json');
  if (await exists(candidateRoot)) {
    if (!await exists(manifestPath)) throw new Error(`Immutable candidate is incomplete: ${candidateRoot}.`);
    const manifest = await readJson(manifestPath);
    if (manifest.input_hash !== inputHash) throw new Error('Immutable candidate input hash changed.');
    await verifyCandidateFiles(candidateRoot, manifest);
    return { plan, product, candidateRoot, manifestPath, manifest, reused: true, gates: manifest.gates };
  }

  await mkdir(resolve(candidateRoot, 'download'), { recursive: true });
  await cp(resolve(baseRoot, 'download'), resolve(candidateRoot, 'download'), { recursive: true });

  const effectSets = [];
  for (const experiment of effectsBundle.experiments) {
    effectSets.push(await copyEffectSet({ productRoot, candidateRoot, bundleItem: experiment, product }));
  }
  const marketingMedia = await (options.marketingBuilder || buildReleaseMarketingMedia)({
    candidateRoot,
    product,
    effectSets,
    version: plan.target_version,
    runProcess: options.runProcess,
    ffmpegExecutable: options.ffmpegExecutable,
  });
  const listing = extensionListing(baseListing, product, plan, effectSets, marketingMedia);
  const anchors = {
    schema_version: '1.0',
    product_id: product.product_id,
    product_version: plan.target_version,
    coordinate_space: { width: product.style.width, height: product.style.height, origin: 'top_left' },
    weapons: effectSets.map((item) => ({
      source_asset_key: item.source_asset_key,
      muzzle_anchor: item.muzzle_anchor,
      source_asset_sha256: item.source_asset_sha256,
    })),
  };
  await Promise.all([
    writeFile(resolve(candidateRoot, 'download', 'README.md'), buyerReadme(product, plan, effectSets), 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'CHANGELOG.md'), [
      '# Changelog', '', `## ${plan.target_version}`, '', ...plan.release_notes.map((note) => `- ${note}`), '',
    ].join('\n'), 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'effects', 'README.md'), effectsReadme(), 'utf8'),
    writeFile(resolve(candidateRoot, 'download', 'effects', 'weapon-anchors.json'), `${JSON.stringify(anchors, null, 2)}\n`, 'utf8'),
    writeFile(resolve(candidateRoot, 'itch-listing.json'), `${JSON.stringify(listing, null, 2)}\n`, 'utf8'),
  ]);

  const candidateFiles = await filesBelow(candidateRoot);
  const files = await Promise.all(candidateFiles.map((path) => hashedFile(path, candidateRoot)));
  const gates = {
    base_package_approved: true,
    effects_bundle_verified: true,
    runtime_files_verified: true,
    quality_holds_resolved: plan.quality_holds.length === 0,
    human_review_required: true,
    distribution_ready: false,
  };
  const identity = {
    schema_version: '1.0',
    release_id: `${product.product_id}-v${plan.target_version.replaceAll('.', '-')}-${inputHash.slice(0, 12)}`,
    release_state: plan.quality_holds.length ? 'blocked_quality_review' : 'awaiting_extension_review',
    product_id: product.product_id,
    product_slug: product.slug,
    base_version: plan.base_version,
    target_version: plan.target_version,
    extension_id: plan.extension_id,
    base_manifest_hash: baseManifest.manifest_hash,
    base_listing_hash: baseListing.listing_hash,
    effects_review_id: effectsBundle.review_id,
    effects_bundle_hash: effectsBundle.bundle_hash,
    input_hash: inputHash,
    weapon_count: product.assets.length,
    asset_count: product.assets.length,
    effect_set_count: effectSets.length,
    effect_animation_count: effectSets.length * REQUIRED_EFFECT_KINDS.length,
    marketing_media: marketingMedia,
    marketing_version: RELEASE_MARKETING_VERSION,
    listing_hash: listing.listing_hash,
    quality_holds: plan.quality_holds,
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
  return { plan, product, candidateRoot, manifestPath, manifest, listing, effectSets, reused: false, gates };
}
