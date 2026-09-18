import {
  ensureNumber,
  roundTime,
} from '../../templates/dual-type-reveal/render/constants.mjs';

function appendFrozenBackground(filters, {
  inputLabel,
  outputLabel,
  width,
  height,
  fps,
  durationSeconds,
  fallbackColor = '0x071426',
}) {
  const duration = roundTime(durationSeconds);
  if (!inputLabel) {
    filters.push(
      `color=c=${fallbackColor}:s=${width}x${height}:r=${fps}:d=${duration},format=rgba[${outputLabel}]`,
    );
    return;
  }
  filters.push(
    `[${inputLabel}]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,tpad=stop_mode=clone:stop_duration=${duration},trim=duration=${duration},fps=${fps},format=rgba[${outputLabel}]`,
  );
}

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

export function appendPokeballStingerCard(filters, programInputs, {
  index,
  inputRef,
  backgroundInputLabel = null,
  directionMultiplier = 1,
  width,
  height,
  fps,
  durationSeconds,
  accentColor,
  config = {},
}) {
  if (inputRef == null || config?.enabled === false) return false;
  const duration = Math.max(0.5, ensureNumber(durationSeconds, 1.15));
  const halfDuration = roundTime(duration / 2);
  const ballSize = Math.max(96, Math.round(ensureNumber(config.pokeball_size_px, 340)));
  const canvasSize = Math.ceil(ballSize * 1.36);
  const startScale = Math.max(0.01, ensureNumber(config.start_scale, 0.08));
  const coverScale = Math.max(startScale, ensureNumber(config.cover_scale, 7.2));
  const rotationTurns = Math.max(0, ensureNumber(config.rotation_turns, 1.25));
  const direction = ensureNumber(directionMultiplier, 1) < 0 ? -1 : 1;
  const phaseExpression = `if(lt(t,${halfDuration}),(1-cos(PI*t/${halfDuration}))/2,(1+cos(PI*(t-${halfDuration})/${roundTime(duration - halfDuration)}))/2)`;
  const scaleExpression = `${roundTime(startScale)}+${roundTime(coverScale - startScale)}*(${phaseExpression})`;
  const rotationExpression = `${direction * rotationTurns}*2*PI*t/${roundTime(duration)}`;
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  const baseLabel = `stingerbase${index}`;
  const ballLabel = `stingerball${index}`;
  const frozenBaseLabel = `stingerfrozen${index}`;
  appendFrozenBackground(filters, {
    inputLabel: backgroundInputLabel,
    outputLabel: frozenBaseLabel,
    width,
    height,
    fps,
    durationSeconds: duration,
  });
  filters.push(
    `[${frozenBaseLabel}]drawbox=x=0:y=0:w=${width}:h=${height}:color=${accentColor}@0.08:t=fill[${baseLabel}]`,
  );
  filters.push(
    `[${inputRef}:v]fps=${fps},trim=duration=${roundTime(duration)},setpts=PTS-STARTPTS,scale=${ballSize}:${ballSize}:force_original_aspect_ratio=decrease,format=rgba,pad=${canvasSize}:${canvasSize}:(ow-iw)/2:(oh-ih)/2:color=black@0,rotate='${rotationExpression}':ow=iw:oh=ih:c=none,scale=w='${canvasSize}*(${scaleExpression})':h='${canvasSize}*(${scaleExpression})':eval=frame,setsar=1[${ballLabel}]`,
  );
  filters.push(
    `[${baseLabel}][${ballLabel}]overlay=x='(W-w)/2':y='(H-h)/2':shortest=1,format=yuv420p[${videoLabel}]`,
  );
  filters.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${roundTime(duration)},asetpts=PTS-STARTPTS[${audioLabel}]`,
  );
  programInputs.push(`[${videoLabel}][${audioLabel}]`);
  return true;
}

export function appendKeyedTransitionCard(filters, programInputs, {
  index,
  inputRef,
  backgroundInputLabel,
  width,
  height,
  fps,
  durationSeconds,
  keyColor,
  similarity,
  blend,
  config = {},
}) {
  if (inputRef == null || !backgroundInputLabel || config?.enabled === false) return false;
  const duration = Math.max(0.5, ensureNumber(durationSeconds, 3));
  const baseLabel = `transitionbase${index}`;
  const sourceLabel = `transitionsource${index}`;
  const videoLabel = `cardv${index}`;
  const audioLabel = `carda${index}`;
  appendFrozenBackground(filters, {
    inputLabel: backgroundInputLabel,
    outputLabel: baseLabel,
    width,
    height,
    fps,
    durationSeconds: duration,
  });
  filters.push(
    `[${inputRef}:v]fps=${fps},setpts=PTS-STARTPTS,scale=${width}:${height}:flags=lanczos,setsar=1,format=rgba,colorkey=${String(keyColor || '0x00FF00')}:${roundTime(Math.max(0.01, ensureNumber(similarity, 0.22)))}:${roundTime(Math.max(0, ensureNumber(blend, 0.08)))},tpad=stop_mode=clone:stop_duration=${roundTime(duration)},trim=duration=${roundTime(duration)}[${sourceLabel}]`,
  );
  filters.push(
    `[${baseLabel}][${sourceLabel}]overlay=x=0:y=0:eof_action=pass:shortest=1,format=yuv420p[${videoLabel}]`,
  );
  filters.push(
    `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${roundTime(duration)},asetpts=PTS-STARTPTS[${audioLabel}]`,
  );
  programInputs.push(`[${videoLabel}][${audioLabel}]`);
  return true;
}
