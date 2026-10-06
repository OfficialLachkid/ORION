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
  const subpixelScale = Math.max(1, Math.min(2, ensureNumber(motionConfig.subpixel_scale, 1)));
  const viewportWidth = Math.ceil(width * subpixelScale);
  const viewportHeight = Math.ceil(height * subpixelScale);
  const normalizedWidth = Math.ceil(width * zoomScale * subpixelScale);
  const normalizedHeight = Math.ceil(height * zoomScale * subpixelScale);
  const duration = Math.max(1, ensureNumber(endSeconds, startSeconds + 1) - startSeconds);
  const progress = `((t-${fixed(startSeconds, 3)})/${fixed(duration, 3)})`;
  const direction = chapterIndex % 2 === 0 ? 1 : -1;
  const phaseX = fixed((chapterIndex * 1.137) % (Math.PI * 2), 6);
  const phaseY = fixed(((chapterIndex * 0.731) + 1.047) % (Math.PI * 2), 6);
  const horizontalProgress = `(0.5+0.49*sin(2*PI*(0.72*${progress}*${direction})+${phaseX}))`;
  const verticalProgress = `(0.5+0.49*sin(2*PI*(0.43*${progress}*${direction})+${phaseY}))`;
  const xExpression = `(iw-${viewportWidth})*${horizontalProgress}`;
  const yExpression = `(ih-${viewportHeight})*${verticalProgress}`;

  return `[${inputRef}:v]fps=${fps},scale=${normalizedWidth}:${normalizedHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=w=${normalizedWidth}:h=${normalizedHeight}:x='(iw-ow)/2':y='(ih-oh)/2',crop=w=${viewportWidth}:h=${viewportHeight}:x='${xExpression}':y='${yExpression}',scale=${width}:${height}:flags=lanczos${blurFilter},setsar=1`;
}
