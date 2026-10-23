import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceReport } from '../src/analyzer.mjs';

function row(runId, observedAt, rank, suffix = 'weapon') {
  return {
    run_id: runId,
    observation_id: `${rank}1111111-1111-4111-8111-111111111111`.slice(0, 36),
    view_id: 'top-sellers-pixel-art',
    signal: 'marketplace_rank_proxy',
    listing_url: `https://maker.itch.io/${suffix}`,
    title: suffix,
    creator: 'maker',
    price_text: '$4.99',
    observed_at: observedAt,
    rank,
  };
}

test('keeps a first snapshot in monitoring without a model recommendation gate', () => {
  const report = buildEvidenceReport([row('run-1', '2026-10-16T10:00:00.000Z', 2)], 2);
  assert.equal(report.status, 'monitoring');
  assert.equal(report.snapshot_count, 1);
});

test('exposes transparent rank movement after two snapshots', () => {
  const report = buildEvidenceReport([
    row('run-2', '2026-10-16T10:00:00.000Z', 2),
    row('run-1', '2026-10-15T10:00:00.000Z', 5),
  ], 2);
  assert.equal(report.status, 'eligible_for_local_analysis');
  assert.equal(report.minimum_snapshots, 2);
  assert.equal(report.evidence[0].rank_change, 3);
  assert.match(report.limitations[0], /proxy/u);
});
