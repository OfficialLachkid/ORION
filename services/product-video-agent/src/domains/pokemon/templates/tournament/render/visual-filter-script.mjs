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

const TOURNAMENT_STAT_ROWS = Object.freeze([
  { key: 'hp', label: 'HP', color: '0xFF4D6D', background: '0x2A171D' },
  { key: 'attack', label: 'Attack', color: '0xFF8F1F', background: '0x2E1D10' },
  { key: 'defense', label: 'Defense', color: '0xFFD23F', background: '0x302710' },
  { key: 'special_attack', label: 'Sp. Atk', color: '0x4D8CFF', background: '0x16233A' },
  { key: 'special_defense', label: 'Sp. Def', color: '0x55D66B', background: '0x16281C' },
  { key: 'speed', label: 'Speed', color: '0xFF58A8', background: '0x311625' },
]);
const TOURNAMENT_SOURCE_SLOT_KEYS = Object.freeze(['semi_1_a', 'semi_1_b', 'semi_2_a', 'semi_2_b']);
const TOURNAMENT_BRACKET_SLOT_GROUPS = Object.freeze([
  ['semi_1_a', 'semi_1_b', 'semi_2_a', 'semi_2_b'],
  ['semi_1_winner', 'semi_2_winner'],
  ['final_winner'],
]);

function buildFontPart(fontPath) {
  return fontPath ? `:fontfile='${escapeFilterPath(fontPath)}'` : '';
}

function buildEnablePart(enableExpression = '') {
  return enableExpression ? `:enable='${enableExpression}'` : '';
}

function combineEnableExpressions(...expressions) {
  const parts = expressions
    .map((expression) => String(expression || '').trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return '';
  }
  return parts.map((expression) => `(${expression})`).join('*');
}

function buildOrderedBracketSlotKeys(slots = {}) {
  const groupedKeys = TOURNAMENT_BRACKET_SLOT_GROUPS.flatMap((group) => group);
  const remainingKeys = Object.keys(slots).filter((slotKey) => !groupedKeys.includes(slotKey));
  return [...groupedKeys, ...remainingKeys];
}

function appendBracketCardOverlays({
  filters,
  currentLabel,
  bracketLayout,
  revealSchedule = {},
  fps,
  totalDurationSeconds,
  labelPrefix = 'vcard',
}) {
  const slotWindows = revealSchedule.slot_windows || {};
  const slotStarts = revealSchedule.slots || {};
  let activeLabel = currentLabel;
  const orderedSlotKeys = buildOrderedBracketSlotKeys(bracketLayout.slots);

  orderedSlotKeys.forEach((slotKey, index) => {
    const slot = bracketLayout.slots[slotKey];
    if (!slot) {
      return;
    }
    const slotStart = ensureNumber(
      slotWindows[slotKey]?.start_seconds,
      ensureNumber(slotStarts[slotKey], 0),
    );
    const sourceLabel = `${labelPrefix}${index}src`;
    const nextLabel = `${labelPrefix}${index}`;
    const durationSeconds = Math.max(0.5, totalDurationSeconds - slotStart);
    filters.push(
      `color=c=black@0:s=${slot.width}x${slot.height}:r=${fps}:d=${durationSeconds},format=rgba,drawbox=x=0:y=0:w=${slot.width}:h=${slot.height}:color=0xFFFFFF@0.95:t=3:replace=1,drawbox=x=3:y=3:w=${slot.width - 6}:h=${slot.height - 6}:color=0x101010@0.32:t=fill:replace=1,fade=t=in:st=0:d=0.18:alpha=1,setpts=PTS-STARTPTS+${slotStart}/TB[${sourceLabel}]`,
    );
    filters.push(
      `[${activeLabel}][${sourceLabel}]overlay=x=${slot.x}:y='${buildAnimatedTextYExpression(slot.y, slotStart)}':enable='gte(t,${slotStart})'[${nextLabel}]`,
    );
    activeLabel = nextLabel;
  });

  return activeLabel;
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

function buildSteppedHorizontalFillBoxes({
  x,
  y,
  yExpression = null,
  width,
  height,
  color,
  startSeconds,
  endSeconds,
  baseEnableExpression = '',
  segmentWidthPx = 8,
}) {
  const safeX = round(x);
  const safeY = round(y);
  const resolvedY = String(yExpression || safeY).trim() || `${safeY}`;
  const safeWidth = Math.max(1, round(width));
  const safeHeight = Math.max(1, round(height));
  const duration = Math.max(0.01, ensureNumber(endSeconds, startSeconds + 0.01) - ensureNumber(startSeconds, 0));
  const segmentCount = Math.max(1, Math.ceil(safeWidth / Math.max(1, round(segmentWidthPx))));
  const filters = [];

  for (let index = 0; index < segmentCount; index += 1) {
    const segmentStartX = safeX + round((safeWidth * index) / segmentCount);
    const segmentEndX = index === segmentCount - 1
      ? safeX + safeWidth
      : safeX + round((safeWidth * (index + 1)) / segmentCount);
    const segmentWidth = Math.max(1, segmentEndX - segmentStartX);
    const segmentStartSeconds = round((startSeconds + ((duration * index) / segmentCount)) * 1000) / 1000;
    const enableExpression = combineEnableExpressions(
      baseEnableExpression,
      `gte(t,${segmentStartSeconds})`,
    );
    filters.push(
      `drawbox=x=${segmentStartX}:y='${resolvedY}':w=${segmentWidth}:h=${safeHeight}:color=${color}:t=fill:replace=1:enable='${enableExpression}'`,
    );
  }

  return filters;
}

function buildSteppedConnectorPath(points = [], thickness, startSeconds, endSeconds, segmentLengthPx = 10) {
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

  const duration = Math.max(0.01, ensureNumber(endSeconds, startSeconds + 0.01) - ensureNumber(startSeconds, 0));
  const filters = [];
  let traversedLength = 0;

  segments.forEach((segment) => {
    const pieceCount = Math.max(1, Math.ceil(segment.segmentLength / Math.max(1, round(segmentLengthPx))));
    for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex += 1) {
      const pieceStartDistance = traversedLength + ((segment.segmentLength * pieceIndex) / pieceCount);
      const pieceEndDistance = traversedLength + ((segment.segmentLength * (pieceIndex + 1)) / pieceCount);
      const pieceStartSeconds = round((startSeconds + ((pieceStartDistance / totalLength) * duration)) * 1000) / 1000;
      const pieceStartRatio = pieceIndex / pieceCount;
      const pieceEndRatio = (pieceIndex + 1) / pieceCount;

      if (segment.isHorizontal) {
        const y = round(segment.startPoint.y - (thickness / 2));
        const startX = round(segment.startPoint.x + ((segment.endPoint.x - segment.startPoint.x) * pieceStartRatio));
        const endX = pieceIndex === pieceCount - 1
          ? round(segment.endPoint.x)
          : round(segment.startPoint.x + ((segment.endPoint.x - segment.startPoint.x) * pieceEndRatio));
        const width = Math.max(1, Math.abs(endX - startX));
        const x = Math.min(startX, endX);
        filters.push(
          `drawbox=x=${x}:y=${y}:w=${width}:h=${thickness}:color=0xFFFFFF@0.7:t=fill:enable='gte(t,${pieceStartSeconds})'`,
        );
      } else {
        const x = round(segment.startPoint.x - (thickness / 2));
        const startY = round(segment.startPoint.y + ((segment.endPoint.y - segment.startPoint.y) * pieceStartRatio));
        const endY = pieceIndex === pieceCount - 1
          ? round(segment.endPoint.y)
          : round(segment.startPoint.y + ((segment.endPoint.y - segment.startPoint.y) * pieceEndRatio));
        const height = Math.max(1, Math.abs(endY - startY));
        const y = Math.min(startY, endY);
        filters.push(
          `drawbox=x=${x}:y=${y}:w=${thickness}:h=${height}:color=0xFFFFFF@0.7:t=fill:enable='gte(t,${pieceStartSeconds})'`,
        );
      }
    }
    traversedLength += segment.segmentLength;
  });

  return filters;
}

