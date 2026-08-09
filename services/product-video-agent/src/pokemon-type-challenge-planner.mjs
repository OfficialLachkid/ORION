import { resolvePokeQuizzPlanner } from './poke-quizz-template-registry.mjs';

export async function planPokemonTypeChallenge(options = {}) {
  const planner = resolvePokeQuizzPlanner(options.template);
  return planner(options);
}
