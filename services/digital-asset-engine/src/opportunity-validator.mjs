import { ProductOpportunitySchema } from './schemas.mjs';

function check(name, status, detail) {
  return { name, status, detail };
}

function normalizeKey(value) {
  return value.trim().toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/gu, '-');
}

export function validateOpportunity(input, config, options = {}) {
  const opportunity = ProductOpportunitySchema.parse(input);
  const now = new Date(options.now || new Date());
  const observedAt = new Date(opportunity.observed_at);
  const expiresAt = new Date(opportunity.expires_at);
  const ageDays = (now.getTime() - observedAt.getTime()) / 86_400_000;
  const existingKeys = new Set((options.existingProducts || []).map((item) => (
    normalizeKey(`${item.title || ''}-${item.theme || ''}-${item.product_type || ''}`)
  )));
  const opportunityKey = normalizeKey(
    `${opportunity.title}-${opportunity.theme}-${opportunity.product_type}`,
  );

  const checks = [
    check(
      'freshness',
      expiresAt >= now && ageDays <= config.validation.maximum_opportunity_age_days ? 'pass' : 'fail',
      `Observed ${Math.max(0, Math.floor(ageDays))} day(s) ago; expires ${opportunity.expires_at}.`,
    ),
    check(
      'demand',
      ['high', 'medium'].includes(opportunity.signals.demand) ? 'pass' : 'fail',
      `Demand is ${opportunity.signals.demand}.`,
    ),
    check(
      'competition',
      opportunity.signals.competition === 'saturated' ? 'fail' : 'pass',
      `Competition is ${opportunity.signals.competition}.`,
    ),
    check(
      'confidence',
      opportunity.signals.confidence >= config.validation.minimum_confidence ? 'pass' : 'fail',
      `Confidence ${opportunity.signals.confidence}; minimum ${config.validation.minimum_confidence}.`,
    ),
    check(
      'generation_scope',
      opportunity.generation.assets.length <= config.validation.maximum_assets_per_product
        ? 'pass'
        : 'fail',
      `${opportunity.generation.assets.length} requested asset(s).`,
    ),
    check(
      'ip_risk',
      opportunity.risk.ip_risk === 'high' ? 'fail' : opportunity.risk.ip_risk === 'medium' ? 'warn' : 'pass',
      `IP risk is ${opportunity.risk.ip_risk}; prohibited references remain blocked.`,
    ),
    check(
      'internal_overlap',
      existingKeys.has(opportunityKey) ? 'fail' : 'pass',
      existingKeys.has(opportunityKey) ? 'A matching internal product exists.' : 'No matching product supplied.',
    ),
    check(
      'marketplace_fit',
      opportunity.commercial.marketplace_candidates.length > 0 ? 'pass' : 'fail',
      `${opportunity.commercial.marketplace_candidates.length} marketplace candidate(s).`,
    ),
  ];

  const failures = checks.filter((item) => item.status === 'fail');
  const warnings = checks.filter((item) => item.status === 'warn');
  return {
    opportunity,
    decision: failures.length === 0 ? 'approved_for_manual_generation' : 'rejected',
    generation_eligible: failures.length === 0,
    human_review_required: true,
    checks,
    failures: failures.map((item) => item.name),
    warnings: warnings.map((item) => item.name),
    validated_at: now.toISOString(),
  };
}
