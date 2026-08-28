function normalizeTypeName(value) {
  return String(value || '').trim().toLowerCase();
}

const TYPE_CHART = Object.freeze({
  normal: Object.freeze({ rock: 0.5, ghost: 0, steel: 0.5 }),
  fire: Object.freeze({ fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 }),
  water: Object.freeze({ fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 }),
  electric: Object.freeze({ water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 }),
  grass: Object.freeze({ fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 }),
  ice: Object.freeze({ fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 }),
  fighting: Object.freeze({ normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 }),
  poison: Object.freeze({ grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 }),
  ground: Object.freeze({ fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 }),
  flying: Object.freeze({ electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 }),
  psychic: Object.freeze({ fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 }),
  bug: Object.freeze({ fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 }),
  rock: Object.freeze({ fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 }),
  ghost: Object.freeze({ normal: 0, psychic: 2, ghost: 2, dark: 0.5 }),
  dragon: Object.freeze({ dragon: 2, steel: 0.5, fairy: 0 }),
  dark: Object.freeze({ fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 }),
  steel: Object.freeze({ fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 }),
  fairy: Object.freeze({ fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }),
});

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeBaseStats(stats = {}) {
  return {
    hp: toFiniteNumber(stats.hp, 0),
    attack: toFiniteNumber(stats.attack, 0),
    defense: toFiniteNumber(stats.defense, 0),
    special_attack: toFiniteNumber(stats.special_attack, 0),
    special_defense: toFiniteNumber(stats.special_defense, 0),
    speed: toFiniteNumber(stats.speed, 0),
  };
}

export function sumBaseStats(stats = {}) {
  const normalized = normalizeBaseStats(stats);
  return normalized.hp
    + normalized.attack
    + normalized.defense
    + normalized.special_attack
    + normalized.special_defense
    + normalized.speed;
}

function typeMultiplierToScore(multiplier, weight) {
  if (multiplier === 0) {
    return -Math.abs(weight) * 2.2;
  }
  const logValue = Math.log2(Math.max(0.25, multiplier));
  return logValue * Math.abs(weight);
}

function resolveAttackTypeEffectiveness(attackingType, defendingTypes = []) {
  const normalizedAttackingType = normalizeTypeName(attackingType);
  const chart = TYPE_CHART[normalizedAttackingType] || {};
  return (Array.isArray(defendingTypes) ? defendingTypes : [])
    .map((type) => normalizeTypeName(type))
    .filter(Boolean)
    .reduce((multiplier, defendingType) => multiplier * (chart[defendingType] ?? 1), 1);
}

export function resolveBestTypeAttack(types = [], defendingTypes = []) {
  const normalizedTypes = (Array.isArray(types) ? types : [])
    .map((type) => normalizeTypeName(type))
    .filter(Boolean);
  const best = normalizedTypes.reduce((currentBest, attackingType) => {
    const multiplier = resolveAttackTypeEffectiveness(attackingType, defendingTypes);
    if (!currentBest || multiplier > currentBest.multiplier) {
      return { attacking_type: attackingType, multiplier };
    }
    return currentBest;
  }, null);
  return best || {
    attacking_type: normalizedTypes[0] || '',
    multiplier: 1,
  };
}

function resolveContributionRanking({ left, right }) {
  const contributions = [
    {
      id: 'type',
      delta: Math.abs((left.type_score || 0) - (right.type_score || 0)),
    },
    {
      id: 'speed',
      delta: Math.abs((left.speed_score || 0) - (right.speed_score || 0)),
    },
    {
      id: 'stats',
      delta: Math.abs((left.stat_score || 0) - (right.stat_score || 0)),
    },
  ];
  return contributions.sort((a, b) => b.delta - a.delta);
}

function resolveInsightText(winner, loser, scoreCards) {
  const ranking = resolveContributionRanking(scoreCards);
  const dominantFactor = ranking[0]?.id || 'stats';
  const winnerCard = scoreCards?.winner || {};
  const loserCard = scoreCards?.loser || {};
  if (dominantFactor === 'type' && (winnerCard.type_attack?.multiplier || 1) > (loserCard.type_attack?.multiplier || 1)) {
    return `${winner.display_name} has the type edge.`;
  }
  if (dominantFactor === 'speed' && winner.base_stats.speed !== loser.base_stats.speed) {
    return `${winner.display_name} is faster.`;
  }
  return `${winner.display_name} has the stronger stat line.`;
}

