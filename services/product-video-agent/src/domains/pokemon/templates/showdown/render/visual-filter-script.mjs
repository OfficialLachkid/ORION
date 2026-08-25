import {
  DEFAULT_TEXT_BORDER,
  ensureNumber,
  escapeDrawtextText,
  escapeFilterPath,
} from '../../dual-type-reveal/render/constants.mjs';
import {
  buildAnimatedTextSegmentAlphaExpression,
  buildAnimatedTextYExpression,
  formatEnableBetween,
} from '../../dual-type-reveal/render/animation-expressions.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function buildCardFilters(bracketLayout) {
  return Object.values(bracketLayout.slots).flatMap((slot) => ([
    `drawbox=x=${slot.x}:y=${slot.y}:w=${slot.width}:h=${slot.height}:color=0xFFFFFF@0.95:t=3`,
    `drawbox=x=${slot.x + 3}:y=${slot.y + 3}:w=${slot.width - 6}:h=${slot.height - 6}:color=0x101010@0.32:t=fill`,
  ]));
}

function buildConnectorSegments(bracketLayout) {
  const thickness = ensureNumber(bracketLayout.connector_thickness_px, 10);
  const slots = bracketLayout.slots;
  const leftBranchX = slots.semi_1_a.x + slots.semi_1_a.width + 34;
  const rightBranchX = slots.semi_2_winner.x + slots.semi_2_winner.width + 34;
  const finalMergeY = slots.final_winner.y + slots.final_winner.height + 44;
  const lines = [];

  lines.push(
    `drawbox=x=${slots.semi_1_a.x + slots.semi_1_a.width}:y=${slots.semi_1_a.center_y - (thickness / 2)}:w=${leftBranchX - (slots.semi_1_a.x + slots.semi_1_a.width)}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${slots.semi_1_b.x + slots.semi_1_b.width}:y=${slots.semi_1_b.center_y - (thickness / 2)}:w=${leftBranchX - (slots.semi_1_b.x + slots.semi_1_b.width)}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${leftBranchX - (thickness / 2)}:y=${slots.semi_1_a.center_y}:w=${thickness}:h=${slots.semi_1_b.center_y - slots.semi_1_a.center_y}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${leftBranchX}:y=${slots.semi_1_winner.center_y - (thickness / 2)}:w=${slots.semi_1_winner.x - leftBranchX}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
  );

  lines.push(
    `drawbox=x=${slots.semi_2_winner.x + slots.semi_2_winner.width}:y=${slots.semi_2_winner.center_y - (thickness / 2)}:w=${rightBranchX - (slots.semi_2_winner.x + slots.semi_2_winner.width)}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${rightBranchX - (thickness / 2)}:y=${slots.semi_2_a.center_y}:w=${thickness}:h=${slots.semi_2_b.center_y - slots.semi_2_a.center_y}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${rightBranchX}:y=${slots.semi_2_a.center_y - (thickness / 2)}:w=${slots.semi_2_a.x - rightBranchX}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${rightBranchX}:y=${slots.semi_2_b.center_y - (thickness / 2)}:w=${slots.semi_2_b.x - rightBranchX}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
  );

  lines.push(
    `drawbox=x=${slots.semi_1_winner.center_x - (thickness / 2)}:y=${slots.semi_1_winner.y - 34}:w=${thickness}:h=${slots.semi_1_winner.height + 34}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${slots.semi_2_winner.center_x - (thickness / 2)}:y=${slots.semi_2_winner.y - 34}:w=${thickness}:h=${slots.semi_2_winner.height + 34}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${slots.semi_1_winner.center_x}:y=${finalMergeY - (thickness / 2)}:w=${slots.semi_2_winner.center_x - slots.semi_1_winner.center_x}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`,
    `drawbox=x=${slots.final_winner.center_x - (thickness / 2)}:y=${slots.final_winner.y + slots.final_winner.height}:w=${thickness}:h=${finalMergeY - (slots.final_winner.y + slots.final_winner.height)}:color=0xFFFFFF@0.7:t=fill`,
  );

  return lines;
}

