const REQUIRED_NAMESPACES = ['patterns', 'learnings', 'results', 'decisions', 'approvals', 'products', 'infra'];
const REQUIRED_RULE_FIELDS = [
  'capture_mode',
  'freshness_rule',
  'promote_when',
  'do_not_promote',
];

function normalizeString(value) {
  return String(value || '').trim();
}

export function auditNamespaceCoverage(namespacesConfig, promotionRulesConfig, playbookText) {
  const namespaceEntries = namespacesConfig?.namespaces || {};
  const ruleEntries = promotionRulesConfig?.rules || {};
  const findings = [];
  const combinedNamespaceNames = new Set([
    ...REQUIRED_NAMESPACES,
    ...Object.keys(namespaceEntries),
    ...Object.keys(ruleEntries),
  ]);

  const playbook = String(playbookText || '');
  const sectionHeadings = new Map();
  const headingPattern = /^###\s+`?([a-zA-Z_]+)`?\s*$/gmu;
  let match = headingPattern.exec(playbook);
  while (match) {
    sectionHeadings.set(match[1].toLowerCase(), true);
    match = headingPattern.exec(playbook);
  }

  for (const namespace of combinedNamespaceNames) {
    const missingInNamespaces = !namespaceEntries[namespace];
    const missingInRules = !ruleEntries[namespace];
    const missingInPlaybook = !sectionHeadings.has(namespace.toLowerCase());

    if (missingInNamespaces) {
      findings.push({
        namespace,
        level: 'error',
        code: 'namespace_missing_from_namespaces_config',
        detail: `namespace '${namespace}' is not defined in memory-namespaces.json`,
      });
    }
    if (missingInRules) {
      findings.push({
        namespace,
        level: 'error',
        code: 'namespace_missing_from_promotion_rules',
        detail: `namespace '${namespace}' is not defined in memory-promotion-rules.json`,
      });
    }
    if (missingInPlaybook) {
      findings.push({
        namespace,
        level: 'error',
        code: 'namespace_missing_from_playbook',
        detail: `namespace '${namespace}' does not have a section heading in Ruflo_Memory_Promotion_Rules.md`,
      });
    }
  }

  for (const [namespace, ruleConfig] of Object.entries(ruleEntries)) {
    for (const field of REQUIRED_RULE_FIELDS) {
      const value = ruleConfig?.[field];
      const empty = value === undefined
        || value === null
        || (typeof value === 'string' && normalizeString(value).length === 0)
        || (Array.isArray(value) && value.length === 0);
      if (empty) {
        findings.push({
          namespace,
          level: 'error',
          code: 'rule_field_empty',
          detail: `namespace '${namespace}' is missing required rule field '${field}'`,
        });
      }
    }

    const reviewAfter = Number(ruleConfig?.review_after_days ?? -1);
    const staleAfter = Number(ruleConfig?.stale_after_days ?? -1);
    if (!Number.isFinite(reviewAfter) || reviewAfter < 0) {
      findings.push({
        namespace,
        level: 'error',
        code: 'review_after_days_invalid',
        detail: `namespace '${namespace}' has invalid review_after_days: ${ruleConfig?.review_after_days}`,
      });
    }
    if (!Number.isFinite(staleAfter) || staleAfter < 0) {
      findings.push({
        namespace,
        level: 'error',
        code: 'stale_after_days_invalid',
        detail: `namespace '${namespace}' has invalid stale_after_days: ${ruleConfig?.stale_after_days}`,
      });
    }
    if (Number.isFinite(reviewAfter) && Number.isFinite(staleAfter) && staleAfter > 0 && reviewAfter > staleAfter) {
      findings.push({
        namespace,
        level: 'warn',
        code: 'review_after_greater_than_stale',
        detail: `namespace '${namespace}' has review_after_days (${reviewAfter}) greater than stale_after_days (${staleAfter}); review should trigger before staleness.`,
      });
    }
  }

  const defaultPolicy = promotionRulesConfig?.default_candidate_policy || {};
  if (!defaultPolicy.status) {
    findings.push({
      namespace: '_default_candidate_policy',
      level: 'warn',
      code: 'default_policy_status_missing',
      detail: 'default_candidate_policy.status is not set',
    });
  }

  return {
    namespaces: [...combinedNamespaceNames].sort(),
    findings,
    errorCount: findings.filter((finding) => finding.level === 'error').length,
    warnCount: findings.filter((finding) => finding.level === 'warn').length,
  };
}

export function summarizeAudit(audit) {
  const lines = [];
  lines.push(`namespaces: ${audit.namespaces.length}`);
  lines.push(`errors: ${audit.errorCount}`);
  lines.push(`warnings: ${audit.warnCount}`);
  for (const finding of audit.findings) {
    lines.push(`[${finding.level.toUpperCase()}] ${finding.namespace} ${finding.code}: ${finding.detail}`);
  }
  return lines;
}
