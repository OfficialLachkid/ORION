import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveInsideRoot } from './paths.mjs';
import { OutputManifestSchema } from './schemas.mjs';

async function calculateSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

async function inspectFile(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile() ? details : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function verifyFile(filePath, expectedSha256, label) {
  const details = await inspectFile(filePath);
  if (!details) throw new Error(`${label} is missing: ${filePath}`);
  const actualSha256 = await calculateSha256(filePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} SHA-256 does not match the manifest.`);
  }
  return details;
}

function workingPath(projectRoot, path, label) {
  return resolveInsideRoot(projectRoot, resolve(projectRoot, path), label);
}

function verifiedExternalLocation(locations, assetId) {
  return locations.find((location) => (
    location.asset_id === assetId
    && location.location_type === 'external_ssd_archive'
    && location.status === 'archived'
    && location.deletion_status !== 'deleted'
  ));
}

export async function restoreArchivedAssetWorkingCopies(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const restoredAssetIds = new Set();

  for (const asset of manifest.assets) {
    if (!asset.local_path || !asset.content_sha256) continue;
    const destinationPath = workingPath(projectRoot, asset.local_path, 'Restored asset path');
    const destination = await inspectFile(destinationPath);
    if (destination) {
      await verifyFile(destinationPath, asset.content_sha256, 'Existing asset working copy');
      continue;
    }

    const location = verifiedExternalLocation(
      manifest.asset_storage_locations,
      asset.asset_id,
    );
    if (!location) continue;
    await verifyFile(location.path, location.content_sha256, 'Archived asset');
    await mkdir(dirname(destinationPath), { recursive: true });
    const temporaryPath = `${destinationPath}.restore-${randomUUID()}`;
    try {
      await copyFile(location.path, temporaryPath);
      await verifyFile(temporaryPath, asset.content_sha256, 'Restored asset working copy');
      await rename(temporaryPath, destinationPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
    restoredAssetIds.add(asset.asset_id);
  }

  if (restoredAssetIds.size === 0) return manifest;
  return OutputManifestSchema.parse({
    ...manifest,
    asset_storage_locations: manifest.asset_storage_locations.map((location) => (
      restoredAssetIds.has(location.asset_id)
        ? { ...location, source_retained: true }
        : location
    )),
    notes: [
      ...manifest.notes,
      `${restoredAssetIds.size} source asset working copy/copies were restored from the verified T7 archive.`,
    ],
  });
}

export async function cleanupVerifiedWorkingMedia(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const projectRoot = options.projectRoot || process.cwd();
  const removedAssetIds = new Set();
  const removedRenderJobIds = new Set();

  for (const asset of manifest.assets) {
    if (!asset.local_path || !asset.content_sha256) continue;
    const location = verifiedExternalLocation(
      manifest.asset_storage_locations,
      asset.asset_id,
    );
    if (!location) continue;
    const sourcePath = workingPath(projectRoot, asset.local_path, 'Asset cleanup path');
    if (!await inspectFile(sourcePath)) continue;
    await verifyFile(location.path, location.content_sha256, 'Archived asset');
    await verifyFile(sourcePath, asset.content_sha256, 'Asset working copy');
    if (resolve(sourcePath) === resolve(location.path)) {
      throw new Error('Refusing to remove an asset that is already stored at its archive path.');
    }
    await unlink(sourcePath);
    removedAssetIds.add(asset.asset_id);
  }

  for (const archive of manifest.archive_results) {
    if (archive.location_type !== 'external_ssd_archive' || archive.status !== 'archived') continue;
    const sourcePath = workingPath(projectRoot, archive.source_path, 'Render cleanup path');
    if (!await inspectFile(sourcePath)) continue;
    await verifyFile(archive.destination_path, archive.content_sha256, 'Archived render');
    await verifyFile(sourcePath, archive.content_sha256, 'Render working copy');
    if (resolve(sourcePath) === resolve(archive.destination_path)) {
      throw new Error('Refusing to remove a render that is already stored at its archive path.');
    }
    await unlink(sourcePath);
    removedRenderJobIds.add(archive.render_job_id);
  }

  return {
    manifest: OutputManifestSchema.parse({
      ...manifest,
      archive_results: manifest.archive_results.map((archive) => (
        removedRenderJobIds.has(archive.render_job_id)
          ? { ...archive, source_retained: false }
          : archive
      )),
      asset_storage_locations: manifest.asset_storage_locations.map((location) => (
        removedAssetIds.has(location.asset_id)
          ? { ...location, source_retained: false }
          : location
      )),
      notes: [
        ...manifest.notes,
        `Verified cache cleanup removed ${removedAssetIds.size} source asset(s) and ${removedRenderJobIds.size} render(s) from the Mac runtime.`,
      ],
    }),
    report: {
      removed_asset_ids: [...removedAssetIds],
      removed_render_job_ids: [...removedRenderJobIds],
    },
  };
}
