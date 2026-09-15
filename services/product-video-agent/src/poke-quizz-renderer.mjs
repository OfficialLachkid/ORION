export {
  applyNarrationDurationsToRenderPlan,
  buildAudioFilterScript,
  buildCountdownMoments,
  buildHookTypeIconLayout,
  buildPhaseSchedule,
  buildTimerLayout,
  buildTypeIconLayout,
  buildVisualFilterScript,
  escapeDrawtextText,
  estimateWrapCharacterLimit,
  formatEnableBetween,
  loadJson,
  wrapTextBlock,
} from './domains/pokemon/templates/dual-type-reveal/renderer.mjs';
import {
  resolvePokeQuizzRenderPlanBuilder,
  resolvePokeQuizzRenderer,
} from './poke-quizz-template-registry.mjs';
import { resolvePokemonChannelIdentity } from './domains/pokemon/templates/shared/render/channel-watermark.mjs';

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const buildRenderPlan = resolvePokeQuizzRenderPlanBuilder(template);
  return buildRenderPlan({
    plan,
    template,
    outputPath,
  });
}

export async function renderPokeQuizzVideo(options = {}) {
  const renderVideo = resolvePokeQuizzRenderer(options.template);
  const channel = resolvePokemonChannelIdentity(options.channelProfile || options.plan?.channel);
  return renderVideo({
    ...options,
    plan: {
      ...(options.plan || {}),
      channel,
    },
  });
}
