import { createStableId } from '../ids.mjs';
import {
  AssetProvenanceSchema,
  ProductPageMediaCandidateSchema,
} from '../schemas.mjs';

const PUBLICATION_RETRIEVAL_METHODS = new Set(['api', 'permitted_download', 'fixture']);
const INTERNAL_TEST_RETRIEVAL_METHODS = new Set([
  'manual_upload',
  'permitted_browser',
  'fixture',
]);

function getCandidateBlockers(candidate) {
  const blockers = [];
  if (!candidate.source_url) blockers.push('source_url_missing');

  if (candidate.usage_scope === 'publication') {
    if (candidate.rights_status !== 'verified') {
      blockers.push(`rights_status=${candidate.rights_status}`);
    }
    if (!candidate.rights_evidence) blockers.push('rights_evidence_missing');
    if (!PUBLICATION_RETRIEVAL_METHODS.has(candidate.retrieval_method)) {
      blockers.push(`retrieval_method=${candidate.retrieval_method}`);
    }
  } else {
    if (!INTERNAL_TEST_RETRIEVAL_METHODS.has(candidate.retrieval_method)) {
      blockers.push(`retrieval_method=${candidate.retrieval_method}`);
    }
    if (!candidate.local_path) blockers.push('local_path_missing');
    if (!candidate.content_sha256) blockers.push('content_hash_missing');
  }

  if (candidate.approval_status !== 'approved') {
    blockers.push(`approval_status=${candidate.approval_status}`);
  }
  return blockers;
}

function resolveStatus(candidate, blockers) {
  if (candidate.retrieval_method === 'reference_only' && candidate.approval_status === 'pending') {
    return 'reference_only';
  }
  return blockers.length === 0 ? 'asset_record_ready' : 'blocked';
}

export function normalizeProductPageMediaCandidate(input, context) {
  const base = {
    media_candidate_id: createStableId('media-candidate', {
      productId: context.productId,
      mediaType: input.media_type,
      sourcePageUrl: input.source_page_url || context.source.source_url,
      sourceUrl: input.source_url || null,
      pagePosition: input.page_position ?? null,
    }),
    product_id: context.productId,
    media_type: input.media_type,
    source_provider: input.source_provider || context.source.provider,
    source_page_url: input.source_page_url || context.source.source_url,
    source_url: input.source_url || null,
    observed_at: input.observed_at || context.source.retrieved_at,
    observation_method: input.observation_method || context.source.retrieval_method,
    retrieval_method: input.retrieval_method || 'reference_only',
    local_path: input.local_path || null,
    content_sha256: input.content_sha256 || null,
    rights_status: input.rights_status || 'unverified',
    rights_basis: input.rights_basis || 'unknown',
    rights_evidence: input.rights_evidence || null,
    attribution_required: input.attribution_required === true,
    attribution_text: input.attribution_text || null,
    approval_status: input.approval_status || 'pending',
    usage_scope: input.usage_scope || 'publication',
    label: input.label || null,
    page_position: input.page_position ?? null,
    usage_notes: Array.isArray(input.usage_notes) ? input.usage_notes : [],
    video_analysis: input.video_analysis || null,
  };
  const blockers = getCandidateBlockers(base);

  return ProductPageMediaCandidateSchema.parse({
    ...base,
    status: resolveStatus(base, blockers),
    blockers,
  });
}

export function promoteMediaCandidateToAsset(candidate) {
  if (!candidate.source_url) return null;

  return AssetProvenanceSchema.parse({
    asset_id: createStableId('asset', {
      productId: candidate.product_id,
      mediaType: candidate.media_type,
      sourceUrl: candidate.source_url,
    }),
    product_id: candidate.product_id,
    media_type: candidate.media_type,
    source_provider: candidate.source_provider,
    source_url: candidate.source_url,
    source_page_url: candidate.source_page_url,
    retrieved_at: candidate.observed_at,
    retrieval_method: candidate.retrieval_method,
    local_path: candidate.local_path,
    content_sha256: candidate.content_sha256,
    rights_status: candidate.rights_status,
    rights_basis: candidate.rights_basis,
    rights_evidence: candidate.rights_evidence,
    attribution_required: candidate.attribution_required,
    attribution_text: candidate.attribution_text,
    approval_status: candidate.approval_status,
    download_status: candidate.local_path ? 'downloaded' : (
      candidate.status === 'asset_record_ready' ? 'planned' : 'blocked'
    ),
    usage_scope: candidate.usage_scope,
    usage_notes: [
      ...candidate.usage_notes,
      `Promoted from media candidate ${candidate.media_candidate_id}.`,
    ],
    video_analysis: candidate.video_analysis,
  });
}

export class ProductPageMediaIntakeAdapter {
  normalize(inputs, context) {
    return (inputs || []).map((input) => normalizeProductPageMediaCandidate(input, context));
  }

  promote(candidates) {
    return candidates
      .map((candidate) => promoteMediaCandidateToAsset(candidate))
      .filter(Boolean);
  }
}
