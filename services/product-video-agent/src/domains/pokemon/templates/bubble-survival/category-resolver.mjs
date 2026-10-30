import {
  filterPokemonSubjectsForPool,
  getPokemonPoolDefinition,
} from '../shared/pokemon-subject-pools.mjs';

export const BUBBLE_SURVIVAL_CATEGORIES = Object.freeze([
  'mixed',
  'first-stage',
  'middle-stage',
  'legendary-mythical',
  'dynamax-gigantamax',
  'final-starter',
  'mega-legendary',
  'baby',
  'starters',
  'final-stage',
  'mega',
]);

const CATEGORY_TO_SHARED_POOL = Object.freeze({
  mixed: 'mixed',
  'first-stage': 'first_stage',
  'middle-stage': 'middle_stage',
  'legendary-mythical': 'legendary_mythical',
  'dynamax-gigantamax': 'dynamax',
  'final-starter': 'final_starter',
  'mega-legendary': 'mega_legendary',
  baby: 'baby',
  starters: 'starter',
  'final-stage': 'final_stage',
  mega: 'mega',
});

const CATEGORY_ALIASES = Object.freeze({
  all: 'mixed',
  'mixed-all': 'mixed',
  'first-evolution': 'middle-stage',
  'first-evolutions': 'middle-stage',
  'middle-evolution': 'middle-stage',
  'middle-evolutions': 'middle-stage',
  legendary: 'legendary-mythical',
  mythical: 'legendary-mythical',
  'legendary-and-mythical': 'legendary-mythical',
  dynamax: 'dynamax-gigantamax',
  gigantamax: 'dynamax-gigantamax',
  starter: 'starters',
  'final-starters': 'final-starter',
  'final-starter-evolutions': 'final-starter',
  'mega-and-legendary': 'mega-legendary',
  'mega-or-legendary': 'mega-legendary',
  'final-evolution': 'final-stage',
  'final-evolutions': 'final-stage',
  'mega-evolution': 'mega',
  'mega-evolutions': 'mega',
  babies: 'baby',
});

function normalizeToken(value) {
  return String(value || '').trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-');
}

export function normalizeBubbleSurvivalCategory(value) {
  const normalized = normalizeToken(value || 'mixed');
  const category = CATEGORY_ALIASES[normalized] || normalized;
  if (!BUBBLE_SURVIVAL_CATEGORIES.includes(category)) {
    throw new Error(
      `Unsupported Bubble Survival category "${value}". Expected one of: ${BUBBLE_SURVIVAL_CATEGORIES.join(', ')}.`,
    );
  }
  return category;
}

export function getBubbleSurvivalCategoryLabel(categoryValue) {
  const category = normalizeBubbleSurvivalCategory(categoryValue);
  return getPokemonPoolDefinition(CATEGORY_TO_SHARED_POOL[category]).label;
}

export function isEligibleForBubbleSurvivalCategory(row, categoryValue) {
  const category = normalizeBubbleSurvivalCategory(categoryValue);
  return filterPokemonSubjectsForPool([row], CATEGORY_TO_SHARED_POOL[category]).length === 1;
}

function uniqueFormKey(row) {
  const pokemonApi = row?.metadata?.pokemon_api || {};
  return String(
    pokemonApi.pokemon_id
    || pokemonApi.pokemon_name
    || row?.id
    || `${row?.national_dex_number || ''}:${row?.slug || row?.name || ''}`,
  );
}

export function resolveBubbleSurvivalCategoryPool(rows, categoryValue) {
  const category = normalizeBubbleSurvivalCategory(categoryValue);
  const seen = new Set();
  return filterPokemonSubjectsForPool(rows, CATEGORY_TO_SHARED_POOL[category])
    .filter((row) => row && String(row.sprite_path || '').trim())
    .filter((row) => {
      const key = uniqueFormKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
