import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  access,
  constants,
  copyFile,
  mkdir,
  rename,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

const DEFAULT_FALLBACK_DIRECTORY = 'Video Generation Fallback';

async function calculateSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function isWritableDirectory(directoryPath) {
  try {
    const details = await stat(directoryPath);
    if (!details.isDirectory()) return false;
    await access(directoryPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveDestination(rootPath, relativePath) {
  if (!relativePath || isAbsolute(relativePath)) {
    throw new Error('Archive relative path must be a non-empty relative path.');
  }
  const root = resolve(rootPath);
  const destination = resolve(root, relativePath);
  const pathFromRoot = relative(root, destination);
  if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error('Archive destination must stay inside the selected archive root.');
  }
  return destination;
}

export function resolveArchiveRoots(options = {}) {
  const homeDirectory = options.homeDirectory || homedir();
  const preferredRoot = options.preferredRoot
    || process.env.VIDEO_GENERATION_ARCHIVE_ROOT
    || null;
  const fallbackRoot = options.fallbackRoot
    || process.env.VIDEO_GENERATION_FALLBACK_ROOT
    || resolve(homeDirectory, 'Desktop', DEFAULT_FALLBACK_DIRECTORY);
  return {
    preferredRoot: preferredRoot ? resolve(preferredRoot) : null,
    fallbackRoot: resolve(fallbackRoot),
  };
}

async function selectArchiveTarget(options) {
  const roots = resolveArchiveRoots(options);
  if (roots.preferredRoot && await isWritableDirectory(roots.preferredRoot)) {
    return {
      rootPath: roots.preferredRoot,
      locationType: 'external_ssd_archive',
      archivePending: false,
      preferredRootConfigured: true,
    };
  }

  await mkdir(roots.fallbackRoot, { recursive: true });
  if (!await isWritableDirectory(roots.fallbackRoot)) {
    throw new Error(`Video archive fallback is not writable: ${roots.fallbackRoot}`);
  }
  return {
    rootPath: roots.fallbackRoot,
    locationType: 'mac_desktop_fallback',
    archivePending: true,
    preferredRootConfigured: Boolean(roots.preferredRoot),
  };
}

export async function archiveVerifiedMedia(options) {
  const sourcePath = resolve(options.sourcePath);
  const sourceDetails = await stat(sourcePath);
  if (!sourceDetails.isFile()) {
    throw new Error(`Archive source is not a file: ${sourcePath}`);
  }

  const contentSha256 = await calculateSha256(sourcePath);
  if (options.expectedSha256 && options.expectedSha256 !== contentSha256) {
    throw new Error('Archive source SHA-256 does not match the expected digest.');
  }

  const target = await selectArchiveTarget(options);
  const relativePath = options.relativePath || basename(sourcePath);
  const destinationPath = resolveDestination(target.rootPath, relativePath);
  await mkdir(dirname(destinationPath), { recursive: true });

  let reusedExistingCopy = false;
  try {
    const destinationDetails = await stat(destinationPath);
    if (!destinationDetails.isFile()) {
      throw new Error(`Archive destination exists but is not a file: ${destinationPath}`);
    }
    const destinationSha256 = await calculateSha256(destinationPath);
    if (destinationSha256 !== contentSha256) {
      throw new Error('Archive destination already exists with different content.');
    }
    reusedExistingCopy = true;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (!reusedExistingCopy) {
    const temporaryPath = `${destinationPath}.partial-${randomUUID()}`;
    try {
      await copyFile(sourcePath, temporaryPath);
      const copiedSha256 = await calculateSha256(temporaryPath);
      if (copiedSha256 !== contentSha256) {
        throw new Error('Archive copy failed SHA-256 verification.');
      }
      await rename(temporaryPath, destinationPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      throw error;
    }
  }

  const verifiedAt = (options.now || new Date()).toISOString();
  const locationSuffix = target.locationType === 'external_ssd_archive' ? 'ssd' : 'desktop';
  return {
    archive_id: `archive-${locationSuffix}-${contentSha256.slice(0, 20)}`,
    render_job_id: options.renderJobId,
    source_path: sourcePath,
    destination_path: destinationPath,
    location_type: target.locationType,
    device_id: options.deviceId || 'vbj-orchestrator-01',
    status: target.archivePending ? 'pending_external_ssd' : 'archived',
    content_sha256: contentSha256,
    size_bytes: sourceDetails.size,
    verified_at: verifiedAt,
    source_retained: true,
    reused_existing_copy: reusedExistingCopy,
    preferred_root_configured: target.preferredRootConfigured,
  };
}

export async function archiveVerifiedAsset(options) {
  if (!options.asset?.asset_id || !options.asset?.content_sha256) {
    throw new Error('Asset archival requires an asset ID and expected SHA-256.');
  }
  if (!options.asset.local_path) {
    throw new Error('Asset archival requires a local source path.');
  }

  const sourcePath = options.sourcePath || options.asset.local_path;
  const extension = basename(sourcePath).includes('.')
    ? basename(sourcePath).split('.').at(-1)
    : 'bin';
  const archived = await archiveVerifiedMedia({
    ...options,
    sourcePath,
    expectedSha256: options.asset.content_sha256,
    relativePath: options.relativePath
      || `assets/${options.asset.content_sha256}.${extension}`,
    renderJobId: `asset-archive-${options.asset.asset_id}`,
  });

  return {
    storage_location_id: `asset-storage-${archived.archive_id}`,
    asset_id: options.asset.asset_id,
    path: archived.destination_path,
    location_type: archived.location_type,
    device_id: archived.device_id,
    status: archived.status,
    content_sha256: archived.content_sha256,
    size_bytes: archived.size_bytes,
    verified_at: archived.verified_at,
    source_retained: archived.source_retained,
    reused_existing_copy: archived.reused_existing_copy,
    preferred_root_configured: archived.preferred_root_configured,
  };
}
