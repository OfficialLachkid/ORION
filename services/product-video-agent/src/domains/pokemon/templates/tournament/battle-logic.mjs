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

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundScore(value) {
  return Number(value.toFixed(3));
}

function normalizeBattleWeights(weights = {}) {
  return {
    base_stat_total: toFiniteNumber(weights?.base_stat_total, 0.06),
    offensive_matchup: toFiniteNumber(weights?.offensive_matchup, 0.11),
    defense_bulk: toFiniteNumber(weights?.defense_bulk, 0.07),
    type_advantage: toFiniteNumber(weights?.type_advantage, 20),
    speed_edge: toFiniteNumber(weights?.speed_edge, 0.42),
    random_spread: clampNumber(toFiniteNumber(weights?.random_spread, 4), 0, 6),
    meaningful_base_stat_total_delta: toFiniteNumber(weights?.meaningful_base_stat_total_delta, 25),
    meaningful_speed_delta: toFiniteNumber(weights?.meaningful_speed_delta, 10),
    meaningful_offense_delta: toFiniteNumber(weights?.meaningful_offense_delta, 18),
    meaningful_defense_delta: toFiniteNumber(weights?.meaningful_defense_delta, 22),
    close_battle_threshold: toFiniteNumber(weights?.close_battle_threshold, 5),
  };
}

function normalizeSubject(subject = {}) {
  const baseStats = normalizeBaseStats(subject.base_stats || subject.metadata?.base_stats || {});
  return {
    ...subject,
    display_name: String(subject.display_name || subject.name || subject.id || 'Pokemon').trim(),
    types: (Array.isArray(subject.types) ? subject.types : [])
      .map((type) => normalizeTypeName(type))
      .filter(Boolean),
    base_stats: baseStats,
    base_stat_total: toFiniteNumber(subject.base_stat_total, sumBaseStats(baseStats)),
  };
}

function resolveBulkScore(stats) {
  return (stats.hp * 0.5) + (stats.defense * 0.25) + (stats.special_defense * 0.25);
}

function resolveOffenseProfile(subject, opponent) {
  const physicalDelta = subject.base_stats.attack - opponent.base_stats.defense;
  const specialDelta = subject.base_stats.special_attack - opponent.base_stats.special_defense;
  const useSpecial = specialDelta > physicalDelta;
  return {
    mode: useSpecial ? 'special' : 'physical',
    best_delta: useSpecial ? specialDelta : physicalDelta,
    physical_delta: physicalDelta,
    special_delta: specialDelta,
  };
}

function resolveDefenseProfile(subject, opponent) {
  const subjectBulk = resolveBulkScore(subject.base_stats);
  const opponentBulk = resolveBulkScore(opponent.base_stats);
  return {
    bulk: roundScore(subjectBulk),
    bulk_delta: roundScore(subjectBulk - opponentBulk),
    defense_average: roundScore((subject.base_stats.defense + subject.base_stats.special_defense) / 2),
    defense_average_delta: roundScore(
      ((subject.base_stats.defense + subject.base_stats.special_defense)
        - (opponent.base_stats.defense + opponent.base_stats.special_defense)) / 2,
    ),
  };
}

function buildScoreCard(subject, opponent, normalizedWeights, randomScore) {
  const typeAttack = resolveBestTypeAttack(subject.types, opponent.types);
  const offenseProfile = resolveOffenseProfile(subject, opponent);
  const defenseProfile = resolveDefenseProfile(subject, opponent);
  const baseStatTotalDelta = subject.base_stat_total - opponent.base_stat_total;
  const speedDelta = subject.base_stats.speed - opponent.base_stats.speed;
  const speedScale = Math.abs(speedDelta) >= normalizedWeights.meaningful_speed_delta ? 1 : 0.2;
  const statScore = clampNumber(baseStatTotalDelta * normalizedWeights.base_stat_total, -14, 14);
  const typeScore = typeMultiplierToScore(typeAttack.multiplier, normalizedWeights.type_advantage);
  const offenseScore = clampNumber(offenseProfile.best_delta * normalizedWeights.offensive_matchup, -10, 14);
  const defenseScore = clampNumber(defenseProfile.bulk_delta * normalizedWeights.defense_bulk, -8, 10);
  const speedScore = clampNumber(speedDelta * normalizedWeights.speed_edge * speedScale, -12, 12);
  return {
    stat_score: roundScore(statScore),
    type_score: roundScore(typeScore),
    offense_score: roundScore(offenseScore),
    defense_score: roundScore(defenseScore),
    speed_score: roundScore(speedScore),
    random_score: roundScore(randomScore),
    total_score: roundScore(statScore + typeScore + offenseScore + defenseScore + speedScore + randomScore),
    type_attack: typeAttack,
    offense_profile: offenseProfile,
    defense_profile: defenseProfile,
    base_stat_total_delta: roundScore(baseStatTotalDelta),
    speed_delta: roundScore(speedDelta),
  };
}

