import {
  ensureNumber,
  roundTime,
} from '../../templates/dual-type-reveal/render/constants.mjs';

export function appendSubscribeReminderOverlay(filters, currentLabel, {
  cardIndex,
  inputRef,
  width,
  height,
  fps,
  durationSeconds,
  config = {},
}) {
  if (inputRef == null || config?.enabled === false) return currentLabel;
  const reminderWidth = Math.max(160, Math.round(ensureNumber(config.width_px, 960)));
  const centerX = ensureNumber(config.center_x, width * 0.76);
  const centerY = ensureNumber(config.center_y, height * 0.77);
  const keyColor = String(config.chroma_key_color || '0x00FF00');
  const similarity = Math.max(0.01, ensureNumber(config.chroma_similarity, 0.22));
  const blend = Math.max(0, ensureNumber(config.chroma_blend, 0.08));
  const sourceLabel = `cardsubscribe${cardIndex}`;
  const outputLabel = `cardwithsubscribe${cardIndex}`;
  filters.push(
    `[${inputRef}:v]fps=${fps},trim=duration=${roundTime(durationSeconds)},setpts=PTS-STARTPTS,scale=${reminderWidth}:-2:force_original_aspect_ratio=decrease,format=rgba,colorkey=${keyColor}:${roundTime(similarity)}:${roundTime(blend)},setsar=1[${sourceLabel}]`,
  );
  filters.push(
    `[${currentLabel}][${sourceLabel}]overlay=x='${roundTime(centerX)}-w/2':y='${roundTime(centerY)}-h/2':eof_action=pass:shortest=0[${outputLabel}]`,
  );
  return outputLabel;
}

export function buildProgressTrackerFilters({
  width,
  height,
  durationSeconds,
  tracker,
  config = {},
}) {
  if (config?.enabled === false || !tracker) return [];
  const totalCount = Math.max(0, Number.parseInt(String(tracker.total_count), 10) || 0);
  if (totalCount === 0) return [];
  const completedCount = Math.min(
    totalCount,
    Math.max(0, Number.parseInt(String(tracker.completed_count), 10) || 0),
  );
  const markerSize = Math.max(12, Math.round(ensureNumber(config.marker_size_px, 42)));
  const markerGap = Math.max(0, Math.round(ensureNumber(config.marker_gap_px, 16)));
  const borderWidth = Math.max(1, Math.round(ensureNumber(config.border_width_px, 3)));
  const rowWidth = (totalCount * markerSize) + (Math.max(0, totalCount - 1) * markerGap);
  const requestedLeft = Math.round(ensureNumber(config.left_px, 160));
  const left = Math.max(0, Math.min(width - rowWidth, requestedLeft));
  const bottom = Math.max(0, Math.round(ensureNumber(config.bottom_px, 160)));
  const top = Math.max(0, Math.min(height - markerSize, height - bottom - markerSize));
  const fillStart = Math.max(0, ensureNumber(config.fill_start_seconds, 0.55));
  const fillStagger = Math.max(0, ensureNumber(config.fill_stagger_seconds, 0.16));
  const markerColors = Array.isArray(tracker.marker_colors) ? tracker.marker_colors : [];
  const filters = [];
  for (let markerIndex = 0; markerIndex < totalCount; markerIndex += 1) {
    const markerX = left + (markerIndex * (markerSize + markerGap));
    filters.push(
      `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=0x0A1726@0.82:t=fill`,
    );
    if (markerIndex < completedCount) {
      const fillAt = Math.min(
        Math.max(0, durationSeconds - 0.5),
        fillStart + (markerIndex * fillStagger),
      );
      const markerColor = String(markerColors[markerIndex] || '0x56C7FF');
      filters.push(
        `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=${markerColor}@0.96:t=fill:enable='gte(t,${roundTime(fillAt)})'`,
      );
    }
    filters.push(
      `drawbox=x=${markerX}:y=${top}:w=${markerSize}:h=${markerSize}:color=white@0.92:t=${borderWidth}`,
    );
  }
  return filters;
}

export function appendPokeballTransitionOverlay(filters, currentLabel, {
  index,
  inputRef,
  cutSeconds,
  directionMultiplier = 1,
  fps,
  durationSeconds,
  config = {},
}) {
  if (inputRef == null || config?.enabled === false) return currentLabel;
  const duration = Math.max(0.5, ensureNumber(durationSeconds, 1.15));
  const halfDuration = roundTime(duration / 2);
  const startSeconds = roundTime(Math.max(0, ensureNumber(cutSeconds, 0) - halfDuration));
  const endSeconds = roundTime(startSeconds + duration);
  const ballSize = Math.max(96, Math.round(ensureNumber(config.pokeball_size_px, 340)));
  const canvasSize = Math.ceil(ballSize * 1.36);
  const startScale = Math.max(0.01, ensureNumber(config.start_scale, 0.08));
  const coverScale = Math.max(startScale, ensureNumber(config.cover_scale, 7.2));
  const rotationTurns = Math.max(0, ensureNumber(config.rotation_turns, 1.25));
  const direction = ensureNumber(directionMultiplier, 1) < 0 ? -1 : 1;
  const phaseExpression = `if(lt(t,${halfDuration}),(1-cos(PI*t/${halfDuration}))/2,(1+cos(PI*(t-${halfDuration})/${roundTime(duration - halfDuration)}))/2)`;
  const scaleExpression = `${roundTime(startScale)}+${roundTime(coverScale - startScale)}*(${phaseExpression})`;
  const rotationExpression = `${direction * rotationTurns}*2*PI*t/${roundTime(duration)}`;
  const ballLabel = `transitionball${index}`;
  const outputLabel = `programtransition${index}`;
  filters.push(
    `[${inputRef}:v]fps=${fps},trim=duration=${roundTime(duration)},setpts=PTS-STARTPTS,scale=${ballSize}:${ballSize}:force_original_aspect_ratio=decrease,format=rgba,pad=${canvasSize}:${canvasSize}:(ow-iw)/2:(oh-ih)/2:color=black@0,rotate='${rotationExpression}':ow=iw:oh=ih:c=none,scale=w='${canvasSize}*(${scaleExpression})':h='${canvasSize}*(${scaleExpression})':eval=frame,setsar=1,setpts=PTS+${startSeconds}/TB[${ballLabel}]`,
  );
  filters.push(
    `[${currentLabel}][${ballLabel}]overlay=x='(W-w)/2':y='(H-h)/2':enable='between(t,${startSeconds},${endSeconds})':eof_action=pass[${outputLabel}]`,
  );
  return outputLabel;
}
