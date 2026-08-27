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

const SHOWDOWN_STAT_ROWS = Object.freeze([
  { key: 'hp', label: 'HP', color: '0xFF5A5F', background: '0xFFB7BA' },
  { key: 'attack', label: 'Attack', color: '0xFF8A2A', background: '0xFFD0A6' },
  { key: 'defense', label: 'Defense', color: '0xFFD63A', background: '0xFFF0A3' },
  { key: 'special_attack', label: 'Sp. Atk', color: '0x6F8FF6', background: '0xB8C8FF' },
  { key: 'special_defense', label: 'Sp. Def', color: '0x7ACB50', background: '0xCBE8B0' },
  { key: 'speed', label: 'Speed', color: '0xF45C97', background: '0xF7B6CF' },
]);
const SHOWDOWN_SOURCE_SLOT_KEYS = Object.freeze(['semi_1_a', 'semi_1_b', 'semi_2_a', 'semi_2_b']);

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function buildEnablePart(enableExpression = '') {
  return enableExpression ? `:enable='${enableExpression}'` : '';
}

function buildCardFilters(bracketLayout, revealSchedule = {}) {
  return Object.entries(bracketLayout.slots).flatMap(([slotKey, slot]) => {
    const enableExpression = revealSchedule[slotKey]
      ? `gte(t,${revealSchedule[slotKey]})`
      : '';
    const enablePart = buildEnablePart(enableExpression);
    return [
      `drawbox=x=${slot.x}:y=${slot.y}:w=${slot.width}:h=${slot.height}:color=0xFFFFFF@0.95:t=3${enablePart}`,
      `drawbox=x=${slot.x + 3}:y=${slot.y + 3}:w=${slot.width - 6}:h=${slot.height - 6}:color=0x101010@0.32:t=fill${enablePart}`,
    ];
  });
}

function buildHorizontalConnector(y, x1, x2, thickness, enableExpression = '') {
  return `drawbox=x=${Math.min(x1, x2)}:y=${round((y - (thickness / 2)))}:w=${Math.max(1, Math.abs(x2 - x1))}:h=${thickness}:color=0xFFFFFF@0.7:t=fill${buildEnablePart(enableExpression)}`;
}

function buildVerticalConnector(x, y1, y2, thickness, enableExpression = '') {
  return `drawbox=x=${round((x - (thickness / 2)))}:y=${Math.min(y1, y2)}:w=${thickness}:h=${Math.max(1, Math.abs(y2 - y1))}:color=0xFFFFFF@0.7:t=fill${buildEnablePart(enableExpression)}`;
}

function buildAnimatedExtentExpression(fullLength, startSeconds, endSeconds) {
  const safeStart = ensureNumber(startSeconds, 0);
  const safeEnd = Math.max(safeStart + 0.01, ensureNumber(endSeconds, safeStart + 0.01));
  const safeDuration = round(((safeEnd - safeStart) * 1000)) / 1000;
  return `if(lt(t,${safeStart}),0,if(lt(t,${safeEnd}),${fullLength}*((t-${safeStart})/${safeDuration}),${fullLength}))`;
}

function buildAnimatedHorizontalConnectorSegment(y, startX, endX, thickness, startSeconds, endSeconds) {
  const fullWidth = Math.max(1, Math.abs(endX - startX));
  const widthExpression = buildAnimatedExtentExpression(fullWidth, startSeconds, endSeconds);
  const xExpression = endX >= startX
    ? `${startX}`
    : `${startX}-${widthExpression}`;
  return `drawbox=x=${xExpression}:y=${round((y - (thickness / 2)))}:w=${widthExpression}:h=${thickness}:color=0xFFFFFF@0.7:t=fill`;
}

function buildAnimatedVerticalConnectorSegment(x, startY, endY, thickness, startSeconds, endSeconds) {
  const fullHeight = Math.max(1, Math.abs(endY - startY));
  const heightExpression = buildAnimatedExtentExpression(fullHeight, startSeconds, endSeconds);
  const yExpression = endY >= startY
    ? `${startY}`
    : `${startY}-${heightExpression}`;
  return `drawbox=x=${round((x - (thickness / 2)))}:y=${yExpression}:w=${thickness}:h=${heightExpression}:color=0xFFFFFF@0.7:t=fill`;
}