function addAdvantage(advantages, advantage) {
  if (!advantage || !Number.isFinite(advantage.strength) || advantage.strength <= 0) {
    return;
  }
  advantages.push({
    ...advantage,
    strength: roundScore(advantage.strength),
    verified: true,
  });
}

function resolveVerifiedAdvantages(subject, opponent, subjectCard, opponentCard, normalizedWeights, scoreDelta) {
  const advantages = [];
  const typeScoreDelta = subjectCard.type_score - opponentCard.type_score;
  if (
    typeScoreDelta >= 8
    && subjectCard.type_attack.multiplier > opponentCard.type_attack.multiplier
    && subjectCard.type_attack.multiplier >= 2
  ) {
    addAdvantage(advantages, {
      id: 'type_advantage',
      label: 'type advantage',
      text: `${subject.display_name} has the type advantage.`,
      strength: 100 + typeScoreDelta,
      evidence: {
        winner_multiplier: subjectCard.type_attack.multiplier,
        loser_multiplier: opponentCard.type_attack.multiplier,
      },
    });
  }

  const offenseGap = subjectCard.offense_profile.best_delta - opponentCard.offense_profile.best_delta;
  if (
    subjectCard.offense_profile.best_delta >= normalizedWeights.meaningful_offense_delta
    && offenseGap >= 8
  ) {
    const label = subjectCard.offense_profile.mode === 'special' ? 'Special Attack' : 'Attack';
    addAdvantage(advantages, {
      id: subjectCard.offense_profile.mode === 'special' ? 'special_attack_edge' : 'attack_edge',
      label,
      text: `${subject.display_name} has stronger ${label}.`,
      strength: 70 + Math.min(40, offenseGap),
      evidence: {
        best_offense_delta: subjectCard.offense_profile.best_delta,
        opponent_best_offense_delta: opponentCard.offense_profile.best_delta,
      },
    });
  }

  if (subject.base_stats.speed - opponent.base_stats.speed >= normalizedWeights.meaningful_speed_delta) {
    addAdvantage(advantages, {
      id: 'speed_edge',
      label: 'speed',
      text: `${subject.display_name} is faster.`,
      strength: 58 + Math.min(36, subject.base_stats.speed - opponent.base_stats.speed),
      evidence: {
        winner_speed: subject.base_stats.speed,
        loser_speed: opponent.base_stats.speed,
      },
    });
  }

  if (subjectCard.defense_profile.defense_average_delta >= normalizedWeights.meaningful_defense_delta) {
    addAdvantage(advantages, {
      id: 'defense_edge',
      label: 'defense',
      text: `${subject.display_name} has stronger defenses.`,
      strength: 50 + Math.min(28, subjectCard.defense_profile.defense_average_delta),
      evidence: {
        defense_average_delta: subjectCard.defense_profile.defense_average_delta,
      },
    });
  }

  if (subject.base_stat_total - opponent.base_stat_total >= normalizedWeights.meaningful_base_stat_total_delta) {
    addAdvantage(advantages, {
      id: 'overall_stats',
      label: 'overall stats',
      text: `${subject.display_name} has stronger overall stats.`,
      strength: 46 + Math.min(30, (subject.base_stat_total - opponent.base_stat_total) / 3),
      evidence: {
        winner_bst: subject.base_stat_total,
        loser_bst: opponent.base_stat_total,
      },
    });
  }

  if (!advantages.length || scoreDelta <= normalizedWeights.close_battle_threshold) {
    addAdvantage(advantages, {
      id: 'close_battle',
      label: 'close battle',
      text: `${subject.display_name} narrowly takes the matchup.`,
      strength: Math.max(
        1,
        normalizedWeights.close_battle_threshold - Math.min(scoreDelta, normalizedWeights.close_battle_threshold),
      ) + 1,
      evidence: {
        score_delta: roundScore(scoreDelta),
      },
    });
  }

  return advantages.sort((a, b) => b.strength - a.strength);
}

