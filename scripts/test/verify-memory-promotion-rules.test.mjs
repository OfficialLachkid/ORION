import test from 'node:test';
import assert from 'node:assert/strict';
import { runMemoryPromotionAudit } from '../verify-memory-promotion-rules.mjs';
import { loadRuntimeConfig } from '../../services/lib/runtime-config.mjs';

test('runMemoryPromotionAudit succeeds against the repo playbook, namespaces, and rules', () => {
  const config = loadRuntimeConfig();
  const report = runMemoryPromotionAudit(config);
  assert.notEqual(report.state, 'blocked', `unexpected blocked state: ${JSON.stringify(report.audit.findings, null, 2)}`);
  assert.notEqual(report.playbookPath, '');
});
