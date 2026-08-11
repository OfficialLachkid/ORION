import {
  DEFAULT_REVEAL_VISUAL_DELAY_SECONDS,
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

function buildTimerLayout(template) {
  const centerX = ensureNumber(template?.layout?.timer?.center_x, 540);
  const centerY = ensureNumber(template?.layout?.timer?.center_y, 470);
  const size = ensureNumber(template?.layout?.timer?.size_px, 268);
  return {
    x: roundTime(centerX - (size / 2)),
    y: roundTime(centerY - (size / 2)),
    width: size,
    height: size,
    number_center_x: centerX,
    number_center_y: centerY,
  };
}

function buildSpriteLayout(template) {
  const centerX = ensureNumber(template?.layout?.sprite?.center_x, 540);
  const centerY = ensureNumber(template?.layout?.sprite?.center_y, 930);
  const size = ensureNumber(template?.layout?.sprite?.size_px, 620);
  const scaleMultiplier = ensureNumber(template?.layout?.sprite?.scale_multiplier, 1.18);
  return {
    center_x: centerX,
    center_y: centerY,
    size_px: size,
    scale_multiplier: scaleMultiplier,
    crop_ratio: ensureNumber(template?.layout?.sprite?.crop_ratio, 0.62),
    intro_duration_seconds: ensureNumber(template?.layout?.sprite?.intro_duration_seconds, 0.34),
    intro_lift_px: ensureNumber(template?.layout?.sprite?.intro_lift_px, 44),
    countdown_float_amplitude_px: ensureNumber(
      template?.layout?.sprite?.countdown_float_amplitude_px,
      18,
    ),
    countdown_float_frequency_hz: ensureNumber(
      template?.layout?.sprite?.countdown_float_frequency_hz,
      2.1,
    ),
    render_size_px: roundTime(size * scaleMultiplier),
  };
}

function buildTypeBadgeLayout(template, iconCount) {
  const centerY = ensureNumber(template?.layout?.type_badges?.center_y, 1322);
  const iconSize = ensureNumber(template?.layout?.type_badges?.icon_size_px, 208);
  const spacing = ensureNumber(template?.layout?.type_badges?.spacing_px, 42);
  if (iconCount <= 1) {
    return [{
      center_x: 540,
      center_y: centerY,
      size_px: iconSize,
    }];
  }

  const totalWidth = (iconSize * iconCount) + (spacing * (iconCount - 1));
  const left = 540 - (totalWidth / 2) + (iconSize / 2);
  return Array.from({ length: iconCount }, (_, index) => ({
    center_x: roundTime(left + (index * (iconSize + spacing))),
    center_y: centerY,
    size_px: iconSize,
  }));
}

function buildCountdownMoments(round, countdownFrom, countdownTo) {
  const values = [];
  let currentValue = Number.parseInt(String(countdownFrom), 10);
  const target = Number.parseInt(String(countdownTo), 10);
  while (Number.isFinite(currentValue) && currentValue > Math.max(0, target)) {
    const offset = countdownFrom - currentValue;
    const startSeconds = round.countdown_start_seconds + offset;
    values.push({
      value: String(currentValue),
      start_seconds: roundTime(startSeconds),
      end_seconds: roundTime(startSeconds + 1),
    });
    currentValue -= 1;
  }

  values.push({
    value: '0',
    start_seconds: round.reveal_start_seconds,
    end_seconds: roundTime(Math.min(round.scene_end_seconds, round.reveal_visual_start_seconds + 0.34)),
  });
  return values;
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const rounds = Array.isArray(plan?.rounds) ? plan.rounds : [];
  const transitionDurationSeconds = ensureNumber(
    template?.layout?.rounds?.transition_duration_seconds,
    0.42,
  );
  const revealVisualDelaySeconds = roundTime(Math.max(
    0,
    ensureNumber(template?.reveal?.visual_delay_seconds, DEFAULT_REVEAL_VISUAL_DELAY_SECONDS),
  ));
  let currentSceneStart = 0;
  const renderedRounds = rounds.map((round, index) => {
    const sceneLeadSeconds = roundTime(ensureNumber(round.scene_lead_seconds, 0));
    const countdownDurationSeconds = roundTime(ensureNumber(round.countdown_duration_seconds, 3));
    const revealHoldSeconds = roundTime(ensureNumber(round.reveal_hold_seconds, 0.92));
    const outgoingTransitionSeconds = roundTime(ensureNumber(
      round.transition_duration_seconds,
      index === rounds.length - 1 ? 0 : transitionDurationSeconds,
    ));
    const finalHoldSeconds = roundTime(ensureNumber(round.final_hold_seconds, 0));
    const revealStartLocal = roundTime(sceneLeadSeconds + countdownDurationSeconds);
    const slideStartLocal = roundTime(revealStartLocal + revealHoldSeconds);
    const sceneDurationSeconds = roundTime(
      slideStartLocal + (outgoingTransitionSeconds > 0 ? outgoingTransitionSeconds : finalHoldSeconds),
    );
    const sceneStartSeconds = roundTime(currentSceneStart);
    const sceneEndSeconds = roundTime(sceneStartSeconds + sceneDurationSeconds);
    const revealVisualStartSeconds = roundTime(sceneStartSeconds + revealStartLocal + revealVisualDelaySeconds);
    const renderedRound = {
      ...round,
      scene_start_seconds: sceneStartSeconds,
      scene_end_seconds: sceneEndSeconds,
      scene_duration_seconds: sceneDurationSeconds,
      countdown_start_seconds: roundTime(sceneStartSeconds + sceneLeadSeconds),
      reveal_start_seconds: roundTime(sceneStartSeconds + revealStartLocal),
      reveal_visual_start_seconds: revealVisualStartSeconds,
      slide_start_seconds: roundTime(sceneStartSeconds + slideStartLocal),
      local: {
        scene_lead_seconds: sceneLeadSeconds,
        countdown_start_seconds: sceneLeadSeconds,
        reveal_start_seconds: revealStartLocal,
        reveal_visual_start_seconds: roundTime(revealStartLocal + revealVisualDelaySeconds),
        slide_start_seconds: slideStartLocal,
        scene_duration_seconds: sceneDurationSeconds,
      },
      countdown_numbers: [],
      type_badge_layout: buildTypeBadgeLayout(template, round.type_icons?.length || 0),
    };
    renderedRound.countdown_numbers = buildCountdownMoments(
      renderedRound,
      round.countdown_from,
      round.countdown_to,
    );
    currentSceneStart = roundTime(sceneEndSeconds - outgoingTransitionSeconds);
    return renderedRound;
  });

  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    total_duration_seconds: renderedRounds.at(-1)?.scene_end_seconds || 0,
    sprite_layout: buildSpriteLayout(template),
    timer_layout: buildTimerLayout(template),
    text_layout: {
      hook_y: ensureNumber(template?.layout?.text?.hook_y, 300),
      hook_font_size: ensureNumber(template?.layout?.text?.hook_font_size, 156),
      prompt_y: ensureNumber(
        template?.layout?.text?.prompt_y,
        ensureNumber(template?.layout?.text?.hook_y, 300),
      ),
      prompt_font_size: ensureNumber(
        template?.layout?.text?.prompt_font_size,
        ensureNumber(template?.layout?.text?.hook_font_size, 156),
      ),
      counter_x: ensureNumber(template?.layout?.text?.counter_x, 96),
      counter_y: ensureNumber(template?.layout?.text?.counter_y, 188),
      counter_font_size: ensureNumber(template?.layout?.text?.counter_font_size, 96),
      name_y: ensureNumber(template?.layout?.text?.name_y, 1160),
      name_font_size: ensureNumber(template?.layout?.text?.name_font_size, 132),
      type_text_y: ensureNumber(template?.layout?.text?.type_text_y, 1448),
      type_text_font_size: ensureNumber(template?.layout?.text?.type_text_font_size, 94),
    },
    audio_cues: {
      hook_start_seconds: 0,
      battle_music_start_seconds: roundTime(Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0))),
      shiny_reveal_start_seconds: renderedRounds.find((round) => round.subject?.is_shiny_reveal)?.reveal_visual_start_seconds ?? null,
    },
    hook_text: plan?.narration?.lines?.[0]?.text || '',
    rounds: renderedRounds,
    output_path: outputPath,
  };
}
