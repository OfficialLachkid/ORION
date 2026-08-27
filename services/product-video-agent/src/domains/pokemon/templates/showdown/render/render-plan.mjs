import {
  ensureNumber,
  roundTime,
} from '../../dual-type-reveal/render/constants.mjs';

function hashSeed(input) {
  let hash = 2166136261;
  for (const character of String(input || 'showdown-intro')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createPrng(seedInput) {
  let seed = hashSeed(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let result = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    result ^= result + Math.imul(result ^ (result >>> 7), 61 | result);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function buildSeededRevealOrder(count, seedInput) {
  const random = createPrng(seedInput);
  const indices = Array.from({ length: Math.max(0, count) }, (_, index) => index);
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [indices[index], indices[swapIndex]] = [indices[swapIndex], indices[index]];
  }
  return indices;
}

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

function resolveIntroBracketStageDurations(template) {
  const renderer = template?.renderer || {};
  const hasConfiguredStages = [
    'intro_bracket_semi_slot_seconds',
    'intro_bracket_semi_connector_seconds',
    'intro_bracket_finalist_slot_seconds',
    'intro_bracket_final_connector_seconds',
  ].some((key) => renderer[key] !== undefined);

  if (!hasConfiguredStages) {
    return null;
  }

  return {
    semi_slot_seconds: roundTime(Math.max(0.05, ensureNumber(renderer.intro_bracket_semi_slot_seconds, 0.18))),
    semi_connector_seconds: roundTime(Math.max(0.1, ensureNumber(renderer.intro_bracket_semi_connector_seconds, 0.8))),
    finalist_slot_seconds: roundTime(Math.max(0.05, ensureNumber(renderer.intro_bracket_finalist_slot_seconds, 0.18))),
    final_connector_seconds: roundTime(Math.max(0.1, ensureNumber(renderer.intro_bracket_final_connector_seconds, 0.8))),
  };
}

function buildIntroSequence({ template, seed, participantCount, firstBattleStartSeconds }) {
  const holdSeconds = roundTime(ensureNumber(template?.layout?.rounds?.intro_participant_hold_seconds, 2));
  const revealStaggerSeconds = roundTime(
    Math.max(0.05, ensureNumber(template?.renderer?.intro_slot_reveal_stagger_seconds, 0.3)),
  );
  const revealFadeSeconds = roundTime(
    Math.max(0.08, ensureNumber(template?.renderer?.intro_slot_reveal_fade_seconds, 0.18)),
  );
  const revealOrder = buildSeededRevealOrder(participantCount, `${seed}:showdown-intro-reveal`);
  const revealWindowSeconds = participantCount > 0
    ? roundTime(revealFadeSeconds + (Math.max(0, participantCount - 1) * revealStaggerSeconds))
    : 0;
  const participantRevealStartSeconds = roundTime(
    Math.max(0, firstBattleStartSeconds - holdSeconds - revealWindowSeconds),
  );
  const participantRevealEndSeconds = roundTime(participantRevealStartSeconds + revealWindowSeconds);
  const participantRevealTimes = Array.from(
    { length: participantCount },
    () => participantRevealStartSeconds,
  );
  revealOrder.forEach((participantIndex, orderIndex) => {
    participantRevealTimes[participantIndex] = roundTime(
      participantRevealStartSeconds + (orderIndex * revealStaggerSeconds),
    );
  });
  const bracketStageSeconds = resolveIntroBracketStageDurations(template);
  return {
    bracket_draw_start_seconds: 0,
    bracket_draw_end_seconds: participantRevealStartSeconds,
    bracket_stage_seconds: bracketStageSeconds,
    participant_hold_end_seconds: roundTime(firstBattleStartSeconds),
    participant_hold_start_seconds: participantRevealEndSeconds,
    participant_reveal_end_seconds: participantRevealEndSeconds,
    participant_reveal_fade_seconds: revealFadeSeconds,
    participant_reveal_order: revealOrder,
    participant_reveal_start_seconds: participantRevealStartSeconds,
    participant_reveal_stagger_seconds: revealStaggerSeconds,
    participant_reveal_times: participantRevealTimes,
  };
}

function buildRenderedMatches(template, matches = [], participantCount = 0) {
  const rounds = template?.layout?.rounds || {};
  const hookHoldSeconds = roundTime(ensureNumber(rounds.hook_hold_seconds, 1.1));
  const introParticipantHoldSeconds = roundTime(
    ensureNumber(rounds.intro_participant_hold_seconds, 2),
  );
  const introParticipantRevealWindowSeconds = roundTime(
    Math.max(0.08, ensureNumber(template?.renderer?.intro_slot_reveal_fade_seconds, 0.18))
      + (Math.max(0, participantCount - 1)
        * Math.max(0.05, ensureNumber(template?.renderer?.intro_slot_reveal_stagger_seconds, 0.3))),
  );
  const interRoundBracketHoldSeconds = roundTime(ensureNumber(rounds.inter_round_bracket_hold_seconds, 0.08));
  const postProgressHoldSeconds = roundTime(ensureNumber(rounds.post_progress_hold_seconds, 0.3));
  const matchIntroHoldSeconds = roundTime(ensureNumber(rounds.match_intro_hold_seconds, 1.8));
  const suspenseHoldSeconds = roundTime(ensureNumber(rounds.suspense_hold_seconds, 0.9));
  const revealHoldSeconds = roundTime(ensureNumber(rounds.reveal_hold_seconds, 1.2));
  const transitionDurationSeconds = roundTime(ensureNumber(rounds.transition_duration_seconds, 0.4));
  const bracketStageSeconds = resolveIntroBracketStageDurations(template);
  const bracketDrawLeadSeconds = bracketStageSeconds
    ? roundTime(
      bracketStageSeconds.semi_slot_seconds
      + bracketStageSeconds.semi_connector_seconds
      + bracketStageSeconds.finalist_slot_seconds
      + bracketStageSeconds.final_connector_seconds,
    )
    : 0;
  const firstRoundLeadSeconds = roundTime(Math.max(
    hookHoldSeconds + introParticipantRevealWindowSeconds + introParticipantHoldSeconds,
    bracketDrawLeadSeconds + introParticipantRevealWindowSeconds + introParticipantHoldSeconds,
  ));
  let currentStart = 0;

  const renderedMatches = matches.map((match, index) => {
    const introDelaySeconds = index === 0 ? firstRoundLeadSeconds : interRoundBracketHoldSeconds;
    const sceneStart = roundTime(currentStart);
    const introStart = roundTime(sceneStart + introDelaySeconds);
    const revealStart = roundTime(introStart + matchIntroHoldSeconds + suspenseHoldSeconds);
    const transitionSeconds = index === matches.length - 1 ? 0 : transitionDurationSeconds;
    const sceneEnd = roundTime(revealStart + revealHoldSeconds + transitionSeconds);
    const battleTransitionStartSeconds = roundTime(
      Math.max(
        sceneStart,
        introStart - transitionDurationSeconds,
      ),
    );
    currentStart = sceneEnd;
    return {
      ...match,
      scene_start_seconds: sceneStart,
      intro_start_seconds: introStart,
      battle_transition_start_seconds: battleTransitionStartSeconds,
      battle_transition_duration_seconds: transitionDurationSeconds,
      reveal_start_seconds: revealStart,
      scene_end_seconds: sceneEnd,
      transition_duration_seconds: transitionSeconds,
      hook_visible_until_seconds: index === 0 ? introStart : null,
    };
  });

  return renderedMatches.map((match, index) => {
    const nextIntroStart = index === renderedMatches.length - 1
      ? roundTime(match.scene_end_seconds + interRoundBracketHoldSeconds)
      : renderedMatches[index + 1].intro_start_seconds;
    const bracketProgressEnd = roundTime(Math.max(
      match.scene_end_seconds + 0.08,
      nextIntroStart - (index === renderedMatches.length - 1 ? 0 : postProgressHoldSeconds),
    ));
    return {
      ...match,
      bracket_progress_start_seconds: match.scene_end_seconds,
      bracket_progress_end_seconds: bracketProgressEnd,
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
  const participantCount = Array.isArray(plan?.tournament?.participants)
    ? plan.tournament.participants.length
    : 0;
  const renderedMatches = buildRenderedMatches(template, plan?.tournament?.matches || [], participantCount);
  const championHoldSeconds = roundTime(ensureNumber(template?.layout?.rounds?.champion_hold_seconds, 1.1));
  const championStart = roundTime(renderedMatches.at(-1)?.bracket_progress_end_seconds || 0);
  const championScene = {
    start_seconds: championStart,
    end_seconds: roundTime(championStart + championHoldSeconds),
  };
  const introSequence = buildIntroSequence({
    template,
    seed: plan?.seed || 'showdown-intro',
    participantCount,
    firstBattleStartSeconds: renderedMatches[0]?.intro_start_seconds || 0,
  });

  return {
    canvas: {
      width: ensureNumber(template?.canvas?.width, 1080),
      height: ensureNumber(template?.canvas?.height, 1920),
      fps: ensureNumber(template?.canvas?.fps, 30),
    },
    seed: String(plan?.seed || ''),
    participant_count: participantCount,
    total_duration_seconds: championScene.end_seconds,
    text_layout: buildTextLayout(template),
    bracket_layout: buildBracketLayout(template),
    battle_stage: buildBattleStageLayout(template),
    champion_stage: buildChampionStageLayout(template),
    intro_sequence: introSequence,
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
    const battleTransitionStartSeconds = roundTime(
      Math.max(
        sceneStart,
        introStart - (match.battle_transition_duration_seconds ?? match.transition_duration_seconds),
      ),
    );
    currentStart = sceneEnd;
    return {
      ...match,
      scene_start_seconds: sceneStart,
      intro_start_seconds: introStart,
      battle_transition_start_seconds: battleTransitionStartSeconds,
      battle_transition_duration_seconds: match.battle_transition_duration_seconds ?? match.transition_duration_seconds,
      reveal_start_seconds: revealStart,
      scene_end_seconds: sceneEnd,
      hook_visible_until_seconds: index === 0 ? introStart : null,
    };
  });
  const finalBracketHoldSeconds = roundTime(Math.max(
    0,
    ensureNumber(
      matches.at(-1)?.bracket_progress_end_seconds - matches.at(-1)?.scene_end_seconds,
      0,
    ),
  ));
  const updatedMatchesWithBracketProgress = updatedMatches.map((match, index) => ({
    ...match,
    bracket_progress_start_seconds: match.scene_end_seconds,
    bracket_progress_end_seconds: index === updatedMatches.length - 1
      ? roundTime(match.scene_end_seconds + finalBracketHoldSeconds)
      : updatedMatches[index + 1].intro_start_seconds,
  }));

  const championBaseDuration = roundTime(
    renderPlan.champion_scene.end_seconds - renderPlan.champion_scene.start_seconds,
  );
  const championDuration = roundTime(Math.max(
    championBaseDuration,
    ensureNumber(durationsByRole.get('champion'), 0),
  ));
  const championStart = roundTime(updatedMatchesWithBracketProgress.at(-1)?.bracket_progress_end_seconds || 0);
  const championScene = {
    ...renderPlan.champion_scene,
    start_seconds: championStart,
    end_seconds: roundTime(championStart + championDuration),
  };
  const introSequence = buildIntroSequence({
    template: {
      layout: {
        rounds: {
          intro_participant_hold_seconds: renderPlan.intro_sequence?.participant_hold_end_seconds
            - renderPlan.intro_sequence?.participant_reveal_end_seconds,
        },
      },
      renderer: {
        intro_slot_reveal_fade_seconds: renderPlan.intro_sequence?.participant_reveal_fade_seconds,
        intro_slot_reveal_stagger_seconds: renderPlan.intro_sequence?.participant_reveal_stagger_seconds,
      },
    },
    seed: renderPlan.seed || 'showdown-intro',
    participantCount: ensureNumber(renderPlan.participant_count, 0),
    firstBattleStartSeconds: updatedMatchesWithBracketProgress[0]?.intro_start_seconds || 0,
  });

  return {
    ...renderPlan,
    intro_sequence: introSequence,
    matches: updatedMatchesWithBracketProgress,
    champion_scene: championScene,
    total_duration_seconds: championScene.end_seconds,
    narration_cues: buildNarrationCueSchedule(updatedMatchesWithBracketProgress, championScene),
  };
}