function resolveSelectedAdvantage(winner, loser, scoreCards, normalizedWeights) {
  const winnerCard = scoreCards.winner;
  const loserCard = scoreCards.loser;
  const scoreDelta = Math.max(0, winnerCard.total_score - loserCard.total_score);
  const advantages = resolveVerifiedAdvantages(winner, loser, winnerCard, loserCard, normalizedWeights, scoreDelta);
  const strongAdvantage = advantages.find((advantage) => (
    advantage.id !== 'close_battle'
    && advantage.strength >= 50
    && scoreDelta > normalizedWeights.close_battle_threshold
  ));
  return strongAdvantage || advantages[0] || {
    id: 'close_battle',
    label: 'close battle',
    text: `${winner.display_name} narrowly takes the matchup.`,
    strength: 1,
    verified: true,
    evidence: {
      score_delta: roundScore(scoreDelta),
    },
  };
}

function resolveBreakdownText(left, right, winner, scoreCards, selectedAdvantage) {
  const leftMultiplier = scoreCards?.left?.type_attack?.multiplier || 1;
  const rightMultiplier = scoreCards?.right?.type_attack?.multiplier || 1;
  const typeLead = leftMultiplier === rightMultiplier
    ? 'Type advantage: even'
    : `Type advantage: ${(leftMultiplier > rightMultiplier ? left : right).display_name}`;
  return `BST ${left.base_stat_total}-${right.base_stat_total} | ${typeLead} | Edge: ${selectedAdvantage.label} | Winner: ${winner.display_name}`;
}

export function resolveTournamentBattle({
  left,
  right,
  weights = {},
  random = Math.random,
  matchId = '',
  roundLabel = '',
}) {
  const normalizedLeft = normalizeSubject(left);
  const normalizedRight = normalizeSubject(right);
  const normalizedWeights = normalizeBattleWeights(weights);
  const randomEdge = ((random() * 2) - 1) * normalizedWeights.random_spread;
  const leftCard = buildScoreCard(normalizedLeft, normalizedRight, normalizedWeights, randomEdge);
  const rightCard = buildScoreCard(normalizedRight, normalizedLeft, normalizedWeights, -randomEdge);
  const winner = leftCard.total_score === rightCard.total_score
    ? (normalizedLeft.base_stat_total >= normalizedRight.base_stat_total ? normalizedLeft : normalizedRight)
    : (leftCard.total_score > rightCard.total_score ? normalizedLeft : normalizedRight);
  const winnerSide = winner.id === normalizedLeft.id ? 'left' : 'right';
  const loser = winnerSide === 'left' ? normalizedRight : normalizedLeft;
  const winnerCard = winnerSide === 'left' ? leftCard : rightCard;
  const loserCard = winnerSide === 'left' ? rightCard : leftCard;
  const scoreCards = {
    left: leftCard,
    right: rightCard,
    winner: winnerCard,
    loser: loserCard,
  };
  const selectedAdvantage = resolveSelectedAdvantage(winner, loser, scoreCards, normalizedWeights);
  const insightText = selectedAdvantage.text;
  const introLineText = `${normalizedLeft.display_name} versus ${normalizedRight.display_name}.`;
  const commentaryText = `${introLineText} ${insightText}`;
  return {
    match_id: matchId,
    round_label: roundLabel,
    left: normalizedLeft,
    right: normalizedRight,
    winner,
    loser,
    winner_side: winnerSide,
    intro_line_text: introLineText,
    insight_text: insightText,
    breakdown_text: resolveBreakdownText(normalizedLeft, normalizedRight, winner, scoreCards, selectedAdvantage),
    commentary_text: commentaryText,
    winner_line_text: `${winner.display_name} wins!`,
    score_cards: scoreCards,
    selected_advantage: selectedAdvantage,
    battle_weights: normalizedWeights,
  };
}
