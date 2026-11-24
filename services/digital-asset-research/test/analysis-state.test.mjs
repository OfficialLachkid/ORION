import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  persistResearchAnalysisState,
  researchEvidenceFingerprint,
} from '../src/analysis-state.mjs';

function report() {
  return {
    status: 'monitoring',
    evidence_cluster: { concept: 'effect', listing_count: 2, creator_count: 2 },
    evidence: [
      {
        listing_url: 'https://one.itch.io/magic-effects', view_id: 'top-sellers',
        title: 'Magic Effects', creator: 'One', current_rank: 2, previous_rank: 4,
      },
      {
        listing_url: 'https://two.itch.io/combat-effects', view_id: 'newest',
        title: 'Combat Effects', creator: 'Two', current_rank: 3, previous_rank: null,
      },
    ],
  };
}

test('evidence fingerprint is stable across input ordering', () => {
  const first = report();
  const second = { ...first, evidence: [...first.evidence].reverse() };
  assert.equal(researchEvidenceFingerprint(first), researchEvidenceFingerprint(second));
});

test('persists exact quality failure locally and coalesces duplicate results', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'orion-research-analysis-'));
  const first = await persistResearchAnalysisState({
    archiveRoot: root,
    observedAt: '2026-11-24T01:30:00.000Z',
    report: report(),
    analysisIssue: 'Exact semantic quality failure.',
    recommendation: null,
  });
  const second = await persistResearchAnalysisState({
    archiveRoot: root,
    observedAt: '2026-11-25T01:30:00.000Z',
    report: report(),
    analysisIssue: 'Exact semantic quality failure.',
    recommendation: null,
  });
  const stored = JSON.parse(await readFile(second.path, 'utf8'));
  const files = await readdir(resolve(root, 'analysis'));
  assert.equal(first.duplicate_of_previous, false);
  assert.equal(second.duplicate_of_previous, true);
  assert.equal(stored.analysis_issue, 'Exact semantic quality failure.');
  assert.equal(stored.occurrence_count, 2);
  assert.equal(files.filter((name) => name !== 'latest.json').length, 1);
});
