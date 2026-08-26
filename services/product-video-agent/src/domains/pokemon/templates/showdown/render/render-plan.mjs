import {
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

function normalizeSlot(config = {}, width, height) {
  const x = ensureNumber(config.x, 0);
  const y = ensureNumber(config.y, 0);
  return {
    x,
    y,
    width,
    height,
    center_x: roundTime(x + (width / 2)),
    center_y: roundTime(y + (height / 2)),
  };
}

function buildBracketLayout(template) {
  const config = template?.layout?.bracket || {};
  const cardWidth = ensureNumber(config.slot_card_width_px, 220);
  const cardHeight = ensureNumber(config.slot_card_height_px, 184);
  const slotNameFontSize = ensureNumber(config.slot_name_font_size, 42);
  const slotSpriteSize = ensureNumber(config.slot_sprite_size_px, 120);
  const connectorThickness = ensureNumber(config.connector_thickness_px, 10);
  const positions = config.slot_positions || {};
  return {
    slot_card_width_px: cardWidth,
    slot_card_height_px: cardHeight,
    slot_name_font_size: slotNameFontSize,
    slot_sprite_size_px: slotSpriteSize,
    connector_thickness_px: connectorThickness,
    slots: {
      semi_1_a: normalizeSlot(positions.semi_1_a || {}, cardWidth, cardHeight),
      semi_1_b: normalizeSlot(positions.semi_1_b || {}, cardWidth, cardHeight),
      semi_1_winner: normalizeSlot(positions.semi_1_winner || {}, cardWidth, cardHeight),
      semi_2_a: normalizeSlot(positions.semi_2_a || {}, cardWidth, cardHeight),
      semi_2_b: normalizeSlot(positions.semi_2_b || {}, cardWidth, cardHeight),
      semi_2_winner: normalizeSlot(positions.semi_2_winner || {}, cardWidth, cardHeight),
      final_winner: normalizeSlot(positions.final_winner || {}, cardWidth, cardHeight),
    },
  };
}

function buildBattleStageLayout(template) {
  const config = template?.layout?.battle_stage || {};
  return {
    sprite_size_px: ensureNumber(config.sprite_size_px, 380),
    left_center_x: ensureNumber(config.left_center_x, 275),
    right_center_x: ensureNumber(config.right_center_x, 805),
    center_y: ensureNumber(config.center_y, 1150),
    name_y: ensureNumber(config.name_y, 1430),
    name_font_size: ensureNumber(config.name_font_size, 62),
    vs_y: ensureNumber(config.vs_y, 1125),
    vs_font_size: ensureNumber(config.vs_font_size, 100),
  };
}

function buildChampionStageLayout(template) {
  const config = template?.layout?.champion_stage || {};
  return {
    sprite_size_px: ensureNumber(config.sprite_size_px, 520),
    center_x: ensureNumber(config.center_x, 540),
    center_y: ensureNumber(config.center_y, 1120),
    name_y: ensureNumber(config.name_y, 1510),
    name_font_size: ensureNumber(config.name_font_size, 86),
  };
}

function buildTextLayout(template) {
  return {
    hook_y: ensureNumber(template?.layout?.text?.hook_y, 150),
    hook_font_size: ensureNumber(template?.layout?.text?.hook_font_size, 122),
    round_y: ensureNumber(template?.layout?.text?.round_y, 305),
    round_font_size: ensureNumber(template?.layout?.text?.round_font_size, 68),
    matchup_y: ensureNumber(template?.layout?.text?.matchup_y, 365),
    matchup_font_size: ensureNumber(template?.layout?.text?.matchup_font_size, 92),
    insight_y: ensureNumber(template?.layout?.text?.insight_y, 470),
    insight_font_size: ensureNumber(template?.layout?.text?.insight_font_size, 58),
    winner_y: ensureNumber(template?.layout?.text?.winner_y, 1450),
    winner_font_size: ensureNumber(template?.layout?.text?.winner_font_size, 90),
    champion_y: ensureNumber(template?.layout?.text?.champion_y, 260),
    champion_font_size: ensureNumber(template?.layout?.text?.champion_font_size, 104),
  };
}

function buildRenderedMatches(template, matches = []) {
  const rounds = template?.layout?.rounds || {};
  const hookHoldSeconds = roundTime(ensureNumber(rounds.hook_hold_seconds, 1.1));
  const matchIntroHoldSeconds = roundTime(ensureNumber(rounds.match_intro_hold_seconds, 1.8));
  const suspenseHoldSeconds = roundTime(ensureNumber(rounds.suspense_hold_seconds, 0.9));
  const revealHoldSeconds = roundTime(ensureNumber(rounds.reveal_hold_seconds, 1.2));
  const transitionDurationSeconds = roundTime(ensureNumber(rounds.transition_duration_seconds, 0.4));
  let currentStart = 0;

  return matches.map((match, index) => {
    const introDelaySeconds = index === 0 ? hookHoldSeconds : 0.08;
    const sceneStart = roundTime(currentStart);
    const introStart = roundTime(sceneStart + introDelaySeconds);
    const revealStart = roundTime(introStart + matchIntroHoldSeconds + suspenseHoldSeconds);
    const transitionSeconds = index === matches.length - 1 ? 0 : transitionDurationSeconds;
    const sceneEnd = roundTime(revealStart + revealHoldSeconds + transitionSeconds);
    currentStart = sceneEnd;
    return {
      ...match,
      scene_start_seconds: sceneStart,
      intro_start_seconds: introStart,
      reveal_start_seconds: revealStart,
      scene_end_seconds: sceneEnd,
      transition_duration_seconds: transitionSeconds,
      hook_visible_until_seconds: index === 0 ? introStart : null,
    };
  });
}

function buildNarrationCueSchedule(renderedMatches = [], championScene) {
  return [
    { role: 'hook', start_seconds: 0 },
    ...renderedMatches.flatMap((match) => ([
      { role: `${match.match_id}-intro`, start_seconds: match.intro_start_seconds },
      { role: `${match.match_id}-winner`, start_seconds: match.reveal_start_seconds + 0.04 },
    ])),
    { role: 'champion', start_seconds: championScene.start_seconds + 0.08 },
  ];
}

export function buildPokeQuizzRenderPlan({ plan, template, outputPath }) {
  const renderedMatches = buildRenderedMatches(template, plan?.tournament?.matches || []);
  const championHoldSeconds = roundTime(ensureNumber(template?.layout?.rounds?.champion_hold_seconds, 1.1));
  const championStart = roundTime(renderedMatches.at(-1)?.scene_end_seconds || 0);
  const championScene = {
    start_seconds: championStart,
    end_seconds: roundTime(championStart + championHoldSeconds),
  };

  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    total_duration_seconds: championScene.end_seconds,
    text_layout: buildTextLayout(template),
    bracket_layout: buildBracketLayout(template),
    battle_stage: buildBattleStageLayout(template),
    champion_stage: buildChampionStageLayout(template),
    matches: renderedMatches,
    champion_scene: championScene,
    narration_cues: buildNarrationCueSchedule(renderedMatches, championScene),
    audio_cues: {
      battle_music_start_seconds: roundTime(Math.max(0, ensureNumber(template?.audio?.battle_intro_music?.start_seconds, 0))),
    },
    output_path: outputPath,
  };
}

