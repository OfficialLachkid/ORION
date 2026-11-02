import { filterPokemonSubjectsForPool } from '../shared/pokemon-subject-pools.mjs';

function normalizeSlug(value) {
  return String(value || '').trim().toLowerCase();
}

export function filterSubjectsForCryMatchPool(subjects = [], pool = {}) {
  return filterPokemonSubjectsForPool(subjects, pool?.selector || 'all');
}

function collapseDuplicateSubjects(subjects = []) {
  const seen = new Set();
  const unique = [];
  for (const subject of subjects) {
    const key = normalizeSlug(subject?.slug || subject?.name || subject?.id || subject?.sprite_path);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(subject);
  }
  return unique;
}

function ensurePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolvePoolVariants(template = {}) {
  const variants = Array.isArray(template?.selection_rules?.pool_variants)
    ? template.selection_rules.pool_variants
    : [];
  return variants
    .map((variant, index) => ({
      key: normalizeSlug(variant?.key || `pool-${index + 1}`),
      label: String(variant?.label || variant?.key || `Pool ${index + 1}`).trim(),
      selector: normalizeSlug(variant?.selector || variant?.key || 'all'),
      weight: Math.max(1, ensurePositiveInteger(variant?.weight, 1)),
    }))
    .filter((variant) => variant.key);
}

function selectWeightedPool(pools, random) {
  const totalWeight = pools.reduce((sum, pool) => sum + pool.weight, 0);
  let cursor = random() * totalWeight;
  for (const pool of pools) {
    cursor -= pool.weight;
    if (cursor <= 0) return pool;
  }
  return pools.at(-1) || null;
}

export function selectCryMatchRoundPools({
  eligibleSubjects,
  template,
  candidateCount,
  roundCount,
  random = Math.random,
}) {
  const configuredPools = resolvePoolVariants(template);
  const forcedPoolKey = normalizeSlug(
    template?.selection_rules?.force_pool_key
    || template?.selection_rules?.forced_pool_key,
  );
  const evaluatedPools = configuredPools.map((pool) => ({
    ...pool,
    subjects: collapseDuplicateSubjects(filterSubjectsForCryMatchPool(eligibleSubjects, pool)),
  }));

  if (forcedPoolKey) {
    const forcedPool = evaluatedPools.find((pool) => (
      pool.key === forcedPoolKey || pool.selector === forcedPoolKey
    ));
    if (!forcedPool) {
      throw new Error(`Cry Match pool override "${forcedPoolKey}" does not match a configured pool.`);
    }
    if (forcedPool.subjects.length < candidateCount) {
      throw new Error(
        `Cry Match pool override "${forcedPoolKey}" only has ${forcedPool.subjects.length} eligible Pokemon; ${candidateCount} required.`,
      );
    }
    return Array.from(
      { length: Math.max(1, ensurePositiveInteger(roundCount, 1)) },
      () => ({ ...forcedPool, forced: true }),
    );
  }

  const viablePools = evaluatedPools.filter((pool) => pool.subjects.length >= candidateCount);
  const fallbackPool = {
    key: 'mixed',
    label: 'Mixed Pokemon',
    selector: 'all',
    weight: 1,
    subjects: collapseDuplicateSubjects(eligibleSubjects),
    forced: false,
  };
  const pools = viablePools.length > 0 ? viablePools : [fallbackPool];
  const sequence = [];
  let remainingPools = [];
  const targetRoundCount = Math.max(1, ensurePositiveInteger(roundCount, 1));
  while (sequence.length < targetRoundCount) {
    if (remainingPools.length === 0) remainingPools = [...pools];
    const previousPoolKey = sequence.at(-1)?.key || '';
    const selectablePools = previousPoolKey && remainingPools.length > 1
      ? remainingPools.filter((pool) => pool.key !== previousPoolKey)
      : remainingPools;
    const selectedPool = selectWeightedPool(selectablePools, random) || fallbackPool;
    sequence.push({ ...selectedPool, forced: false });
    remainingPools = remainingPools.filter((pool) => pool.key !== selectedPool.key);
  }
  return sequence;
}

export function selectCryMatchSubjectPool(options) {
  return selectCryMatchRoundPools({ ...options, roundCount: 1 })[0];
}
