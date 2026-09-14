import { ensureNumber, roundTime } from '../../dual-type-reveal/render/constants.mjs';

function buildRevealBoxLayout(template) {
  const canvasWidth = ensureNumber(template?.canvas?.width, 1080);
  const config = template?.layout?.reveal_box || {};
  const width = Math.max(320, Math.round(ensureNumber(config.width_px, 760)));
  const height = Math.max(320, Math.round(ensureNumber(config.height_px, 760)));
  const centerX = ensureNumber(config.center_x, canvasWidth / 2);
  const centerY = ensureNumber(config.center_y, 890);
  return {
    x: roundTime(centerX - (width / 2)),
    y: roundTime(centerY - (height / 2)),
    width,
    height,
    center_x: roundTime(centerX),
    center_y: roundTime(centerY),
    sprite_size_px: Math.max(240, Math.round(ensureNumber(config.sprite_size_px, 650))),
    background_color: String(config.background_color || 'black@0.88').trim() || 'black@0.88',
    border_color: String(config.border_color || 'white@0.92').trim() || 'white@0.92',
    border_width_px: Math.max(0, Math.round(ensureNumber(config.border_width_px, 6))),
    shadow_offset_px: Math.max(0, Math.round(ensureNumber(config.shadow_offset_px, 18))),
  };
}

function buildProgressBarLayout(template, revealBox) {
  const config = template?.layout?.progress_bar || {};
  const width = Math.max(180, Math.round(ensureNumber(config.width_px, revealBox.width - 100)));
  const height = Math.max(10, Math.round(ensureNumber(config.height_px, 30)));
  const centerX = ensureNumber(config.center_x, revealBox.center_x);
  const centerY = ensureNumber(config.center_y, revealBox.y + revealBox.height + 92);
  return {
    x: roundTime(centerX - (width / 2)),
    y: roundTime(centerY - (height / 2)),
    width,
    height,
    center_x: roundTime(centerX),
    center_y: roundTime(centerY),
    fill_color: String(config.fill_color || '0xFFD60A').trim() || '0xFFD60A',
    track_color: String(config.track_color || 'black@0.72').trim() || 'black@0.72',
    border_color: String(config.border_color || 'white@0.82').trim() || 'white@0.82',
  };
}

function buildTextLayout(template) {
  const config = template?.layout?.text || {};
  return {
    hook_y: ensureNumber(config.hook_y, 150),
    hook_font_size: Math.max(48, Math.round(ensureNumber(config.hook_font_size, 102))),
    hook_line_gap_px: Math.max(0, Math.round(ensureNumber(config.hook_line_gap_px, 8))),
    counter_x: ensureNumber(config.counter_x, 72),
    counter_y: ensureNumber(config.counter_y, 92),
    counter_font_size: Math.max(30, Math.round(ensureNumber(config.counter_font_size, 48))),
    method_y: ensureNumber(config.method_y, 1340),
    method_font_size: Math.max(24, Math.round(ensureNumber(config.method_font_size, 42))),
    answer_y: ensureNumber(config.answer_y, 1480),
    answer_font_size: Math.max(52, Math.round(ensureNumber(config.answer_font_size, 104))),
    primary_color: String(config.primary_color || 'white').trim() || 'white',
    accent_color: String(config.accent_color || '0xFFD60A').trim() || '0xFFD60A',
    outline_width: Math.max(1, Math.round(ensureNumber(config.outline_width, 8))),
    depth_px: Math.max(0, Math.round(ensureNumber(config.depth_px, 8))),
  };
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const revealBox = buildRevealBoxLayout(template);
  const progressBar = buildProgressBarLayout(template, revealBox);
  const textLayout = buildTextLayout(template);
  const transitionFallback = ensureNumber(template?.layout?.rounds?.transition_duration_seconds, 0.42);
  let currentSceneStart = 0;
  const rounds = (Array.isArray(plan?.rounds) ? plan.rounds : []).map((round, index, sourceRounds) => {
    const sceneLeadSeconds = roundTime(Math.max(0, ensureNumber(round.scene_lead_seconds, 0)));
    const revealDurationSeconds = roundTime(Math.max(0.05, ensureNumber(round.reveal_duration_seconds, 8.4)));
    const answerHoldSeconds = roundTime(Math.max(0.1, ensureNumber(round.answer_hold_seconds, 1.45)));
    const transitionDurationSeconds = roundTime(Math.max(0, ensureNumber(
      round.transition_duration_seconds,
      index === sourceRounds.length - 1 ? 0 : transitionFallback,
    )));
    const finalHoldSeconds = roundTime(Math.max(0, ensureNumber(round.final_hold_seconds, 0)));
    const revealStartLocal = sceneLeadSeconds;
    const answerStartLocal = roundTime(revealStartLocal + revealDurationSeconds);
    const slideStartLocal = roundTime(answerStartLocal + answerHoldSeconds);
    const sceneDurationSeconds = roundTime(
      slideStartLocal + (transitionDurationSeconds > 0 ? transitionDurationSeconds : finalHoldSeconds),
    );
    const sceneStartSeconds = roundTime(currentSceneStart);
    const sceneEndSeconds = roundTime(sceneStartSeconds + sceneDurationSeconds);
    const renderedRound = {
      ...round,
      scene_start_seconds: sceneStartSeconds,
      scene_end_seconds: sceneEndSeconds,
      scene_duration_seconds: sceneDurationSeconds,
      reveal_start_seconds: roundTime(sceneStartSeconds + revealStartLocal),
      reveal_complete_seconds: roundTime(sceneStartSeconds + answerStartLocal),
      answer_start_seconds: roundTime(sceneStartSeconds + answerStartLocal),
      slide_start_seconds: roundTime(sceneStartSeconds + slideStartLocal),
      local: {
        scene_lead_seconds: sceneLeadSeconds,
        reveal_start_seconds: revealStartLocal,
        reveal_complete_seconds: answerStartLocal,
        answer_start_seconds: answerStartLocal,
        slide_start_seconds: slideStartLocal,
        scene_duration_seconds: sceneDurationSeconds,
      },
      reveal_box: revealBox,
      progress_bar: progressBar,
    };
    currentSceneStart = roundTime(sceneEndSeconds - transitionDurationSeconds);
    return renderedRound;
  });

  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    total_duration_seconds: rounds.at(-1)?.scene_end_seconds || 0,
    reveal_box: revealBox,
    progress_bar: progressBar,
    text_layout: textLayout,
    background: {
      blur_sigma: Math.max(0, ensureNumber(template?.layout?.background?.blur_sigma, 6)),
      darken_alpha: Math.min(0.85, Math.max(0, ensureNumber(template?.layout?.background?.darken_alpha, 0.24))),
    },
    audio_cues: {
      battle_music_start_seconds: roundTime(Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0))),
    },
    rounds,
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan) {
  return renderPlan;
}
