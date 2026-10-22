import { basename } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/u;

function manifestFile(manifest, buyerPath) {
  const normalized = String(buyerPath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  return (manifest.files || []).find((file) => (
    file.path === normalized || file.path === `download/${normalized}`
  ));
}

function uniqueByAssetId(entries, label) {
  const seen = new Set();
  for (const entry of entries) {
    if (!entry?.asset_id || seen.has(entry.asset_id)) {
      throw new Error(`${label} contains a missing or duplicate asset identity.`);
    }
    seen.add(entry.asset_id);
  }
}

export function resolveReviewedReleaseAssets(product, manifest) {
  const canonicalById = new Map((product.assets || []).map((asset) => [asset.asset_id, asset]));
  const expansionAssets = Array.isArray(manifest.expansion_assets) ? manifest.expansion_assets : [];
  uniqueByAssetId(expansionAssets, 'Release expansion inventory');
  const expansionById = new Map(expansionAssets.map((asset) => [asset.asset_id, asset]));
  let entries;
  if (Array.isArray(manifest.asset_inventory) && manifest.asset_inventory.length) {
    entries = manifest.asset_inventory;
    uniqueByAssetId(entries, 'Release asset inventory');
  } else {
    entries = (product.assets || []).map((asset) => {
      const expansion = expansionById.get(asset.asset_id);
      return {
        ...asset,
        ...(expansion || {}),
        asset_id: asset.asset_id,
        asset_key: expansion?.asset_key || asset.asset_key,
        buyer_path: expansion?.buyer_path || `assets/individual/${basename(asset.final_path)}`,
        content_origin: expansion?.operation === 'replace_existing' ? 'replacement' : 'canonical',
        latest_operation: expansion?.operation || 'canonical',
      };
    });
    entries.push(...expansionAssets.filter((asset) => (
      asset.operation === 'add_asset' && !canonicalById.has(asset.asset_id)
    )).map((asset) => ({
      ...asset,
      content_origin: 'addition',
      latest_operation: 'add_asset',
    })));
  }
  return entries.map((entry) => {
    const canonicalAsset = canonicalById.get(entry.asset_id) || null;
    const expansion = expansionById.get(entry.asset_id) || null;
    const buyerPath = entry.buyer_path
      || expansion?.buyer_path
      || (canonicalAsset?.final_path ? `assets/individual/${basename(canonicalAsset.final_path)}` : '');
    const file = manifestFile(manifest, buyerPath);
    const contentHash = String(entry.content_sha256 || expansion?.content_sha256 || file?.content_sha256 || '');
    if (!buyerPath || !file || !SHA256.test(contentHash) || file.content_sha256 !== contentHash) {
      throw new Error(`Reviewed release asset ${entry.asset_id || 'unknown'} is not bound to an exact buyer file hash.`);
    }
    const contentOrigin = entry.content_origin
      || (entry.operation === 'replace_existing' ? 'replacement'
        : entry.operation === 'add_asset' ? 'addition' : 'canonical');
    return {
      ...(canonicalAsset || {}),
      ...entry,
      asset_id: entry.asset_id,
      asset_key: entry.asset_key || canonicalAsset?.asset_key,
      name: entry.name || canonicalAsset?.name,
      description: entry.description || canonicalAsset?.description || '',
      kind: entry.kind || canonicalAsset?.kind || 'asset',
      buyer_path: buyerPath,
      manifest_path: file.path,
      content_sha256: contentHash,
      content_origin: contentOrigin,
      latest_operation: entry.latest_operation || entry.operation || 'canonical',
      final_path: buyerPath,
      canonical_asset: canonicalAsset,
    };
  });
}

export function buildReleaseAssetInventory({
  product,
  baseManifest,
  expansionAssets,
  expansionManifestHash,
  files,
}) {
  const fileManifest = { files };
  const baseEntries = Array.isArray(baseManifest.asset_inventory) && baseManifest.asset_inventory.length
    ? baseManifest.asset_inventory.map((entry) => ({ ...entry }))
    : (product.assets || []).map((asset) => ({
      asset_id: asset.asset_id,
      asset_key: asset.asset_key,
      name: asset.name,
      description: asset.description || '',
      kind: asset.kind,
      buyer_group: 'assets',
      buyer_path: `assets/individual/${basename(asset.final_path)}`,
      content_origin: 'canonical',
      origin_manifest_hash: baseManifest.manifest_hash,
      latest_operation: 'canonical',
    }));
  uniqueByAssetId(baseEntries, 'Base release asset inventory');
  const byId = new Map(baseEntries.map((entry) => [entry.asset_id, entry]));
  for (const asset of expansionAssets) {
    const previous = byId.get(asset.asset_id);
    const contentOrigin = asset.operation === 'replace_existing'
      ? 'replacement'
      : asset.operation === 'add_asset'
        ? 'addition'
        : previous?.content_origin || 'canonical';
    byId.set(asset.asset_id, {
      ...(previous || {}),
      asset_id: asset.asset_id,
      asset_key: asset.asset_key,
      name: asset.name,
      description: asset.description || previous?.description || '',
      kind: asset.kind || previous?.kind || 'asset',
      buyer_group: asset.buyer_group || previous?.buyer_group || 'assets',
      buyer_path: asset.buyer_path,
      content_origin: contentOrigin,
      origin_manifest_hash: ['replace_existing', 'add_asset'].includes(asset.operation)
        ? expansionManifestHash
        : previous?.origin_manifest_hash || baseManifest.manifest_hash,
      latest_operation: asset.operation,
    });
  }
  return [...byId.values()].map((entry) => {
    const file = manifestFile(fileManifest, entry.buyer_path);
    if (!file || !SHA256.test(String(file.content_sha256 || ''))) {
      throw new Error(`Release inventory asset ${entry.asset_id} is missing its buyer file.`);
    }
    return { ...entry, content_sha256: file.content_sha256 };
  });
}
