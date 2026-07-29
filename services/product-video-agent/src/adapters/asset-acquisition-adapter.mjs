import { canPlanAssetDownload } from '../compliance.mjs';
import { createStableId } from '../ids.mjs';
import { AssetAcquisitionPlanSchema } from '../schemas.mjs';

function getFileExtension(mediaType) {
  if (mediaType === 'video') {
    return 'mp4';
  }
  if (mediaType === 'audio') {
    return 'wav';
  }
  return 'jpg';
}
function getBlockers(asset) {
  const blockers = [];
  if (asset.rights_status !== 'verified') {
    blockers.push(`rights_status=${asset.rights_status}`);
  }
  if (!asset.rights_evidence) {
    blockers.push('rights_evidence_missing');
  }
  if (asset.approval_status !== 'approved') {
    blockers.push(`approval_status=${asset.approval_status}`);
  }
  if (!['api', 'permitted_download', 'fixture'].includes(asset.retrieval_method)) {
    blockers.push(`retrieval_method=${asset.retrieval_method}`);
  }
  return blockers;
}

export class RightsGatedAssetAcquisitionPlanner {
  constructor() {
    this.name = 'rights-gated-http-download';
  }

  createPlan(asset, runAt) {
    const planId = createStableId('asset-acquisition', {
      assetId: asset.asset_id,
      sourceUrl: asset.source_url,
    });
    const destinationPath = `data/runtime/product-video-agent/assets/${asset.asset_id}.${getFileExtension(asset.media_type)}`;

    return AssetAcquisitionPlanSchema.parse({
      acquisition_plan_id: planId,
      asset_id: asset.asset_id,
      source_url: asset.source_url,
      destination_path: destinationPath,
      status: canPlanAssetDownload(asset) ? 'planned' : 'blocked',
      blockers: canPlanAssetDownload(asset) ? [] : getBlockers(asset),
      execution_plan: {
        provider: 'http_download',
        execute: false,
      },
      created_at: runAt,
    });
  }
}
