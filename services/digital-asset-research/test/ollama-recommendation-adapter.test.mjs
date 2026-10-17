import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildResearchRecommendationJsonSchema,
  generateResearchRecommendation,
} from '../src/ollama-recommendation-adapter.mjs';

const observationId = '11111111-1111-4111-8111-111111111111';
const observedAt = '2026-10-17T15:00:00.000Z';
const listingUrl = 'https://maker.itch.io/pixel-effects';

function recommendation() {
  return {
    schema_version: '1.0',
    recommendation_id: 'pixel-effects-opportunity',
    action: 'new_product',
    existing_product_slug: null,
    title: 'Pixel Effects Opportunity',
    summary: 'A compact original effects pack supported by the supplied listing evidence.',
    rationale: ['The cited listing persisted across both snapshots.'],
    confidence: 70,
    evidence_ids: [observationId],
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
      expires_at: '2026-11-17T15:00:00.000Z',
      signals: {
        trend_direction: 'stable',
        demand: 'medium',
        competition: 'medium',
        cross_marketplace_evidence: 'weak',
        confidence: 70,
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
      evidence: [{ label: 'Persisted ranked listing', source: listingUrl, observed_at: observedAt }],
    },
  };
}

test('sends a strict JSON schema to Ollama instead of a prompt template', async () => {
  let requestBody;
  const result = await generateResearchRecommendation({
    report: {
      status: 'eligible_for_local_analysis',
      snapshot_count: 2,
      evidence: [{ observation_id: observationId, listing_url: listingUrl, observed_at: observedAt }],
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
    evidence: [{ observation_id: observationId, listing_url: listingUrl, observed_at: observedAt }],
  }));
  assert.deepEqual(requestBody.format.properties.evidence_ids.items.enum, [observationId]);
  assert.deepEqual(
    requestBody.format.properties.opportunity.properties.evidence.items.properties.source.enum,
    [listingUrl],
  );
  assert.equal(requestBody.options.temperature, 0);
  assert.equal(requestBody.messages[1].content.includes('required_shape'), false);
  assert.equal(result.recommendation_id, 'pixel-effects-opportunity');
});