function buildAnimatedConnectorPath(points = [], thickness, startSeconds, endSeconds) {
  if (!Array.isArray(points) || points.length < 2) {
    return [];
  }

  const segments = [];
  let totalLength = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const startPoint = points[index];
    const endPoint = points[index + 1];
    if (!startPoint || !endPoint) {
      continue;
    }
    const deltaX = endPoint.x - startPoint.x;
    const deltaY = endPoint.y - startPoint.y;
    const isHorizontal = deltaY === 0;
    const segmentLength = isHorizontal ? Math.abs(deltaX) : Math.abs(deltaY);
    if (segmentLength <= 0) {
      continue;
    }
    segments.push({
      startPoint,
      endPoint,
      isHorizontal,
      segmentLength,
    });
    totalLength += segmentLength;
  }

  if (segments.length === 0 || totalLength <= 0) {
    return [];
  }

  const totalDuration = Math.max(0.01, ensureNumber(endSeconds, startSeconds + 0.01) - ensureNumber(startSeconds, 0));
  let traversedLength = 0;

  return segments.map((segment) => {
    const segmentStartSeconds = round((startSeconds + ((traversedLength / totalLength) * totalDuration)) * 1000) / 1000;
    traversedLength += segment.segmentLength;
    const segmentEndSeconds = round((startSeconds + ((traversedLength / totalLength) * totalDuration)) * 1000) / 1000;

    return segment.isHorizontal
      ? buildAnimatedHorizontalConnectorSegment(
        segment.startPoint.y,
        segment.startPoint.x,
        segment.endPoint.x,
        thickness,
        segmentStartSeconds,
        segmentEndSeconds,
      )
      : buildAnimatedVerticalConnectorSegment(
        segment.startPoint.x,
        segment.startPoint.y,
        segment.endPoint.y,
        thickness,
        segmentStartSeconds,
        segmentEndSeconds,
      );
  });
}

function round(value) {
  return Math.round(ensureNumber(value, 0));
}

function buildPairConnectorY(winnerSlot, leftSourceSlot, rightSourceSlot) {
  const sourceTopY = Math.min(leftSourceSlot.y, rightSourceSlot.y);
  const winnerBottomY = winnerSlot.y + winnerSlot.height;
  return round((sourceTopY + winnerBottomY) / 2);
}

function buildFinalConnectorY(finalWinnerSlot, leftWinnerSlot, rightWinnerSlot) {
  const semiWinnerTopY = Math.min(leftWinnerSlot.y, rightWinnerSlot.y);
  const finalBottomY = finalWinnerSlot.y + finalWinnerSlot.height;
  return round((semiWinnerTopY + finalBottomY) / 2);
}

