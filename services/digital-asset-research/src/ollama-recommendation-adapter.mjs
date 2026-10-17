import { ResearchRecommendationSchema } from './schemas.mjs';

const identifier = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' };
const isoDateTime = { type: 'string', format: 'date-time' };
const confidence = { type: 'number', minimum: 0, maximum: 80 };
const nonEmptyString = { type: 'string', minLength: 1 };

function strictObject(properties) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const assetSchema = strictObject({
  asset_key: identifier,
  name: nonEmptyString,
  kind: nonEmptyString,
  description: nonEmptyString,
  prompt_notes: { type: 'array', items: nonEmptyString },
});

const opportunitySchema = strictObject({
  schema_version: { type: 'string', const: '1.0' },
  opportunity_id: nonEmptyString,
  status: { type: 'string', const: 'validated' },
  title: nonEmptyString,
  category: nonEmptyString,
  product_type: nonEmptyString,
  theme: nonEmptyString,
  target_audience: { type: 'array', minItems: 1, items: nonEmptyString },
  observed_at: isoDateTime,
  expires_at: isoDateTime,
  signals: strictObject({
    trend_direction: { type: 'string', enum: ['rising', 'stable', 'falling'] },
    demand: { type: 'string', enum: ['high', 'medium', 'low'] },
    competition: { type: 'string', enum: ['low', 'medium', 'high', 'saturated'] },
    cross_marketplace_evidence: { type: 'string', const: 'weak' },
    confidence,
  }),
  generation: strictObject({
    medium: { type: 'string', const: 'pixel art' },
    perspective: nonEmptyString,
    width: { type: 'integer', minimum: 8, maximum: 4096 },
    height: { type: 'integer', minimum: 8, maximum: 4096 },
    source_width: { type: 'integer', minimum: 64, maximum: 4096 },
    source_height: { type: 'integer', minimum: 64, maximum: 4096 },
    max_palette_colors: { type: 'integer', minimum: 2, maximum: 256 },
    palette: {
      type: 'array',
      minItems: 2,
      maxItems: 256,
      items: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    },
    outline: nonEmptyString,
    lighting: nonEmptyString,
    background: { type: 'string', const: 'transparent' },
    chroma_key: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    assets: { type: 'array', minItems: 1, maxItems: 100, items: assetSchema },
  }),
  commercial: strictObject({
    base_price: strictObject({
      amount: { type: 'number', minimum: 0 },
      currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    }),
    marketplace_candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 1,
      items: { type: 'string', const: 'itch.io' },
    },
  }),
  risk: strictObject({
    ip_risk: { type: 'string', const: 'low' },
    prohibited_references: { type: 'array', items: nonEmptyString },
    notes: { type: 'array', items: nonEmptyString },
  }),
  evidence: {
    type: 'array',
    minItems: 1,
    maxItems: 30,
    items: strictObject({
      label: nonEmptyString,
      source: { type: 'string', format: 'uri' },
      observed_at: isoDateTime,
    }),
  },
});

const researchRecommendationJsonSchema = strictObject({
  schema_version: { type: 'string', const: '1.0' },
  recommendation_id: { ...identifier, maxLength: 48 },
  action: { type: 'string', enum: ['new_product', 'extend_existing_product'] },
  existing_product_slug: { anyOf: [identifier, { type: 'null' }] },
  title: { type: 'string', minLength: 1, maxLength: 120 },
  summary: { type: 'string', minLength: 1, maxLength: 1000 },
  rationale: { type: 'array', minItems: 1, maxItems: 8, items: nonEmptyString },
  confidence,
  evidence_ids: {
    type: 'array',
    minItems: 1,
    maxItems: 30,
    items: { type: 'string', format: 'uuid' },
  },
  opportunity: opportunitySchema,
});

export function buildResearchRecommendationJsonSchema(report) {
  const evidence = report.evidence || [];
  const observationIds = [...new Set(evidence.map((item) => item.observation_id))];
  const listingUrls = [...new Set(evidence.map((item) => item.listing_url))];
  const observedTimes = [...new Set(evidence.map((item) => item.observed_at))];
  if (!observationIds.length || !listingUrls.length || !observedTimes.length) {
    throw new Error('Research recommendation schema requires supplied evidence identifiers, URLs, and timestamps.');
  }
  const dynamicOpportunity = {
    ...opportunitySchema,
    properties: {
      ...opportunitySchema.properties,
      evidence: {
        ...opportunitySchema.properties.evidence,
        items: strictObject({
          label: nonEmptyString,
          source: { type: 'string', enum: listingUrls },
          observed_at: { type: 'string', enum: observedTimes },
        }),
      },
    },
  };
  return {
    ...researchRecommendationJsonSchema,
    properties: {
      ...researchRecommendationJsonSchema.properties,
      evidence_ids: {
        ...researchRecommendationJsonSchema.properties.evidence_ids,
        uniqueItems: true,
        items: { type: 'string', enum: observationIds },
      },
      opportunity: dynamicOpportunity,
    },
  };
}

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
      format: buildResearchRecommendationJsonSchema(options.report),
      options: { temperature: 0 },
      messages: [
        {
          role: 'system',
          content: [
            'You are ORION research. Return one JSON recommendation only.',
            'Fill every field required by the provided response schema with concrete values.',
            'Do not repeat the schema, required shape, or evidence report.',
            'Use only supplied evidence. Marketplace rank is a proxy, never a sales count.',
            'Do not cite brands, copyrighted franchises, or facts absent from the evidence.',
            'The opportunity field must conform to ORION ProductOpportunity schema_version 1.0 and status validated.',
            'Set generation medium to pixel art and background to transparent.',
            'Set commercial marketplace_candidates to ["itch.io"], cross_marketplace_evidence to weak, and ip_risk to low.',
            'Every recommendation evidence_id must be an observation_id supplied below.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            existing_products: options.existingProducts || [],
            evidence_report: options.report,
            decision_request: 'Recommend one original product opportunity supported by the supplied observations.',
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
