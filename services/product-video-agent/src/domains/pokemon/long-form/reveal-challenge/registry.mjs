import { resolvePokeQuizzTemplateKey } from '../../../../poke-quizz-template-registry.mjs';
import { resolveProgressiveRevealMethods } from '../../templates/progressive-reveal/planner.mjs';
import { LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS } from '../landscape-template-adapter.mjs';

const REVEAL_TEMPLATE_KEYS = new Set(
  LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS.map((spec) => spec.key),
);

export function listRevealChallengeTemplateSpecs() {
  return LANDSCAPE_POKEMON_REVEAL_TEMPLATE_SPECS.map((spec) => ({ ...spec }));
}

export function resolveRevealChallengeStrategies(template = {}) {
  const templateKey = resolvePokeQuizzTemplateKey(template);
  if (!REVEAL_TEMPLATE_KEYS.has(templateKey)) {
    return [];
  }
  return resolveProgressiveRevealMethods(template).map((method) => ({
    id: `${templateKey}:${method}`,
    template_key: templateKey,
    reveal_method: method,
  }));
}

export function isRevealChallengeTemplate(template = {}) {
  try {
    return REVEAL_TEMPLATE_KEYS.has(resolvePokeQuizzTemplateKey(template));
  } catch {
    return false;
  }
}
