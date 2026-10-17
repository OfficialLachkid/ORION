import { ResearchRecommendationSchema } from './schemas.mjs';

const identifier = { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' };
const isoDateTime = { type: 'string', format: 'date-time' };
const confidence = { type: 'integer', minimum: 20, maximum: 60 };
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
    demand: { type: 'string', enum: ['medium', 'low'] },
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
    chroma_key: { type: 'string', const: '#ff00ff' },
    assets: { type: 'array', minItems: 1, maxItems: 100, items: assetSchema },
  }),
  commercial: strictObject({
    base_price: strictObject({
      amount: { type: 'number', minimum: 0 },
      currency: { type: 'string', const: 'EUR' },
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
    minItems: 2,
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
    minItems: 2,
    maxItems: 30,
    items: { type: 'string', format: 'uuid' },
  },
  opportunity: opportunitySchema,
});

export function buildResearchRecommendationJsonSchema(report, existingProducts = []) {
  const evidence = report.evidence || [];
  const observationIds = [...new Set(evidence.map((item) => item.observation_id))];
  const listingUrls = [...new Set(evidence.map((item) => item.listing_url))];
  const observedTimes = [...new Set(evidence.map((item) => item.observed_at))];
  if (!observationIds.length || !listingUrls.length || !observedTimes.length) {
    throw new Error('Research recommendation schema requires supplied evidence identifiers, URLs, and timestamps.');
  }
  const latestObservedAt = [...observedTimes]
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];
  const expiresAt = new Date(Date.parse(latestObservedAt) + (30 * 24 * 60 * 60 * 1000)).toISOString();
  const dynamicOpportunity = {
    ...opportunitySchema,
    properties: {
      ...opportunitySchema.properties,
      observed_at: { type: 'string', const: latestObservedAt },
      expires_at: { type: 'string', const: expiresAt },
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
  const existingSlugs = [...new Set(existingProducts.map((item) => item.slug).filter(Boolean))];
  return {
    ...researchRecommendationJsonSchema,
    properties: {
      ...researchRecommendationJsonSchema.properties,
      existing_product_slug: existingSlugs.length
        ? { anyOf: [{ type: 'string', enum: existingSlugs }, { type: 'null' }] }
        : { type: 'null' },
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

const genericConceptWords = new Set([
  'asset', 'assets', 'game', 'games', 'original', 'opportunity', 'pack', 'pixel', 'product', 'products', 'rpg',
]);

function conceptTokens(value) {
  return new Set((String(value || '').toLowerCase().match(/[a-z0-9]+/gu) || [])
    .filter((word) => word.length >= 4 && !genericConceptWords.has(word)));
}

function validateRecommendation(content, options) {
  const parsed = extractJson(content);
  if (parsed?.action === 'new_product') parsed.existing_product_slug = null;
  const suppliedById = new Map(options.report.evidence.map((item) => [item.observation_id, item]));
  if (Array.isArray(parsed?.evidence_ids) && parsed?.opportunity) {
    const citedRows = parsed.evidence_ids.map((id) => suppliedById.get(id));
    if (citedRows.every(Boolean)) {
      parsed.opportunity.evidence = citedRows.map((item) => ({
        label: `${item.view_id} rank ${item.current_rank}: ${item.title}`,
        source: item.listing_url,
        observed_at: item.observed_at,
      }));
    }
  }
  const recommendation = ResearchRecommendationSchema.parse(parsed);
  const existingSlugs = new Set((options.existingProducts || []).map((item) => item.slug));
  if (recommendation.action === 'extend_existing_product'
    && !existingSlugs.has(recommendation.existing_product_slug)) {
    throw new Error('An extension recommendation must target a product in the canonical catalog.');
  }
  if (!recommendation.evidence_ids.every((id) => suppliedById.has(id))) {
    throw new Error('The local model cited evidence that was not supplied by the research adapter.');
  }
  if (new Set(recommendation.evidence_ids).size < 2) {
    throw new Error('A recommendation requires at least two distinct cited observations.');
  }
  const citedRows = recommendation.evidence_ids.map((id) => suppliedById.get(id));
  if (new Set(citedRows.map((item) => item.creator).filter(Boolean)).size < 2) {
    throw new Error('A recommendation requires evidence from at least two distinct creators.');
  }
  const opportunityConcepts = conceptTokens([
    recommendation.title,
    recommendation.opportunity.title,
    recommendation.opportunity.theme,
    recommendation.opportunity.product_type,
  ].join(' '));
  const conceptMatches = citedRows.filter((item) => {
    const listingConcepts = conceptTokens(item.title);
    return [...opportunityConcepts].some((word) => listingConcepts.has(word));
  });
  if (conceptMatches.length < 2) {
    throw new Error('At least two cited listing titles must support a specific theme or product-type term in the recommendation.');
  }
  const citedEvidence = new Set(citedRows.map((item) => `${item.listing_url}|${item.observed_at}`));
  if (!recommendation.opportunity.evidence.every((item) => citedEvidence.has(`${item.source}|${item.observed_at}`))) {
    throw new Error('Opportunity evidence must be drawn from the recommendation citation set.');
  }
  if (recommendation.opportunity.evidence.length < 2) {
    throw new Error('An opportunity requires at least two evidence references.');
  }
  if (recommendation.opportunity.signals.cross_marketplace_evidence !== 'weak') {
    throw new Error('The first-source MVP cannot claim moderate or strong cross-marketplace evidence.');
  }
  if (!Number.isInteger(recommendation.confidence)
    || !Number.isInteger(recommendation.opportunity.signals.confidence)
    || recommendation.confidence < 20 || recommendation.confidence > 60
    || recommendation.opportunity.signals.confidence < 20
    || recommendation.opportunity.signals.confidence > 60) {
    throw new Error('Two-snapshot confidence must be an integer percentage from 20 through 60.');
  }
  const genericTitles = new Set([
    'original product opportunity',
    'pixel art asset',
    'pixel art asset pack',
    'new asset pack',
  ]);
  if (genericTitles.has(recommendation.title.trim().toLowerCase())
    || genericTitles.has(recommendation.opportunity.title.trim().toLowerCase())) {
    throw new Error('The recommendation must name a concrete product concept, not a placeholder title.');
  }
  const unsupportedClaims = /\b(?:sales|downloads|revenue|conversion rate|purchase count)\b/iu;
  if (unsupportedClaims.test([
    recommendation.summary,
    ...recommendation.rationale,
  ].join(' '))) {
    throw new Error('The recommendation claimed a marketplace metric unavailable to this source adapter.');
  }
  return recommendation;
}

async function requestRecommendation(options, endpoint, messages) {
  const response = await (options.fetchImpl || fetch)(new URL('/api/chat', endpoint), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(options.model.timeout_ms),
    body: JSON.stringify({
      model: options.model.model,
      stream: false,
      format: buildResearchRecommendationJsonSchema(options.report, options.existingProducts || []),
      options: { temperature: 0 },
      messages,
    }),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Local Ollama research request failed (${response.status}): ${body.slice(0, 300)}`);
  const envelope = JSON.parse(body);
  return String(envelope.message?.content || '');
}

export async function generateResearchRecommendation(options) {
  if (options.report.status !== 'eligible_for_local_analysis') {
    throw new Error('Local recommendation generation requires at least two comparable snapshots.');
  }
  const endpoint = assertLocalEndpoint(options.model.endpoint);
  const messages = [
    {
      role: 'system',
      content: [
        'You are ORION research. Return one JSON recommendation only.',
        'Fill every field required by the provided response schema with concrete values.',
        'Name a specific original product; placeholder titles such as Original Product Opportunity are forbidden.',
        'Cite at least two coherent observations from at least two different creators.',
        'At least two cited listing titles must share a specific theme or product-type term with the recommendation.',
        'Generic words such as pixel, art, asset, pack, game, and RPG do not establish concept support.',
        'Rationales must use the exact titles, ranks, and rank changes in the cited evidence.',
        'Do not repeat the schema, required shape, or evidence report.',
        'Use only supplied evidence. Marketplace rank is a proxy, never a sales count.',
        'Do not claim sales, downloads, revenue, purchases, or conversion rates.',
        'Do not cite brands, copyrighted franchises, or facts absent from the evidence.',
        'Because this is one source and two snapshots, demand cannot be high and confidence must be an integer from 20 to 60.',
        'The opportunity field must conform to ORION ProductOpportunity schema_version 1.0 and status validated.',
        'Set generation medium to pixel art, background to transparent, and chroma_key to #ff00ff.',
        'Set currency to EUR, marketplace_candidates to ["itch.io"], cross_marketplace_evidence to weak, and ip_risk to low.',
        'Every recommendation evidence_id must be an observation_id supplied below.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        existing_products: options.existingProducts || [],
        evidence_report: options.report,
        decision_request: 'Recommend one concrete, original product opportunity supported by a pattern across the supplied observations.',
      }),
    },
  ];
  const firstContent = await requestRecommendation(options, endpoint, messages);
  try {
    return validateRecommendation(firstContent, options);
  } catch (firstError) {
    const repairMessages = [
      ...messages,
      { role: 'assistant', content: firstContent },
      {
        role: 'user',
        content: `Your recommendation failed ORION semantic validation: ${String(firstError.message || firstError).slice(0, 1200)} Correct the evidence and product concept, then return the complete JSON object again.`,
      },
    ];
    const repairedContent = await requestRecommendation(options, endpoint, repairMessages);
    try {
      return validateRecommendation(repairedContent, options);
    } catch (repairError) {
      throw new Error(`Local research recommendation failed semantic validation after one repair attempt: ${repairError.message}`);
    }
  }
}