function buildParallelConnectorPaths(pathGroups = [], thickness, startSeconds, endSeconds, segmentLengthPx = 10) {
  const validPaths = (Array.isArray(pathGroups) ? pathGroups : [])
    .filter((points) => Array.isArray(points) && points.length >= 2);
  if (validPaths.length === 0) {
    return [];
  }

  const allSegments = validPaths.map((points) => {
    const segments = [];
    let totalPieces = 0;
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
      const pieceCount = Math.max(1, Math.ceil(segmentLength / Math.max(1, round(segmentLengthPx))));
      segments.push({
        startPoint,
        endPoint,
        isHorizontal,
        pieceCount,
      });
      totalPieces += pieceCount;
    }
    return { segments, totalPieces };
  });

  const maxPieceCount = Math.max(1, ...allSegments.map((entry) => entry.totalPieces));
  const duration = Math.max(0.01, ensureNumber(endSeconds, startSeconds + 0.01) - ensureNumber(startSeconds, 0));
  const filters = [];

  allSegments.forEach(({ segments, totalPieces }) => {
    if (segments.length === 0 || totalPieces <= 0) {
      return;
    }
    let pieceCursor = 0;
    segments.forEach((segment) => {
      for (let pieceIndex = 0; pieceIndex < segment.pieceCount; pieceIndex += 1) {
        const pieceStartRatio = pieceIndex / segment.pieceCount;
        const pieceEndRatio = (pieceIndex + 1) / segment.pieceCount;
        const absolutePieceIndex = pieceCursor + pieceIndex;
        const pieceStartSeconds = round((startSeconds + ((absolutePieceIndex / maxPieceCount) * duration)) * 1000) / 1000;
        if (segment.isHorizontal) {
          const y = round(segment.startPoint.y - (thickness / 2));
          const startX = round(segment.startPoint.x + ((segment.endPoint.x - segment.startPoint.x) * pieceStartRatio));
          const endX = pieceIndex === segment.pieceCount - 1
            ? round(segment.endPoint.x)
            : round(segment.startPoint.x + ((segment.endPoint.x - segment.startPoint.x) * pieceEndRatio));
          const width = Math.max(1, Math.abs(endX - startX));
          const x = Math.min(startX, endX);
          filters.push(
            `drawbox=x=${x}:y=${y}:w=${width}:h=${thickness}:color=0xFFFFFF@0.7:t=fill:enable='gte(t,${pieceStartSeconds})'`,
          );
        } else {
          const x = round(segment.startPoint.x - (thickness / 2));
          const startY = round(segment.startPoint.y + ((segment.endPoint.y - segment.startPoint.y) * pieceStartRatio));
          const endY = pieceIndex === segment.pieceCount - 1
            ? round(segment.endPoint.y)
            : round(segment.startPoint.y + ((segment.endPoint.y - segment.startPoint.y) * pieceEndRatio));
          const height = Math.max(1, Math.abs(endY - startY));
          const y = Math.min(startY, endY);
          filters.push(
            `drawbox=x=${x}:y=${y}:w=${thickness}:h=${height}:color=0xFFFFFF@0.7:t=fill:enable='gte(t,${pieceStartSeconds})'`,
          );
        }
      }
      pieceCursor += segment.pieceCount;
    });
  });

  return filters;
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
  const splitWindow = (window = {}) => {
    const startSeconds = ensureNumber(window.start_seconds, 0);
    const endSeconds = Math.max(startSeconds + 0.01, ensureNumber(window.end_seconds, startSeconds + 0.01));
    const midSeconds = round((((startSeconds + endSeconds) / 2) * 1000)) / 1000;
    return {
      first: {
        start_seconds: startSeconds,
        end_seconds: midSeconds,
      },
      second: {
        start_seconds: midSeconds,
        end_seconds: endSeconds,
      },
    };
  };

  if (connectorWindows.connector_left) {
    const window = connectorWindows.connector_left;
    const sharedWindow = connectorWindows.connector_right
      && connectorWindows.connector_right.start_seconds === window.start_seconds
      && connectorWindows.connector_right.end_seconds === window.end_seconds;
    if (sharedWindow) {
      const startSeconds = ensureNumber(window.start_seconds, 0);
      const endSeconds = Math.max(startSeconds + 0.01, ensureNumber(window.end_seconds, startSeconds + 0.01));
      const durationSeconds = endSeconds - startSeconds;
      const firstPhaseEndSeconds = round((startSeconds + (durationSeconds * 0.44)) * 1000) / 1000;
      const secondPhaseEndSeconds = round((startSeconds + (durationSeconds * 0.68)) * 1000) / 1000;
      lines.push(
        buildAnimatedVerticalConnectorSegment(
          slots.semi_1_a.center_x,
          slots.semi_1_a.y,
          leftPairConnectorY,
          thickness,
          startSeconds,
          firstPhaseEndSeconds,
        ),
        buildAnimatedVerticalConnectorSegment(
          slots.semi_1_b.center_x,
          slots.semi_1_b.y,
          leftPairConnectorY,
          thickness,
          startSeconds,
          firstPhaseEndSeconds,
        ),
        buildAnimatedVerticalConnectorSegment(
          slots.semi_2_a.center_x,
          slots.semi_2_a.y,
          rightPairConnectorY,
          thickness,
          startSeconds,
          firstPhaseEndSeconds,
        ),
        buildAnimatedVerticalConnectorSegment(
          slots.semi_2_b.center_x,
          slots.semi_2_b.y,
          rightPairConnectorY,
          thickness,
          startSeconds,
          firstPhaseEndSeconds,
        ),
        buildAnimatedHorizontalConnectorSegment(
          leftPairConnectorY,
          slots.semi_1_a.center_x,
          slots.semi_1_b.center_x,
          thickness,
          firstPhaseEndSeconds,
          secondPhaseEndSeconds,
        ),
        buildAnimatedHorizontalConnectorSegment(
          rightPairConnectorY,
          slots.semi_2_a.center_x,
          slots.semi_2_b.center_x,
          thickness,
          firstPhaseEndSeconds,
          secondPhaseEndSeconds,
        ),
        buildAnimatedVerticalConnectorSegment(
          slots.semi_1_winner.center_x,
          slots.semi_1_winner.y + slots.semi_1_winner.height,
          leftPairConnectorY,
          thickness,
          secondPhaseEndSeconds,
          endSeconds,
        ),
        buildAnimatedVerticalConnectorSegment(
          slots.semi_2_winner.center_x,
          slots.semi_2_winner.y + slots.semi_2_winner.height,
          rightPairConnectorY,
          thickness,
          secondPhaseEndSeconds,
          endSeconds,
        ),
      );
    } else {
      lines.push(
        ...buildSteppedConnectorPath([
          { x: slots.semi_1_a.center_x, y: slots.semi_1_a.y },
          { x: slots.semi_1_a.center_x, y: leftPairConnectorY },
          { x: slots.semi_1_winner.center_x, y: leftPairConnectorY },
          { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y + slots.semi_1_winner.height },
        ], thickness, window.start_seconds, window.end_seconds, 5),
        ...buildSteppedConnectorPath([
          { x: slots.semi_1_b.center_x, y: slots.semi_1_b.y },
          { x: slots.semi_1_b.center_x, y: leftPairConnectorY },
          { x: slots.semi_1_winner.center_x, y: leftPairConnectorY },
          { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y + slots.semi_1_winner.height },
        ], thickness, window.start_seconds, window.end_seconds, 5),
      );
    }
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

  if (connectorWindows.connector_right && !(
    connectorWindows.connector_left
    && connectorWindows.connector_left.start_seconds === connectorWindows.connector_right.start_seconds
    && connectorWindows.connector_left.end_seconds === connectorWindows.connector_right.end_seconds
  )) {
    const window = connectorWindows.connector_right;
    lines.push(
      ...buildSteppedConnectorPath([
        { x: slots.semi_2_a.center_x, y: slots.semi_2_a.y },
        { x: slots.semi_2_a.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y + slots.semi_2_winner.height },
      ], thickness, window.start_seconds, window.end_seconds, 5),
      ...buildSteppedConnectorPath([
        { x: slots.semi_2_b.center_x, y: slots.semi_2_b.y },
        { x: slots.semi_2_b.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: rightPairConnectorY },
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y + slots.semi_2_winner.height },
      ], thickness, window.start_seconds, window.end_seconds, 5),
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
      ...buildSteppedConnectorPath([
        { x: slots.semi_1_winner.center_x, y: slots.semi_1_winner.y },
        { x: slots.semi_1_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: slots.final_winner.y + slots.final_winner.height },
      ], thickness, window.start_seconds, window.end_seconds, 5),
      ...buildSteppedConnectorPath([
        { x: slots.semi_2_winner.center_x, y: slots.semi_2_winner.y },
        { x: slots.semi_2_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: finalConnectorY },
        { x: slots.final_winner.center_x, y: slots.final_winner.y + slots.final_winner.height },
      ], thickness, window.start_seconds, window.end_seconds, 5),
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
  const stageSeconds = renderPlan?.intro_sequence?.bracket_stage_seconds || null;
  if (stageSeconds) {
    const configuredDurations = [
      ensureNumber(stageSeconds.semi_slot_seconds, 0.18),
      ensureNumber(stageSeconds.semi_connector_seconds, 1.3),
      ensureNumber(stageSeconds.finalist_slot_seconds, 0.18),
      ensureNumber(stageSeconds.final_connector_seconds, 1.3),
      ensureNumber(stageSeconds.champion_slot_seconds, 0.18),
    ];
    const totalConfiguredSeconds = configuredDurations.reduce((sum, value) => sum + Math.max(0.05, value), 0);
    const stageScale = introEnd > 0
      ? Math.min(1, introEnd / Math.max(0.01, totalConfiguredSeconds))
      : 1;
    const scaledSemiSlotSeconds = round(Math.max(0.05, configuredDurations[0] * stageScale) * 1000) / 1000;
    const scaledSemiConnectorSeconds = round(Math.max(0.08, configuredDurations[1] * stageScale) * 1000) / 1000;
    const scaledFinalistSlotSeconds = round(Math.max(0.05, configuredDurations[2] * stageScale) * 1000) / 1000;
    const scaledFinalConnectorSeconds = round(Math.max(0.08, configuredDurations[3] * stageScale) * 1000) / 1000;
    const scaledChampionSlotSeconds = round(Math.max(0.05, configuredDurations[4] * stageScale) * 1000) / 1000;
    const semiSlotStart = 0;
    const semiSlotEnd = round((semiSlotStart + scaledSemiSlotSeconds) * 1000) / 1000;
    const semiConnectorStart = semiSlotEnd;
    const semiConnectorEnd = round((semiConnectorStart + scaledSemiConnectorSeconds) * 1000) / 1000;
    const finalistSlotStart = semiConnectorEnd;
    const finalistSlotEnd = round((finalistSlotStart + scaledFinalistSlotSeconds) * 1000) / 1000;
    const finalConnectorStart = finalistSlotEnd;
    const finalConnectorEnd = round((finalConnectorStart + scaledFinalConnectorSeconds) * 1000) / 1000;
    const championSlotStart = finalConnectorEnd;
    const championSlotEnd = round((championSlotStart + scaledChampionSlotSeconds) * 1000) / 1000;
    const clampedChampionEnd = Math.min(introEnd, championSlotEnd);
    return {
      slots: {
        semi_1_a: semiSlotStart,
        semi_1_b: semiSlotStart,
        semi_2_a: semiSlotStart,
        semi_2_b: semiSlotStart,
        semi_1_winner: finalistSlotStart,
        semi_2_winner: finalistSlotStart,
        final_winner: championSlotStart,
      },
      connectors: {
        connector_left: semiConnectorStart,
        connector_right: semiConnectorStart,
        connector_final: finalConnectorStart,
      },
      slot_windows: {
        semi_1_a: {
          start_seconds: semiSlotStart,
          end_seconds: Math.min(introEnd, semiSlotEnd),
        },
        semi_1_b: {
          start_seconds: semiSlotStart,
          end_seconds: Math.min(introEnd, semiSlotEnd),
        },
        semi_2_a: {
          start_seconds: semiSlotStart,
          end_seconds: Math.min(introEnd, semiSlotEnd),
        },
        semi_2_b: {
          start_seconds: semiSlotStart,
          end_seconds: Math.min(introEnd, semiSlotEnd),
        },
        semi_1_winner: {
          start_seconds: finalistSlotStart,
          end_seconds: Math.min(introEnd, finalistSlotEnd),
        },
        semi_2_winner: {
          start_seconds: finalistSlotStart,
          end_seconds: Math.min(introEnd, finalistSlotEnd),
        },
        final_winner: {
          start_seconds: championSlotStart,
          end_seconds: clampedChampionEnd,
        },
      },
      connector_windows: {
        connector_left: {
          start_seconds: semiConnectorStart,
          end_seconds: Math.min(introEnd, semiConnectorEnd),
        },
        connector_right: {
          start_seconds: semiConnectorStart,
          end_seconds: Math.min(introEnd, semiConnectorEnd),
        },
        connector_final: {
          start_seconds: finalConnectorStart,
          end_seconds: Math.min(introEnd, finalConnectorEnd),
        },
      },
    };
  }
  const sequence = [
    ['semi_1_a', 'slot', 0.45],
    ['semi_1_b', 'slot', 0.45],
    ['semi_2_a', 'slot', 0.45],
    ['semi_2_b', 'slot', 0.45],
    ['connector_left', 'connector', 2.55],
    ['connector_right', 'connector', 2.55],
    ['semi_1_winner', 'slot', 0.45],
    ['semi_2_winner', 'slot', 0.45],
    ['connector_final', 'connector', 2.55],
    ['final_winner', 'slot', 0.45],
  ];
  const totalWeight = sequence.reduce((sum, [, , weight]) => sum + ensureNumber(weight, 1), 0);
  const slots = {};
  const connectors = {};
  const connectorWindows = {};
  let elapsedSeconds = 0;
  sequence.forEach(([key, type, weight]) => {
    const durationSeconds = introEnd * (ensureNumber(weight, 1) / Math.max(0.01, totalWeight));
    const startSeconds = round(elapsedSeconds * 1000) / 1000;
    const endSeconds = round(Math.min(introEnd, (elapsedSeconds + durationSeconds)) * 1000) / 1000;
    if (type === 'slot') {
      slots[key] = startSeconds;
    } else {
      connectors[key] = startSeconds;
      connectorWindows[key] = {
        start_seconds: startSeconds,
        end_seconds: endSeconds,
      };
    }
    elapsedSeconds += durationSeconds;
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

function resolvePlatformLayout(template) {
  const config = template?.layout?.sprite_platform || {};
  return {
    enabled: config.option_enabled !== false,
    width_multiplier: ensureNumber(config.option_width_multiplier, 0.85),
    center_y_offset_multiplier: ensureNumber(config.center_y_offset_multiplier, 0.34),
    center_y_offset_px: ensureNumber(
      config.option_center_y_offset_px,
      ensureNumber(config.center_y_offset_px, 80),
    ),
  };
}

function resolveVersusLayout(template, battleStage) {
  const config = template?.layout?.battle_stage || {};
  return {
    width_px: Math.max(
      80,
      round(
        config.versus_width_px
        ?? (ensureNumber(battleStage?.vs_font_size, 88) * 2.5),
      ),
    ),
    y: round(config.versus_y_px ?? config.vs_y ?? 935),
  };
}

function buildVersusRotationExpression(startSeconds, durationSeconds = 0.22) {
  const safeStart = ensureNumber(startSeconds, 0);
  const safeDuration = Math.max(0.08, ensureNumber(durationSeconds, 0.22));
  const safeEnd = round((safeStart + safeDuration) * 1000) / 1000;
  return `if(lt(t,${safeStart}),0,if(lt(t,${safeEnd}),(1-((t-${safeStart})/${safeDuration}))*PI*2,0))`;
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
  const completedLoseAlpha = Math.min(0.42, completeAlpha + 0.1);
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
    const [leftSourceSlotKey, rightSourceSlotKey] = sourceSlotKeys;
    const winnerSourceSlotKey = match.winner_side === 'left' ? leftSourceSlotKey : rightSourceSlotKey;
    const loserSourceSlotKey = match.winner_side === 'left' ? rightSourceSlotKey : leftSourceSlotKey;
    const winnerSourceSlot = slots[winnerSourceSlotKey];
    const loserSourceSlot = slots[loserSourceSlotKey];
    if (winnerSourceSlot && loserSourceSlot) {
      filters.push(
        `drawbox=x=${winnerSourceSlot.x + 4}:y=${winnerSourceSlot.y + 4}:w=${winnerSourceSlot.width - 8}:h=${winnerSourceSlot.height - 8}:color=0x34C759@${completeAlpha}:t=fill:enable='${formatEnableBetween(match.scene_end_seconds, renderPlan.total_duration_seconds)}'`,
        `drawbox=x=${loserSourceSlot.x + 4}:y=${loserSourceSlot.y + 4}:w=${loserSourceSlot.width - 8}:h=${loserSourceSlot.height - 8}:color=0xFF2A2A@${completedLoseAlpha}:t=fill:enable='${formatEnableBetween(match.scene_end_seconds, renderPlan.total_duration_seconds)}'`,
      );
    }
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

function buildBattlePlatformPlacement(centerX, centerY, spriteSize, platformLayout) {
  const platformCenterY = round(
    centerY
    + (ensureNumber(spriteSize, 0) * ensureNumber(platformLayout?.center_y_offset_multiplier, 0.34))
    + ensureNumber(platformLayout?.center_y_offset_px, 80),
  );
  return {
    x: `${centerX}-overlay_w/2`,
    y: `${platformCenterY}-overlay_h/2`,
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

function buildBattleStatsLayout(battleStage, template = {}) {
  const panelWidth = 446;
  const rowHeight = 40;
  const rowGap = 6;
  const panelHeight = (TOURNAMENT_STAT_ROWS.length * rowHeight) + ((TOURNAMENT_STAT_ROWS.length - 1) * rowGap);
  const spriteBottom = battleStage.center_y + (battleStage.sprite_size_px / 2);
  const statsTopOffsetPx = ensureNumber(template?.layout?.battle_stage?.stats_top_offset_px, 68);
  const proposedTop = Math.round(spriteBottom + statsTopOffsetPx);
  const maxTopBeforeName = Math.round(battleStage.name_y - panelHeight - 34);
  const top = Math.max(100, Math.min(proposedTop, maxTopBeforeName));
  const labelWidth = 128;
  const valueWidth = 72;
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
    valueFontSize: 31,
    labelFontSize: 30,
  };
}

function appendBattleStatsFilters({
  filters,
  currentLabel,
  match,
  battleStage,
  fontPart,
  template,
  fps,
  totalDurationSeconds,
  battleDisappearStart,
  labelPrefix,
}) {
  const layout = buildBattleStatsLayout(battleStage, template);
  const rowLeadInSeconds = Math.max(0, ensureNumber(template?.renderer?.stat_row_lead_in_seconds, 0.16));
  const rowStaggerSeconds = Math.max(0.05, ensureNumber(template?.renderer?.stat_row_stagger_seconds, 0.3));
  const rowFillDurationSeconds = 0.66;
  const rowValueCountDurationSeconds = 1;
  const fadeOutDurationSeconds = Math.max(0.12, ensureNumber(match.scene_end_seconds, 0) - ensureNumber(battleDisappearStart, 0));
  const statSources = [
    { stats: match.participant_a.base_stats || {}, x: layout.leftX, side: 'left' },
    { stats: match.participant_b.base_stats || {}, x: layout.rightX, side: 'right' },
  ];

  let activeLabel = currentLabel;
  statSources.forEach(({ stats, x, side }) => {
    const panelLabel = `${labelPrefix}${side}stats`;
    const panelFilters = [
      `color=c=black@0:s=${layout.panelWidth}x${layout.panelHeight}:r=${fps}:d=${totalDurationSeconds},format=rgba`,
    ];

    TOURNAMENT_STAT_ROWS.forEach((row, rowIndex) => {
      const value = Math.max(0, Math.min(255, round(stats[row.key] || 0)));
      const y = rowIndex * (layout.rowHeight + layout.rowGap);
      const fillWidth = Math.max(2, round((value / 255) * layout.barWidth));
      const rowStartSeconds = round((match.intro_start_seconds + rowLeadInSeconds + (rowIndex * rowStaggerSeconds)) * 1000) / 1000;
      const rowEndSeconds = round((rowStartSeconds + rowFillDurationSeconds) * 1000) / 1000;
      const valueCountExpression = `%{eif\\:clip((t-${rowStartSeconds})/${rowValueCountDurationSeconds}\\,0\\,1)*${value}\\:d}`;
      const rowEnableExpression = formatEnableBetween(rowStartSeconds, match.scene_end_seconds);
      const rowAlphaExpression = buildAnimatedTextSegmentAlphaExpression(rowStartSeconds, battleDisappearStart);
      const rowYExpression = buildAnimatedTextYExpression(y, rowStartSeconds);
      const rowTextYExpression = buildAnimatedTextYExpression(y + 3, rowStartSeconds);
      const rowTrackYExpression = buildAnimatedTextYExpression(y + 4, rowStartSeconds);
      const barTrackX = layout.barX;
      const valueX = layout.labelWidth + 8;
      panelFilters.push(
        `drawbox=x=0:y='${rowYExpression}':w=${layout.panelWidth}:h=${layout.rowHeight}:color=${row.background}@0.94:t=fill:replace=1:enable='${rowEnableExpression}'`,
        `drawbox=x=${barTrackX}:y='${rowTrackYExpression}':w=${layout.barWidth}:h=${layout.rowHeight - 8}:color=0x0B1220@0.52:t=fill:replace=1:enable='${rowEnableExpression}'`,
        ...buildSteppedHorizontalFillBoxes({
          x: barTrackX,
          y: y + 4,
          yExpression: rowTrackYExpression,
          width: fillWidth,
          height: layout.rowHeight - 8,
          color: `${row.color}@0.95`,
          startSeconds: rowStartSeconds,
          endSeconds: rowEndSeconds,
          baseEnableExpression: rowEnableExpression,
          segmentWidthPx: 7,
        }),
        `drawtext=text='${escapeDrawtextText(`${row.label}:`)}'${fontPart}:fontcolor=white:fontsize=${layout.labelFontSize}:borderw=1:bordercolor=0x081018:fix_bounds=1:x=10:y='${rowTextYExpression}':alpha='${rowAlphaExpression}':enable='${rowEnableExpression}'`,
        `drawtext=text='${valueCountExpression}'${fontPart}:fontcolor=0xF7FAFF:fontsize=${layout.valueFontSize}:borderw=1:bordercolor=0x081018:fix_bounds=1:x=${valueX}:y='${rowTextYExpression}':alpha='${rowAlphaExpression}':enable='${rowEnableExpression}'`,
      );
    });

    filters.push(
      `${panelFilters.join(',')},fade=t=out:st=${battleDisappearStart}:d=${fadeOutDurationSeconds}:alpha=1[${panelLabel}]`,
    );
    const overlayLabel = `${labelPrefix}${side}statsov`;
    filters.push(
      `[${activeLabel}][${panelLabel}]overlay=x=${x}:y=${layout.top}:enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'[${overlayLabel}]`,
    );
    activeLabel = overlayLabel;
  });

  return activeLabel;
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
    safeTopOverride = null,
  } = {},
) {
  const safeTop = ensureNumber(safeTopOverride, ensureNumber(template?.canvas?.safe_zone?.top, 160));
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
  return combineEnableExpressions(...expressions);
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
  const battleDisappearDuration = Math.max(
    0.12,
    ensureNumber(
      renderPlan?.audio_cues?.battle_disappear_duration_seconds,
      ensureNumber(template?.renderer?.battle_disappear_duration_seconds, 0.42),
    ),
  );
  const introPokeballSize = round(
    slotSpriteSize * ensureNumber(template?.renderer?.intro_pokeball_scale_multiplier, 1.04),
  );
  const platformLayout = resolvePlatformLayout(template);
  const versusLayout = resolveVersusLayout(template, battleStage);
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
  const battleDisappearLabels = inputRefs.battleDisappear != null
    ? Array.from({ length: renderPlan.matches.length * 2 }, (_, index) => `vbattledisappearsrc${index}`)
    : [];

  filters.push(
    `[${inputRefs.background}:v]fps=${fps},scale=${renderPlan.canvas.width}:${renderPlan.canvas.height}:force_original_aspect_ratio=increase,crop=${renderPlan.canvas.width}:${renderPlan.canvas.height},boxblur=${blurSigma}:1,setsar=1,split=${1 + matchBackgroundLabels.length + 1}[vbgbase]${matchBackgroundLabels.map((label) => `[${label}]`).join('')}[${championBackgroundLabel}]`,
  );
  if (inputRefs.battleDisappear != null && battleDisappearLabels.length > 0) {
    filters.push(
      `[${inputRefs.battleDisappear}:v]split=${battleDisappearLabels.length}${battleDisappearLabels.map((label) => `[${label}]`).join('')}`,
    );
  }
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
        `[${sourceLabel}]format=rgba,setsar=1[${slotTransitionLabels[usageIndex]}]`,
      );
    });
    slotGraySourceLabels.forEach((sourceLabel, usageIndex) => {
      participantFilters.push(
        `[${sourceLabel}]scale=${slotSpriteSize}:${slotSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,eq=saturation=0:brightness=-0.42:contrast=1.22,setsar=1,colorchannelmixer=aa=0.94[${slotGrayLabels[usageIndex]}]`,
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
      ...buildConnectorSegments(bracketLayout, introRevealSchedule),
    ].join(',')}[${bracketBaseLabel}]`,
  );
  currentVideoLabel = bracketBaseLabel;
  currentVideoLabel = appendBracketCardOverlays({
    filters,
    currentLabel: currentVideoLabel,
    bracketLayout,
    revealSchedule: introRevealSchedule,
    fps,
    totalDurationSeconds: renderPlan.total_duration_seconds,
  });
  const bracketHighlightLabel = 'vbrackethighlight';
  filters.push(
    `[${currentVideoLabel}]${buildHighlightFilters(renderPlan, template).join(',')}[${bracketHighlightLabel}]`,
  );
  currentVideoLabel = bracketHighlightLabel;

  const participantById = new Map(
    (plan.tournament?.participants || []).map((participant) => [participant.id, participant]),
  );
  const slotMap = bracketLayout.slots;
  const sourceSlotKeys = [...TOURNAMENT_SOURCE_SLOT_KEYS];

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
    const battleDisappearStart = round(
      Math.max(
        ensureNumber(match.reveal_start_seconds, 0),
        ensureNumber(match.scene_end_seconds, 0) - battleDisappearDuration,
      ) * 1000,
    ) / 1000;
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
    let stageSurfaceLabel = stageSceneBaseLabel;
    if (inputRefs.grassPlatform != null && platformLayout.enabled) {
      const platformWidth = Number((battleSpriteSize * platformLayout.width_multiplier).toFixed(3));
      const leftPlatformPlacement = buildBattlePlatformPlacement(
        battleStage.left_center_x,
        battleStage.center_y,
        battleSpriteSize,
        platformLayout,
      );
      const rightPlatformPlacement = buildBattlePlatformPlacement(
        battleStage.right_center_x,
        battleStage.center_y,
        battleSpriteSize,
        platformLayout,
      );
      const leftPlatformSourceLabel = `vmatchplatformlsrc${matchIndex}`;
      const leftPlatformLabel = `vmatchplatforml${matchIndex}`;
      const rightPlatformSourceLabel = `vmatchplatformrsrc${matchIndex}`;
      const rightPlatformLabel = `vmatchplatformr${matchIndex}`;
      filters.push(
        `[${inputRefs.grassPlatform}:v]fps=${fps},scale=${platformWidth}:-1,format=rgba,setsar=1,fade=t=in:st=${match.intro_start_seconds}:d=0.18:alpha=1[${leftPlatformSourceLabel}]`,
      );
      filters.push(
        `[${stageSurfaceLabel}][${leftPlatformSourceLabel}]overlay=x='${leftPlatformPlacement.x}':y='${buildAnimatedTextYExpression(leftPlatformPlacement.y, match.intro_start_seconds)}':enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'[${leftPlatformLabel}]`,
      );
      filters.push(
        `[${inputRefs.grassPlatform}:v]fps=${fps},scale=${platformWidth}:-1,format=rgba,setsar=1,fade=t=in:st=${match.intro_start_seconds}:d=0.18:alpha=1[${rightPlatformSourceLabel}]`,
      );
      filters.push(
        `[${leftPlatformLabel}][${rightPlatformSourceLabel}]overlay=x='${rightPlatformPlacement.x}':y='${buildAnimatedTextYExpression(rightPlatformPlacement.y, match.intro_start_seconds)}':enable='${formatEnableBetween(match.intro_start_seconds, match.scene_end_seconds)}'[${rightPlatformLabel}]`,
      );
      stageSurfaceLabel = rightPlatformLabel;
    }
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
      `[${stageSurfaceLabel}][${leftTransitionLabel}]overlay=x='${leftTransitionPlacement.x}':y='${leftTransitionPlacement.y}':enable='${formatEnableBetween(transitionStart, match.intro_start_seconds)}'[${transitionLeftLabelName}]`,
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
    let preRevealSceneLabel = appendBattleStatsFilters({
      filters,
      currentLabel: preRevealRightLabel,
      match,
      battleStage,
      fontPart,
      template,
      fps,
      totalDurationSeconds: renderPlan.total_duration_seconds,
      battleDisappearStart,
      labelPrefix: `vmatch${matchIndex}`,
    });
    if (inputRefs.versus != null) {
      const versusSourceLabel = `vversussrc${matchIndex}`;
      const versusSceneLabel = `vversus${matchIndex}`;
      filters.push(
        `[${inputRefs.versus}:v]fps=${fps},scale=${versusLayout.width_px}:-1,format=rgba,rotate='${buildVersusRotationExpression(match.intro_start_seconds)}':ow=rotw(iw):oh=roth(ih):c=none,setsar=1,fade=t=in:st=${match.intro_start_seconds}:d=0.18:alpha=1[${versusSourceLabel}]`,
      );
      filters.push(
        `[${preRevealSceneLabel}][${versusSourceLabel}]overlay=x='(main_w-overlay_w)/2':y='${buildAnimatedTextYExpression(versusLayout.y, match.intro_start_seconds)}':enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'[${versusSceneLabel}]`,
      );
      preRevealSceneLabel = versusSceneLabel;
    }

    const winnerPlacement = winnerIndex === leftIndex ? leftPlacement : rightPlacement;
    const loserPlacement = loserIndex === leftIndex ? leftPlacement : rightPlacement;
    const postWinnerLabel = `vmatchwin${matchIndex}`;
    filters.push(
      `[${preRevealSceneLabel}][${winnerStageLabel}]overlay=x='${winnerPlacement.x}':y='${winnerPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, battleDisappearStart)}'[${postWinnerLabel}]`,
    );
    const postLoserLabel = `vmatchlose${matchIndex}`;
    filters.push(
      `[${postWinnerLabel}][${loserStageGrayLabel}]overlay=x='${loserPlacement.x}':y='${loserPlacement.y}':enable='${formatEnableBetween(match.reveal_start_seconds, battleDisappearStart)}'[${postLoserLabel}]`,
    );
    let battleSceneLabel = postLoserLabel;
    if (inputRefs.battleDisappear != null) {
      const leftDisappearSourceLabel = battleDisappearLabels[(matchIndex * 2)];
      const rightDisappearSourceLabel = battleDisappearLabels[(matchIndex * 2) + 1];
      const leftDisappearLabel = `vbattledisappearleft${matchIndex}`;
      const rightDisappearLabel = `vbattledisappearright${matchIndex}`;
      const leftDisappearVideoLabel = `vbattledisappearleftv${matchIndex}`;
      const rightDisappearVideoLabel = `vbattledisappearrightv${matchIndex}`;
      filters.push(
        `[${leftDisappearSourceLabel}]fps=${fps},trim=duration=${battleDisappearDuration},setpts=PTS-STARTPTS+${battleDisappearStart}/TB,scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${leftDisappearLabel}]`,
      );
      filters.push(
        `[${battleSceneLabel}][${leftDisappearLabel}]overlay=x='${leftPlacement.x}':y='${leftPlacement.y}':enable='${formatEnableBetween(battleDisappearStart, match.scene_end_seconds)}'[${leftDisappearVideoLabel}]`,
      );
      filters.push(
        `[${rightDisappearSourceLabel}]fps=${fps},trim=duration=${battleDisappearDuration},setpts=PTS-STARTPTS+${battleDisappearStart}/TB,scale=${battleSpriteSize}:${battleSpriteSize}:force_original_aspect_ratio=decrease,format=rgba,setsar=1[${rightDisappearLabel}]`,
      );
      filters.push(
        `[${leftDisappearVideoLabel}][${rightDisappearLabel}]overlay=x='${rightPlacement.x}':y='${rightPlacement.y}':enable='${formatEnableBetween(battleDisappearStart, match.scene_end_seconds)}'[${rightDisappearVideoLabel}]`,
      );
      battleSceneLabel = rightDisappearVideoLabel;
    }
    currentVideoLabel = battleSceneLabel;
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
        { maxLines: 1, safeTopOverride: 60 },
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
      ...(inputRefs.versus == null
        ? [`drawtext=text='VS'${fontPart}:fontcolor=0xFFD60A:fontsize=${renderPlan.battle_stage.vs_font_size}:borderw=${DEFAULT_TEXT_BORDER}:bordercolor=black:fix_bounds=1:x=(w-text_w)/2:y=${renderPlan.battle_stage.vs_y}:enable='${formatEnableBetween(match.intro_start_seconds, match.reveal_start_seconds)}'`]
        : []),
    );
  });

  drawtextParts.push(
    ...buildAnimatedSceneTextBlock(
      `Winner: ${plan.tournament?.champion?.display_name || ''}`,
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