function buildHighlightFilters(renderPlan, template) {
  const currentAlpha = ensureNumber(template?.renderer?.current_slot_highlight_alpha, 0.2);
  const completeAlpha = ensureNumber(template?.renderer?.completed_slot_highlight_alpha, 0.18);
  const slots = renderPlan.bracket_layout.slots;
  const matchToSourceSlotKeys = {
    'semi-final-1': ['semi_1_a', 'semi_1_b'],
    'semi-final-2': ['semi_2_a', 'semi_2_b'],
    final: ['semi_1_winner', 'semi_2_winner'],
  };
  return renderPlan.matches.flatMap((match) => {
    const sourceSlotKeys = matchToSourceSlotKeys[match.match_id] || [];
    const filters = sourceSlotKeys.map((slotKey) => {
      const slot = slots[slotKey];
      return `drawbox=x=${slot.x + 4}:y=${slot.y + 4}:w=${slot.width - 8}:h=${slot.height - 8}:color=0xFFD60A@${currentAlpha}:t=fill:enable='${formatEnableBetween(match.scene_start_seconds, match.scene_end_seconds)}'`;
    });
    const winnerSlotKey = (
      match.match_id === 'semi-final-1' ? 'semi_1_winner'
        : match.match_id === 'semi-final-2' ? 'semi_2_winner'
          : 'final_winner'
    );
    const winnerSlot = slots[winnerSlotKey];
    filters.push(
      `drawbox=x=${winnerSlot.x + 4}:y=${winnerSlot.y + 4}:w=${winnerSlot.width - 8}:h=${winnerSlot.height - 8}:color=0x34C759@${completeAlpha}:t=fill:enable='${formatEnableBetween(match.reveal_start_seconds, match.scene_end_seconds)}'`,
    );
    return filters;
  });
}

function buildSlotSpritePlacement(slot, spriteSize) {
  return {
    x: `${slot.center_x}-w/2`,
    y: `${slot.y + 16}+(${spriteSize}-h)/2`,
  };
}

function buildStageSpritePlacement(centerX, centerY) {
  return {
    x: `${centerX}-w/2`,
    y: `${centerY}-h/2`,
  };
}

function buildChampionSpritePlacement(stage) {
  return {
    x: `${stage.center_x}-w/2`,
    y: `${stage.center_y}-h/2`,
  };
}

function buildSlotNameDrawtext(text, slot, fontPart, fontSize, enableExpression = '') {
  const enablePart = enableExpression ? `:enable='${enableExpression}'` : '';
  return `drawtext=text='${escapeDrawtextText(text)}'${fontPart}:fontcolor=white:fontsize=${fontSize}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${slot.center_x}-text_w/2:y=${slot.y + slot.height - 46}${enablePart}`;
}

function buildPlaceholderDrawtext(slot, fontPart, enableExpression) {
  return `drawtext=text='?'${fontPart}:fontcolor=white:fontsize=84:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${slot.center_x}-text_w/2:y=${slot.y + 32}:enable='${enableExpression}'`;
}

function buildAnimatedSceneText(text, fontPart, fontSize, y, startSeconds, endSeconds, color = 'white') {
  return `drawtext=text='${escapeDrawtextText(text)}'${fontPart}:fontcolor=${color}:fontsize=${fontSize}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y='${buildAnimatedTextYExpression(y, startSeconds)}':alpha='${buildAnimatedTextSegmentAlphaExpression(startSeconds, endSeconds)}':enable='${formatEnableBetween(startSeconds, endSeconds)}'`;
}

