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
