import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import { OutputManifestSchema } from './schemas.mjs';

async function inspectFile(filePath) {
  try {
    const details = await stat(filePath);
    return details.isFile() ? details : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function calculateSha256(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function assertValidRetentionHours(retentionHours) {
  if (!Number.isFinite(retentionHours) || retentionHours <= 0 || retentionHours > 2160) {
    throw new Error('Temporary source retention must be between 0 and 2160 hours.');
  }
}

export function setTemporarySourceRetention(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const retentionHours = Number(options.retentionHours);
  assertValidRetentionHours(retentionHours);
  const now = new Date(options.now || new Date());
  if (Number.isNaN(now.valueOf())) throw new Error('Retention start time must be a valid date.');
  const deleteAfter = new Date(now.valueOf() + retentionHours * 60 * 60 * 1000).toISOString();
  let updated = 0;

  const assetStorageLocations = manifest.asset_storage_locations.map((location) => {
    if (
      options.assetId
      && location.asset_id !== options.assetId
    ) {
      return location;
    }
    const asset = manifest.assets.find((candidate) => candidate.asset_id === location.asset_id);
    if (
      asset?.usage_scope !== 'internal_editor_test'
      || location.location_type !== 'external_ssd_archive'
      || location.status !== 'archived'
      || location.deletion_status === 'deleted'
    ) {
      return location;
    }
    updated += 1;
    return {
      ...location,
      retention_class: 'temporary_source',
      delete_after: deleteAfter,
      deletion_status: 'retained',
      deleted_at: null,
    };
  });

  if (updated === 0) {
    throw new Error('No retained internal-test source asset matched the retention request.');
  }
  return OutputManifestSchema.parse({
    ...manifest,
    asset_storage_locations: assetStorageLocations,
    notes: [
      ...manifest.notes,
      `${updated} temporary source asset(s) will become deletion-eligible at ${deleteAfter}.`,
    ],
  });
}

export async function sweepExpiredTemporarySources(options) {
  const manifest = OutputManifestSchema.parse(options.manifest);
  const asOf = new Date(options.asOf || new Date());
  if (Number.isNaN(asOf.valueOf())) throw new Error('Retention sweep time must be a valid date.');
  const hasVerifiedRender = manifest.archive_results.some((archive) => (
    archive.location_type === 'external_ssd_archive'
    && archive.status === 'archived'
  ));
  if (!hasVerifiedRender) {
    throw new Error('Refusing source deletion until a generated render is verified on the external SSD.');
  }

  const deletedIds = new Set();
  for (const location of manifest.asset_storage_locations) {
    if (
      location.retention_class !== 'temporary_source'
      || location.deletion_status === 'deleted'
      || location.location_type !== 'external_ssd_archive'
      || location.status !== 'archived'
      || !location.delete_after
      || Date.parse(location.delete_after) > asOf.valueOf()
    ) {
      continue;
    }
    const details = await inspectFile(location.path);
    if (!details) throw new Error(`Retention candidate is missing before verified deletion: ${location.path}`);
    const actualSha256 = await calculateSha256(location.path);
    if (actualSha256 !== location.content_sha256) {
      throw new Error(`Retention candidate SHA-256 does not match: ${location.asset_id}`);
    }
    await unlink(location.path);
    deletedIds.add(location.storage_location_id);
  }

  const deletedAt = asOf.toISOString();
  const updatedManifest = OutputManifestSchema.parse({
    ...manifest,
    asset_storage_locations: manifest.asset_storage_locations.map((location) => (
      deletedIds.has(location.storage_location_id)
        ? {
          ...location,
          deletion_status: 'deleted',
          deleted_at: deletedAt,
          source_retained: false,
        }
        : location
    )),
    notes: [
      ...manifest.notes,
      `Retention sweep deleted ${deletedIds.size} expired temporary source asset(s) after SHA-256 verification.`,
    ],
  });
  return {
    manifest: updatedManifest,
    report: {
      deleted_storage_location_ids: [...deletedIds],
      swept_at: deletedAt,
    },
  };
}