export function buildVisualFilterScript(plan, template, renderPlan, inputRefs, fontPath = '') {
  const filters = [];
  const fontPart = buildFontPart(fontPath);
  const fps = ensureNumber(renderPlan.canvas.fps, 30);
  const blurSigma = ensureNumber(template?.layout?.background?.blur_sigma, 3.5);
  const battleStage = renderPlan.battle_stage;
  const championStage = renderPlan.champion_stage;
  const bracketLayout = renderPlan.bracket_layout;
  const slotSpriteSize = ensureNumber(bracketLayout.slot_sprite_size_px, 120);
  const battleSpriteSize = ensureNumber(battleStage.sprite_size_px, 380);
  const championSpriteSize = ensureNumber(championStage.sprite_size_px, 520);
  const loserAlphaMultiplier = ensureNumber(template?.renderer?.loser_alpha_multiplier, 0.46);
  const championParticipantId = plan.tournament?.champion?.id || '';

  filters.push(
    `[${inputRefs.background}:v]fps=${fps},scale=${renderPlan.canvas.width}:${renderPlan.canvas.height}:force_original_aspect_ratio=increase,crop=${renderPlan.canvas.width}:${renderPlan.canvas.height},boxblur=${blurSigma}:1,setsar=1[vbg]`,
  );

  (plan.tournament?.participants || []).forEach((participant, index) => {
    const ref = inputRefs.participants[index];
    const participantFilters = [
      `[${ref}:v]fps=${fps},scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[p${index}slot]`,
      `[${ref}:v]fps=${fps},scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[p${index}stage]`,
      `[p${index}stage]hue=s=0,colorchannelmixer=aa=${loserAlphaMultiplier}[p${index}stagegray]`,
    ];
    if (participant.id === championParticipantId) {
      participantFilters.push(
        `[${ref}:v]fps=${fps},scale=${championSpriteSize}:${championSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[p${index}champ]`,
      );
    }
    filters.push(...participantFilters);
  });

  let currentVideoLabel = 'vbg';
  const bracketBaseLabel = 'vbracketbase';
  filters.push(
    `[${currentVideoLabel}]${[
      ...buildCardFilters(bracketLayout),
      ...buildConnectorSegments(bracketLayout),
      ...buildHighlightFilters(renderPlan, template),
    ].join(',')}[${bracketBaseLabel}]`,
  );
  currentVideoLabel = bracketBaseLabel;

  const participantById = new Map(
    (plan.tournament?.participants || []).map((participant) => [participant.id, participant]),
  );
  const slotMap = bracketLayout.slots;
  const sourceSlotKeys = ['semi_1_a', 'semi_1_b', 'semi_2_a', 'semi_2_b'];
  (plan.tournament?.participants || []).forEach((participant, index) => {
    const slot = slotMap[sourceSlotKeys[index]];
    const placement = buildSlotSpritePlacement(slot, slotSpriteSize);
    const nextLabel = `vslot${index}`;
    filters.push(
      `[${currentVideoLabel}][p${index}slot]overlay=x='${placement.x}':y='${placement.y}'[${nextLabel}]`,
    );
    currentVideoLabel = nextLabel;
  });

  renderPlan.matches.forEach((match, matchIndex) => {
    const winnerSlotKey = (
      match.match_id === 'semi-final-1' ? 'semi_1_winner'
        : match.match_id === 'semi-final-2' ? 'semi_2_winner'
          : 'final_winner'
    );
    const participantIndex = participantById.get(match.winner.id)?.bracket_seed_index ?? 0;
    const slot = slotMap[winnerSlotKey];
    const placement = buildSlotSpritePlacement(slot, slotSpriteSize);
    const nextLabel = `vwinner${matchIndex}`;
    filters.push(
      `[${currentVideoLabel}][p${participantIndex}slot]overlay=x='${placement.x}':y='${placement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, renderPlan.total_duration_seconds)}'[${nextLabel}]`,
    );
    currentVideoLabel = nextLabel;
  });

  renderPlan.matches.forEach((match, matchIndex) => {
    const leftIndex = participantById.get(match.participant_a.id)?.bracket_seed_index ?? 0;
    const rightIndex = participantById.get(match.participant_b.id)?.bracket_seed_index ?? 1;
    const winnerIndex = participantById.get(match.winner.id)?.bracket_seed_index ?? leftIndex;
    const loserIndex = participantById.get(match.loser.id)?.bracket_seed_index ?? rightIndex;
    const leftPlacement = buildStageSpritePlacement(battleStage.left_center_x, battleStage.center_y);
    const rightPlacement = buildStageSpritePlacement(battleStage.right_center_x, battleStage.center_y);

    const preRevealLabel = `vmatchpre${matchIndex}`;
    filters.push(
      `[${currentVideoLabel}][p${leftIndex}stage]overlay=x='${leftPlacement.x}':y='${leftPlacement.y}':enable='${formatEnableBetween(match.scene_start_seconds, match.reveal_start_seconds)}'[${preRevealLabel}]`,
    );
    const preRevealRightLabel = `vmatchprer${matchIndex}`;
    filters.push(
      `[${preRevealLabel}][p${rightIndex}stage]overlay=x='${rightPlacement.x}':y='${rightPlacement.y}':enable='${formatEnableBetween(match.scene_start_seconds, match.reveal_start_seconds)}'[${preRevealRightLabel}]`,
    );

    const winnerPlacement = winnerIndex === leftIndex ? leftPlacement : rightPlacement;
    const loserPlacement = loserIndex === leftIndex ? leftPlacement : rightPlacement;
    const postWinnerLabel = `vmatchwin${matchIndex}`;
    filters.push(
      `[${preRevealRightLabel}][p${winnerIndex}stage]overlay=x='${winnerPlacement.x}':y='${winnerPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, match.scene_end_seconds)}'[${postWinnerLabel}]`,
    );
    const postLoserLabel = `vmatchlose${matchIndex}`;
    filters.push(
      `[${postWinnerLabel}][p${loserIndex}stagegray]overlay=x='${loserPlacement.x}':y='${loserPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, match.scene_end_seconds)}'[${postLoserLabel}]`,
    );
    currentVideoLabel = postLoserLabel;
  });

  const championIndex = participantById.get(plan.tournament?.champion?.id || '')?.bracket_seed_index ?? 0;
  const championPlacement = buildChampionSpritePlacement(championStage);
  const championLabel = 'vchamp';
  filters.push(
    `[${currentVideoLabel}][p${championIndex}champ]overlay=x='${championPlacement.x}':y='${championPlacement.y}':enable='${formatEnableBetween(renderPlan.champion_scene.start_seconds, renderPlan.champion_scene.end_seconds)}'[${championLabel}]`,
  );
  currentVideoLabel = championLabel;

  const drawtextParts = [];
  const firstMatch = renderPlan.matches[0];
  if (firstMatch) {
    drawtextParts.push(
      buildAnimatedSceneText(
        plan.narration?.lines?.[0]?.text || '',
        fontPart,
        renderPlan.text_layout.hook_font_size,
        renderPlan.text_layout.hook_y,
        0,
        firstMatch.intro_start_seconds,
      ),
    );
  }

  (plan.tournament?.participants || []).forEach((participant, index) => {
    const slot = slotMap[sourceSlotKeys[index]];
    drawtextParts.push(
      buildSlotNameDrawtext(
        participant.display_name,
        slot,
        fontPart,
        bracketLayout.slot_name_font_size,
      ),
    );
  });

  drawtextParts.push(
    buildPlaceholderDrawtext(slotMap.semi_1_winner, fontPart, `lt(t,${renderPlan.matches[0]?.reveal_start_seconds || 0})`),
    buildPlaceholderDrawtext(slotMap.semi_2_winner, fontPart, `lt(t,${renderPlan.matches[1]?.reveal_start_seconds || 0})`),
    buildPlaceholderDrawtext(slotMap.final_winner, fontPart, `lt(t,${renderPlan.matches[2]?.reveal_start_seconds || 0})`),
  );

  renderPlan.matches.forEach((match) => {
    const winnerSlotKey = (
      match.match_id === 'semi-final-1' ? 'semi_1_winner'
        : match.match_id === 'semi-final-2' ? 'semi_2_winner'
          : 'final_winner'
    );
    drawtextParts.push(
      buildSlotNameDrawtext(
        match.winner.display_name,
        slotMap[winnerSlotKey],
        fontPart,
        bracketLayout.slot_name_font_size,
        formatEnableBetween(match.reveal_start_seconds, renderPlan.total_duration_seconds),
      ),
      buildAnimatedSceneText(
        match.round_label,
        fontPart,
        renderPlan.text_layout.round_font_size,
        renderPlan.text_layout.round_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
      ),
      buildAnimatedSceneText(
        `${match.participant_a.display_name} vs ${match.participant_b.display_name}`,
        fontPart,
        renderPlan.text_layout.matchup_font_size,
        renderPlan.text_layout.matchup_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
      ),
      buildAnimatedSceneText(
        match.insight_text,
        fontPart,
        renderPlan.text_layout.insight_font_size,
        renderPlan.text_layout.insight_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
      ),
      buildAnimatedSceneText(
        match.winner_line_text,
        fontPart,
        renderPlan.text_layout.winner_font_size,
        renderPlan.text_layout.winner_y,
        match.reveal_start_seconds,
        match.scene_end_seconds,
        '0xFFD60A',
      ),
      `drawtext=text='${escapeDrawtextText(match.participant_a.display_name)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.battle_stage.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.battle_stage.left_center_x}-text_w/2:y=${renderPlan.battle_stage.name_y}:enable='${formatEnableBetween(match.scene_start_seconds, match.scene_end_seconds)}'`,
      `drawtext=text='${escapeDrawtextText(match.participant_b.display_name)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.battle_stage.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.battle_stage.right_center_x}-text_w/2:y=${renderPlan.battle_stage.name_y}:enable='${formatEnableBetween(match.scene_start_seconds, match.scene_end_seconds)}'`,
      `drawtext=text='VS'${fontPart}:fontcolor=0xFFD60A:fontsize=${renderPlan.battle_stage.vs_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${renderPlan.battle_stage.vs_y}:enable='${formatEnableBetween(match.scene_start_seconds, match.reveal_start_seconds)}'`,
    );
  });

  drawtextParts.push(
    buildAnimatedSceneText(
      `Champion: ${plan.tournament?.champion?.display_name || ''}`,
      fontPart,
      renderPlan.text_layout.champion_font_size,
      renderPlan.text_layout.champion_y,
      renderPlan.champion_scene.start_seconds,
      renderPlan.champion_scene.end_seconds,
      '0xFFD60A',
    ),
    `drawtext=text='${escapeDrawtextText(plan.tournament?.champion?.display_name || '')}'${fontPart}:fontcolor=white:fontsize=${renderPlan.champion_stage.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${renderPlan.champion_stage.name_y}:enable='${formatEnableBetween(renderPlan.champion_scene.start_seconds, renderPlan.champion_scene.end_seconds)}'`,
  );

  filters.push(
    `[${currentVideoLabel}]${drawtextParts.join(',')},trim=duration=${renderPlan.total_duration_seconds}[vout]`,
  );

  return {
    script: `${filters.join(';\n')}\n`,
  };
}
