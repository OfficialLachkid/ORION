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
import {
  estimateWrapCharacterLimit,
  wrapTextBlock,
} from '../../dual-type-reveal/render/text-layout.mjs';

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function buildCardFilters(bracketLayout) {
  return Object.values(bracketLayout.slots).flatMap((slot) => ([
    `drawbox=x=${slot.x}:y=${slot.y}:w=${slot.width}:h=${slot.height}:color=0xFFFFFF@0.95:t=3`,
    `drawbox=x=${slot.x + 3}:y=${slot.y + 3}:w=${slot.width - 6}:h=${slot.height - 6}:color=0x101010@0.32:t=fill`,
  ]));
}

function buildHorizontalConnector(y, x1, x2, thickness) {
  return `drawbox=x=${Math.min(x1, x2)}:y=${round((y - (thickness / 2)))}:w=${Math.max(1, Math.abs(x2 - x1))}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`;
}

function buildVerticalConnector(x, y1, y2, thickness) {
  return `drawbox=x=${round((x - (thickness / 2)))}:y=${Math.min(y1, y2)}:w=${thickness}:h=${Math.max(1, Math.abs(y2 - y1))}:color=0xFFFFFF@0.7:t=fill`;
}

function round(value) {
  return Math.round(ensureNumber(value, 0));
}

function buildConnectorSegments(bracketLayout) {
  const thickness = ensureNumber(bracketLayout.connector_thickness_px, 10);
  const slots = bracketLayout.slots;
  const lines = [];
  const leftSourceRight = slots.semi_1_a.x + slots.semi_1_a.width;
  const rightSourceLeft = slots.semi_2_a.x;
  const leftWinnerCenterX = slots.semi_1_winner.center_x;
  const rightWinnerCenterX = slots.semi_2_winner.center_x;
  const finalCenterX = slots.final_winner.center_x;
  const finalMergeY = round((slots.final_winner.center_y + slots.semi_1_winner.center_y) / 2);

  lines.push(
    buildHorizontalConnector(slots.semi_1_a.center_y, leftSourceRight, leftWinnerCenterX, thickness),
    buildHorizontalConnector(slots.semi_1_b.center_y, leftSourceRight, leftWinnerCenterX, thickness),
    buildVerticalConnector(leftWinnerCenterX, slots.semi_1_a.center_y, slots.semi_1_b.center_y, thickness),
  );

  lines.push(
    buildHorizontalConnector(slots.semi_2_a.center_y, rightSourceLeft, rightWinnerCenterX, thickness),
    buildHorizontalConnector(slots.semi_2_b.center_y, rightSourceLeft, rightWinnerCenterX, thickness),
    buildVerticalConnector(rightWinnerCenterX, slots.semi_2_a.center_y, slots.semi_2_b.center_y, thickness),
  );

  lines.push(
    buildVerticalConnector(slots.semi_1_winner.center_x, slots.semi_1_winner.center_y, finalMergeY, thickness),
    buildVerticalConnector(slots.semi_2_winner.center_x, slots.semi_2_winner.center_y, finalMergeY, thickness),
    buildHorizontalConnector(finalMergeY, slots.semi_1_winner.center_x, slots.semi_2_winner.center_x, thickness),
    buildVerticalConnector(finalCenterX, slots.final_winner.center_y, finalMergeY, thickness),
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
    x: `${slot.center_x}-overlay_w/2`,
    y: `${slot.y + 16}+(${spriteSize}-overlay_h)/2`,
  };
}

function buildStageSpritePlacement(centerX, centerY) {
  return {
    x: `${centerX}-overlay_w/2`,
    y: `${centerY}-overlay_h/2`,
  };
}

