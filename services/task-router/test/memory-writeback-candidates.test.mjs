import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRuntimeConfig } from '../../lib/runtime-config.mjs';
import {
  buildApprovalOutcomeWriteBackCandidates,
  buildExecutionWriteBackCandidates,
  buildTaskWriteBackCandidates,
} from '../../lib/memory-writeback-candidates.mjs';

test('buildTaskWriteBackCandidates applies freshness metadata from promotion rules', () => {
  const config = loadRuntimeConfig();
  const candidates = buildTaskWriteBackCandidates({
    task_id: 'TASK-MEM-1',
    source_type: 'discord_text_command',
    summary: 'Check current launch agents health on the Mac mini.',
    approval_required: true,
    approval_reason: 'production_change: runtime verification',
    domain: 'infra',
    submitted_at: '2026-07-10T10:00:00.000Z',
  }, config.memoryPromotionRules);

  const infraCandidate = candidates.find((candidate) => candidate.namespace === 'infra');
  assert.equal(candidates.some((candidate) => candidate.namespace === 'approvals'), true);
  assert.equal(infraCandidate?.reviewAfterDays, 14);
  assert.equal(infraCandidate?.staleAfterDays, 60);
  assert.match(infraCandidate?.freshnessRule || '', /host changes|reboots|runtime upgrades/u);
});

test('buildApprovalOutcomeWriteBackCandidates captures approval audit outcomes', () => {
  const config = loadRuntimeConfig();
  const candidates = buildApprovalOutcomeWriteBackCandidates({
    task_id: 'TASK-MEM-2',
  }, {
    decision: 'approve',
    actor: 'Lachkid',
    reason: 'Safe to continue.',
  }, config.memoryPromotionRules);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].namespace, 'approvals');
  assert.equal(candidates[0].status, 'ready_to_write');
  assert.match(candidates[0].summary, /Lachkid/u);
});

test('buildExecutionWriteBackCandidates captures blocked learnings and infra follow-up', () => {
  const config = loadRuntimeConfig();
  const candidates = buildExecutionWriteBackCandidates({
    task_id: 'TASK-MEM-3',
    domain: 'infra',
  }, {
    outcome: 'completed',
    executionResult: {
      report: {
        state: 'blocked',
        summary: 'Claude CLI is installed but not logged in for the Agent runtime user.',
      },
    },
  }, config.memoryPromotionRules);

  assert.equal(candidates.some((candidate) => candidate.namespace === 'results'), true);
  assert.equal(candidates.some((candidate) => candidate.namespace === 'learnings'), true);
  assert.equal(candidates.some((candidate) => candidate.namespace === 'infra'), true);
});
