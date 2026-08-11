import {
  DEFAULT_HOOK_FONT_SIZE,
  DEFAULT_PROMPT_FONT_SIZE,
  DEFAULT_REVEAL_FONT_SIZE,
  DEFAULT_REVEAL_TEXT_DELAY_SECONDS,
  ensureNumber,
} from '../../dual-type-reveal/render/constants.mjs';
import { buildProgressiveTextArtifacts } from '../../dual-type-reveal/render/text-layout.mjs';

export {
  resolveFontPath,
  writeDrawtextArtifacts,
} from '../../dual-type-reveal/render/drawtext-artifacts.mjs';

function resolveTextPosition(template, role, fallbackY) {
  return ensureNumber(template?.layout?.text?.[`${role}_y`], fallbackY);
}

export function buildTextArtifacts({ renderPlan, template }) {
  const revealTextStartSeconds = Math.min(
    Math.max(0, renderPlan.total_duration_seconds - 0.12),
    ensureNumber(
      renderPlan.audio_cues?.reveal_start_seconds,
      renderPlan.phases.reveal.start_seconds,
    ) + DEFAULT_REVEAL_TEXT_DELAY_SECONDS,
  );

  return {
    hook: buildProgressiveTextArtifacts(renderPlan.text.hook, {
      template,
      fontSize: ensureNumber(template?.layout?.text?.hook_font_size, DEFAULT_HOOK_FONT_SIZE),
      maxLines: 2,
      baseY: resolveTextPosition(template, 'hook', 180),
      startSeconds: renderPlan.phases.hook.start_seconds,
      endSeconds: renderPlan.phases.hook.end_seconds,
    }),
    prompt: buildProgressiveTextArtifacts(renderPlan.text.prompt, {
      template,
      fontSize: DEFAULT_PROMPT_FONT_SIZE,
      maxLines: 3,
      baseY: resolveTextPosition(template, 'prompt', 290),
      startSeconds: renderPlan.phases.type_prompt.start_seconds,
      endSeconds: ensureNumber(
        renderPlan.audio_cues?.prompt_end_seconds,
        renderPlan.phases.countdown?.start_seconds ?? renderPlan.phases.reveal.start_seconds,
      ),
    }),
    reveal: buildProgressiveTextArtifacts(renderPlan.text.reveal, {
      template,
      fontSize: DEFAULT_REVEAL_FONT_SIZE,
      maxLines: 2,
      baseY: resolveTextPosition(template, 'reveal', 260),
      startSeconds: revealTextStartSeconds,
      endSeconds: renderPlan.total_duration_seconds,
    }),
  };
}
