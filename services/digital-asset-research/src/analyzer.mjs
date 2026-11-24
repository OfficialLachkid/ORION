function byRun(observations) {
  const groups = new Map();
  for (const row of observations) {
    if (!groups.has(row.run_id)) groups.set(row.run_id, []);
    groups.get(row.run_id).push(row);
  }
  return [...groups.values()].sort((left, right) => (
    Date.parse(right[0]?.observed_at || 0) - Date.parse(left[0]?.observed_at || 0)
  ));
}

function compactEvidence(row, previous) {
  const prior = previous.find((candidate) => (
    candidate.view_id === row.view_id && candidate.listing_url === row.listing_url
  ));
  return {
    observation_id: row.observation_id,
    view_id: row.view_id,
    signal: row.signal,
    title: row.title,
    creator: row.creator,
    price_text: row.price_text,
    listing_url: row.listing_url,
    observed_at: row.observed_at,
    current_rank: row.rank,
    previous_rank: prior?.rank || null,
    rank_change: prior ? prior.rank - row.rank : null,
  };
}

const GENERIC_CONCEPT_WORDS = new Set([
  'asset', 'assets', 'game', 'games', 'pack', 'packs', 'pixel', 'pixels',
  'sprite', 'sprites', 'art', 'with', 'from', 'your', 'free', 'paid',
]);

function conceptTokens(value) {
  return [...new Set((String(value || '').toLowerCase().match(/[a-z0-9]+/gu) || [])
    .filter((word) => word.length >= 4 && !GENERIC_CONCEPT_WORDS.has(word))
    .map((word) => (word.endsWith('s') && word.length > 5 ? word.slice(0, -1) : word)))];
}

function clusterScore(rows) {
  const creators = new Set(rows.map((row) => row.creator).filter(Boolean)).size;
  const persisted = rows.filter((row) => row.previous_rank !== null).length;
  const demandRows = rows.filter((row) => row.signal === 'marketplace_rank_proxy').length;
  const rankScore = rows.reduce((total, row) => total + Math.max(0, 101 - row.current_rank), 0);
  return (creators * 10_000) + (persisted * 1_000) + (demandRows * 100) + rankScore;
}

export function selectCoherentEvidenceCluster(report, maximumRows = 12) {
  if (report.status !== 'eligible_for_local_analysis') return null;
  const clusters = new Map();
  for (const row of report.evidence || []) {
    for (const token of conceptTokens(row.title)) {
      if (!clusters.has(token)) clusters.set(token, []);
      clusters.get(token).push(row);
    }
  }
  const candidates = [...clusters.entries()]
    .map(([concept, rows]) => ({
      concept,
      rows,
      creatorCount: new Set(rows.map((row) => row.creator).filter(Boolean)).size,
    }))
    .filter((cluster) => cluster.rows.length >= 2 && cluster.creatorCount >= 2)
    .sort((left, right) => clusterScore(right.rows) - clusterScore(left.rows)
      || left.concept.localeCompare(right.concept));
  if (!candidates.length) return null;
  const selected = candidates[0];
  return {
    ...report,
    evidence: selected.rows
      .sort((left, right) => Number(right.previous_rank !== null) - Number(left.previous_rank !== null)
        || left.current_rank - right.current_rank)
      .slice(0, maximumRows),
    evidence_cluster: {
      concept: selected.concept,
      listing_count: selected.rows.length,
      creator_count: selected.creatorCount,
      source_evidence_count: report.evidence.length,
    },
  };
}

export function buildEvidenceReport(observations, minimumSnapshots = 2) {
  const runs = byRun(observations);
  if (runs.length < minimumSnapshots) {
    return {
      status: 'monitoring',
      snapshot_count: runs.length,
      minimum_snapshots: minimumSnapshots,
      reason: 'A trend recommendation requires at least two comparable snapshots.',
      evidence: (runs[0] || []).slice(0, 10).map((row) => compactEvidence(row, [])),
    };
  }
  const current = runs[0];
  const previous = runs[1];
  const comparable = current.map((row) => compactEvidence(row, previous));
  const persisted = comparable.filter((row) => row.previous_rank !== null);
  return {
    status: 'eligible_for_local_analysis',
    snapshot_count: runs.length,
    minimum_snapshots: minimumSnapshots,
    compared_runs: [current[0].run_id, previous[0].run_id],
    limitations: [
      'Marketplace rank is a demand proxy, not a sales or download count.',
      'Newest listings measure visible supply activity only.',
      'A recommendation must cite supplied observation IDs.',
    ],
    evidence: comparable
      .sort((left, right) => {
        const persistedDifference = Number(right.previous_rank !== null) - Number(left.previous_rank !== null);
        return persistedDifference || left.current_rank - right.current_rank;
      })
      .slice(0, 30),
    persisted_listing_count: persisted.length,
  };
}
