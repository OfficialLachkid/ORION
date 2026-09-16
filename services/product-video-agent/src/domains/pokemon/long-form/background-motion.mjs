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
  const scanPasses = Math.max(1, Math.round(ensureNumber(motionConfig.scan_passes, 3)));
  const scaledWidth = Math.ceil(width * zoomScale);
  const scaledHeight = Math.ceil(height * zoomScale);
  const duration = Math.max(1, ensureNumber(endSeconds, startSeconds + 1) - startSeconds);
  const progress = `((t-${fixed(startSeconds, 3)})/${fixed(duration, 3)})`;
  const scan = `acos(cos(${scanPasses}*PI*${progress}))/PI`;
  const horizontalProgress = chapterIndex % 2 === 0 ? scan : `(1-${scan})`;
  const verticalProgress = chapterIndex % 2 === 0 ? progress : `(1-${progress})`;
  const xExpression = `(iw-${width})*${horizontalProgress}`;
  const yExpression = `(ih-${height})*${verticalProgress}`;

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${width}:h=${height}:x='${xExpression}':y='${yExpression}'${blurFilter},setsar=1`;
}
