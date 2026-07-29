import { basename, resolve } from 'node:path';
import { archiveVerifiedAsset } from './archive-manager.mjs';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';

function archiveSlug(value) {
  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/gu, '')
    .replace(/[^a-zA-Z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 80);
}

function assetArchivePath(asset, productName) {
  const extension = basename(asset.local_path).includes('.')
    ? basename(asset.local_path).split('.').at(-1)
    : 'bin';
  if (asset.usage_scope === 'internal_editor_test') {
    return `Assets/Temporary Product Footage/ORION-${archiveSlug(productName)}-${asset.content_sha256.slice(0, 8)}.${extension}`;
  }
  return `Assets/Source Media/ORION-${archiveSlug(productName)}-${asset.content_sha256.slice(0, 8)}.${extension}`;
}

export async function archiveManifestAssets(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const referencedAssetIds = new Set(
    manifest.render_jobs.flatMap((job) => job.asset_ids),
  );
  const candidates = manifest.assets.filter((asset) => (
    referencedAssetIds.has(asset.asset_id)
    && asset.approval_status === 'approved'
    && asset.download_status === 'downloaded'
    && asset.local_path
    && asset.content_sha256
  ));
  const archivedLocations = [];

  for (const asset of candidates) {
    const productName = manifest.products.find((product) => (
      product.product_id === asset.product_id
    ))?.canonical_name || asset.product_id;
    const location = await archiveVerifiedAsset({
      asset,
      sourcePath: resolveInsideRoot(
        projectRoot,
        resolve(projectRoot, asset.local_path),
        'Asset archive source path',
      ),
      relativePath: assetArchivePath(asset, productName),
      preferredRoot: options.config?.archive?.preferred_root,
      fallbackRoot: options.config?.archive?.fallback_root,
      deviceId: options.config?.archive?.device_id,
      now: options.now,
    });
    archivedLocations.push({
      ...location,
      retention_class: asset.usage_scope === 'internal_editor_test'
        ? 'temporary_source'
        : 'permanent',
      delete_after: null,
      deletion_status: 'retained',
      deleted_at: null,
    });
  }

  const archivedIds = new Set(archivedLocations.map((location) => location.asset_id));
  return OutputManifestSchema.parse({
    ...manifest,
    asset_storage_locations: [
      ...manifest.asset_storage_locations.filter((location) => (
        !archivedIds.has(location.asset_id)
      )),
      ...archivedLocations,
    ],
    notes: [
      ...manifest.notes,
      `${archivedLocations.length} referenced source asset(s) were copied and SHA-256 verified in the configured media archive.`,
    ],
  });
}
