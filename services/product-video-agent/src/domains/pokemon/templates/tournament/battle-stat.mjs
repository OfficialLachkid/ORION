export const TOURNAMENT_BATTLE_STATS = Object.freeze([
  Object.freeze({ key: 'hp', label: 'HP', spoken_label: 'HP', color: '0xFF4D6D', weight: 1 }),
  Object.freeze({ key: 'attack', label: 'Attack', spoken_label: 'Attack', color: '0xFF8F1F', weight: 1 }),
  Object.freeze({ key: 'defense', label: 'Defense', spoken_label: 'Defense', color: '0xFFD23F', weight: 1 }),
  Object.freeze({ key: 'special_attack', label: 'Sp. Atk', spoken_label: 'Special Attack', color: '0x4D8CFF', weight: 1 }),
  Object.freeze({ key: 'special_defense', label: 'Sp. Def', spoken_label: 'Special Defense', color: '0x55D66B', weight: 1 }),
  Object.freeze({ key: 'speed', label: 'Speed', spoken_label: 'Speed', color: '0xFF58A8', weight: 1 }),
  Object.freeze({ key: 'type', label: 'Type', spoken_label: 'Type', color: '0xB884FF', weight: 1 }),
]);

const BATTLE_STAT_BY_KEY = new Map(TOURNAMENT_BATTLE_STATS.map((stat) => [stat.key, stat]));

function normalizeStatKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/gu, '_')
    .replace(/^sp_atk$/u, 'special_attack')
    .replace(/^sp_def$/u, 'special_defense');
}

export function resolveTournamentBattleStat(value) {
  const key = normalizeStatKey(typeof value === 'object' ? value?.key : value);
  const fallback = BATTLE_STAT_BY_KEY.get(key);
  if (!fallback) {
    return null;
  }
  const configured = value && typeof value === 'object' ? value : {};
  return {
    ...fallback,
    label: String(configured.label || fallback.label).trim() || fallback.label,
    spoken_label: String(configured.spoken_label || fallback.spoken_label).trim() || fallback.spoken_label,
    color: String(configured.color || fallback.color).trim() || fallback.color,
    weight: Math.max(1, Number(configured.weight) || fallback.weight),
  };
}

export function resolveTournamentBattleStatVariants(template = {}) {
  const configured = Array.isArray(template?.selection_rules?.battle_stat_variants)
    ? template.selection_rules.battle_stat_variants
    : [];
  const variants = configured
    .map((variant) => resolveTournamentBattleStat(variant))
    .filter(Boolean);
  return variants.length > 0
    ? variants
    : TOURNAMENT_BATTLE_STATS.map((stat) => ({ ...stat }));
}

export function selectTournamentBattleStat(template = {}, random = Math.random, excludedKeys = []) {
  const excluded = new Set((Array.isArray(excludedKeys) ? excludedKeys : []).map(normalizeStatKey));
  const allVariants = resolveTournamentBattleStatVariants(template);
  const available = allVariants.filter((variant) => !excluded.has(variant.key));
  const fallbackAvailable = TOURNAMENT_BATTLE_STATS.filter((variant) => !excluded.has(variant.key));
  const candidates = available.length > 0
    ? available
    : (fallbackAvailable.length > 0 ? fallbackAvailable : allVariants);
  const totalWeight = candidates.reduce((sum, variant) => sum + variant.weight, 0);
  let cursor = random() * totalWeight;
  for (const candidate of candidates) {
    cursor -= candidate.weight;
    if (cursor <= 0) {
      return { ...candidate };
    }
  }
  return { ...(candidates.at(-1) || TOURNAMENT_BATTLE_STATS[0]) };
}
