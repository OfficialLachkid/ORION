const DISALLOWED_TYPE_PAIR_INPUTS = [
  ['normal', 'ice'],
  ['normal', 'bug'],
  ['normal', 'rock'],
  ['normal', 'steel'],
  ['fire', 'fairy'],
  ['ice', 'poison'],
  ['ground', 'fairy'],
  ['bug', 'dragon'],
  ['rock', 'ghost'],
];

export function normalizeTypeName(typeName) {
  return String(typeName || '').trim().toLowerCase();
}

export function normalizeTypePair(typePair) {
  if (!Array.isArray(typePair) || typePair.length !== 2) {
    throw new Error('A Pokemon type pair must contain exactly two types.');
  }

  const normalized = typePair
    .map((type) => normalizeTypeName(type))
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));

  if (normalized.length !== 2 || normalized[0] === normalized[1]) {
    throw new Error('A Pokemon type pair must contain exactly two distinct types.');
  }

  return normalized;
}

export function createTypePairKey(typePair) {
  return normalizeTypePair(typePair).join('|');
}

export const DISALLOWED_TYPE_PAIRS = Object.freeze(
  DISALLOWED_TYPE_PAIR_INPUTS.map((pair) => Object.freeze(normalizeTypePair(pair))),
);

export const DISALLOWED_TYPE_PAIR_KEYS = new Set(
  DISALLOWED_TYPE_PAIRS.map((pair) => createTypePairKey(pair)),
);

export function isDisallowedTypePair(typePair) {
  return DISALLOWED_TYPE_PAIR_KEYS.has(createTypePairKey(typePair));
}
