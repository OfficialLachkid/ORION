import { ensureNumber } from '../templates/dual-type-reveal/render/constants.mjs';

function fixed(value, digits = 6) {
  return Number(Number(value || 0).toFixed(digits));
}

export function buildLongFormBackgroundPreparationFilter({
  inputRef,
  width,
  height,
  fps,
  blurSigma,
  template,
  chapterIndex = 0,
  startSeconds = 0,
  endSeconds,
}) {
  const motionConfig = template?.layout?.background?.motion || {};
  const motionEnabled = motionConfig.enabled === true;
  const safeBlurSigma = Math.max(0, ensureNumber(blurSigma, 6));
  const blurFilter = safeBlurSigma > 0
    ? `,gblur=sigma=${fixed(safeBlurSigma, 3)}:steps=1`
    : '';

  if (!motionEnabled) {
    return `[${inputRef}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${blurFilter},fps=${fps},setsar=1`;
  }

  const zoomScale = Math.max(1.05, ensureNumber(motionConfig.zoom_scale, 1.3));
  const scaledWidth = Math.ceil(width * zoomScale);
  const scaledHeight = Math.ceil(height * zoomScale);
  const duration = Math.max(1, ensureNumber(endSeconds, startSeconds + 1) - startSeconds);
  const progress = `((t-${fixed(startSeconds, 3)})/${fixed(duration, 3)})`;
  const direction = chapterIndex % 2 === 0 ? 1 : -1;
  const phaseX = fixed((chapterIndex * 1.137) % (Math.PI * 2), 6);
  const phaseY = fixed(((chapterIndex * 0.731) + 1.047) % (Math.PI * 2), 6);
  const horizontalProgress = `(0.5+0.49*sin(2*PI*(0.72*${progress}*${direction})+${phaseX}))`;
  const verticalProgress = `(0.5+0.49*sin(2*PI*(0.43*${progress}*${direction})+${phaseY}))`;
  const xExpression = `(iw-${width})*${horizontalProgress}`;
  const yExpression = `(ih-${height})*${verticalProgress}`;

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${width}:h=${height}:x='${xExpression}':y='${yExpression}'${blurFilter},setsar=1`;
}
