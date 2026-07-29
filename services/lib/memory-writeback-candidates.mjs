function normalizeText(value) {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

function asPositiveInteger(value, fallbackValue = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallbackValue;
  }

  return parsed;
}

function addDays(isoTimestamp, days) {
  if (!isoTimestamp || !days) {
    return '';
  }

  const base = new Date(isoTimestamp);
  if (Number.isNaN(base.getTime())) {
    return '';
  }

  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString();
}

function getRuleConfig(namespace, promotionRules = {}) {
  return promotionRules?.rules?.[namespace] || {};
}

function getDefaultCandidatePolicy(promotionRules = {}) {
  return promotionRules?.default_candidate_policy || {};
}

function buildCandidate(namespace, type, summary, promotionRules, options = {}) {
  const defaults = getDefaultCandidatePolicy(promotionRules);
  const namespaceRule = getRuleConfig(namespace, promotionRules);
  const referenceTimestamp = options.referenceTimestamp || new Date().toISOString();
  const reviewAfterDays = asPositiveInteger(
    options.reviewAfterDays ?? namespaceRule.review_after_days,
    asPositiveInteger(defaults.review_after_days, 0)
  );
  const staleAfterDays = asPositiveInteger(
    options.staleAfterDays ?? namespaceRule.stale_after_days,
    asPositiveInteger(defaults.stale_after_days, 0)
  );

  return {
    namespace,
    type,
    status: options.status || defaults.status || 'pending_review',
    requiresResultInspection: options.requiresResultInspection ?? (defaults.requires_result_inspection !== false),
    reviewRequired: options.reviewRequired ?? (namespaceRule.review_required === true),
    captureMode: namespaceRule.capture_mode || 'manual_review',
    freshnessRule: namespaceRule.freshness_rule || '',
    reviewAfterDays,
    staleAfterDays,
    reviewByUtc: addDays(referenceTimestamp, reviewAfterDays),
    staleByUtc: addDays(referenceTimestamp, staleAfterDays),
    summary: normalizeText(summary),
    promoteWhen: namespaceRule.promote_when || [],
    doNotPromote: namespaceRule.do_not_promote || [],
  };
}

export function buildTaskWriteBackCandidates(task, promotionRules) {
  const referenceTimestamp = task?.submitted_at || new Date().toISOString();
  const candidates = [
    buildCandidate(
      'results',
      'normalized_task_summary',
      `Normalized ${task.source_type} task ${task.task_id}: ${task.summary}`,
      promotionRules,
      {
        referenceTimestamp,
      }
    ),
  ];

  if (task?.approval_required) {
    candidates.push(
      buildCandidate(
        'approvals',
        'approval_request',
        `Approval required for ${task.task_id}: ${task.approval_reason}`,
        promotionRules,
        {
          referenceTimestamp,
          status: 'awaiting_outcome',
          requiresResultInspection: false,
        }
      )
    );
  }

  if (task?.domain === 'infra') {
    candidates.push(
      buildCandidate(
        'infra',
        'infra_change_candidate',
        `Infra-affecting task detected for ${task.task_id}: ${task.summary}`,
        promotionRules,
        {
          referenceTimestamp,
          requiresResultInspection: true,
        }
      )
    );
  }

  return candidates;
}

export function buildApprovalOutcomeWriteBackCandidates(task, decision, promotionRules) {
  if (!task?.task_id || !decision?.decision) {
    return [];
  }

  const actor = normalizeText(decision.actor || task.approved_by || '');
  const reason = normalizeText(decision.reason || '');
  const actorFragment = actor ? ` by ${actor}` : '';
  const reasonFragment = reason ? ` Reason: ${reason}` : '';

  return [
    buildCandidate(
      'approvals',
      'approval_outcome',
      `Approval ${decision.decision} recorded for ${task.task_id}${actorFragment}.${reasonFragment}`.trim(),
      promotionRules,
      {
        referenceTimestamp: new Date().toISOString(),
        status: 'ready_to_write',
        requiresResultInspection: false,
      }
    ),
  ];
}

export function buildExecutionWriteBackCandidates(task, execution, promotionRules) {
  if (!task?.task_id) {
    return [];
  }

  const report = execution?.executionResult?.report || execution?.report || {};
  const state = normalizeText(report.state || execution?.outcome || 'unknown').toLowerCase();
  const summary = normalizeText(report.summary || execution?.error?.message || `${task.task_id} finished with state ${state || 'unknown'}.`);
  const referenceTimestamp = new Date().toISOString();
  const candidates = [
    buildCandidate(
      'results',
      'execution_result_summary',
      `${task.task_id} ${state || 'completed'}: ${summary}`,
      promotionRules,
      {
        referenceTimestamp,
        requiresResultInspection: false,
        status: 'ready_to_write',
      }
    ),
  ];

  if (state === 'blocked' || state === 'paused' || execution?.outcome === 'failed') {
    candidates.push(
      buildCandidate(
        'learnings',
        state === 'paused' ? 'execution_offboarding_checkpoint' : 'execution_blocker_learning',
        `${task.task_id} ${state || 'blocked'}: ${summary}`,
        promotionRules,
        {
          referenceTimestamp,
          requiresResultInspection: true,
        }
      )
    );
  }

  if (task?.domain === 'infra') {
    candidates.push(
      buildCandidate(
        'infra',
        state === 'completed' ? 'infra_runtime_verified' : 'infra_runtime_followup',
        `${task.task_id} ${state || 'completed'} in infra flow: ${summary}`,
        promotionRules,
        {
          referenceTimestamp,
          requiresResultInspection: state !== 'completed',
          status: state === 'completed' ? 'ready_to_write' : 'pending_review',
        }
      )
    );
  }

  return candidates;
}
