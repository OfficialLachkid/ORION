import test from 'node:test';
import assert from 'node:assert/strict';
import { auditNamespaceCoverage } from '../lib/memory-promotion-audit.mjs';

const HEALTHY_NAMESPACES = {
  namespaces: {
    patterns: { purpose: 'p', write_standard: ['x'] },
    learnings: { purpose: 'p', write_standard: ['x'] },
    results: { purpose: 'p', write_standard: ['x'] },
    decisions: { purpose: 'p', write_standard: ['x'] },
    approvals: { purpose: 'p', write_standard: ['x'] },
    products: { purpose: 'p', write_standard: ['x'] },
    infra: { purpose: 'p', write_standard: ['x'] },
  },
};

function baseRule() {
  return {
    capture_mode: 'manual_review',
    freshness_rule: 'refresh often',
    promote_when: ['something happened'],
    do_not_promote: ['noise'],
    review_after_days: 7,
    stale_after_days: 30,
    review_required: false,
  };
}

const HEALTHY_RULES = {
  rules: {
    patterns: baseRule(),
    learnings: baseRule(),
    results: baseRule(),
    decisions: baseRule(),
    approvals: baseRule(),
    products: baseRule(),
    infra: baseRule(),
  },
  default_candidate_policy: {
    status: 'pending_review',
  },
};

const HEALTHY_PLAYBOOK = `# Ruflo Memory Promotion Rules

### \`patterns\`
### \`learnings\`
### \`results\`
### \`decisions\`
### \`approvals\`
### \`products\`
### \`infra\`
`;

test('auditNamespaceCoverage returns no findings when everything aligns', () => {
  const audit = auditNamespaceCoverage(HEALTHY_NAMESPACES, HEALTHY_RULES, HEALTHY_PLAYBOOK);
  assert.equal(audit.errorCount, 0);
  assert.equal(audit.warnCount, 0);
  assert.deepEqual(audit.namespaces.sort(), [
    'approvals', 'decisions', 'infra', 'learnings', 'patterns', 'products', 'results',
  ]);
});

test('auditNamespaceCoverage flags namespace missing from playbook', () => {
  const playbook = HEALTHY_PLAYBOOK.replace('### `infra`', '');
  const audit = auditNamespaceCoverage(HEALTHY_NAMESPACES, HEALTHY_RULES, playbook);
  assert.ok(audit.errorCount >= 1);
  assert.ok(audit.findings.some((finding) =>
    finding.code === 'namespace_missing_from_playbook' && finding.namespace === 'infra'));
});

test('auditNamespaceCoverage flags missing required rule fields', () => {
  const rules = { ...HEALTHY_RULES, rules: { ...HEALTHY_RULES.rules } };
  rules.rules.patterns = { ...baseRule(), promote_when: [] };
  const audit = auditNamespaceCoverage(HEALTHY_NAMESPACES, rules, HEALTHY_PLAYBOOK);
  assert.ok(audit.findings.some((finding) =>
    finding.code === 'rule_field_empty' && finding.namespace === 'patterns'));
});

test('auditNamespaceCoverage warns when review_after > stale_after', () => {
  const rules = { ...HEALTHY_RULES, rules: { ...HEALTHY_RULES.rules } };
  rules.rules.decisions = { ...baseRule(), review_after_days: 100, stale_after_days: 30 };
  const audit = auditNamespaceCoverage(HEALTHY_NAMESPACES, rules, HEALTHY_PLAYBOOK);
  assert.ok(audit.findings.some((finding) =>
    finding.code === 'review_after_greater_than_stale' && finding.namespace === 'decisions'));
  assert.equal(audit.warnCount >= 1, true);
});

test('auditNamespaceCoverage warns when default policy status is missing', () => {
  const rules = { ...HEALTHY_RULES, default_candidate_policy: {} };
  const audit = auditNamespaceCoverage(HEALTHY_NAMESPACES, rules, HEALTHY_PLAYBOOK);
  assert.ok(audit.findings.some((finding) => finding.code === 'default_policy_status_missing'));
});