function buildChampionSpritePlacement(stage) {
  return {
    x: `${stage.center_x}-overlay_w/2`,
    y: `${stage.center_y}-overlay_h/2`,
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

function buildAnimatedSceneTextBlock(
  text,
  fontPart,
  template,
  fontSize,
  y,
  startSeconds,
  endSeconds,
  {
    color = 'white',
    maxLines = 2,
  } = {},
) {
  const safeTop = ensureNumber(template?.canvas?.safe_zone?.top, 160);
  const lineHeight = Math.round(fontSize + 12);
  const maxCharactersPerLine = Math.max(10, Math.floor(estimateWrapCharacterLimit(template, fontSize) * 0.92));
  const wrapped = wrapTextBlock(text, {
    maxCharactersPerLine,
    maxLines,
  });
  const lines = wrapped.lines.length > 0 ? wrapped.lines : [String(text || '').trim()].filter(Boolean);
  const blockStartY = Math.max(
    safeTop - 8,
    Math.round(y - (((Math.max(1, lines.length) - 1) * lineHeight) / 2)),
  );
  return lines.map((lineText, index) => (
    buildAnimatedSceneText(
      lineText,
      fontPart,
      fontSize,
      blockStartY + (index * lineHeight),
      startSeconds,
      endSeconds,
      color,
    )
  ));
}

function buildWindowExpression(windows = []) {
  const parts = windows
    .filter((window) => ensureNumber(window?.end, 0) > ensureNumber(window?.start, 0))
    .map((window) => `between(t,${window.start},${window.end})`);
  return parts.length > 0 ? parts.join('+') : '';
}

function buildAndEnableExpression(...expressions) {
  const parts = expressions
    .map((expression) => String(expression || '').trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  return parts.map((expression) => `(${expression})`).join('*');
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
  const matchBackgroundLabels = renderPlan.matches.map((_, index) => `vbgmatch${index}`);
  const championBackgroundLabel = 'vbgchamp';
  const loserParticipantIds = new Set(
    (renderPlan.matches || []).map((match) => match.loser?.id).filter(Boolean),
  );
  const slotLabelQueues = new Map();
  const stageLabelQueues = new Map();
  const stageGrayLabels = new Map();
  const championStageLabels = new Map();

  filters.push(
    `[${inputRefs.background}:v]fps=${fps},scale=${renderPlan.canvas.width}:${renderPlan.canvas.height}:force_original_aspect_ratio=increase,crop=${renderPlan.canvas.width}:${renderPlan.canvas.height},boxblur=${blurSigma}:1,setsar=1,split=${1 + matchBackgroundLabels.length + 1}[vbgbase]${matchBackgroundLabels.map((label) => `[${label}]`).join('')}[${championBackgroundLabel}]`,
  );

  (plan.tournament?.participants || []).forEach((participant, index) => {
    const ref = inputRefs.participants[index];
    const slotUsageCount = 1 + renderPlan.matches.filter((match) => match.winner?.id === participant.id).length;
    const stageUsageCount = renderPlan.matches.reduce((count, match) => {
      const appearsInMatch = match.participant_a.id === participant.id || match.participant_b.id === participant.id;
      const winsMatch = match.winner?.id === participant.id;
      return count + (appearsInMatch ? 1 : 0) + (winsMatch ? 1 : 0);
    }, 0);
    const stageGrayUsageCount = loserParticipantIds.has(participant.id) ? 1 : 0;
    const championUsageCount = participant.id === championParticipantId ? 1 : 0;
    const slotLabels = Array.from({ length: slotUsageCount }, (_, usageIndex) => `p${index}slot${usageIndex}`);
    const stageLabels = Array.from({ length: stageUsageCount }, (_, usageIndex) => `p${index}stage${usageIndex}`);
    const slotSourceLabels = slotLabels.map((_, usageIndex) => `p${index}slotsrc${usageIndex}`);
    const stageSourceLabels = stageLabels.map((_, usageIndex) => `p${index}stagesrc${usageIndex}`);
    const stageGraySourceLabel = stageGrayUsageCount > 0 ? `p${index}stagegraysrc0` : '';
    const stageGrayLabel = stageGrayUsageCount > 0 ? `p${index}stagegray0` : '';
    const championSourceLabel = championUsageCount > 0 ? `p${index}champsrc0` : '';
    const championLabel = championUsageCount > 0 ? `p${index}champ0` : '';
    slotLabelQueues.set(index, [...slotLabels]);
    stageLabelQueues.set(index, [...stageLabels]);
    if (stageGrayLabel) {
      stageGrayLabels.set(index, stageGrayLabel);
    }
    if (championLabel) {
      championStageLabels.set(index, championLabel);
    }
    const branchLabels = [
      ...slotSourceLabels.map((label) => `[${label}]`),
      ...stageSourceLabels.map((label) => `[${label}]`),
      ...(stageGraySourceLabel ? [`[${stageGraySourceLabel}]`] : []),
      ...(championSourceLabel ? [`[${championSourceLabel}]`] : []),
    ];
    const participantFilters = [
      `[${ref}:v]fps=${fps},trim=duration=${renderPlan.total_duration_seconds},setpts=PTS-STARTPTS,split=${branchLabels.length}${branchLabels.join('')}`,
    ];
    slotSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${slotLabels[usageIndex]}]`,
      );
    });
    stageSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${stageLabels[usageIndex]}]`,
      );
    });
    if (stageGraySourceLabel && stageGrayLabel) {
      participantFilters.push(
        `[${stageGraySourceLabel}]scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1,hue=s=0,colorchannelmixer=aa=${loserAlphaMultiplier}[${stageGrayLabel}]`,
      );
    }
    if (championSourceLabel && championLabel) {
      participantFilters.push(
        `[${championSourceLabel}]scale=${championSpriteSize}:${championSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${championLabel}]`,
      );
    }
    filters.push(...participantFilters);
  });

  let currentVideoLabel = 'vbgbase';
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
  const bracketVisibleWindows = [];
  if (renderPlan.matches[0]) {
    bracketVisibleWindows.push({
      start: 0,
      end: renderPlan.matches[0].intro_start_seconds,
    });
  }
  for (let index = 0; index < renderPlan.matches.length - 1; index += 1) {
    const currentMatch = renderPlan.matches[index];
    const nextMatch = renderPlan.matches[index + 1];
    if (ensureNumber(nextMatch?.intro_start_seconds, 0) > ensureNumber(currentMatch?.scene_end_seconds, 0)) {
      bracketVisibleWindows.push({
        start: currentMatch.scene_end_seconds,
        end: nextMatch.intro_start_seconds,
      });
    }
  }
  const bracketVisibleExpression = buildWindowExpression(bracketVisibleWindows);
  (plan.tournament?.participants || []).forEach((participant, index) => {
    const slot = slotMap[sourceSlotKeys[index]];
    const placement = buildSlotSpritePlacement(slot, slotSpriteSize);
    const nextLabel = `vslot${index}`;
    const slotLabel = slotLabelQueues.get(index)?.shift();
    filters.push(
      `[${currentVideoLabel}][${slotLabel}]overlay=x='${placement.x}':y='${placement.y}'[${nextLabel}]`,
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
    const winnerSlotLabel = slotLabelQueues.get(participantIndex)?.shift();
    filters.push(
      `[${currentVideoLabel}][${winnerSlotLabel}]overlay=x='${placement.x}':y='${placement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, renderPlan.total_duration_seconds)}'[${nextLabel}]`,
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
    const stageSceneBaseLabel = `vmatchscene${matchIndex}`;
    const leftStageLabel = stageLabelQueues.get(leftIndex)?.shift();
    const rightStageLabel = stageLabelQueues.get(rightIndex)?.shift();
    const winnerStageLabel = stageLabelQueues.get(winnerIndex)?.shift();
    const loserStageGrayLabel = stageGrayLabels.get(loserIndex);

    filters.push(
      `[${currentVideoLabel}][${matchBackgroundLabels[matchIndex]}]overlay=x=0:y=0:enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'[${stageSceneBaseLabel}]`,
    );

    const preRevealLabel = `vmatchpre${matchIndex}`;
    filters.push(
      `[${stageSceneBaseLabel}][${leftStageLabel}]overlay=x='${leftPlacement.x}':y='${leftPlacement.y}':enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'[${preRevealLabel}]`,
    );
    const preRevealRightLabel = `vmatchprer${matchIndex}`;
    filters.push(
      `[${preRevealLabel}][${rightStageLabel}]overlay=x='${rightPlacement.x}':y='${rightPlacement.y}':enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'[${preRevealRightLabel}]`,
    );

    const winnerPlacement = winnerIndex === leftIndex ? leftPlacement : rightPlacement;
    const loserPlacement = loserIndex === leftIndex ? leftPlacement : rightPlacement;
    const postWinnerLabel = `vmatchwin${matchIndex}`;
    filters.push(
      `[${preRevealRightLabel}][${winnerStageLabel}]overlay=x='${winnerPlacement.x}':y='${winnerPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, match.scene_end_seconds)}'[${postWinnerLabel}]`,
    );
    const postLoserLabel = `vmatchlose${matchIndex}`;
    filters.push(
      `[${postWinnerLabel}][${loserStageGrayLabel}]overlay=x='${loserPlacement.x}':y='${loserPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, match.scene_end_seconds)}'[${postLoserLabel}]`,
    );
    currentVideoLabel = postLoserLabel;
  });

  const championIndex = participantById.get(plan.tournament?.champion?.id || '')?.bracket_seed_index ?? 0;
  const championPlacement = buildChampionSpritePlacement(championStage);
  const championSceneBaseLabel = 'vchampbg';
  filters.push(
    `[${currentVideoLabel}][${championBackgroundLabel}]overlay=x=0:y=0:enable='${formatEnableBetween(renderPlan.champion_scene.start_seconds, renderPlan.champion_scene.end_seconds)}'[${championSceneBaseLabel}]`,
  );
  const championLabel = 'vchamp';
  const championStageLabel = championStageLabels.get(championIndex);
  filters.push(
    `[${championSceneBaseLabel}][${championStageLabel}]overlay=x='${championPlacement.x}':y='${championPlacement.y}':enable='${formatEnableBetween(renderPlan.champion_scene.start_seconds, renderPlan.champion_scene.end_seconds)}'[${championLabel}]`,
  );
  currentVideoLabel = championLabel;

  const drawtextParts = [];
  const firstMatch = renderPlan.matches[0];
  if (firstMatch) {
    drawtextParts.push(
      ...buildAnimatedSceneTextBlock(
        plan.narration?.lines?.[0]?.text || '',
        fontPart,
        template,
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
        bracketVisibleExpression,
      ),
    );
  });

  drawtextParts.push(
    buildPlaceholderDrawtext(slotMap.semi_1_winner, fontPart, buildAndEnableExpression(bracketVisibleExpression, `lt(t,${renderPlan.matches[0]?.reveal_start_seconds || 0})`)),
    buildPlaceholderDrawtext(slotMap.semi_2_winner, fontPart, buildAndEnableExpression(bracketVisibleExpression, `lt(t,${renderPlan.matches[1]?.reveal_start_seconds || 0})`)),
    buildPlaceholderDrawtext(slotMap.final_winner, fontPart, buildAndEnableExpression(bracketVisibleExpression, `lt(t,${renderPlan.matches[2]?.reveal_start_seconds || 0})`)),
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
        buildAndEnableExpression(
          bracketVisibleExpression,
          `gte(t,${match.reveal_start_seconds})`,
        ),
      ),
      ...buildAnimatedSceneTextBlock(
        match.round_label,
        fontPart,
        template,
        renderPlan.text_layout.round_font_size,
        renderPlan.text_layout.round_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
        { maxLines: 1 },
      ),
      ...buildAnimatedSceneTextBlock(
        `${match.participant_a.display_name} vs ${match.participant_b.display_name}`,
        fontPart,
        template,
        renderPlan.text_layout.matchup_font_size,
        renderPlan.text_layout.matchup_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
        { maxLines: 2 },
      ),
      ...buildAnimatedSceneTextBlock(
        match.insight_text,
        fontPart,
        template,
        renderPlan.text_layout.insight_font_size,
        renderPlan.text_layout.insight_y,
        match.intro_start_seconds,
        match.reveal_start_seconds,
        { maxLines: 2 },
      ),
      ...buildAnimatedSceneTextBlock(
        match.winner_line_text,
        fontPart,
        template,
        renderPlan.text_layout.winner_font_size,
        renderPlan.text_layout.winner_y,
        match.reveal_start_seconds,
        match.scene_end_seconds,
        { color: '0xFFD60A', maxLines: 2 },
      ),
      `drawtext=text='${escapeDrawtextText(match.participant_a.display_name)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.battle_stage.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.battle_stage.left_center_x}-text_w/2:y=${renderPlan.battle_stage.name_y}:enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'`,
      `drawtext=text='${escapeDrawtextText(match.participant_b.display_name)}'${fontPart}:fontcolor=white:fontsize=${renderPlan.battle_stage.name_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=${renderPlan.battle_stage.right_center_x}-text_w/2:y=${renderPlan.battle_stage.name_y}:enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'`,
      `drawtext=text='VS'${fontPart}:fontcolor=0xFFD60A:fontsize=${renderPlan.battle_stage.vs_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${renderPlan.battle_stage.vs_y}:enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'`,
    );
  });

  drawtextParts.push(
    ...buildAnimatedSceneTextBlock(
      `Champion: ${plan.tournament?.champion?.display_name || ''}`,
      fontPart,
      template,
      renderPlan.text_layout.champion_font_size,
      renderPlan.text_layout.champion_y,
      renderPlan.champion_scene.start_seconds,
      renderPlan.champion_scene.end_seconds,
      { color: '0xFFD60A', maxLines: 2 },
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
