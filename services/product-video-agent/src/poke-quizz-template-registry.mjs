import {
  planPokemonTypeChallenge as planDualTypeRevealChallenge,
} from './domains/pokemon/templates/dual-type-reveal/planner.mjs';
import {
  buildPokeQuizzRenderPlan as buildDualTypeRevealRenderPlan,
  renderPokeQuizzVideo as renderDualTypeRevealVideo,
} from './domains/pokemon/templates/dual-type-reveal/renderer.mjs';
import {
  planFindTheShinyChallenge,
} from './domains/pokemon/templates/find-the-shiny/planner.mjs';
import {
  buildPokeQuizzRenderPlan as buildFindTheShinyRenderPlan,
  renderPokeQuizzVideo as renderFindTheShinyVideo,
} from './domains/pokemon/templates/find-the-shiny/renderer.mjs';
import {
  planPokemonTypeQuizChallenge,
} from './domains/pokemon/templates/type-speed-quiz/planner.mjs';
import {
  buildPokeQuizzRenderPlan as buildTypeSpeedQuizRenderPlan,
  renderPokeQuizzVideo as renderTypeSpeedQuizVideo,
} from './domains/pokemon/templates/type-speed-quiz/renderer.mjs';

const TEMPLATE_REGISTRY = Object.freeze({
  'dual-type-reveal': Object.freeze({
    planner: planDualTypeRevealChallenge,
    buildRenderPlan: buildDualTypeRevealRenderPlan,
    renderVideo: renderDualTypeRevealVideo,
  }),
  'find-the-shiny': Object.freeze({
    planner: planFindTheShinyChallenge,
    buildRenderPlan: buildFindTheShinyRenderPlan,
    renderVideo: renderFindTheShinyVideo,
  }),
  'type-quiz': Object.freeze({
    planner: planPokemonTypeQuizChallenge,
    buildRenderPlan: buildTypeSpeedQuizRenderPlan,
    renderVideo: renderTypeSpeedQuizVideo,
  }),
});

function normalizeTemplateSelector(template = {}) {
  const templateKey = String(template?.template_key || '')
    .trim()
    .toLowerCase();
  const templateId = String(template?.template_id || '')
    .trim()
    .toLowerCase();
  return {
    templateKey,
    templateId,
  };
}

export function resolvePokeQuizzTemplateKey(template = {}) {
  const { templateKey, templateId } = normalizeTemplateSelector(template);
  if (templateKey === 'type-quiz' || templateKey === 'type-speed-quiz') {
    return 'type-quiz';
  }
  if (templateKey && TEMPLATE_REGISTRY[templateKey]) {
    return templateKey;
  }
  if (!templateKey && !templateId) {
    return 'dual-type-reveal';
  }
  if (templateId.includes('find-the-shiny')) {
    return 'find-the-shiny';
  }
  if (templateId.includes('type-quiz') || templateId.includes('type-speed-quiz')) {
    return 'type-quiz';
  }
  if (!templateKey || templateId.includes('dual-type-reveal')) {
    return 'dual-type-reveal';
  }
  throw new Error(`Unsupported Poke Quizz template: ${templateKey || templateId || '(unknown)'}.`);
}

function resolveTemplateEntry(template = {}) {
  return TEMPLATE_REGISTRY[resolvePokeQuizzTemplateKey(template)];
}

export function resolvePokeQuizzPlanner(template = {}) {
  return resolveTemplateEntry(template).planner;
}

export function resolvePokeQuizzRenderPlanBuilder(template = {}) {
  return resolveTemplateEntry(template).buildRenderPlan;
}

export function resolvePokeQuizzRenderer(template = {}) {
  return resolveTemplateEntry(template).renderVideo;
}
