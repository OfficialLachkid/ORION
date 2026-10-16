import { ResearchRecommendationSchema } from './schemas.mjs';

function assertLocalEndpoint(value) {
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    throw new Error('Research recommendations must use the local Ollama endpoint.');
  }
  return url;
}

function extractJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '');
  return JSON.parse(text);
}

export async function generateResearchRecommendation(options) {
  if (options.report.status !== 'eligible_for_local_analysis') {
    throw new Error('Local recommendation generation requires at least two comparable snapshots.');
  }
  const endpoint = assertLocalEndpoint(options.model.endpoint);
  const response = await (options.fetchImpl || fetch)(new URL('/api/chat', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(options.model.timeout_ms),
    body: JSON.stringify({
      model: options.model.model,
      stream: false,
      format: 'json',
      messages: [
        {
          role: 'system',
          content: [
            'You are ORION research. Return one JSON recommendation only.',
            'Use only supplied evidence. Marketplace rank is a proxy, never a sales count.',
            'Do not cite brands, copyrighted franchises, or facts absent from the evidence.',
            'The opportunity field must conform to ORION ProductOpportunity schema_version 1.0 and status validated.',
            'Set generation background to transparent, commercial marketplace_candidates to ["itch.io"], and ip_risk low.',
            'Every recommendation evidence_id must be an observation_id supplied below.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            existing_products: options.existingProducts || [],
            evidence_report: options.report,
            required_shape: {
              schema_version: '1.0',
              recommendation_id: 'lowercase-kebab-id',
              action: 'new_product | extend_existing_product',
              existing_product_slug: null,
              title: 'string',
              summary: 'string',
              rationale: ['evidence-backed string'],
              confidence: '0..100',
              evidence_ids: ['observation uuid'],
              opportunity: {
                schema_version: '1.0', opportunity_id: 'string', status: 'validated',
                title: 'string', category: 'string', product_type: 'string', theme: 'string',
                target_audience: ['string'], observed_at: 'ISO datetime', expires_at: 'ISO datetime',
                signals: {
                  trend_direction: 'rising | stable | falling', demand: 'high | medium | low',
                  competition: 'low | medium | high | saturated',
                  cross_marketplace_evidence: 'strong | moderate | weak', confidence: '0..100',
                },
                generation: {
                  medium: 'pixel art', perspective: 'string', width: '8..4096 integer', height: '8..4096 integer',
                  source_width: '64..4096 integer', source_height: '64..4096 integer',
                  max_palette_colors: '2..256 integer', palette: ['#rrggbb', '#rrggbb'],
                  outline: 'string', lighting: 'string', background: 'transparent', chroma_key: '#ff00ff',
                  assets: [{ asset_key: 'lowercase-kebab', name: 'string', kind: 'string', description: 'string', prompt_notes: [] }],
                },
                commercial: { base_price: { amount: 'number', currency: 'EUR' }, marketplace_candidates: ['itch.io'] },
                risk: { ip_risk: 'low', prohibited_references: [], notes: [] },
                evidence: [{ label: 'string', source: 'listing URL from evidence', observed_at: 'ISO datetime' }],
              },
            },
          }),
        },
      ],
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Local Ollama research request failed (${response.status}): ${body.slice(0, 300)}`);
  const envelope = JSON.parse(body);
  const recommendation = ResearchRecommendationSchema.parse(extractJson(envelope.message?.content));
  const suppliedIds = new Set(options.report.evidence.map((item) => item.observation_id));
  if (!recommendation.evidence_ids.every((id) => suppliedIds.has(id))) {
    throw new Error('The local model cited evidence that was not supplied by the research adapter.');
  }
  const suppliedEvidence = new Set(options.report.evidence.map((item) => `${item.listing_url}|${item.observed_at}`));
  if (!recommendation.opportunity.evidence.every((item) => suppliedEvidence.has(`${item.source}|${item.observed_at}`))) {
    throw new Error('The local model added opportunity evidence that was not supplied by the research adapter.');
  }
  if (recommendation.opportunity.signals.cross_marketplace_evidence !== 'weak') {
    throw new Error('The first-source MVP cannot claim moderate or strong cross-marketplace evidence.');
  }
  if (recommendation.confidence > 80 || recommendation.opportunity.signals.confidence > 80) {
    throw new Error('The first-source MVP caps recommendation confidence at 80.');
  }
  return recommendation;
}
