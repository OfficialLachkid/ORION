import { createStableId } from './ids.mjs';
import { ProductScoreSchema, ScoreDimensionsSchema } from './schemas.mjs';

const WEIGHTS = Object.freeze({
  visual_appeal: 20,
  problem_solving_value: 20,
  virality: 20,
  novelty: 15,
  competition: 10,
  affiliate_potential: 15,
});

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function normalizeScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.min(100, Math.max(0, round(number)));
}

export function scoreProduct(product, signals, economics, scoredAt) {
  const dimensions = ScoreDimensionsSchema.parse({
    visual_appeal: normalizeScore(signals.visual_appeal),
    problem_solving_value: normalizeScore(signals.problem_solving_value),
    virality: normalizeScore(signals.virality),
    novelty: normalizeScore(signals.novelty),
    competition: normalizeScore(signals.competition_opportunity),
    affiliate_potential: normalizeScore(signals.affiliate_potential),
  });

  const totalWeight = Object.values(WEIGHTS).reduce((total, value) => total + value, 0);
  const weightedTotal = Object.entries(WEIGHTS).reduce(
    (total, [key, weight]) => total + dimensions[key] * weight,
    0,
  );
  const estimatedClicks = Math.max(0, Math.round(Number(economics.estimated_clicks) || 0));
  const conversionRate = Math.min(1, Math.max(0, Number(economics.conversion_rate) || 0));
  const commissionRate = Math.min(1, Math.max(0, Number(economics.commission_rate) || 0));
  const productionCost = Math.max(0, Number(economics.production_cost) || 0);
  const productPrice = product.current_price?.amount || 0;
  const currency = product.current_price?.currency || economics.currency || 'EUR';
  const estimatedRevenue = round(
    estimatedClicks * conversionRate * productPrice * commissionRate,
  );

  return ProductScoreSchema.parse({
    score_id: createStableId('score', { productId: product.product_id, version: 'phase-1-v1' }),
    product_id: product.product_id,
    scoring_version: 'phase-1-v1',
    dimensions,
    weights: WEIGHTS,
    overall_score: round(weightedTotal / totalWeight),
    expected_roi: {
      currency,
      estimated_clicks: estimatedClicks,
      conversion_rate: conversionRate,
      commission_rate: commissionRate,
      estimated_revenue: estimatedRevenue,
      production_cost: productionCost,
      expected_net_return: round(estimatedRevenue - productionCost),
      assumptions: [
        'Traffic, conversion, and commission inputs are operator-supplied planning estimates.',
        ...(product.current_price
          ? []
          : ['Current marketplace price was unavailable; expected revenue remains zero until refreshed.']),
        'No paid model, TTS, rendering, marketplace, or publishing cost is incurred in dry-run mode.',
      ],
    },
    scored_at: scoredAt,
  });
}