function resolveBreakdownText(left, right, winner, scoreCards) {
  const leftMultiplier = scoreCards?.left?.type_attack?.multiplier || 1;
  const rightMultiplier = scoreCards?.right?.type_attack?.multiplier || 1;
  const typeLead = leftMultiplier === rightMultiplier
    ? 'Type edge: even'
    : `Type edge: ${(leftMultiplier > rightMultiplier ? left : right).display_name}`;
  return `BST ${left.base_stat_total}-${right.base_stat_total} | ${typeLead} | Winner: ${winner.display_name}`;
}

function buildScoreCard(subject, opponent, weights, randomFn) {
  const normalizedWeights = {
    base_stat_total: toFiniteNumber(weights?.base_stat_total, 0.06),
    hp: toFiniteNumber(weights?.hp, 0.18),
    attack: toFiniteNumber(weights?.attack, 0.24),
    defense: toFiniteNumber(weights?.defense, 0.19),
    special_attack: toFiniteNumber(weights?.special_attack, 0.23),
    special_defense: toFiniteNumber(weights?.special_defense, 0.19),
    speed: toFiniteNumber(weights?.speed, 0.25),
    type_advantage: toFiniteNumber(weights?.type_advantage, 20),
    speed_edge: toFiniteNumber(weights?.speed_edge, 0.42),
    random_spread: toFiniteNumber(weights?.random_spread, 18),
  };
  const typeAttack = resolveBestTypeAttack(subject.types, opponent.types);
  const statScore = (
    (subject.base_stat_total * normalizedWeights.base_stat_total)
    + (subject.base_stats.hp * normalizedWeights.hp)
    + (subject.base_stats.attack * normalizedWeights.attack)
    + (subject.base_stats.defense * normalizedWeights.defense)
    + (subject.base_stats.special_attack * normalizedWeights.special_attack)
    + (subject.base_stats.special_defense * normalizedWeights.special_defense)
    + (subject.base_stats.speed * normalizedWeights.speed)
  );
  const typeScore = typeMultiplierToScore(typeAttack.multiplier, normalizedWeights.type_advantage);
  const speedScore = Math.max(
    -12,
    Math.min(12, (subject.base_stats.speed - opponent.base_stats.speed) * normalizedWeights.speed_edge),
  );
  const randomScore = ((randomFn() * 2) - 1) * normalizedWeights.random_spread;
  return {
    stat_score: Number(statScore.toFixed(3)),
    type_score: Number(typeScore.toFixed(3)),
    speed_score: Number(speedScore.toFixed(3)),
    random_score: Number(randomScore.toFixed(3)),
    total_score: Number((statScore + typeScore + speedScore + randomScore).toFixed(3)),
    type_attack: typeAttack,
  };
}

export function resolveTournamentBattle({
  left,
  right,
  weights = {},
  random = Math.random,
  matchId = '',
  roundLabel = '',
}) {
  const leftCard = buildScoreCard(left, right, weights, random);
  const rightCard = buildScoreCard(right, left, weights, random);
  const winner = leftCard.total_score === rightCard.total_score
    ? (left.base_stat_total >= right.base_stat_total ? left : right)
    : (leftCard.total_score > rightCard.total_score ? left : right);
  const loser = winner.id === left.id ? right : left;
  const winnerCard = winner.id === left.id ? leftCard : rightCard;
  const loserCard = winner.id === left.id ? rightCard : leftCard;
  const scoreCards = {
    left: leftCard,
    right: rightCard,
    winner: winnerCard,
    loser: loserCard,
  };
  const insightText = resolveInsightText(winner, loser, scoreCards);
  const commentaryText = `${left.display_name} versus ${right.display_name}. ${insightText}`;
  return {
    match_id: matchId,
    round_label: roundLabel,
    left,
    right,
    winner,
    loser,
    winner_side: winner.id === left.id ? 'left' : 'right',
    insight_text: insightText,
    breakdown_text: resolveBreakdownText(left, right, winner, scoreCards),
    commentary_text: commentaryText,
    winner_line_text: `${winner.display_name} wins!`,
    score_cards: scoreCards,
  };
}