export function applyNarrationDurationsToRenderPlan(renderPlan, narrationDurations = []) {
  const matches = Array.isArray(renderPlan?.matches) ? renderPlan.matches : [];
  if (matches.length === 0) {
    return renderPlan;
  }

  const durationsByRole = new Map();
  (Array.isArray(renderPlan?.narration_cues) ? renderPlan.narration_cues : []).forEach((cue, index) => {
    const role = String(cue?.role || '').trim();
    const duration = ensureNumber(narrationDurations[index], 0);
    if (role) {
      durationsByRole.set(role, duration);
    }
  });

  const hookDuration = ensureNumber(durationsByRole.get('hook'), 0);
  let currentStart = 0;
  const updatedMatches = matches.map((match, index) => {
    const introDelay = roundTime(Math.max(
      match.intro_start_seconds - match.scene_start_seconds,
      index === 0 ? hookDuration : 0,
    ));
    const introDuration = roundTime(Math.max(
      match.reveal_start_seconds - match.intro_start_seconds,
      ensureNumber(durationsByRole.get(`${match.match_id}-intro`), 0),
    ));
    const winnerDuration = roundTime(Math.max(
      match.scene_end_seconds - match.reveal_start_seconds - match.transition_duration_seconds,
      ensureNumber(durationsByRole.get(`${match.match_id}-winner`), 0),
    ));
    const sceneStart = roundTime(currentStart);
    const introStart = roundTime(sceneStart + introDelay);
    const revealStart = roundTime(introStart + introDuration);
    const sceneEnd = roundTime(revealStart + winnerDuration + match.transition_duration_seconds);
    currentStart = sceneEnd;
    return {
      ...match,
      scene_start_seconds: sceneStart,
      intro_start_seconds: introStart,
      reveal_start_seconds: revealStart,
      scene_end_seconds: sceneEnd,
      hook_visible_until_seconds: index === 0 ? introStart : null,
    };
  });

  const championBaseDuration = roundTime(
    renderPlan.champion_scene.end_seconds - renderPlan.champion_scene.start_seconds,
  );
  const championDuration = roundTime(Math.max(
    championBaseDuration,
    ensureNumber(durationsByRole.get('champion'), 0),
  ));
  const championStart = roundTime(updatedMatches.at(-1)?.scene_end_seconds || 0);
  const championScene = {
    ...renderPlan.champion_scene,
    start_seconds: championStart,
    end_seconds: roundTime(championStart + championDuration),
  };

  return {
    ...renderPlan,
    matches: updatedMatches,
    champion_scene: championScene,
    total_duration_seconds: championScene.end_seconds,
    narration_cues: buildNarrationCueSchedule(updatedMatches, championScene),
  };
}
