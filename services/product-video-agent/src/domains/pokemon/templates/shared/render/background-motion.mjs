import { ensureNumber } from '../../dual-type-reveal/render/constants.mjs';

export function buildBackgroundPreparationFilter({
  inputRef,
  width,
  height,
  fps,
  blurSigma,
  template,
}) {
  const motionConfig = template?.layout?.background?.motion || {};
  const motionEnabled = motionConfig?.enabled === true;
  const safeBlurSigma = Math.max(0, ensureNumber(blurSigma, 0));
  const blurFilter = safeBlurSigma > 0
    ? `,gblur=sigma=${Number(safeBlurSigma.toFixed(3))}`
    : '';

  if (!motionEnabled) {
    return `[${inputRef}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}${blurFilter},fps=${fps},setsar=1`;
  }

  const zoomScale = Math.max(1.01, ensureNumber(motionConfig.zoom_scale, 1.12));
  const subpixelScale = Math.max(
    1,
    Math.min(3, Math.round(ensureNumber(motionConfig.subpixel_scale, 1))),
  );
  const panCycleSeconds = Math.max(4, ensureNumber(motionConfig.pan_cycle_seconds, 18));
  const verticalPanRatio = Math.max(
    0,
    Math.min(1, ensureNumber(motionConfig.vertical_pan_ratio, 0.72)),
  );
  const outputWidth = width * subpixelScale;
  const outputHeight = height * subpixelScale;
  const scaledWidth = Math.ceil(width * zoomScale * subpixelScale);
  const scaledHeight = Math.ceil(height * zoomScale * subpixelScale);
  const xSpeed = Number(((Math.PI * 2) / panCycleSeconds).toFixed(6));
  const ySpeed = Number((xSpeed * 0.73).toFixed(6));
  const xExpression = `(iw-${outputWidth})*(0.5+0.5*sin(t*${xSpeed}))`;
  const yExpression = `((ih-${outputHeight})*(1-${verticalPanRatio})/2)+((ih-${outputHeight})*${verticalPanRatio})*(0.5+0.5*cos(t*${ySpeed}))`;
  const subpixelDownscaleFilter = subpixelScale > 1
    ? `,scale=${width}:${height}:flags=lanczos`
    : '';

  return `[${inputRef}:v]fps=${fps},scale=${scaledWidth}:${scaledHeight}:force_original_aspect_ratio=increase,crop=w=${outputWidth}:h=${outputHeight}:x='${xExpression}':y='${yExpression}'${subpixelDownscaleFilter}${blurFilter},setsar=1`;
}
