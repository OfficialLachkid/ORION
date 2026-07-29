import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createStableId } from '../ids.mjs';
import {
  AffiliateLinkSchema,
  AssetProvenanceSchema,
  ProductSchema,
  SourceSnapshotSchema,
} from '../schemas.mjs';
import { ProductProviderAdapter } from './provider-adapter.mjs';
import { ProductPageMediaIntakeAdapter } from './product-page-media-intake-adapter.mjs';

function normalizeSpecifications(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [String(key), String(item)]),
  );
}
function normalizeAsset(asset, productId, source) {
  const assetId = createStableId('asset', {
    productId,
    mediaType: asset.media_type,
    sourceUrl: asset.source_url,
  });

  return AssetProvenanceSchema.parse({
    asset_id: assetId,
    product_id: productId,
    media_type: asset.media_type,
    source_provider: asset.source_provider,
    source_url: asset.source_url,
    source_page_url: asset.source_page_url || source.source_url,
    retrieved_at: source.retrieved_at,
    retrieval_method: asset.retrieval_method || 'reference_only',
    local_path: asset.local_path || null,
    content_sha256: asset.content_sha256 || null,
    rights_status: asset.rights_status || 'unverified',
    rights_basis: asset.rights_basis || 'unknown',
    rights_evidence: asset.rights_evidence || null,
    attribution_required: asset.attribution_required === true,
    attribution_text: asset.attribution_text || null,
    approval_status: asset.approval_status || 'pending',
    download_status: asset.download_status || 'not_requested',
    usage_scope: asset.usage_scope || 'publication',
    usage_notes: Array.isArray(asset.usage_notes) ? asset.usage_notes : [],
  });
}

export class FixtureProductProviderAdapter extends ProductProviderAdapter {
  constructor(options = {}) {
    super(options.name || 'fixture-manual-import');
    this.projectRoot = options.projectRoot || process.cwd();
  }

  async importProduct({ inputFile }) {
    if (!inputFile) {
      throw new Error('Fixture adapter requires inputFile.');
    }

    const fixturePath = resolve(this.projectRoot, inputFile);
    return JSON.parse(await readFile(fixturePath, 'utf8'));
  }

  normalize(raw, context) {
    const source = raw?.source || {};
    const input = raw?.product || {};
    const productId = createStableId('product', {
      provider: source.provider,
      sourceProductId: source.source_product_id,
    });

    const product = ProductSchema.parse({
      product_id: productId,
      canonical_name: input.name,
      brand: input.brand,
      category: input.category,
      description: input.description,
      specifications: normalizeSpecifications(input.specifications),
      current_price: input.current_price,
      list_price: input.list_price || null,
      rating: input.rating ?? null,
      review_count: input.review_count || 0,
      marketplace_source: source.marketplace,
      source_product_id: source.source_product_id,
      source_url: source.source_url,
      imported_at: context.runAt,
      tags: Array.isArray(input.tags) ? input.tags : [],
    });

    const snapshot = SourceSnapshotSchema.parse({
      snapshot_id: createStableId('snapshot', {
        productId,
        retrievedAt: source.retrieved_at,
        sourceUrl: source.source_url,
      }),
      product_id: productId,
      provider: source.provider,
      source_url: source.source_url,
      retrieved_at: source.retrieved_at,
      retrieval_method: source.retrieval_method,
      source_access_permitted: source.source_access_permitted === true,
      raw_payload: raw,
    });

    const assets = (raw.assets || []).map((asset) => normalizeAsset(asset, productId, source));
    const mediaIntakeAdapter = new ProductPageMediaIntakeAdapter();
    const mediaCandidates = mediaIntakeAdapter.normalize(raw.media_candidates, {
      productId,
      source,
    });
    const candidateAssets = mediaIntakeAdapter.promote(mediaCandidates);
    const assetsById = new Map(
      [...assets, ...candidateAssets].map((asset) => [asset.asset_id, asset]),
    );
    const affiliateLink = AffiliateLinkSchema.parse({
      affiliate_link_id: createStableId('affiliate', { productId, provider: raw.affiliate?.provider }),
      product_id: productId,
      provider: raw.affiliate?.provider || source.marketplace,
      destination_url: raw.affiliate?.destination_url || source.source_url,
      tracking_url: raw.affiliate?.tracking_url || null,
      disclosure: context.config.affiliate_disclosure,
      status: 'pending',
      approval_status: 'pending',
      created_at: context.runAt,
    });

    return {
      product,
      snapshot,
      mediaCandidates,
      assets: [...assetsById.values()],
      affiliateLink,
      scoreSignals: raw.score_signals || {},
      economics: raw.economics || {},
      claimGuardrails: raw.claim_guardrails || {},
    };
  }
}