function buildConnectorSegments(bracketLayout, revealSchedule = {}) {
  const thickness = ensureNumber(bracketLayout.connector_thickness_px, 10);
  const slots = bracketLayout.slots;
  const lines = [];
  const leftPairConnectorY = buildPairConnectorY(slots.semi_1_winner, slots.semi_1_a, slots.semi_1_b);
  const rightPairConnectorY = buildPairConnectorY(slots.semi_2_winner, slots.semi_2_a, slots.semi_2_b);
  const finalConnectorY = buildFinalConnectorY(
    slots.final_winner,
    slots.semi_1_winner,
    slots.semi_2_winner,
  );
  const leftEnable = revealSchedule.connector_left ? `gte(t,${revealSchedule.connector_left})` : '';
  const rightEnable = revealSchedule.connector_right ? `gte(t,${revealSchedule.connector_right})` : '';
  const finalEnable = revealSchedule.connector_final ? `gte(t,${revealSchedule.connector_final})` : '';
  const connectorWindows = revealSchedule.connector_windows || {};

  if (connectorWindows.connector_left) {
    const window = connectorWindows.connector_left;
    lines.push(
      ...buildAnimatedConnectorPath([
        { x: slots.semi_1_a.center_x, y: slots.semi_1_a.y },
        { x: slots.semi_1_a.center_x, y: leftPairConnectorY },
        { x: slots.semi_1_winner.center_x, y: leftPairConnectorY },
        { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y + slots.semi_1_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
      ...buildAnimatedConnectorPath([
        { x: slots.semi_1_b.center_x, y: slots.semi_1_b.y },
        { x: slots.semi_1_b.center_x, y: leftPairConnectorY },
        { x: slots.semi_1_winner.center_x, y: leftPairConnectorY },
        { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y + slots.semi_1_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
    );
  } else {
    lines.push(
      buildVerticalConnector(slots.semi_1_a.center_x, slots.semi_1_a.y, leftPairConnectorY, thickness, leftEnable),
      buildVerticalConnector(slots.semi_1_b.center_x, slots.semi_1_b.y, leftPairConnectorY, thickness, leftEnable),
      buildHorizontalConnector(leftPairConnectorY, slots.semi_1_a.center_x, slots.semi_1_b.center_x, thickness, leftEnable),
      buildVerticalConnector(
        slots.semi_1_winner.center_x,
        slots.semi_1_winner.y + slots.semi_1_winner.height,
        leftPairConnectorY,
        thickness,
        leftEnable,
      ),
    );
  }

  if (connectorWindows.connector_right) {
    const window = connectorWindows.connector_right;
    lines.push(
      ...buildAnimatedConnectorPath([
        { x: slots.semi_2_a.center_x, y: slots.semi_2_a.y },
        { x: slots.semi_2_a.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y + slots.semi_2_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
      ...buildAnimatedConnectorPath([
        { x: slots.semi_2_b.center_x, y: slots.semi_2_b.y },
        { x: slots.semi_2_b.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y + slots.semi_2_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
    );
  } else {
    lines.push(
      buildVerticalConnector(slots.semi_2_a.center_x, slots.semi_2_a.y, rightPairConnectorY, thickness, rightEnable),
      buildVerticalConnector(slots.semi_2_b.center_x, slots.semi_2_b.y, rightPairConnectorY, thickness, rightEnable),
      buildHorizontalConnector(rightPairConnectorY, slots.semi_2_a.center_x, slots.semi_2_b.center_x, thickness, rightEnable),
      buildVerticalConnector(
        slots.semi_2_winner.center_x,
        slots.semi_2_winner.y + slots.semi_2_winner.height,
        rightPairConnectorY,
        thickness,
        rightEnable,
      ),
    );
  }

  if (connectorWindows.connector_final) {
    const window = connectorWindows.connector_final;
    lines.push(
      ...buildAnimatedConnectorPath([
        { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y },
        { x: slots.semi_1_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: slots.final_winner.y + slots.final_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
      ...buildAnimatedConnectorPath([
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y },
        { x: slots.semi_2_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: slots.final_winner.y + slots.final_winner.height },
      ], thickness, window.start_seconds, window.end_seconds),
    );
  } else {
    lines.push(
      buildVerticalConnector(slots.semi_1_winner.center_x, slots.semi_1_winner.y, finalConnectorY, thickness, finalEnable),
      buildVerticalConnector(slots.semi_2_winner.center_x, slots.semi_2_winner.y, finalConnectorY, thickness, finalEnable),
      buildHorizontalConnector(finalConnectorY, slots.semi_1_winner.center_x, slots.semi_2_winner.center_x, thickness, finalEnable),
      buildVerticalConnector(
        slots.final_winner.center_x,
        slots.final_winner.y + slots.final_winner.height,
        finalConnectorY,
        thickness,
        finalEnable,
      ),
    );
  }

  return lines;
}

function buildIntroRevealSchedule(renderPlan) {
  const introEnd = ensureNumber(
    renderPlan?.intro_sequence?.bracket_draw_end_seconds,
    renderPlan?.matches?.[0]?.intro_start_seconds,
  );
  if (introEnd <= 0) {
    return { slots: {}, connectors: {} };
  }
  const sequence = [
    ['semi_1_a', 'slot'],
    ['semi_1_b', 'slot'],
    ['semi_2_a', 'slot'],
    ['semi_2_b', 'slot'],
    ['connector_left', 'connector'],
    ['connector_right', 'connector'],
    ['semi_1_winner', 'slot'],
    ['semi_2_winner', 'slot'],
    ['connector_final', 'connector'],
    ['final_winner', 'slot'],
  ];
  const stepDuration = introEnd / sequence.length;
  const slots = {};
  const connectors = {};
  const connectorWindows = {};
  sequence.forEach(([key, type], index) => {
    const startSeconds = round(index * stepDuration * 1000) / 1000;
    const endSeconds = round(Math.min(introEnd, (startSeconds + stepDuration)) * 1000) / 1000;
    if (type === 'slot') {
      slots[key] = startSeconds;
    } else {
      connectors[key] = startSeconds;
      connectorWindows[key] = {
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      };
    }
  });
  return { slots, connectors, connector_windows: connectorWindows };
}

function buildPathCoordinateExpression(points = [], axis, startSeconds, endSeconds, overlayDimensionExpression) {
  if (points.length === 0) {
    return '0';
  }
  if (points.length === 1 || endSeconds <= startSeconds) {
    return `${points[0][axis]}-${overlayDimensionExpression}/2`;
  }
  const segmentDuration = (endSeconds - startSeconds) / (points.length - 1);
  const buildSegmentExpression = (index) => {
    const currentPoint = points[index];
    const nextPoint = points[index + 1];
    if (!nextPoint) {
      return `${currentPoint[axis]}-${overlayDimensionExpression}/2`;
    }
    const segmentStart = round((startSeconds + (segmentDuration * index)) * 1000) / 1000;
    const currentValue = currentPoint[axis];
    const nextValue = nextPoint[axis];
    const linear = `${currentValue}+(${nextValue}-${currentValue})*((t-${segmentStart})/${segmentDuration})-${overlayDimensionExpression}/2`;
    if (index === points.length - 2) {
      return linear;
    }
    const segmentEnd = round((segmentStart + segmentDuration) * 1000) / 1000;
    return `if(lt(t,${segmentEnd}),${linear},${buildSegmentExpression(index + 1)})`;
  };
  return buildSegmentExpression(0);
}

function buildBracketProgressPath(slotMap, match) {
  const leftPairConnectorY = buildPairConnectorY(slotMap.semi_1_winner, slotMap.semi_1_a, slotMap.semi_1_b);
  const rightPairConnectorY = buildPairConnectorY(slotMap.semi_2_winner, slotMap.semi_2_a, slotMap.semi_2_b);
  const finalConnectorY = buildFinalConnectorY(
    slotMap.final_winner,
    slotMap.semi_1_winner,
    slotMap.semi_2_winner,
  );
  if (match.match_id === 'semi-final-1') {
    const sourceSlot = match.winner_side === 'left' ? slotMap.semi_1_a : slotMap.semi_1_b;
    const winnerSlot = slotMap.semi_1_winner;
    return [
      { center_x: sourceSlot.center_x, center_y: sourceSlot.center_y },
      { center_x: sourceSlot.center_x, center_y: leftPairConnectorY },
      { center_x: winnerSlot.center_x, center_y: leftPairConnectorY },
      { center_x: winnerSlot.center_x, center_y: winnerSlot.center_y },
    ];
  }
  if (match.match_id === 'semi-final-2') {
    const sourceSlot = match.winner_side === 'left' ? slotMap.semi_2_a : slotMap.semi_2_b;
    const winnerSlot = slotMap.semi_2_winner;
    return [
      { center_x: sourceSlot.center_x, center_y: sourceSlot.center_y },
      { center_x: sourceSlot.center_x, center_y: rightPairConnectorY },
      { center_x: winnerSlot.center_x, center_y: rightPairConnectorY },
      { center_x: winnerSlot.center_x, center_y: winnerSlot.center_y },
    ];
  }
  const sourceSlot = match.winner_side === 'left' ? slotMap.semi_1_winner : slotMap.semi_2_winner;
  const winnerSlot = slotMap.final_winner;
  return [
    { center_x: sourceSlot.center_x, center_y: sourceSlot.center_y },
    { center_x: sourceSlot.center_x, center_y: finalConnectorY },
    { center_x: winnerSlot.center_x, center_y: finalConnectorY },
    { center_x: winnerSlot.center_x, center_y: winnerSlot.center_y },
  ];
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
      return `drawbox=x=${slot.x + 4}:y=${slot.y + 4}:w=${slot.width - 8}:h=${slot.height - 8}:color=0xFFD60A@${currentAlpha}:t=fill:enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'`;
    });
    const winnerSlotKey = (
      match.match_id === 'semi-final-1' ? 'semi_1_winner'
        : match.match_id === 'semi-final-2' ? 'semi_2_winner'
          : 'final_winner'
    );
    const winnerSlot = slots[winnerSlotKey];
    filters.push(
      `drawbox=x=${winnerSlot.x + 4}:y=${winnerSlot.y + 4}:w=${winnerSlot.width - 8}:h=${winnerSlot.height - 8}:color=0x34C759@${completeAlpha}:t=fill:enable='${formatEnableBetween(match.bracket_progress_end_seconds, renderPlan.total_duration_seconds)}'`,
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

function buildLinearSpritePlacement(startCenterX, startCenterY, endCenterX, endCenterY, startSeconds, endSeconds) {
  return {
    x: `${buildPathCoordinateExpression([
      { center_x: startCenterX, center_y: startCenterY },
      { center_x: endCenterX, center_y: endCenterY },
    ], 'center_x', startSeconds, endSeconds, 'overlay_w')}`,
    y: `${buildPathCoordinateExpression([
      { center_x: startCenterX, center_y: startCenterY },
      { center_x: endCenterX, center_y: endCenterY },
    ], 'center_y', startSeconds, endSeconds, 'overlay_h')}`,
  };
}

function buildChampionSpritePlacement(stage) {
  return {
    x: `${stage.center_x}-overlay_w/2`,
    y: `${stage.center_y}-overlay_h/2`,
  };
}

function buildBattleStatsLayout(battleStage) {
  const panelWidth = 310;
  const rowHeight = 28;
  const rowGap = 4;
  const panelHeight = (SHOWDOWN_STAT_ROWS.length * rowHeight) + ((SHOWDOWN_STAT_ROWS.length - 1) * rowGap);
  const spriteBottom = battleStage.center_y + (battleStage.sprite_size_px / 2);
  const proposedTop = Math.round(spriteBottom + 18);
  const maxTopBeforeName = Math.round(battleStage.name_y - panelHeight - 34);
  const top = Math.max(100, Math.min(proposedTop, maxTopBeforeName));
  const labelWidth = 92;
  const valueWidth = 54;
  const barX = labelWidth + valueWidth + 22;
  const barWidth = panelWidth - barX - 18;
  return {
    rowHeight,
    rowGap,
    panelWidth,
    panelHeight,
    labelWidth,
    valueWidth,
    barX,
    barWidth,
    top,
    leftX: Math.round(battleStage.left_center_x - (panelWidth / 2)),
    rightX: Math.round(battleStage.right_center_x - (panelWidth / 2)),
    valueFontSize: 23,
    labelFontSize: 22,
  };
}

function buildBattleStatsFilters({ match, battleStage, fontPart }) {
  const layout = buildBattleStatsLayout(battleStage);
  const enableExpression = formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds);
  const rowLeadInSeconds = 0.12;
  const rowStaggerSeconds = 0.16;
  const rowFillDurationSeconds = 0.52;
  const statSources = [
    { stats: match.participant_a.base_stats || {}, x: layout.leftX },
    { stats: match.participant_b.base_stats || {}, x: layout.rightX },
  ];
  return statSources.flatMap(({ stats, x }) => (
    SHOWDOWN_STAT_ROWS.flatMap((row, rowIndex) => {
      const value = Math.max(0, Math.min(255, round(stats[row.key] || 0)));
      const y = layout.top + (rowIndex * (layout.rowHeight + layout.rowGap));
      const fillWidth = Math.max(2, round((value / 255) * layout.barWidth));
      const rowStartSeconds = round((match.intro_start_seconds + rowLeadInSeconds + (rowIndex * rowStaggerSeconds)) * 1000) / 1000;
      const rowEndSeconds = round((rowStartSeconds + rowFillDurationSeconds) * 1000) / 1000;
      const animatedFillWidth = buildAnimatedExtentExpression(fillWidth, rowStartSeconds, rowEndSeconds);
      const barTrackX = x + layout.barX;
      const valueX = x + layout.labelWidth + 8;
      return [
        `drawbox=x=${x}:y=${y}:w=${layout.panelWidth}:h=${layout.rowHeight}:color=${row.background}@0.88:t=fill:enable='${enableExpression}'`,
        `drawbox=x=${barTrackX}:y=${y + 4}:w=${layout.barWidth}:h=${layout.rowHeight - 8}:color=0x101010@0.32:t=fill:enable='${enableExpression}'`,
        `drawbox=x=${barTrackX}:y=${y + 4}:w='${animatedFillWidth}':h=${layout.rowHeight - 8}:color=${row.color}@0.95:t=fill:enable='${enableExpression}'`,
        `drawtext=text='${escapeDrawtextText(`${row.label}:`)}'${fontPart}:fontcolor=black:fontsize=${layout.labelFontSize}:borderw=0:fix_bounds=1:x=${x + 10}:y=${y + 3}:enable='${enableExpression}'`,
        `drawtext=text='${value}'${fontPart}:fontcolor=black:fontsize=${layout.valueFontSize}:borderw=0:fix_bounds=1:x=${valueX}:y=${y + 3}:enable='${enableExpression}'`,
      ];
    })
  ));
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

function resolveMatchSourceSlotKeys(match = {}) {
  if (match.match_id === 'semi-final-1') {
    return ['semi_1_a', 'semi_1_b'];
  }
  if (match.match_id === 'semi-final-2') {
    return ['semi_2_a', 'semi_2_b'];
  }
  return ['semi_1_winner', 'semi_2_winner'];
}

function resolveLoserBracketSlotKeys(match = {}) {
  if (match.match_id === 'semi-final-1') {
    return [match.winner_side === 'left' ? 'semi_1_b' : 'semi_1_a'];
  }
  if (match.match_id === 'semi-final-2') {
    return [match.winner_side === 'left' ? 'semi_2_b' : 'semi_2_a'];
  }
  return [match.winner_side === 'left' ? 'semi_2_winner' : 'semi_1_winner'];
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
  const introPokeballSize = round(
    slotSpriteSize * ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.04),
  );
  const loserAlphaMultiplier = ensureNumber(template?.renderer?.loser_alpha_multiplier, 0.46);
  const championParticipantId = plan.tournament?.champion?.id || '';
  const matchBackgroundLabels = renderPlan.matches.map((_, index) => `vbgmatch${index}`);
  const preparedMatchBackgroundLabels = renderPlan.matches.map((_, index) => `vbgmatchprepared${index}`);
  const championBackgroundLabel = 'vbgchamp';
  const introSequence = renderPlan.intro_sequence || {};
  const sourceSlotRevealTimes = Array.isArray(introSequence.participant_reveal_times)
    ? introSequence.participant_reveal_times
    : [];
  const loserParticipantIds = new Set(
    (renderPlan.matches || []).map((match) => match.loser?.id).filter(Boolean),
  );
  const slotStaticLabels = new Map();
  const slotWinnerLabelQueues = new Map();
  const slotProgressLabelQueues = new Map();
  const slotTransitionLabelQueues = new Map();
  const slotGrayLabelQueues = new Map();
  const stageBattleLabelQueues = new Map();
  const stageWinnerLabelQueues = new Map();
  const stageGrayLabels = new Map();
  const championStageLabels = new Map();
  const introRevealSchedule = buildIntroRevealSchedule(renderPlan);

  filters.push(
    `[${inputRefs.background}:v]fps=${fps},scale=${renderPlan.canvas.width}:${renderPlan.canvas.height}:force_original_aspect_ratio=increase,crop=${renderPlan.canvas.width}:${renderPlan.canvas.height},boxblur=${blurSigma}:1,setsar=1,split=${1 + matchBackgroundLabels.length + 1}[vbgbase]${matchBackgroundLabels.map((label) => `[${label}]`).join('')}[${championBackgroundLabel}]`,
  );
  renderPlan.matches.forEach((match, index) => {
    const transitionDuration = Math.max(0.08, ensureNumber(match.battle_transition_duration_seconds, 0.4));
    filters.push(
      `[${matchBackgroundLabels[index]}]format=rgba,fade=t=in:st=${match.battle_transition_start_seconds}:d=${transitionDuration}:alpha=1[${preparedMatchBackgroundLabels[index]}]`,
    );
  });

  (plan.tournament?.participants || []).forEach((participant, index) => {
    const ref = inputRefs.participants[index];
    const appearanceCount = renderPlan.matches.reduce((count, match) => (
      match.participant_a.id === participant.id || match.participant_b.id === participant.id
        ? count + 1
        : count
    ), 0);
    const winCount = renderPlan.matches.filter((match) => match.winner?.id === participant.id).length;
    const slotGrayCount = loserParticipantIds.has(participant.id) ? 1 : 0;
    const stageGrayUsageCount = loserParticipantIds.has(participant.id) ? 1 : 0;
    const championUsageCount = participant.id === championParticipantId ? 1 : 0;
    const slotStaticLabel = `p${index}slotstatic`;
    const slotWinnerLabels = Array.from({ length: winCount }, (_, usageIndex) => `p${index}slotwin${usageIndex}`);
    const slotProgressLabels = Array.from({ length: winCount }, (_, usageIndex) => `p${index}slotprogress${usageIndex}`);
    const slotTransitionLabels = Array.from({ length: appearanceCount }, (_, usageIndex) => `p${index}slottransition${usageIndex}`);
    const slotGrayLabels = Array.from({ length: slotGrayCount }, (_, usageIndex) => `p${index}slotgray${usageIndex}`);
    const stageBattleLabels = Array.from({ length: appearanceCount }, (_, usageIndex) => `p${index}stagebattle${usageIndex}`);
    const stageWinnerLabels = Array.from({ length: winCount }, (_, usageIndex) => `p${index}stagewin${usageIndex}`);
    const slotStaticSourceLabel = `p${index}slotstaticsrc`;
    const slotWinnerSourceLabels = slotWinnerLabels.map((_, usageIndex) => `p${index}slotwinsrc${usageIndex}`);
    const slotProgressSourceLabels = slotProgressLabels.map((_, usageIndex) => `p${index}slotprogresssrc${usageIndex}`);
    const slotTransitionSourceLabels = slotTransitionLabels.map((_, usageIndex) => `p${index}slottransitionsrc${usageIndex}`);
    const slotGraySourceLabels = slotGrayLabels.map((_, usageIndex) => `p${index}slotgraysrc${usageIndex}`);
    const stageBattleSourceLabels = stageBattleLabels.map((_, usageIndex) => `p${index}stagebattlesrc${usageIndex}`);
    const stageWinnerSourceLabels = stageWinnerLabels.map((_, usageIndex) => `p${index}stagewinsrc${usageIndex}`);
    const stageGraySourceLabel = stageGrayUsageCount > 0 ? `p${index}stagegraysrc0` : '';
    const stageGrayLabel = stageGrayUsageCount > 0 ? `p${index}stagegray0` : '';
    const championSourceLabel = championUsageCount > 0 ? `p${index}champsrc0` : '';
    const championLabel = championUsageCount > 0 ? `p${index}champ0` : '';
    slotStaticLabels.set(index, slotStaticLabel);
    slotWinnerLabelQueues.set(index, [...slotWinnerLabels]);
    slotProgressLabelQueues.set(index, [...slotProgressLabels]);
    slotTransitionLabelQueues.set(index, [...slotTransitionLabels]);
    slotGrayLabelQueues.set(index, [...slotGrayLabels]);
    stageBattleLabelQueues.set(index, [...stageBattleLabels]);
    stageWinnerLabelQueues.set(index, [...stageWinnerLabels]);
    if (stageGrayLabel) {
      stageGrayLabels.set(index, stageGrayLabel);
    }
    if (championLabel) {
      championStageLabels.set(index, championLabel);
    }
    const branchLabels = [
      `[${slotStaticSourceLabel}]`,
      ...slotWinnerSourceLabels.map((label) => `[${label}]`),
      ...slotProgressSourceLabels.map((label) => `[${label}]`),
      ...slotTransitionSourceLabels.map((label) => `[${label}]`),
      ...slotGraySourceLabels.map((label) => `[${label}]`),
      ...stageBattleSourceLabels.map((label) => `[${label}]`),
      ...stageWinnerSourceLabels.map((label) => `[${label}]`),
      ...(stageGraySourceLabel ? [`[${stageGraySourceLabel}]`] : []),
      ...(championSourceLabel ? [`[${championSourceLabel}]`] : []),
    ];
    const participantFilters = [
      `[${ref}:v]fps=${fps},trim=duration=${renderPlan.total_duration_seconds},setpts=PTS-STARTPTS,split=${branchLabels.length}${branchLabels.join('')}`,
    ];
    participantFilters.push(
      `[${slotStaticSourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${slotStaticLabel}]`,
    );
    slotWinnerSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${slotWinnerLabels[usageIndex]}]`,
      );
    });
    slotProgressSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${slotProgressLabels[usageIndex]}]`,
      );
    });
    slotTransitionSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${slotTransitionLabels[usageIndex]}]`,
      );
    });
    slotGraySourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1,hue=s=0,colorchannelmixer=aa=0.72[${slotGrayLabels[usageIndex]}]`,
      );
    });
    stageBattleSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${stageBattleLabels[usageIndex]}]`,
      );
    });
    stageWinnerSourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${stageWinnerLabels[usageIndex]}]`,
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
      ...buildCardFilters(bracketLayout, introRevealSchedule.slots),
      ...buildConnectorSegments(bracketLayout, introRevealSchedule.connectors),
      ...buildHighlightFilters(renderPlan, template),
    ].join(',')}[${bracketBaseLabel}]`,
  );
  currentVideoLabel = bracketBaseLabel;

  const participantById = new Map(
    (plan.tournament?.participants || []).map((participant) => [participant.id, participant]),
  );
  const slotMap = bracketLayout.slots;
  const sourceSlotKeys = [...SHOWDOWN_SOURCE_SLOT_KEYS];

  if (inputRefs.introPokeball != null) {
    const sourcePokeballLabels = sourceSlotKeys.map((_, index) => `vpokeball${index}`);
    filters.push(
      `[${inputRefs.introPokeball}:v]fps=${fps},scale=${introPokeballSize}:${introPokeballSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1,split=${sourcePokeballLabels.length}${sourcePokeballLabels.map((label) => `[${label}]`).join('')}`,
    );
    sourceSlotKeys.forEach((slotKey, index) => {
      const slot = slotMap[slotKey];
      const slotRevealStart = ensureNumber(introRevealSchedule.slots[slotKey], 0);
      const spriteRevealStart = ensureNumber(
        sourceSlotRevealTimes[index],
        renderPlan.matches[0]?.intro_start_seconds,
      );
      if (spriteRevealStart <= slotRevealStart) {
        return;
      }
      const placement = buildSlotSpritePlacement(slot, introPokeballSize);
      const nextLabel = `vslotpokeball${index}`;
      filters.push(
        `[${currentVideoLabel}][${sourcePokeballLabels[index]}]overlay=x='${placement.x}':y='${placement.y}':enable='${formatEnableBetween(slotRevealStart, spriteRevealStart)}'[${nextLabel}]`,
      );
      currentVideoLabel = nextLabel;
    });
  }

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
  const finalMatch = renderPlan.matches.at(-1);
  if (ensureNumber(finalMatch?.bracket_progress_end_seconds, 0) > ensureNumber(finalMatch?.scene_end_seconds, 0)) {
    bracketVisibleWindows.push({
      start: finalMatch.scene_end_seconds,
      end: finalMatch.bracket_progress_end_seconds,
    });
  }
  const bracketVisibleExpression = buildWindowExpression(bracketVisibleWindows);
  (plan.tournament?.participants || []).forEach((participant, index) => {
    const slot = slotMap[sourceSlotKeys[index]];
    const placement = buildSlotSpritePlacement(slot, slotSpriteSize);
    const nextLabel = `vslot${index}`;
    const slotLabel = slotStaticLabels.get(index);
    const slotRevealStart = ensureNumber(
      sourceSlotRevealTimes[index],
      ensureNumber(introRevealSchedule.slots[sourceSlotKeys[index]], 0),
    );
    filters.push(
      `[${currentVideoLabel}][${slotLabel}]overlay=x='${placement.x}':y='${placement.y}':enable='gte(t,${slotRevealStart})'[${nextLabel}]`,
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
    const winnerSlotLabel = slotWinnerLabelQueues.get(participantIndex)?.shift();
    filters.push(
      `[${currentVideoLabel}][${winnerSlotLabel}]overlay=x='${placement.x}':y='${placement.y}':enable='${formatEnableBetween(match.bracket_progress_end_seconds, renderPlan.total_duration_seconds)}'[${nextLabel}]`,
    );
    currentVideoLabel = nextLabel;
  });

  renderPlan.matches.forEach((match, matchIndex) => {
    const participantIndex = participantById.get(match.winner.id)?.bracket_seed_index ?? 0;
    const progressSlotLabel = slotProgressLabelQueues.get(participantIndex)?.shift();
    const pathPoints = buildBracketProgressPath(slotMap, match);
    const nextLabel = `vprogress${matchIndex}`;
    filters.push(
      `[${currentVideoLabel}][${progressSlotLabel}]overlay=x='${buildPathCoordinateExpression(pathPoints, 'center_x', match.bracket_progress_start_seconds, match.bracket_progress_end_seconds, 'overlay_w')}':y='${buildPathCoordinateExpression(pathPoints, 'center_y', match.bracket_progress_start_seconds, match.bracket_progress_end_seconds, 'overlay_h')}':enable='${formatEnableBetween(match.bracket_progress_start_seconds, match.bracket_progress_end_seconds)}'[${nextLabel}]`,
    );
    currentVideoLabel = nextLabel;
  });

  renderPlan.matches.forEach((match, matchIndex) => {
    const loserIndex = participantById.get(match.loser.id)?.bracket_seed_index ?? 0;
    const graySlotKeys = resolveLoserBracketSlotKeys(match);
    graySlotKeys.forEach((slotKey, grayIndex) => {
      const slot = slotMap[slotKey];
      const placement = buildSlotSpritePlacement(slot, slotSpriteSize);
      const graySlotLabel = slotGrayLabelQueues.get(loserIndex)?.shift();
      const nextLabel = `vslotgray${matchIndex}_${grayIndex}`;
      filters.push(
        `[${currentVideoLabel}][${graySlotLabel}]overlay=x='${placement.x}':y='${placement.y}':enable='${buildAndEnableExpression(
          bracketVisibleExpression,
          `gte(t,${match.scene_end_seconds})`,
        )}'[${nextLabel}]`,
      );
      currentVideoLabel = nextLabel;
    });
  });

  renderPlan.matches.forEach((match, matchIndex) => {
    const leftIndex = participantById.get(match.participant_a.id)?.bracket_seed_index ?? 0;
    const rightIndex = participantById.get(match.participant_b.id)?.bracket_seed_index ?? 1;
    const winnerIndex = participantById.get(match.winner.id)?.bracket_seed_index ?? leftIndex;
    const loserIndex = participantById.get(match.loser.id)?.bracket_seed_index ?? rightIndex;
    const [leftSourceSlotKey, rightSourceSlotKey] = resolveMatchSourceSlotKeys(match);
    const leftSourceSlot = slotMap[leftSourceSlotKey];
    const rightSourceSlot = slotMap[rightSourceSlotKey];
    const leftPlacement = buildStageSpritePlacement(battleStage.left_center_x, battleStage.center_y);
    const rightPlacement = buildStageSpritePlacement(battleStage.right_center_x, battleStage.center_y);
    const transitionStart = ensureNumber(match.battle_transition_start_seconds, match.intro_start_seconds);
    const stageSceneBaseLabel = `vmatchscene${matchIndex}`;
    const leftStageLabel = stageBattleLabelQueues.get(leftIndex)?.shift();
    const rightStageLabel = stageBattleLabelQueues.get(rightIndex)?.shift();
    const winnerStageLabel = stageWinnerLabelQueues.get(winnerIndex)?.shift();
    const loserStageGrayLabel = stageGrayLabels.get(loserIndex);
    const leftTransitionLabel = slotTransitionLabelQueues.get(leftIndex)?.shift();
    const rightTransitionLabel = slotTransitionLabelQueues.get(rightIndex)?.shift();

    filters.push(
      `[${currentVideoLabel}][${preparedMatchBackgroundLabels[matchIndex]}]overlay=x=0:y=0:enable='${formatEnableBetween(transitionStart, match.scene_end_seconds)}'[${stageSceneBaseLabel}]`,
    );
    const leftTransitionPlacement = buildLinearSpritePlacement(
      leftSourceSlot.center_x,
      leftSourceSlot.center_y,
      battleStage.left_center_x,
      battleStage.center_y,
      transitionStart,
      match.intro_start_seconds,
    );
    const rightTransitionPlacement = buildLinearSpritePlacement(
      rightSourceSlot.center_x,
      rightSourceSlot.center_y,
      battleStage.right_center_x,
      battleStage.center_y,
      transitionStart,
      match.intro_start_seconds,
    );
    const transitionLeftLabelName = `vmatchtransl${matchIndex}`;
    filters.push(
      `[${stageSceneBaseLabel}][${leftTransitionLabel}]overlay=x='${leftTransitionPlacement.x}':y='${leftTransitionPlacement.y}':enable='${formatEnableBetween(transitionStart, match.intro_start_seconds)}'[${transitionLeftLabelName}]`,
    );
    const transitionRightLabelName = `vmatchtransr${matchIndex}`;
    filters.push(
      `[${transitionLeftLabelName}][${rightTransitionLabel}]overlay=x='${rightTransitionPlacement.x}':y='${rightTransitionPlacement.y}':enable='${formatEnableBetween(transitionStart, match.intro_start_seconds)}'[${transitionRightLabelName}]`,
    );

    const preRevealLabel = `vmatchpre${matchIndex}`;
    filters.push(
      `[${transitionRightLabelName}][${leftStageLabel}]overlay=x='${leftPlacement.x}':y='${leftPlacement.y}':enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'[${preRevealLabel}]`,
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
    const sourceRevealStart = ensureNumber(
      sourceSlotRevealTimes[index],
      ensureNumber(introRevealSchedule.slots[sourceSlotKeys[index]], 0),
    );
    drawtextParts.push(
      buildSlotNameDrawtext(
        participant.display_name,
        slot,
        fontPart,
        bracketLayout.slot_name_font_size,
        buildAndEnableExpression(
          bracketVisibleExpression,
          `gte(t,${sourceRevealStart})`,
        ),
      ),
    );
  });

  drawtextParts.push(
    buildPlaceholderDrawtext(
      slotMap.semi_1_winner,
      fontPart,
      buildAndEnableExpression(
        bracketVisibleExpression,
        `gte(t,${ensureNumber(introRevealSchedule.slots.semi_1_winner, 0)})`,
        `lt(t,${renderPlan.matches[0]?.bracket_progress_end_seconds || 0})`,
      ),
    ),
    buildPlaceholderDrawtext(
      slotMap.semi_2_winner,
      fontPart,
      buildAndEnableExpression(
        bracketVisibleExpression,
        `gte(t,${ensureNumber(introRevealSchedule.slots.semi_2_winner, 0)})`,
        `lt(t,${renderPlan.matches[1]?.bracket_progress_end_seconds || 0})`,
      ),
    ),
    buildPlaceholderDrawtext(
      slotMap.final_winner,
      fontPart,
      buildAndEnableExpression(
        bracketVisibleExpression,
        `gte(t,${ensureNumber(introRevealSchedule.slots.final_winner, 0)})`,
        `lt(t,${renderPlan.matches[2]?.bracket_progress_end_seconds || 0})`,
      ),
    ),
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
          `gte(t,${match.bracket_progress_end_seconds})`,
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
      ...buildBattleStatsFilters({
        match,
        battleStage: renderPlan.battle_stage,
        fontPart,
      }),
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
