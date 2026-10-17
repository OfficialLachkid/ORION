import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResearchRecommendationJsonSchema,
  generateResearchRecommendation,
} from '../src/ollama-recommendation-adapter.mjs';

const observationId = '11111111-1111-4111-8111-111111111111';
const secondObservationId = '22222222-2222-4222-8222-222222222222';
const observedAt = '2026-10-17T15:00:00.000Z';
const listingUrl = 'https://maker.itch.io/pixel-effects';
const secondListingUrl = 'https://another-maker.itch.io/combat-effects';

function evidence() {
  return [
    {
      observation_id: observationId,
      listing_url: listingUrl,
      observed_at: observedAt,
      creator: 'Maker',
    },
    {
      observation_id: secondObservationId,
      listing_url: secondListingUrl,
      observed_at: observedAt,
      creator: 'Another Maker',
    },
  ];
}

function recommendation() {
  return {
    schema_version: '1.0',
    recommendation_id: 'pixel-effects-opportunity',
    action: 'new_product',
    existing_product_slug: null,
    title: 'Pixel Effects Opportunity',
    summary: 'A compact original effects pack supported by the supplied listing evidence.',
    rationale: ['Two effects listings from different creators persisted across both snapshots.'],
    confidence: 55,
    evidence_ids: [observationId, secondObservationId],
    opportunity: {
      schema_version: '1.0',
      opportunity_id: 'OPPORTUNITY-RESEARCH-001',
      status: 'validated',
      title: 'Original Pixel Effects Pack',
      category: 'Pixel Art',
      product_type: 'effects pack',
      theme: 'original fantasy combat effects',
      target_audience: ['indie game developers'],
      observed_at: observedAt,
      expires_at: '2026-11-16T15:00:00.000Z',
      signals: {
        trend_direction: 'stable',
        demand: 'medium',
        competition: 'medium',
        cross_marketplace_evidence: 'weak',
        confidence: 55,
      },
      generation: {
        medium: 'pixel art',
        perspective: 'side view',
        width: 64,
        height: 64,
        source_width: 1024,
        source_height: 1024,
        max_palette_colors: 24,
        palette: ['#10131d', '#35d9ff'],
        outline: 'one-pixel dark outline',
        lighting: 'readable high-contrast glow',
        background: 'transparent',
        chroma_key: '#ff00ff',
        assets: [{
          asset_key: 'energy-impact',
          name: 'Energy Impact',
          kind: 'effect',
          description: 'An original animated energy impact.',
          prompt_notes: [],
        }],
      },
      commercial: {
        base_price: { amount: 3.99, currency: 'EUR' },
        marketplace_candidates: ['itch.io'],
      },
      risk: { ip_risk: 'low', prohibited_references: [], notes: [] },
      evidence: [
        { label: 'Persisted ranked listing', source: listingUrl, observed_at: observedAt },
        { label: 'Second persisted ranked listing', source: secondListingUrl, observed_at: observedAt },
      ],
    },
  };
}

test('sends a strict JSON schema to Ollama instead of a prompt template', async () => {
  let requestBody;
  const result = await generateResearchRecommendation({
    report: {
      status: 'eligible_for_local_analysis',
      snapshot_count: 2,
      evidence: evidence(),
    },
    model: { endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b', timeout_ms: 1000 },
    existingProducts: [],
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return new Response(JSON.stringify({ message: { content: JSON.stringify(recommendation()) } }), {
        status: 200,
      });
    },
  });

  assert.deepEqual(requestBody.format, buildResearchRecommendationJsonSchema({
    evidence: evidence(),
  }, []));
  assert.deepEqual(requestBody.format.oneOf, [{
    type: 'object',
    properties: {
      action: { type: 'string', const: 'new_product' },
      existing_product_slug: { type: 'null' },
    },
    required: ['action', 'existing_product_slug'],
  }]);
  assert.deepEqual(requestBody.format.properties.evidence_ids.items.enum, [observationId, secondObservationId]);
  assert.deepEqual(
    requestBody.format.properties.opportunity.properties.evidence.items.properties.source.enum,
    [listingUrl, secondListingUrl],
  );
  assert.equal(requestBody.options.temperature, 0);
  assert.equal(requestBody.messages[1].content.includes('required_shape'), false);
  assert.equal(result.recommendation_id, 'pixel-effects-opportunity');
});

test('repairs one semantically weak local recommendation before returning it', async () => {
  const invalid = recommendation();
  invalid.title = 'Original Product Opportunity';
  let requests = 0;
  let repairBody;
  const result = await generateResearchRecommendation({
    report: { status: 'eligible_for_local_analysis', snapshot_count: 2, evidence: evidence() },
    model: { endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b', timeout_ms: 1000 },
    existingProducts: [],
    fetchImpl: async (_url, options) => {
      requests += 1;
      repairBody = JSON.parse(options.body);
      const content = requests === 1 ? invalid : recommendation();
      return new Response(JSON.stringify({ message: { content: JSON.stringify(content) } }), { status: 200 });
    },
  });

  assert.equal(requests, 2);
  assert.match(repairBody.messages.at(-1).content, /placeholder title/iu);
  assert.equal(result.title, 'Pixel Effects Opportunity');
});

test('constrains extensions to product slugs present in the canonical catalog', () => {
  const schema = buildResearchRecommendationJsonSchema(
    { evidence: evidence() },
    [{ slug: 'neon-plasma-armory' }],
  );
  assert.equal(schema.oneOf.length, 2);
  assert.deepEqual(
    schema.oneOf[1].properties.existing_product_slug.enum,
    ['neon-plasma-armory'],
  );
});
